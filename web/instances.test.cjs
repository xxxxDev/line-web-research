const test = require('node:test');
const assert = require('node:assert/strict');
require('./test-fixture.cjs');
const { createServer } = require('./server.cjs');
const { createInstanceManager } = require('./instances.cjs');
const make = options => createInstanceManager({ createServer: instances => createServer(undefined, {instances}), ...options });

test('ports and sessions are isolated; only same-origin pages may create instances', async () => {
  const manager = make();
  try {
    const a = await manager.create(), b = await manager.create();
    const originA = new URL(a.url).origin, originB = new URL(b.url).origin;
    assert.notEqual(originA, originB);
    const request = (origin, route, method = 'GET', headers = {}) => fetch(origin + route, {method, headers});
    const response = await request(originA, '/__session', 'POST', {origin: originA});
    const {id} = await response.json();
    assert.equal((await request(originB, '/__clear-login-cookie', 'POST', {origin: originB, 'x-line-web-session': id})).status, 403);
    assert.equal((await request(originA, '/__clear-login-cookie', 'POST', {origin: originA, 'x-line-web-session': id})).status, 204);
    assert.equal((await request(originA, '/__instances')).status, 403);
    assert.equal((await request(originA, '/__instances', 'POST', {origin: originB, 'x-line-web-action':'create-instance'})).status, 403);
    assert.equal((await request(originA, '/__instances', 'POST', {origin: originA})).status, 403);
    assert.equal(manager.list().length, 2);
    const created = await request(originA, '/__instances', 'POST', {origin: originA, 'x-line-web-action':'create-instance'});
    assert.equal(created.status, 201); assert.equal((await created.json()).id, '3');
    const listed = await request(originB, '/__instances', 'GET', {origin: originB});
    assert.equal((await listed.json()).length, 3);
  } finally { await manager.close(); }
});

test('concurrent creates respect limits and save only counts', async () => {
  const counts = [];
  const manager = make({limit: 3, saveCount: n => counts.push(n)});
  try {
    const results = await Promise.allSettled(Array.from({length:6}, () => manager.create()));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
    assert.deepEqual(counts, [1,2,3]);
    assert.equal(new Set(manager.list().map(i => i.url)).size, 3);
  } finally { await manager.close(); }
  await assert.rejects(manager.create(), /stopping/);
});

test('failed persistence closes the new listener and permits a clean retry', async () => {
  const servers = []; let fail = true;
  const manager = make({createServer: instances => { const server = createServer(undefined, {instances}); servers.push(server); return server; }, saveCount: () => {if (fail) throw new Error('disk unavailable');}});
  try {
    await assert.rejects(manager.create(), /disk unavailable/);
    assert.equal(servers[0].listening, false); assert.equal(manager.list().length, 0);
    fail = false; assert.equal((await manager.create()).id, '1');
  } finally { await manager.close(); }
});

