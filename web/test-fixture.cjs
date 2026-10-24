const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Tests run without LINE's files: route tests then use a minimal synthetic page.
const sandboxSource = path.resolve(process.env.LINE_EXTENSION_DIR || path.join(__dirname, '../vendor/line'), 'static/js/ltsmSandbox.js');
if (!fs.existsSync(sandboxSource)) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'line-extension-fixture-'));
  fs.writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><html><head><script defer="defer" src="/static/js/main.js"></script></head><body></body></html>');
  process.env.LINE_EXTENSION_DIR = fixture;
}
module.exports = { sandboxSource };
