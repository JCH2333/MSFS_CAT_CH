const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('gsxTool', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  catalog: {
    refresh: () => ipcRenderer.invoke('catalog:refresh')
  },
  patches: {
    chooseTarget: (options) => ipcRenderer.invoke('patch:choose-target', options),
    listInstallations: () => ipcRenderer.invoke('patch:list-installations'),
    install: (patch, targetPath) => ipcRenderer.invoke('patch:install', { patch, targetPath }),
    restore: (patchId) => ipcRenderer.invoke('patch:restore', patchId),
    onProgress: (listener) => subscribe('patch:progress', listener)
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (listener) => subscribe('updates:status', listener)
  },
  external: {
    open: (url) => ipcRenderer.invoke('external:open', url)
  }
})
