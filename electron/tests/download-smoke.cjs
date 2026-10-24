const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = async ({ window, session, root }) => {
  const directory = fs.mkdtempSync(path.join(root, 'download-test-'));
  const observed = [];
  let cancelNext = false;
  // Test-only selection of a path stands in for the native save dialog.
  // Production code never accepts a destination path from the renderer.
  const selectDestination = (_event, item) => {
    const suggested = item.getSaveDialogOptions().defaultPath;
    const name = path.basename(suggested);
    observed.push({ name, title: item.getSaveDialogOptions().title });
    assert.equal(item.getSaveDialogOptions().title, 'Save LINE File');
    if (cancelNext) { cancelNext = false; item.cancel(); }
    else item.setSavePath(path.join(directory, name));
  };
  session.on('will-download', selectDestination);
  const download = async (name, size, delay = 0) => window.webContents.executeJavaScript(`(async()=>{
    const bytes = Uint8Array.from({length:${size}}, (_,i)=>i%251);
    const url = URL.createObjectURL(new Blob([bytes], {type:'application/octet-stream'}));
    try {
      const id = await chrome.downloads.download({url,filename:${JSON.stringify(name)},saveAs:true});
      if (${delay}) await new Promise(resolve=>setTimeout(resolve,${delay}));
      return await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{chrome.downloads.onChanged.removeListener(listener);reject(new Error('Download completion timed out'));},15000);
        const listener=change=>{
          if(change.id!==id)return;
          if(['complete','interrupted'].includes(change.state?.current)){
            clearTimeout(timeout);chrome.downloads.onChanged.removeListener(listener);resolve(change);
          }
        };
        chrome.downloads.onChanged.addListener(listener);
      });
    } finally { URL.revokeObjectURL(url); }
  })()`, true);
  try {
    const small = await download('測試附件.txt', 513, 500);
    assert.equal(small.state.current, 'complete');
    assert.deepEqual(fs.readFileSync(path.join(directory, '測試附件.txt')), Buffer.from(Array.from({ length: 513 }, (_, i) => i % 251)));
    const large = await download('../../測試二進位.bin', 2 * 1024 * 1024);
    assert.equal(large.state.current, 'complete');
    const expected = Buffer.alloc(2 * 1024 * 1024); for (let i = 0; i < expected.length; i++) expected[i] = i % 251;
    assert.deepEqual(fs.readFileSync(path.join(directory, '測試二進位.bin')), expected);
    const concurrent = await Promise.all([download('parallel-a.bin', 4096), download('parallel-b.bin', 8192)]);
    assert.ok(concurrent.every(result => result.state.current === 'complete'));
    cancelNext = true;
    const cancelled = await download('cancelled.txt', 50);
    assert.equal(cancelled.state.current, 'interrupted');
    assert.equal(cancelled.error.current, 'USER_CANCELED');
    assert.equal(fs.existsSync(path.join(directory, 'cancelled.txt')), false);
    const rejected = await window.webContents.executeJavaScript(`(async()=>{
      const urls=['file:///etc/passwd','https://example.com/file','data:text/plain,example','blob:https://example.com/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'];
      return Promise.all(urls.map(async url=>{try{await chrome.downloads.download({url,filename:'denied.txt'});return false}catch{return true}}));
    })()`);
    assert.ok(rejected.every(Boolean));
    const result = { smallBlobByteMatch: true, lateCompletionListener: true, binary2MiBByteMatch: true, filenameTraversalStripped: true, concurrentDownloads: true, cancellationReported: true, cancelledFileAbsent: true, disallowedURLsRejected: true, nativeSaveDialogConfigured: observed.every(o => o.title === 'Save LINE File'), savedCount: 4, binarySHA256: crypto.createHash('sha256').update(expected).digest('hex'), limitation: 'Synthetic blobs only; test chooses destination in will-download; real LINE account and interactive save dialog not exercised.' };
    fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'evidence/download-smoke.json'), JSON.stringify(result, null, 2));
    console.log('DOWNLOAD_SMOKE', JSON.stringify(result));
  } finally { session.removeListener('will-download', selectDestination); }
};
