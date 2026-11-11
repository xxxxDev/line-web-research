const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash, createCipheriv, createDecipheriv } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const IDLE_MS = 90 * 86400000;
const MAX_BYTES = 128 * 1024;
const KEYCHAIN_SERVICE = 'local.line-web-research.login-vault.v1';
const KEYCHAIN_ACCOUNT = 'aes-256-gcm';

function keychainKey(run = spawnSync, allowCreate = true) {
  const options = { encoding: 'utf8', timeout: 15000, maxBuffer: 4096 };
  const args = ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w'];
  const found = run('/usr/bin/security', args, options);
  if (found.status === 0) {
    const secret = found.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid login vault key');
    return Buffer.from(secret, 'hex');
  }
  // Only item-not-found may create a key. Locked/denied Keychain never resets it.
  if (!allowCreate || found.status !== 44) throw new Error('Login vault Keychain unavailable');
  const secret = randomBytes(32).toString('hex');
  // Pass the key on stdin to security's command parser, never in argv/env/logs.
  // No -A or -U: do not weaken ACLs or overwrite an existing/racing key.
  const input = `add-generic-password -a ${KEYCHAIN_ACCOUNT} -s ${KEYCHAIN_SERVICE} -w ${secret}\n`;
  const added = run('/usr/bin/security', ['-i'], { ...options, input });
  if (added.status !== 0) throw new Error('Cannot create login vault Keychain item');
  const verified = run('/usr/bin/security', args, options);
  if (verified.status !== 0 || verified.stdout.trim() !== secret) throw new Error('Cannot verify login vault Keychain item');
  return Buffer.from(secret, 'hex');
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error('Unsafe login vault directory');
  fs.chmodSync(directory, 0o700);
}

function createLoginVault({ directory, key, hosts, now = Date.now, idleMs = IDLE_MS }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid login vault key');
  privateDirectory(directory);
  const binding = (origin, id) => {
    const u = new URL(origin);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.origin !== origin || !u.port || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid login vault binding');
    return createHash('sha256').update(origin + '\n' + id).digest('hex');
  };
  const aad = (origin, hash) => Buffer.from(`line-web-research-v1\n${origin}\n${hash}`);
  const filename = (origin, hash) => path.join(directory, new URL(origin).port + '-' + hash + '.vault');
  function readRecord(file, origin, hash) {
    let fd;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (e) { if (e.code === 'ENOENT') return null; throw new Error('Cannot read login vault'); }
    let blob;
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o077) || st.size > MAX_BYTES || st.size < 29) throw new Error('Unsafe login vault file');
      blob = Buffer.alloc(st.size);
      if (fs.readSync(fd, blob, 0, blob.length, 0) !== blob.length) throw new Error('Incomplete login vault');
    } finally { fs.closeSync(fd); }
    try {
      if (blob[0] !== 1) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13));
      decipher.setAAD(aad(origin, hash)); decipher.setAuthTag(blob.subarray(-16));
      const plain = Buffer.concat([decipher.update(blob.subarray(13, -16)), decipher.final()]);
      const value = JSON.parse(plain);
      if (value.v !== 1 || !Number.isFinite(value.used) || value.used > now() + 60000 || !Array.isArray(value.cookies) || value.cookies.length > 128) throw new Error();
      return value;
    } catch { throw new Error('Cannot authenticate login vault'); }
  }
  function syncDirectory() {
    const fd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function removeFile(file) {
    fs.unlinkSync(file); syncDirectory();
  }
  function pruneExpired() {
    let changed = false;
    for (const name of fs.readdirSync(directory)) {
      const match = /^([0-9]{1,5})-([a-f0-9]{64})\.vault$/.exec(name);
      if (!match) continue;
      const file = path.join(directory, name);
      const value = readRecord(file, `http://127.0.0.1:${Number(match[1])}`, match[2]);
      if (value && (now() - value.used > idleMs || !value.cookies.some(c => c.expires === null || c.expires > now()))) { fs.unlinkSync(file); changed = true; }
    }
    if (changed) syncDirectory();
  }
  function cookies(jar) {
    if (!(jar instanceof Map) || jar.size > 128) throw new Error('Invalid login cookie jar');
    const values = [];
    for (const c of jar.values()) {
      if (!hosts.has(c.host) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.name)
        || typeof c.path !== 'string' || !c.path.startsWith('/') || c.path.length > 2048
        || typeof c.value !== 'string' || c.value.length > 16384 || /[\r\n\x00]/.test(c.value)
        || !(c.expires === Infinity || Number.isFinite(c.expires))) throw new Error('Invalid login cookie');
      if (c.expires > now()) values.push({ host: c.host, path: c.path, name: c.name, value: c.value, expires: c.expires === Infinity ? null : c.expires });
    }
    return values;
  }
  return {
    idleMs,
    save(origin, id, state) {
      const hash = binding(origin, id);
      const target = filename(origin, hash), values = cookies(state.jar);
      if (!values.length) {
        if (fs.existsSync(target)) removeFile(target);
        return;
      }
      const plain = Buffer.from(JSON.stringify({ v: 1, used: state.used, cookies: values }));
      if (plain.length > MAX_BYTES - 29) throw new Error('Login vault size limit');
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(origin, hash));
      const encrypted = Buffer.concat([Buffer.from([1]), iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
      if (!fs.existsSync(target)) {
        pruneExpired();
        if (fs.readdirSync(directory).filter(n => n.endsWith('.vault')).length >= 256) throw new Error('Login vault session limit');
      }
      const temp = target + '.' + randomBytes(8).toString('hex') + '.tmp';
      let fd;
      try {
        fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.renameSync(temp, target);
        syncDirectory();
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      }
    },
    load(origin, id) {
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null;
      const hash = binding(origin, id), target = filename(origin, hash);
      const value = readRecord(target, origin, hash);
      if (!value) return null;
      if (now() - value.used > idleMs) { removeFile(target); return null; }
      try {
        const jar = new Map();
        for (const c of value.cookies) {
          if (c.expires === null) c.expires = Infinity;
          jar.set(JSON.stringify([c.host, c.path, c.name]), c);
        }
        const valid = cookies(jar);
        if (!valid.length) { removeFile(target); return null; }
        return { used: value.used, jar: new Map(valid.map(c => {
          if (c.expires === null) c.expires = Infinity;
          return [JSON.stringify([c.host, c.path, c.name]), c];
        })) };
      } catch { throw new Error('Cannot authenticate login vault'); }
    }
  };
}
module.exports = { createLoginVault, keychainKey, IDLE_MS };
