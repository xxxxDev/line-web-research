const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDownloadHost, suggestedName } = require('../download-host.cjs');
const origin = 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc';
test('untrusted filenames stay within one safe UTF-8 filename and preserve suffix', () => {
  assert.equal(suggestedName('../../folder\\報表.pdf'), '報表.pdf');
  const long = suggestedName('中'.repeat(200) + '.pdf');
  assert.ok(Buffer.byteLength(long) <= 240); assert.ok(long.endsWith('.pdf'));
  assert.equal(suggestedName('invoice\u202Efdp.exe'), 'invoicefdp.exe');
  assert.equal(suggestedName('..'), 'download');
});
test('capacity limit returns terminal events instead of stranding LINE promises', async () => {
  const events = [], session = new EventEmitter();
  const owner = { id: 1, getURL: () => origin + '/index.html', isDestroyed: () => false, send: (_channel, event) => events.push(event), downloadURL: () => {} };
  const host = createDownloadHost({ session, origin, trustedURL: url => url === origin + '/index.html', downloadsPath: '/tmp', reveal: () => {} });
  const ids = Array.from({ length: 9 }, (_, i) => host.start(owner, { url: `${'blob:' + origin}/00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, filename: 'test.txt' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(new Set(ids).size, 9);
  assert.ok(events.some(e => e.id === ids[8] && e.state.current === 'interrupted'));
  assert.throws(() => host.show({ ...owner, id: 2 }, ids[0]), /unavailable/);
});
