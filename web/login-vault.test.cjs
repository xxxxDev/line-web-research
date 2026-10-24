const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const { createLoginVault, keychainKey, IDLE_MS } = require('./login-vault.cjs');
const { createServer, UPSTREAMS, storeCookies } = require('./server.cjs');
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'line-vault-test-'));
  const key = randomBytes(32); let clock = Date.now();
  const vault = () => createLoginVault({ directory, key, hosts: UPSTREAMS, now: () => clock });
  return { directory, key, vault, now: () => clock, advance: ms => { clock += ms; }, clean: () => fs.rmSync(directory, {recursive:true,force:true}) };
}
const origin = 'http://127.0.0.1:52426', id = 'a'.repeat(64);
function state() {
  const jar = new Map();
  storeCookies(jar, 'line-chrome-gw.line-apps.com', ['lct=synthetic-only-secret; Path=/; Secure', 'narrow=synthetic-narrow; Path=/files; Max-Age=60']);
  return { jar, used: Date.now() };
}
test('vault stores only ciphertext with private permissions, and survives a fresh instance', () => {
  const f = fixture();
  try {
    const saved = state(); f.vault().save(origin,id,saved);
    assert.equal(fs.statSync(f.directory).mode & 0o777,0o700);
    const file = path.join(f.directory,fs.readdirSync(f.directory)[0]);
    assert.equal(fs.statSync(file).mode & 0o777,0o600);
    const blob=fs.readFileSync(file);
    assert.equal(blob.includes(Buffer.from('synthetic-only-secret')),false);
    assert.deepEqual(f.vault().load(origin,id).jar,saved.jar);
    f.vault().save(origin,id,saved); assert.notDeepEqual(fs.readFileSync(file),blob,'fresh GCM nonce');
  } finally { f.clean(); }
});
test('binding, tampering, wrong keys, unsafe files and hostile IDs fail closed', () => {
  const f = fixture();
  try {
    const v=f.vault(); v.save(origin,id,state());
    assert.equal(v.load(origin,'../secret'),null);
    assert.equal(v.load('http://127.0.0.1:52427',id),null);
    const name=fs.readdirSync(f.directory)[0],file=path.join(f.directory,name),blob=fs.readFileSync(file);
    const wrong=createLoginVault({directory:f.directory,key:randomBytes(32),hosts:UPSTREAMS});
    assert.throws(()=>wrong.load(origin,id),/authenticate/);
    const other='http://127.0.0.1:52427';
    const destination=path.join(f.directory,'52427-'+createHash('sha256').update(other+'\n'+id).digest('hex')+'.vault');
    fs.writeFileSync(destination,blob,{mode:0o600}); assert.throws(()=>v.load(other,id),/authenticate/);
    blob[20]^=1; fs.writeFileSync(file,blob); assert.throws(()=>v.load(origin,id),/authenticate/);
    fs.chmodSync(file,0o644); assert.throws(()=>v.load(origin,id),/Unsafe/);
    fs.unlinkSync(file); fs.symlinkSync(destination,file); assert.throws(()=>v.load(origin,id),/Cannot read/);
  } finally { f.clean(); }
});
test('cookie expiry and 90 day inactivity are preserved, invalid cookie headers cannot be saved', () => {
  const f=fixture();
  try {
    const saved=state(),v=f.vault();v.save(origin,id,saved);f.advance(61000);
    assert.equal(v.load(origin,id).jar.size,1);
    f.advance(IDLE_MS);assert.equal(v.load(origin,id),null);
    const invalid=state();invalid.jar.set('bad',{host:'evil.test',name:'cookie',value:'bad',path:'/',expires:Infinity});
    assert.throws(()=>v.save(origin,id,invalid),/Invalid login cookie/);
    invalid.jar.delete('bad');invalid.jar.values().next().value.value='x\r\nInjected: bad';
    assert.throws(()=>v.save(origin,id,invalid),/Invalid login cookie/);
  } finally {f.clean();}
});
test('Keychain setup keeps secrets out of argv; unavailable or missing existing keys never reset',()=>{
  const secret='a'.repeat(64);let calls=0;
  assert.deepEqual(keychainKey(()=>({status:0,stdout:secret+'\n'})),Buffer.from(secret,'hex'));
  assert.throws(()=>keychainKey(()=>({status:36,stdout:''})),/unavailable/);
  assert.throws(()=>keychainKey(()=>({status:44,stdout:''}),false),/unavailable/);
  const commands=[];let created;
  const result=keychainKey((bin,args,options)=>{
    commands.push({bin,args});calls++;
    if(calls===1)return {status:44,stdout:''};
    if(calls===2){assert.deepEqual(args,['-i']);created=options.input.match(/-w ([a-f0-9]{64})/)[1];return {status:0,stdout:''};}
    return {status:0,stdout:created+'\n'};
  });
  assert.equal(result.toString('hex'),created);
  assert.ok(commands.every(c=>!c.args.some(a=>a.includes(created))));
});
function mockUpstream(pending) {
  const seen=[];
  const request=(options,callback)=>{
    seen.push(options);
    const req=new Writable({write(_c,_e,done){done();},final(done){
      const send=(cookies=[])=>{
        const response=Readable.from(['{}']);response.statusCode=200;response.headers={'content-type':'application/json','set-cookie':cookies};callback(response);
      };
      if(options.path==='/pending'){pending(send);}
      else send(options.path==='/set' ? ['lct=synthetic-only-secret; Path=/; Secure'] : []);
      done();
    }});req.setTimeout=()=>req;return req;
  };return {seen,request};
}
async function listen(server,port=0){await new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);});return `http://127.0.0.1:${server.address().port}`;}
async function close(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
async function session(url,token=''){const r=await fetch(url+'/__session',{method:'POST',headers:{connection:'close',origin:url,'x-line-web-session':token}});assert.equal(r.status,200);return (await r.json()).id;}
async function proxy(url,token,route,method='GET'){const r=await fetch(url+'/proxy/line-chrome-gw.line-apps.com'+route,{method,headers:{connection:'close',origin:url,'x-line-web-session':token}});await r.text();return r;}
test('browser session resumes after service restart, stays isolated across ports/profiles, never leaks upstream',async()=>{
  const f=fixture(),mock=mockUpstream();let server=createServer(mock.request,{loginVault:f.vault()}),other;
  try {
    const url=await listen(server),port=server.address().port;
    const token=await session(url);await proxy(url,token,'/set');
    await close(server);server=createServer(mock.request,{loginVault:f.vault()});await listen(server,port);
    // Existing tab can also resume, before a reload issues /__session.
    await proxy(url,token,'/check');assert.equal(mock.seen.at(-1).headers.cookie,'lct=synthetic-only-secret');
    assert.equal(await session(url,token),token);
    const another=await session(url);await proxy(url,another,'/check');assert.equal(mock.seen.at(-1).headers.cookie,undefined);
    other=createServer(mock.request,{loginVault:f.vault()});const urlOther=await listen(other);
    assert.notEqual(await session(urlOther,token),token);
    assert.equal((await proxy(urlOther,token,'/check')).status,401);
    assert.ok(mock.seen.every(o=>o.headers['x-line-web-session']===undefined));
    const foreign=await fetch(url+'/__session',{method:'POST',headers:{origin:'https://evil.test','x-line-web-session':token}});assert.equal(foreign.status,403);
  } finally {if(other)await close(other);await close(server);f.clean();}
});
test('logout clears all persistent cookies and late responses cannot resurrect them',async()=>{
  const f=fixture();let ready,send;const started=new Promise(r=>ready=r);
  const mock=mockUpstream(callback=>{send=callback;ready();});
  let server=createServer(mock.request,{loginVault:f.vault()});
  try {
    const url=await listen(server),port=server.address().port,token=await session(url);
    await proxy(url,token,'/set');
    const pending=proxy(url,token,'/pending');await started;
    await proxy(url,token,'/api/talk/thrift/Talk/AuthService/logoutV2','POST');
    assert.equal(mock.seen.at(-1).headers.cookie,'lct=synthetic-only-secret');
    send(['lct=late-synthetic-secret; Path=/']);await pending;
    await close(server);server=createServer(mock.request,{loginVault:f.vault()});await listen(server,port);
    const fresh=await session(url,token);assert.notEqual(fresh,token);await proxy(url,fresh,'/check');
    assert.equal(mock.seen.at(-1).headers.cookie,undefined);
    assert.equal((await proxy(url,token,'/check')).status,401);
    await proxy(url,fresh,'/set');
    const cleared=await fetch(url+'/__clear-login-cookie',{method:'POST',headers:{connection:'close',origin:url,'x-line-web-session':fresh}});assert.equal(cleared.status,204);
    await close(server);server=createServer(mock.request,{loginVault:f.vault()});await listen(server,port);
    const afterClear=await session(url,fresh);await proxy(url,afterClear,'/check');assert.equal(mock.seen.at(-1).headers.cookie,undefined);
    assert.equal(fs.readdirSync(f.directory).length,0);
  } finally {await close(server);f.clean();}
});
test('persistent failures return generic errors without plaintext cookies or memory fallback',async()=>{
  const mock=mockUpstream();
  const vault={idleMs:IDLE_MS,load(){return null;},save(){throw new Error('synthetic-secret-do-not-leak');}};
  const server=createServer(mock.request,{loginVault:vault});
  try {
    const url=await listen(server),token=await session(url);
    const response=await proxy(url,token,'/set');assert.equal(response.status,503);
    const sent=mock.seen.length;
    assert.equal((await proxy(url,token,'/check','POST')).status,503,'save failure cannot silently fall back to memory-only login');
    assert.equal(mock.seen.length,sent,'known persistence failure blocks upstream side effects');
    vault.load=()=>{throw new Error('synthetic-secret-do-not-leak');};
    const failed=await fetch(url+'/__session',{method:'POST',headers:{connection:'close',origin:url,'x-line-web-session':'b'.repeat(64)}});
    assert.equal(failed.status,503);assert.equal((await failed.text()).includes('synthetic-secret'),false);
  } finally {await close(server);}
});

test('expired and cleared snapshots release file quota instead of accumulating tombstones',()=>{
  const f=fixture();
  try {
    const v=f.vault();
    for(let i=1;i<=256;i++)v.save(origin,i.toString(16).padStart(64,'0'),state());
    assert.equal(fs.readdirSync(f.directory).length,256);
    const extra='f'.repeat(64);
    assert.throws(()=>v.save(origin,extra,state()),/session limit/);
    f.advance(IDLE_MS+60000);
    const fresh=state();fresh.used=Date.now()+IDLE_MS+60000;
    v.save(origin,extra,fresh);
    assert.equal(fs.readdirSync(f.directory).length,1);
    fresh.jar.clear();v.save(origin,extra,fresh);
    assert.equal(fs.readdirSync(f.directory).length,0);
  } finally {f.clean();}
});

test('already open tabs cannot revive an idle-expired session through the proxy',async()=>{
  const f=fixture(),mock=mockUpstream();
  const server=createServer(mock.request,{loginVault:f.vault(),now:f.now});
  try {
    const url=await listen(server),token=await session(url);await proxy(url,token,'/set');
    const sent=mock.seen.length;f.advance(IDLE_MS+60000);
    assert.equal((await proxy(url,token,'/check')).status,401);
    assert.equal(mock.seen.length,sent);
    assert.equal(fs.readdirSync(f.directory).length,0);
  } finally {await close(server);f.clean();}
});
