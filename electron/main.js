const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const { GitHubCatalog } = require('./github-catalog')
const { PatchInstaller } = require('./patch-installer')

let mainWindow = null
let catalog = null
let installer = null

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'GSX 汉化工具',
    icon: path.join(__dirname, '../public/logo.png'),
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
  autoUpdater.on('error', (error) => send('updates:status', { state: 'error', message: error.message }))
}

function registerIpc() {
  ipcMain.handle('app:get-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged
  }))

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  ipcMain.handle('catalog:refresh', () => catalog.refresh())
  ipcMain.handle('patch:list-installations', () => installer.listInstallations())
  ipcMain.handle('patch:choose-target', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || '选择补丁安装目录',
      defaultPath: options.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('patch:install', (_event, { patch, targetPath }) => installer.install(patch, targetPath))
  ipcMain.handle('patch:restore', (_event, patchId) => installer.restore(patchId))

  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) {
      return { state: 'development', version: app.getVersion() }
    }
    const result = await autoUpdater.checkForUpdates()
    return { state: result?.updateInfo?.version === app.getVersion() ? 'current' : 'checked', info: result?.updateInfo }
  })
  ipcMain.handle('updates:download', async () => {
    if (!app.isPackaged) return { state: 'development' }
    await autoUpdater.downloadUpdate()
    return { state: 'downloading' }
  })
  ipcMain.handle('updates:install', () => {
    if (!app.isPackaged) return { state: 'development' }
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return { state: 'installing' }
  })

  ipcMain.handle('external:open', async (_event, input) => {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/JCH2333/')) {
      throw new Error('只允许打开项目的 GitHub 地址')
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
