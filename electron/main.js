const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const { SERVER_HOSTNAME } = require('./distribution-server')
const { ServerCatalog } = require('./server-catalog')
const { fetchAnnouncements, fetchPopupAnnouncements } = require('./announcements')
const { loadFeedbackImages, queryFeedback, submitFeedback, validateFeedbackPayload } = require('./feedback')
const { ensureDeviceId, reportAgreementAcceptance } = require('./legal-evidence')
const { detectGsxRuntimeResTarget, detectPatchTargets } = require('./installation-targets')
const { PatchInstaller } = require('./patch-installer')
const { fetchSponsorQr } = require('./support-qr')
const { UpdateCheckTimeoutError, downloadUpdate, serverSoftwareFeed, startRequiredUpdate } = require('./software-updater')

let mainWindow = null
let catalog = null
let installer = null
let latestUpdateStatus = { state: 'idle' }

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function setUpdateStatus(payload) {
  latestUpdateStatus = payload
  send('updates:status', payload)
}

function createWindow() {
  const windowIcon = process.env.VITE_DEV_SERVER_URL
    ? path.join(__dirname, '../public/logo.png')
    : path.join(__dirname, '../dist/logo.png')

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'MSFS_CAT_CH',
    icon: windowIcon,
    autoHideMenuBar: true,
    frame: false,
    show: false,
    backgroundColor: '#171816',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    void startRequiredSoftwareUpdate()
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

function configureUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => setUpdateStatus({ state: 'available', info }))
  autoUpdater.on('update-not-available', (info) => setUpdateStatus({ state: 'current', info }))
  autoUpdater.on('download-progress', (progress) => setUpdateStatus({ state: 'downloading', progress }))
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus({ state: 'downloaded', info })
    setImmediate(() => {
      setUpdateStatus({ state: 'installing', info })
      autoUpdater.quitAndInstall(false, true)
    })
  })
  autoUpdater.on('error', () => {
    setUpdateStatus({ state: 'error', message: '暂时无法检查软件更新，请稍后再试' })
  })
}

async function startRequiredSoftwareUpdate() {
  if (!app.isPackaged) {
    const status = { state: 'development', version: app.getVersion() }
    setUpdateStatus(status)
    return status
  }
  try {
    const status = await startRequiredUpdate({ updater: autoUpdater, feed: serverSoftwareFeed() })
    if (status.state === 'current') setUpdateStatus(status)
    return status
  } catch (error) {
    const status = error instanceof UpdateCheckTimeoutError
      ? { state: 'error', message: '暂时无法连接更新服务器，请检查网络后重试' }
      : { state: 'error', message: '暂时无法检查软件更新，请稍后再试。' }
    setUpdateStatus(status)
    return status
  }
}

