(() => {
  const host = window.lineHost;
  if (!host) throw new Error('LINE Electron bridge is unavailable');
  const call = (method, data, callback) => {
    const promise = host.invoke(method, data);
    if (typeof callback === 'function') promise.then(callback).catch(error => console.error('LINE host operation failed:', method, error.message));
    return promise;
  };
  const event = () => {
    const listeners = new Set();
    return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), hasListener: f => listeners.has(f), emit: (...args) => listeners.forEach(f => f(...args)) };
  };
  const clicked = event(), closed = event();
  const downloadListeners = new Set(), downloadResults = new Map();
  host.onDownload(change => {
    downloadResults.set(change.id, change);
    if (downloadResults.size > 128) downloadResults.delete(downloadResults.keys().next().value);
    downloadListeners.forEach(f => f(change));
  });
  chrome.downloads = {
    download: (options, callback) => call('download', options, callback),
    open: id => call('showDownload', { id }),
    onChanged: {
      addListener: f => {
        downloadListeners.add(f);
        // Tiny blobs can complete before LINE registers its listener after await.
        queueMicrotask(() => { for (const change of downloadResults.values()) if (downloadListeners.has(f)) f(change); });
      },
      removeListener: f => downloadListeners.delete(f),
      hasListener: f => downloadListeners.has(f)
    }
  };
  host.onNotification(({ name, id }) => (name === 'clicked' ? clicked : closed).emit(id));
  chrome.tabs.getZoom = (...args) => call('zoom', {}, args.find(x => typeof x === 'function'));
  chrome.windows = {
    getCurrent: callback => call('currentWindow', {}, callback),
    getAll: callback => call('allWindows', {}, callback),
    update: (id, options, callback) => call('focus', { id }, callback)
  };
  chrome.action = { ...chrome.action, setBadgeText: options => call('badge', options) };
  chrome.notifications = {
    onClicked: clicked, onClosed: closed,
    create: (id, options, callback) => call('notify', { id, ...options }, callback),
    clear: (id, callback) => call('clearNotification', { id }, callback)
  };
  chrome.cookies = { remove: (details, callback) => call('removeLoginCookie', details, callback) };
})();