test('cross-port top-level links work while cross-origin API and frame requests stay blocked', async () => {
  const http = require('node:http');
  const manager = make();
  try {
    const entry = await manager.create(); const origin = new URL(entry.url).origin;
    const request = (route, headers) => new Promise((resolve,reject) => {
      http.get(origin + route, {headers}, res => {res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);
    });
    const navigation = {'sec-fetch-site':'same-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
    assert.equal(await request('/index.html', navigation),200);
    assert.equal(await request('/', {...navigation,'sec-fetch-site':'cross-site'}),200);
    for (const route of ['/__session','/__instances','/proxy/line-chrome-gw.line-apps.com/file']) assert.equal(await request(route,navigation),403);
    assert.equal(await request('/index.html', {...navigation,'sec-fetch-dest':'iframe'}),403);
    assert.equal(await request('/index.html', {...navigation,'sec-fetch-mode':'cors'}),403);
    assert.equal(await request('/index.html', {...navigation,host:'evil.test'}),403);
  } finally { await manager.close(); }
});

test('deletion isolates other instances, protects main/current and never reuses IDs', async () => {
  let fail = false; const counts = [];
  const manager = make({saveCount: n => {if(fail) throw new Error('disk'); counts.push(n);}});
  try {
    const a = await manager.create(), b = await manager.create(), c = await manager.create();
    const origin = new URL(a.url).origin;
    const endpoint = origin + '/__instances/' + b.id;
    assert.equal((await fetch(endpoint,{method:'DELETE',headers:{origin}})).status,403);
    assert.equal((await fetch(endpoint,{method:'DELETE',headers:{origin:new URL(b.url).origin,'X-Line-Web-Action':'delete-instance'}})).status,403);
    await assert.rejects(manager.remove(a.id, origin));
    await assert.rejects(manager.remove(b.id, new URL(b.url).origin));
    fail = true; await assert.rejects(manager.remove(b.id, origin),/disk/);
    assert.equal((await fetch(new URL('/__health',b.url))).status,200);
    fail = false;
    assert.equal((await fetch(endpoint,{method:'DELETE',headers:{origin,'X-Line-Web-Action':'delete-instance'}})).status,204);
    await assert.rejects(fetch(new URL('/__health',b.url)));
    assert.equal((await fetch(new URL('/__health',c.url))).status,200);
    assert.equal((await fetch(new URL('/__health',a.url))).status,200);
    assert.deepEqual(manager.list().map(x=>x.id),['1','3']);
    assert.equal((await manager.create()).id,'4');
    assert.deepEqual(counts,[1,2,3,2,3]);
  } finally { await manager.close(); }
});

async function freePortBlock() {
  const net = require('node:net');
  for (let attempt = 0; attempt < 40; attempt++) {
    const base = 40000 + Math.floor(Math.random() * 10000), reservations = [];
    try {
      for (let i = 0; i < 4; i++) {
        const server = net.createServer(); reservations.push(server);
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(base + i, '127.0.0.1', resolve); });
      }
      return base;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
    finally { await Promise.all(reservations.map(s => new Promise(r => s.close(r)))); }
  }
  throw new Error('No free test ports');
}

test('fixed origins and deleted IDs survive restart without switching accounts', async () => {
  const basePort = await freePortBlock(); let saved;
  let manager = make({ basePort, saveState: value => { saved = value; } });
  try {
    const a = await manager.create(); await manager.create(); const c = await manager.create();
    assert.equal(new URL(a.url).port, String(basePort));
    assert.equal(new URL(c.url).port, String(basePort + 2));
    await manager.remove('2', new URL(a.url).origin);
    assert.deepEqual(saved, { ids: [1, 3], nextId: 4 });
    const restored = structuredClone(saved);
    await manager.close();
    manager = make({ basePort, initialNextId: restored.nextId, saveState: value => { saved = value; } });
    for (const id of restored.ids) await manager.create(id);
    assert.deepEqual(manager.list().map(e => e.url), [a.url, c.url]);
    const d = await manager.create();
    assert.equal(d.id, '4'); assert.equal(new URL(d.url).port, String(basePort + 3));
  } finally { await manager.close(); }
});

test('occupied fixed port fails without fallback or consuming an ID', async () => {
  const blocker = require('node:net').createServer();
  await new Promise(r => blocker.listen(0, '127.0.0.1', r));
  const basePort = blocker.address().port; let writes = 0;
  const manager = make({ basePort, saveState: () => { writes++; } });
  try {
    await assert.rejects(manager.create(), { code: 'EADDRINUSE' });
    assert.deepEqual(manager.list(), []); assert.equal(writes, 0);
    await new Promise(r => blocker.close(r));
    const entry = await manager.create();
    assert.equal(entry.id, '1'); assert.equal(new URL(entry.url).port, String(basePort));
  } finally { await manager.close(); if (blocker.listening) await new Promise(r => blocker.close(r)); }
});
