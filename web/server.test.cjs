const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { sandboxSource } = require('./test-fixture.cjs');
const { createServer, sameOrigin, storeCookies, cookieHeader, adaptSandboxSource } = require('./server.cjs');

test('local origin gate rejects hostile Host, Origin and Fetch Metadata', () => {
  const origin = 'http://127.0.0.1:8787';
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:8787', origin } }, origin, true), true);
  for (const headers of [{ host: 'evil.test:8787' }, { host: '127.0.0.1:8787', origin: 'https://evil.test' }, { host: '127.0.0.1:8787', 'sec-fetch-site': 'cross-site' }, { host: '127.0.0.1:8787', origin: 'null' }]) assert.equal(sameOrigin({ headers }, origin, true), false);
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:8787' } }, origin, true), false);
});
test('server-side cookies stay isolated by session, host, path and expiry', () => {
  const jar = new Map(), other = new Map(), host = 'line-chrome-gw.line-apps.com';
  storeCookies(jar, host, ['lct=synthetic; Path=/; Max-Age=30', 'file=narrow; Path=/files']);
  assert.equal(cookieHeader(jar, host, '/files/a'), 'file=narrow; lct=synthetic');
  assert.equal(cookieHeader(jar, host, '/files2'), 'lct=synthetic');
  assert.equal(cookieHeader(jar, 'obs.line-apps.com', '/'), '');
  assert.equal(cookieHeader(other, host, '/'), '');
  storeCookies(jar, host, ['lct=gone; Path=/; Max-Age=0']);
  assert.equal(cookieHeader(jar, host, '/'), '');
});
test('LTSM compatibility changes only one expected host import and fails closed on drift', { skip: !fs.existsSync(sandboxSource) && 'LINE extension not installed in vendor/line' }, () => {
  const original = fs.readFileSync(sandboxSource, 'utf8');
  const modified = adaptSandboxSource(original);
  assert.equal(modified.replace('w:function(){var e=window.origin,t=k(e)+1,r=nr(t);', 'w:function(){var e=window.location.origin,t=k(e)+1,r=nr(t);'), original);
  assert.throws(() => adaptSandboxSource('changed upstream'), /Unrecognized/);
});
test('HTTP routes protect sources and reject arbitrary proxies without contacting upstream', async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ method, hostname: '127.0.0.1', port, path: url, headers }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', s => body += s); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }); req.on('error', reject); req.end();
  });
  try {
    assert.equal((await request('/__health')).status, 200);
    const origin = `http://127.0.0.1:${port}`;
    assert.equal((await request('/__session', {}, 'POST')).status, 403);
    const session = await request('/__session', { origin }, 'POST');
    assert.equal(session.status, 200); assert.equal(session.headers['set-cookie'], undefined);
    const id = JSON.parse(session.body).id; assert.match(id, /^[a-f0-9]{64}$/);
    const again = await request('/__session', { origin, 'x-line-web-session': id }, 'POST');
    assert.equal(JSON.parse(again.body).id, id);
    assert.equal((await request('/__clear-login-cookie', { origin }, 'POST')).status, 403);
    assert.equal((await request('/__clear-login-cookie', { origin, 'x-line-web-session': id }, 'POST')).status, 204);
    assert.equal((await request('/proxy/line-chrome-gw.line-apps.com/file', { origin })).status, 401);
    const page = await request('/index.html'); assert.equal(page.status, 200); assert.ok(page.body.includes('/web-adapter.js')); assert.ok(!page.body.includes('electron-compat'));
    assert.equal((await request('/%2e%2e%2fpackage.json')).status, 403);
    assert.equal((await request('/proxy/127.0.0.1/secret', { 'sec-fetch-site': 'same-origin' })).status, 403);
    assert.equal((await request('/proxy/line-chrome-gw.line-apps.com.evil.test/file', { 'sec-fetch-site': 'same-origin' })).status, 403);
    assert.equal((await request('/proxy/line-chrome-gw.line-apps.com/file', { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await request('/', { Host: 'evil.test' })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('proxy keeps upstream cookies in memory and never forwards local capability', async () => {
  const { Writable, Readable } = require('node:stream');
  const forwarded = [];
  const server = createServer((options, callback) => {
    forwarded.push(options);
    const request = new Writable({ write(chunk, encoding, done) { done(); }, final(done) {
      const response = Readable.from(['{}']); response.statusCode = 200;
      response.headers = { 'content-type': 'application/json', 'set-cookie': ['lct=synthetic; Path=/; Secure'] };
      callback(response); done();
    } });
    request.setTimeout = () => request;
    return request;
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = async () => (await (await fetch(origin + '/__session', {method:'POST', headers:{origin}})).json()).id;
    const id = await session(), second = await session();
    const headers = {origin, 'x-line-web-session': id, 'x-hmac': 'test-signature'};
    const endpoint = origin + '/proxy/line-chrome-gw.line-apps.com/api/test';
    const first = await fetch(endpoint, {headers}); await first.text();
    assert.equal(first.status, 200); assert.equal(first.headers.get('set-cookie'), null);
    await (await fetch(endpoint, {headers})).text();
    await (await fetch(endpoint, {headers:{origin, 'x-line-web-session': second}})).text();
    assert.equal(forwarded[0].headers['x-line-web-session'], undefined);
    assert.equal(forwarded[0].headers['x-hmac'], 'test-signature');
    assert.equal(forwarded[0].headers.cookie, undefined);
    assert.equal(forwarded[1].headers.cookie, 'lct=synthetic');
    assert.equal(forwarded[2].headers.cookie, undefined);
    const sse = await fetch(origin + '/proxy/line-chrome-gw.line-apps.com/api/operation/receive?__lw_session=' + id, {headers:{origin}});
    await sse.text(); assert.equal(sse.status, 200);
    assert.equal(forwarded[3].path, '/api/operation/receive');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});


test('attachment upload preserves bytes and returns the OBS object ID', async () => {
  const { Writable, Readable } = require('node:stream');
  const payload = Buffer.from([0, 255, 13, 10, 128, 42]);
  let received, forwarded;
  const server = createServer((options, callback) => {
    forwarded = options;
    const chunks = [];
    const request = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); }, final(done) {
      received = Buffer.concat(chunks);
      const response = Readable.from(['']); response.statusCode = 201;
      response.headers = { 'x-obs-oid': 'synthetic-object-id', 'x-unrelated-private': 'omit-me', 'content-type': 'application/octet-stream', 'set-cookie': ['test=synthetic; Secure'] };
      callback(response); done();
    } });
    request.setTimeout = () => request;
    return request;
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const { id } = await (await fetch(origin + '/__session', { method: 'POST', headers: { origin } })).json();
    const response = await fetch(origin + '/proxy/obs.line-apps.com/r/talk/m/synthetic', {
      method: 'POST', headers: { origin, 'x-line-web-session': id, 'content-type': 'application/octet-stream', 'x-obs-params': 'synthetic-params' }, body: payload
    });
    await response.arrayBuffer();
    assert.equal(response.status, 201);
    assert.deepEqual(received, payload);
    assert.equal(forwarded.hostname, 'obs.line-apps.com');
    assert.equal(forwarded.headers['x-obs-params'], 'synthetic-params');
    assert.equal(forwarded.headers['x-line-web-session'], undefined);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-unrelated-private'), null);
    assert.equal(response.headers.get('x-obs-oid'), 'synthetic-object-id');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
