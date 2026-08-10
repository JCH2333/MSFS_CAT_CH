const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const { GitHubCatalog } = require('./github-catalog')
const { detectPatchTargets } = require('./installation-targets')
const { PatchInstaller } = require('./patch-installer')
const { UpdateCheckTimeoutError, checkForUpdatesWithFallback, downloadUpdate, resolveGiteeSoftwareFeed } = require('./software-updater')

let mainWindow = null
let catalog = null
let installer = null

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
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

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

function configureUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => send('updates:status', { state: 'checking' }))
  autoUpdater.on('update-available', (info) => send('updates:status', { state: 'available', info }))
  autoUpdater.on('update-not-available', (info) => send('updates:status', { state: 'current', info }))
  autoUpdater.on('download-progress', (progress) => send('updates:status', { state: 'downloading', progress }))
  autoUpdater.on('update-downloaded', (info) => send('updates:status', { state: 'downloaded', info }))
  autoUpdater.on('error', (error) => {
    if (/no published versions on github/i.test(error.message)) {
      send('updates:status', { state: 'unpublished' })
      return
    }
    send('updates:status', { state: 'error', message: '暂时无法检查软件更新，请稍后再试' })
  })
}

function checkForSoftwareUpdates() {
  return checkForUpdatesWithFallback({
    updater: autoUpdater,
    resolveGiteeFeed: () => resolveGiteeSoftwareFeed(),
    onGiteeFallback: () => send('updates:status', { state: 'checking' }),
    onDirectFallback: () => send('updates:status', { state: 'checking-direct' }),
    onMirrorFallback: () => send('updates:status', { state: 'checking-mirror' })
  })
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

  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) {
      return { state: 'development', version: app.getVersion() }
    }
    try {
      return await checkForSoftwareUpdates()
    } catch (error) {
      if (error instanceof UpdateCheckTimeoutError) {
        return {
          state: 'error',
          message: '检查更新超时。已依次尝试 Gitee、GitHub 和国内镜像，请检查网络或代理设置后重试。'
        }
      }
      return { state: 'error', message: '暂时无法检查软件更新，请稍后再试' }
    }
  })
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

  ipcMain.handle('external:open', async (_event, input) => {
    const url = new URL(input)
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
    if (!isProjectGitee && !isProjectGitHub && !isGsxBaiduMirror && !isAuthorBilibili && !isQqGroupJoin) {
      throw new Error('只允许打开已配置的项目、分流或作者地址')
    }
    await shell.openExternal(url.toString())
    return true
  })
}

app.whenReady().then(() => {
  const userDataDirectory = app.getPath('userData')
  catalog = new GitHubCatalog({ cacheDirectory: path.join(userDataDirectory, 'cache') })
  installer = new PatchInstaller({
    userDataDirectory,
    onProgress: (payload) => send('patch:progress', payload)
  })
  configureUpdater()
  registerIpc()
  createWindow()
  if (app.isPackaged) {
    setTimeout(() => checkForSoftwareUpdates().catch(() => {}), 1500)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
