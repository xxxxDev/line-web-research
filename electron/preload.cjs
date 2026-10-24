const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'chrome-extension:' && location.hostname === 'ophjlpahpchlmihnnnihgmmeilfjmjjc' && ['/index.html', '/popup.html'].includes(location.pathname) && process.isMainFrame) {
  contextBridge.exposeInMainWorld('lineHost', {
    invoke: (method, data) => ipcRenderer.invoke('line-host', method, data),
    onDownload: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('line-download', listener);
      return () => ipcRenderer.removeListener('line-download', listener);
    },
    onNotification: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('line-notification', listener);
      return () => ipcRenderer.removeListener('line-notification', listener);
    }
  });
}
