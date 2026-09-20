const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('gsxTool', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
    quit: () => ipcRenderer.invoke('app:quit'),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  catalog: {
    refresh: () => ipcRenderer.invoke('catalog:refresh')
  },
  patches: {
    chooseTarget: (options) => ipcRenderer.invoke('patch:choose-target', options),
    choosePackage: () => ipcRenderer.invoke('patch:choose-package'),
    detectTargets: (patches, options) => ipcRenderer.invoke('patch:detect-targets', patches, options || {}),
    listInstallations: () => ipcRenderer.invoke('patch:list-installations'),
    verifyInstallations: () => ipcRenderer.invoke('patch:verify-installations'),
    reconcileInstallations: (patches, targetPaths) => ipcRenderer.invoke('patch:reconcile-installations', { patches, targetPaths }),
    install: (patch, targetPath) => ipcRenderer.invoke('patch:install', { patch, targetPath }),
    installFromFile: (patch, targetPath, sourceArchivePath) => ipcRenderer.invoke('patch:install-from-file', { patch, targetPath, sourceArchivePath }),
    restore: (patchId) => ipcRenderer.invoke('patch:restore', patchId),
    onProgress: (listener) => subscribe('patch:progress', listener)
  },
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (listener) => subscribe('updates:status', listener)
  },
  gsx: {
    status: () => ipcRenderer.invoke('gsx:status'),
    startUpdate: () => ipcRenderer.invoke('gsx:update:start'),
    onProgress: (listener) => subscribe('gsx:progress', listener),
    lifecycle: () => ipcRenderer.invoke('gsx:lifecycle'),
    launchInstallerUi: () => ipcRenderer.invoke('gsx:launch-installer-ui'),
    launchLicenseWizard: () => ipcRenderer.invoke('gsx:launch-license-wizard'),
    pollActivation: (payload) => ipcRenderer.invoke('gsx:poll-activation', payload),
    uninstall: () => ipcRenderer.invoke('gsx:uninstall:start'),
    installManifest: () => ipcRenderer.invoke('gsx:install:manifest'),
    startBootstrap: () => ipcRenderer.invoke('gsx:bootstrap:start'),
    startPackagePreset: () => ipcRenderer.invoke('gsx:package:start')
  },
  announcements: {
    list: () => ipcRenderer.invoke('announcements:list'),
    popup: () => ipcRenderer.invoke('announcements:popup')
  },
  support: {
    qr: () => ipcRenderer.invoke('support:qr')
  },
  feedback: {
    chooseImages: () => ipcRenderer.invoke('feedback:choose-images'),
    submit: (payload) => ipcRenderer.invoke('feedback:submit', payload),
    query: (code) => ipcRenderer.invoke('feedback:query', code)
  },
  legal: {
    reportAcceptance: (payload) => ipcRenderer.invoke('legal:report-acceptance', payload),
    ensureDeviceId: () => ipcRenderer.invoke('legal:ensure-device-id'),
    getAgreementText: () => ipcRenderer.invoke('legal:get-agreement-text'),
    checkAgreementUpdate: (payload) => ipcRenderer.invoke('legal:check-agreement-update', payload)
  },
  msfslog: {
    status: () => ipcRenderer.invoke('msfslog:status'),
    setRecording: (enabled) => ipcRenderer.invoke('msfslog:set-recording', enabled),
    latest: () => ipcRenderer.invoke('msfslog:latest'),
    readAppLog: () => ipcRenderer.invoke('app:log:read'),
    open: (kind) => ipcRenderer.invoke('log:open', kind)
  },
  external: {
    open: (url) => ipcRenderer.invoke('external:open', url)
  }
})
