const path = require('node:path');

function suggestedName(value) {
  const name = path.posix.basename(String(value || 'download').replace(/\\/g, '/'))
    .replace(/\p{Cf}/gu, '').replace(/[\x00-\x1f\x7f:]/g, '_');
  if (!name || /^\.+$/.test(name)) return 'download';
  const suffix = path.extname(name);
  const extension = Buffer.byteLength(suffix) <= 32 ? suffix : '';
  const stem = Array.from(extension ? name.slice(0, -extension.length) : name);
  while (Buffer.byteLength(stem.join('') + extension) > 240) stem.pop();
  return stem.join('') + extension || 'download';
}

function createDownloadHost({ session, origin, trustedURL, downloadsPath, reveal }) {
  let nextId = 1;
  const records = new Map();
  const pending = new Map();
  function emit(record, state, error) {
    if (record.owner.isDestroyed()) return;
    record.owner.send('line-download', { id: record.id, state: { current: state }, ...(error ? { error: { current: error } } : {}) });
  }
  function finish(record, state, error) {
    if (record.finished) return;
    record.finished = true;
    clearTimeout(record.timer);
    if (pending.get(record.key) === record) pending.delete(record.key);
    emit(record, state, error);
    const completed = [...records.values()].filter(r => r.finished);
    for (const old of completed.slice(0, Math.max(0, completed.length - 128))) records.delete(old.id);
  }
  session.on('will-download', (event, item, owner) => {
    const key = `${owner?.id}:${item.getURL()}`;
    const record = pending.get(key);
    // Only downloads explicitly requested by the authorized top-level IPC bridge.
    if (!record || owner !== record.owner || !trustedURL(owner.getURL()) || item.getInitiatorOrigin() !== origin) {
      event.preventDefault(); if (record) finish(record, 'interrupted', 'USER_CANCELED'); return;
    }
    pending.delete(key);
    clearTimeout(record.timer);
    item.setSaveDialogOptions({ title: 'Save LINE File', defaultPath: path.join(downloadsPath, record.filename), buttonLabel: 'Save' });
    // Deliberately do not accept a destination path from the renderer.
    // Chromium presents the native Save dialog, including overwrite confirmation.
    item.once('done', (_event, state) => {
      if (state === 'completed') {
        record.savedPath = item.getSavePath();
        finish(record, 'complete');
      } else finish(record, 'interrupted', state === 'cancelled' ? 'USER_CANCELED' : 'FILE_FAILED');
    });
  });
  return {
    start(owner, options) {
      if (!trustedURL(owner.getURL()) || !options || typeof options.url !== 'string' ||
          !new RegExp(`^blob:${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[0-9a-f-]{36}$`, 'i').test(options.url)) {
        throw new Error('Only LINE attachment blobs can be downloaded');
      }
      const key = `${owner.id}:${options.url}`;
      const busy = [...records.values()].filter(r => !r.finished && r.owner === owner).length >= 8 || pending.has(key);
      const record = { id: nextId++, key, owner, filename: suggestedName(options.filename), finished: false };
      records.set(record.id, record);
      if (busy) {
        // LINE swallows rejected download() promises and would wait forever.
        // A valid request always receives an ID and a matching terminal event.
        setImmediate(() => finish(record, 'interrupted', 'USER_CANCELED'));
        return record.id;
      }
      pending.set(key, record);
      record.timer = setTimeout(() => finish(record, 'interrupted', 'NETWORK_FAILED'), 30000);
      record.timer.unref();
      try { owner.downloadURL(options.url); }
      catch { setImmediate(() => finish(record, 'interrupted', 'NETWORK_FAILED')); }
      return record.id;
    },
    show(owner, id) {
      const record = records.get(id);
      if (!record || record.owner !== owner || !record.finished || !record.savedPath) throw new Error('Download unavailable');
      // Reveal the file; never automatically execute a downloaded attachment.
      reveal(record.savedPath);
    }
  };
}
module.exports = { createDownloadHost, suggestedName };
