const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { createServer } = require('./server.cjs');
const { createInstanceManager } = require('./instances.cjs');
const { createLoginVault, keychainKey } = require('./login-vault.cjs');
const { UPSTREAMS } = require('./server.cjs');
const directory = path.join(os.homedir(), 'Library/Application Support/line-web-research');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.chmodSync(directory, 0o700);
const socketPath = path.join(directory, 'service.sock');
// launchd runs one instance; remove only a stale socket, never an arbitrary file.
if (fs.existsSync(socketPath)) {
  if (!fs.lstatSync(socketPath).isSocket()) throw new Error('Unexpected control socket path');
  fs.unlinkSync(socketPath);
}
const countFile = path.join(directory, 'instances.json');
const BASE_PORT = 52426;
let config = { ids: [1], nextId: 2 };
if (fs.existsSync(countFile)) {
  const saved = JSON.parse(fs.readFileSync(countFile, 'utf8'));
  if (saved.ids === undefined) {
    if (!Number.isInteger(saved.count) || saved.count < 1 || saved.count > 8) throw new Error('Invalid instance count');
    config = { ids: Array.from({ length: saved.count }, (_, i) => i + 1), nextId: saved.count + 1 };
  } else {
    if (!Array.isArray(saved.ids) || saved.ids.length < 1 || saved.ids.length > 8
      || saved.ids[0] !== 1 || new Set(saved.ids).size !== saved.ids.length
      || saved.ids.some(id => !Number.isInteger(id) || id < 1 || BASE_PORT + id - 1 > 65535)
      || !Number.isInteger(saved.nextId) || saved.nextId <= Math.max(...saved.ids)) throw new Error('Invalid instance settings');
    config = { ids: saved.ids, nextId: saved.nextId };
  }
}
function saveSettings(value) {
  fs.writeFileSync(countFile + '.tmp', JSON.stringify(value) + '\n', { mode: 0o600 });
  fs.renameSync(countFile + '.tmp', countFile);
}
let starting = true;
let loginVault;
const manager = createInstanceManager({
  createServer: instances => createServer(undefined, { instances, loginVault }),
  basePort: BASE_PORT,
  initialNextId: config.nextId,
  saveState: value => { if (!starting) saveSettings(value); }
});
let control;
const fail = error => { console.error(error?.code === 'EADDRINUSE' ? 'LINE fixed port is occupied; service did not switch ports.' : 'LINE background service could not start.'); process.exit(1); };
(async () => {
  const vaultDirectory = path.join(directory, 'login-vault');
  // A missing Keychain item with existing vaults is a failure, not a reset.
  const hasVaults = fs.existsSync(vaultDirectory) && fs.readdirSync(vaultDirectory).some(name => name.endsWith('.vault'));
  loginVault = createLoginVault({ directory: vaultDirectory, key: keychainKey(undefined, !hasVaults), hosts: UPSTREAMS });
  for (const id of config.ids) await manager.create(id);
  saveSettings(config);
  starting = false;
  const url = new URL('/', manager.list()[0].url).href;
  control = net.createServer(client => {
    client.setTimeout(3000, () => client.destroy());
    let input = '';
    client.on('error', () => {});
    client.on('data', chunk => {
      input += chunk.toString();
      if (input.length > 32) { client.destroy(); return; }
      if (!input.includes('\n')) return;
      client.removeAllListeners('data');
      if (input !== 'open\n') { client.end('error\n'); return; }
      execFile('/usr/bin/open', [url], error => client.end(error ? 'error\n' : 'ok\n'));
    });
  });
  control.on('error', fail);
  control.listen(socketPath, () => { fs.chmodSync(socketPath, 0o600); console.log('LINE background service ready.'); });
})().catch(fail);
function stop() {
  control?.close(); manager.close().then(() => process.exit(0), () => process.exit(1));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