function registerIpc() {
  ipcMain.handle('app:get-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged
  }))
  ipcMain.handle('app:quit', () => { app.quit(); return true })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  ipcMain.handle('catalog:refresh', () => catalog.refresh())
  ipcMain.handle('patch:list-installations', () => installer.listInstallations())
  ipcMain.handle('patch:verify-installations', () => installer.verifyInstallations())
  ipcMain.handle('patch:reconcile-installations', (_event, { patches, targetPaths }) => installer.reconcileInstallations(patches, targetPaths))
  ipcMain.handle('patch:detect-targets', async (_event, patches) => detectPatchTargets(patches, {
    appData: app.getPath('appData'),
    localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
    knownAudioTargets: Object.values(await installer.listInstallations())
      .filter((installation) => typeof installation?.targetPath === 'string' && installation.targetPath)
      .map((installation) => ({ targetPath: installation.targetPath, source: '已记录的 GSX 语音目录' }))
  }))
  ipcMain.handle('patch:choose-target', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || '选择补丁安装目录',
      defaultPath: options.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('patch:choose-package', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择离线补丁包',
      properties: ['openFile'],
      filters: [{ name: 'ZIP 补丁包', extensions: ['zip'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('patch:install', (_event, { patch, targetPath }) => installer.install(patch, targetPath))
  ipcMain.handle('patch:install-from-file', (_event, { patch, targetPath, sourceArchivePath }) => installer.installFromFile(patch, targetPath, sourceArchivePath))
  ipcMain.handle('patch:restore', (_event, patchId) => installer.restore(patchId))

  ipcMain.handle('updates:check', () => startRequiredSoftwareUpdate())
  ipcMain.handle('updates:status', () => latestUpdateStatus)
  ipcMain.handle('updates:download', async () => {
    if (!app.isPackaged) return { state: 'development' }
    try {
      return await downloadUpdate(autoUpdater)
    } catch {
      return { state: 'error', message: '更新下载未完成，请检查网络后重试。' }
    }
  })
  ipcMain.handle('updates:install', () => {
    if (!app.isPackaged) return { state: 'development' }
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return { state: 'installing' }
  })

  ipcMain.handle('announcements:list', () => fetchAnnouncements())
  ipcMain.handle('announcements:popup', () => fetchPopupAnnouncements())

  ipcMain.handle('support:qr', () => fetchSponsorQr())

  ipcMain.handle('feedback:choose-images', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择反馈截图',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片 (png/jpg/jpeg/webp)', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return []
    return loadFeedbackImages(result.filePaths)
  })
  ipcMain.handle('feedback:submit', async (_event, payload) => {
    const validated = validateFeedbackPayload(payload)
    if (!validated.ok) return validated
    return submitFeedback({
      content: validated.content,
      username: validated.username,
      images: validated.images
    })
  })
  ipcMain.handle('feedback:query', async (_event, code) => {
    return queryFeedback(typeof code === 'string' ? code : '')
  })

  // 协议同意存证（法律证据留存）：匿名设备标识维护与同意记录上报
  ipcMain.handle('legal:ensure-device-id', () => ensureDeviceId(app.getPath('userData')))
  ipcMain.handle('legal:report-acceptance', (_event, payload) => {
    return reportAgreementAcceptance(payload, {
      userDataDirectory: app.getPath('userData'),
      appVersion: app.getVersion()
    })
  })

  ipcMain.handle('external:open', async (_event, input) => {
    const url = new URL(input)
    const isDistributionServer = url.protocol === 'https:' && url.hostname === SERVER_HOSTNAME
    const isProjectGitee = url.protocol === 'https:' && url.hostname === 'gitee.com' && url.pathname.startsWith('/ljd123456/')
    const isProjectGitHub = url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/JCH2333/')
    const isGsxBaiduMirror = url.protocol === 'https:'
      && url.hostname === 'pan.baidu.com'
      && url.pathname === '/s/1jrz3nSFc8gFhBDUFFjYaAg'
    const isAuthorBilibili = url.protocol === 'https:'
      && url.hostname === 'space.bilibili.com'
      && url.pathname === '/472309803'
    const isQqGroupJoin = url.protocol === 'https:'
      && url.hostname === 'qun.qq.com'
      && url.pathname === '/join.html'
      && url.searchParams.get('gc') === '1101733374'
    if (!isDistributionServer && !isProjectGitee && !isProjectGitHub && !isGsxBaiduMirror && !isAuthorBilibili && !isQqGroupJoin) {
      throw new Error('只允许打开已配置的项目、分发服务器、分流或作者地址')
    }
    await shell.openExternal(url.toString())
    return true
  })
}

app.whenReady().then(() => {
  const userDataDirectory = app.getPath('userData')
  catalog = new ServerCatalog({ cacheDirectory: path.join(userDataDirectory, 'cache') })
  installer = new PatchInstaller({
    userDataDirectory,
    onProgress: (payload) => send('patch:progress', payload),
    resolveAdditionalTarget: async (target) => {
      if (target !== 'gsx-runtime-res') throw new Error(`不支持的补丁安装目标：${target}`)
      const detected = await detectGsxRuntimeResTarget()
      if (!detected?.targetPath) throw new Error('未检测到 FSDreamTeam Addon Manager 的 GSX 图片资源目录')
      return detected.targetPath
    }
  })
  configureUpdater()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
