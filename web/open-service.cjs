const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const socket = path.join(os.homedir(), 'Library/Application Support/line-web-research/service.sock');
const domain = `gui/${process.getuid()}`;
const label = 'local.line-web-research';
execFileSync('/bin/launchctl', ['enable', `${domain}/${label}`], {stdio:'ignore'});
try { execFileSync('/bin/launchctl', ['print', `${domain}/${label}`], {stdio:'ignore'}); }
catch {
  try { execFileSync('/bin/launchctl', ['bootstrap', domain, path.join(os.homedir(), 'Library/LaunchAgents', label + '.plist')], {stdio:'ignore'}); }
  catch { console.error('Could not start the background service. Is the LaunchAgent installed? (scripts/install-launchagent.sh)'); process.exit(1); }
}
const deadline = Date.now() + 8000;
function connect() {
  const client = net.createConnection(socket);
  client.setTimeout(3000, () => client.destroy(new Error('timeout')));
  client.once('connect', () => client.write('open\n'));
  let result = '';
  client.on('data', data => result += data);
  client.once('end', () => { if (result.trim() !== 'ok') { console.error('Could not open the browser.'); process.exitCode = 1; } });
  client.once('error', () => {
    if (Date.now() < deadline) setTimeout(connect, 300);
    else { console.error('The background service is not ready. See ~/Library/Application Support/line-web-research/service.log'); process.exitCode = 1; }
  });
}
connect();
