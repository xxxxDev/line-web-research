// Build electron/extension from your own copy of the LINE Chrome extension.
// The LINE files are never part of this repository; see README.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.env.LINE_EXTENSION_DIR || path.join(root, 'vendor/line'));
const target = path.join(root, 'electron/extension');
const overlay = path.join(root, 'electron/overlay');
// Public key of the Chrome Web Store item ophjlpahpchlmihnnnihgmmeilfjmjjc.
// It keeps the extension ID that LINE's servers and main.cjs expect.
const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuOql7UFiY9pkxo4aAmuN2HHlZhNT5ws6knRdxYhOACJcm1sBfB7GIIMuBwtpYSb3B3m7jbrKqX2iDdgYLxE9ZmFjYgrD6p4D4H9/4FCz/a7h66vp0onNu2PmbZOEnpZKeCgUGMDDcXk673R8tPfkBbmuzQ0rvpc1Z8hWgHo1jLtnjpkTlH4vzu9FGRQFsCuqUzJPjoPpa2rozvTPpmiO2qfcqH3FJoGJbKwXIPZ74JI8cY//o6xFDVhugveN1VqoGZA8PsVliAa5fgBqDohfiv36xkuD88BqynKNn00hGibuXrj4L6mnR+9I68dhwAiXY01gihtI6KhbekToLfoJmwIDAQAB';
const SCRIPTS = '<script src="/electron-compat.js"></script><script src="/unread-mode.js"></script><script src="/theme-mode.js"></script>';
const MARKER = '.generated-by-prepare-electron-extension';

const manifestPath = path.join(source, 'manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`LINE extension not found in ${source}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.name !== 'LINE' || manifest.version !== '3.7.2') throw new Error(`Expected LINE 3.7.2, found ${manifest.name} ${manifest.version}`);

// Replace only a folder this script created, never an unrelated one.
if (fs.existsSync(target)) {
  if (!fs.existsSync(path.join(target, MARKER))) throw new Error(`${target} exists and was not made by this script`);
  fs.rmSync(target, { recursive: true });
}
fs.cpSync(source, target, { recursive: true, filter: file => path.basename(file) !== '_metadata' });
for (const name of fs.readdirSync(overlay)) fs.copyFileSync(path.join(overlay, name), path.join(target, name));

// No background worker or store updates; storage only; LINE hosts only.
delete manifest.update_url;
delete manifest.background;
manifest.permissions = ['storage'];
manifest.host_permissions = ['https://*.line.me/*', 'https://*.line-apps.com/*', 'https://*.line-scdn.net/*'];
manifest.key = KEY;
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const page of ['index.html', 'popup.html']) {
  const file = path.join(target, page);
  const html = fs.readFileSync(file, 'utf8');
  if (html.split('<head>').length !== 2) throw new Error(`Unrecognized ${page}`);
  fs.writeFileSync(file, html.replace('<head>', '<head>' + SCRIPTS));
}
fs.writeFileSync(path.join(target, MARKER), '');
console.log(`Prepared ${path.relative(root, target)} from ${source}`);
