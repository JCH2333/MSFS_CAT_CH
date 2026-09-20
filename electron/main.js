const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const { SERVER_HOSTNAME } = require('./distribution-server')
const { ServerCatalog } = require('./server-catalog')
const { fetchAnnouncements, fetchPopupAnnouncements } = require('./announcements')
const { loadFeedbackImages, queryFeedback, submitFeedback, validateFeedbackPayload } = require('./feedback')
const { ensureDeviceId, reportAgreementAcceptance } = require('./legal-evidence')
const { checkAgreementUpdate, getAgreementText } = require('./agreements-secure')
const { AppLogger, mirrorConsoleToLogger } = require('./app-logger')
const { createMsfsLogBridge } = require('./msfslog')
const { classifySimSlot, configuredRoots, detectGsxRuntimeResTarget, detectPatchTargets, addonManagerRootsFromPrimaryPath, recordedGsxRuntimeResRoots } = require('./installation-targets')
const { createGsxInstaller } = require('./gsx-installer')
const { createGsxInstall } = require('./gsx-install')
const { createGsxQueueClient, createQueueAwareDownload } = require('./gsx-queue')
const { InstallationTargetCache, recordInstalledTarget, resolveDetectedTargets } = require('./installation-cache')
const { PatchInstaller, downloadToFile } = require('./patch-installer')
const { GsxUpdater } = require('./gsx-updater')
const { fetchSponsorQr } = require('./support-qr')
const { UpdateCheckTimeoutError, downloadUpdate, serverSoftwareFeed, startRequiredUpdate } = require('./software-updater')

let mainWindow = null
let catalog = null
// 运行日志（安装目录 MSFS_CAT_CH.log）；restoreConsole 还原被镜像的 console
let logger = null
let restoreConsole = null
let logFilePath = null
let msfsLogBridge = null
let installer = null
let gsxInstaller = null
let gsxInstall = null
let gsxUpdater = null
let installationTargetCache = null
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

// GSX 更新会覆盖已部署的汉化补丁文件；文本/按钮补丁必然受影响，
// 语音补丁只有当本次更新包含 GSX_sounds 组件时才受影响（差量更新会跳过未变化的组件）。
const GSX_TEXT_PATCH_ID = 'gsx-pro-zh-cn'
const GSX_VOICE_PATCH_ID = 'gsx-pro-zh-cn-voice'
const GSX_VOICE_COMPONENT = 'GSX_sounds'

// 卸载 GSX 产品（官方作用域）：仅移除 MSFS 社区包与产品文件，引擎目录、
// 激活状态与机场配置保留。已安装的 GSX 汉化补丁记录一并失效（产品文件随之删除）。
async function runGsxUninstallFlow() {
  if (!gsxUpdater || !gsxInstaller || !installer) throw new Error('GSX 组件未就绪')
  const send2 = (phase, percent, message) => send('gsx:progress', { phase, percent, message })
  send2('check', 2, '正在确认模拟器已完全退出…')
  await gsxUpdater.assertSimClosed()

  const install = await gsxUpdater.detectInstall()
  if (!install.installed || !install.addonRoot) throw new Error('未检测到 GSX 安装，无需卸载')

  send2('check', 10, '正在收集安装信息…')
  const communityRoots = await configuredRoots({
    appData: app.getPath('appData'),
    localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  })

  send2('forget-records', 25, '正在移除汉化补丁安装记录…')
  const installations = await installer.listInstallations()
  const forgotten = await installer.forgetInstallations([GSX_TEXT_PATCH_ID, GSX_VOICE_PATCH_ID].filter((id) => installations[id]))

  send2('remove', 55, '正在移除 GSX 产品文件与社区目录链接…')
  const result = await gsxInstaller.uninstallProduct({
    addonRoot: install.addonRoot,
    communityDirectories: communityRoots.map((entry) => entry.packageRoot)
      .flatMap((packageRoot) => [
        packageRoot,
        path.join(packageRoot, 'Community2024'),
        path.join(packageRoot, 'Community')
      ])
  })

  send2('reset-state', 80, '正在重置本机更新状态…')
  await gsxUpdater.clearAppliedState()

  send2('complete', 100, 'GSX Pro 已卸载（引擎与激活状态保留）')
  logger?.line?.('INFO', 'gsx', `GSX 产品已卸载：移除链接 ${result.removedLinks.length} 个、产品目录 ${result.removedPackages.length} 个、补丁记录 ${forgotten} 条`)
  return {
    state: 'uninstalled',
    removedLinks: result.removedLinks.length,
    removedPackages: result.removedPackages.length,
    forgottenPatchRecords: forgotten
  }
}

// 第一步：从分发服务器取官方安装器（SHA-256 校验）并启动。基础组件安装
// 可能需要国际网络，安装器打不开/中断由用户界面引导重试。
async function runGsxBootstrapFlow() {
  if (!gsxInstall) throw new Error('GSX 安装组件未就绪')
  const result = await gsxInstall.ensureBootstrap()
  logger?.line('INFO', 'gsx', `官方安装器就绪：${result.filePath} downloaded=${result.downloaded}`)
  await gsxInstall.openBootstrap(result.filePath)
  return { opened: true, downloaded: result.downloaded, filePath: result.filePath }
}

// 第三步（一键安装）：把版本化完整包预置到官方 PackagesCache 后，由本应用直接
// 解压部署到 Addon Manager\MSFS\<产品> 并在模拟器社区目录创建链接——全程不拉起
// 官方安装器。前置条件：第一步基础组件 + 第二步激活已完成。
async function runGsxOneClickInstallFlow() {
  if (!gsxInstall || !gsxInstaller) throw new Error('GSX 组件未就绪')
  await gsxUpdater.assertSimClosed()
  const infrastructure = await gsxInstaller.detectInfrastructure()
  if (!infrastructure.present) throw new Error('请先完成第一步：安装 FSDT 官方安装器')
  const activation = await gsxInstaller.detectActivation()
  if (!activation.activated) throw new Error('请先完成第二步：激活 GSX Pro')

  const communityRoots = await configuredRoots({
    appData: app.getPath('appData'),
    localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  })
  if (!communityRoots.length) {
    throw new Error('未检测到模拟器社区目录：请先在「汉化补丁」页完成一次安装目标检测后再试')
  }
  const fsPromises = require('node:fs/promises')
  const communityTargets = []
  const seenDirectories = new Set()
  for (const entry of communityRoots) {
    const slot = classifySimSlot(entry.source) || 'msfs2024'
    const candidates = slot === 'msfs2020'
      ? [path.join(entry.packageRoot, 'Community'), entry.packageRoot]
      : [path.join(entry.packageRoot, 'Community2024'), path.join(entry.packageRoot, 'Community'), entry.packageRoot]
    for (const directory of candidates) {
      const key = path.resolve(directory).toLowerCase()
      if (seenDirectories.has(key)) continue
      const stats = await fsPromises.stat(directory).then((s) => s.isDirectory()).catch(() => false)
      if (!stats) continue
      seenDirectories.add(key)
      communityTargets.push({ directory, slot })
      break
    }
  }
  if (!communityTargets.length) {
    throw new Error('模拟器社区目录不存在或不可访问，无法创建社区链接')
  }

  const deployResult = await gsxInstall.deployPackages({
    addonRoot: infrastructure.addonRoot,
    communityTargets
  })
  logger?.line('INFO', 'gsx', `一键安装部署完成：deployed=${deployResult.deployed.length} skipped=${deployResult.skipped.length} links=${deployResult.linked.length}`)
  send('gsx:progress', { kind: 'install', phase: 'deploy', percent: 100, message: '本体部署完成，正在更新到最新版本…' })
  // 自动连跑：镜像更新到最新版本 + 受影响汉化补丁自动重装，用户零多余操作
  const updateResult = await runGsxUpdateFlow()
  logger?.line('INFO', 'gsx', `一键安装全部完成：applied=${updateResult?.applied?.length ?? 0} patchReinstalled=${updateResult?.patchCare?.reinstalled?.length ?? 0}`)
  return { deploy: deployResult, update: updateResult }
}

// 第二步：启动官方 QLM 激活向导并监视激活结果。向导窗口关闭或注册表出现
// 新激活记录即返回；用户若经官方安装器（Active 按钮）或官方下载器完成激活，
// 本轮询同样能检测到。激活码只在官方向导内输入，不经过本应用。
async function runGsxActivateFlow() {
  if (!gsxInstaller) throw new Error('GSX 组件未就绪')
  const infrastructure = await gsxInstaller.detectInfrastructure()
  if (!infrastructure.present) {
    throw new Error('未检测到 FSDT 安装根目录：请先完成第一步；若已安装过官方安装器，请确认其安装目录未被改名或移动')
  }
  const baseline = await gsxInstaller.detectActivation()
  const pid = await gsxInstaller.launchLicenseWizard(infrastructure)
  logger?.line('INFO', 'gsx', `激活向导已启动 pid=${pid} baselineActivated=${baseline.activated}`)
  const result = await gsxInstaller.pollForActivation({
    baselineSerial: baseline.serial || null,
    watchPid: pid
  })
  logger?.line('INFO', 'gsx', `激活检测结果：activated=${result.activated} wizardClosed=${result.wizardClosed} timedOut=${result.timedOut}`)
  return result
}

async function runGsxUpdateFlow() {
  if (!gsxUpdater) throw new Error('GSX 更新器未就绪')
  await gsxUpdater.assertSimClosed()
  const status = await gsxUpdater.getStatus()
  if (!status.installed) throw new Error('未检测到 GSX 安装，无法更新')
  const pendingComponents = new Set(status.pending.map((pkg) => pkg.component))
  const affectedPatchIds = [GSX_TEXT_PATCH_ID]
  if (pendingComponents.has(GSX_VOICE_COMPONENT)) affectedPatchIds.push(GSX_VOICE_PATCH_ID)

  // 1) 还原受影响的汉化补丁（使用本地备份，不产生下载）
  const installations = await installer.listInstallations()
  const restored = []
  const restoreSkipped = []
  for (const patchId of affectedPatchIds) {
    if (!installations[patchId]) {
      restoreSkipped.push(patchId)
      continue
    }
    send('gsx:progress', { phase: 'patch-restore', percent: 0, message: `正在还原汉化补丁（${patchId}），避免被 GSX 更新覆盖…` })
    await installer.restore(patchId)
    restored.push(patchId)
  }

  // 2) 执行 GSX 更新
  const updateResult = await gsxUpdater.applyUpdate()
  if (updateResult.state !== 'complete') {
    return { ...updateResult, patchCare: { restored, reinstalled: [], failed: [], skipped: restoreSkipped } }
  }

  // 3) 自动重装受影响的汉化补丁（从服务器取最新已发布版本）
  const reinstalled = []
  const failed = []
  send('gsx:progress', { phase: 'patch-reinstall', percent: 100, message: 'GSX 已更新，正在重装汉化补丁…' })
  const { catalog: freshCatalog } = await catalog.refresh()
  const patchEntries = affectedPatchIds
    .map((patchId) => freshCatalog.patches.find((patch) => patch.id === patchId))
    .filter(Boolean)
  const targets = await detectPatchTargets(patchEntries, {
    appData: app.getPath('appData'),
    localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  })
  for (const entry of patchEntries) {
    const targetPath = targets[entry.id]?.targetPath
    try {
      if (entry.status !== 'published') throw new Error('服务器目录中暂无已发布版本')
      if (!targetPath) throw new Error('未检测到安装目标')
      send('gsx:progress', { phase: 'patch-reinstall', percent: 100, message: `正在重装汉化补丁（${entry.id} v${entry.version}）…` })
      await installer.install(entry, targetPath)
      reinstalled.push(entry.id)
    } catch (error) {
      failed.push(`${entry.id}: ${error.message}`)
    }
  }

  return {
    ...updateResult,
    patchCare: { restored, reinstalled, failed, skipped: restoreSkipped }
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
    const status = await startRequiredUpdate({ updater: autoUpdater, feed: serverSoftwareFeed(), currentVersion: app.getVersion() })
    if (status.state === 'current') {
      setUpdateStatus(status)
      logger?.line('INFO', 'update', '软件更新检查：已是最新（直连快速预检）')
    }
    return status
  } catch (error) {
    const status = error instanceof UpdateCheckTimeoutError
      ? { state: 'error', message: '暂时无法连接更新服务器，请检查网络后重试' }
      : { state: 'error', message: '暂时无法检查软件更新，请稍后再试。' }
    setUpdateStatus(status)
    return status
  }
}

// 启动期目录探测：优先复用持久化的目标缓存（签名一致且目录仍存在），只在缓存
// 失效或强制刷新时才做全盘扫描。detectPatchTargets 的注册表全树枚举在装了大量
// 软件的机器上可达数秒，是启动安装状态链的主要耗时。
async function resolvePatchTargets(patches, { force = false } = {}) {
  const { targets, fromCache } = await resolveDetectedTargets({
    patches,
    force,
    cache: installationTargetCache,
    detect: async (descriptorPatches) => detectPatchTargets(descriptorPatches, {
      appData: app.getPath('appData'),
      localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
      knownAudioTargets: Object.values(await installer.listInstallations())
        .filter((installation) => typeof installation?.targetPath === 'string' && installation.targetPath)
        .map((installation) => ({ targetPath: installation.targetPath, source: '已记录的 GSX 语音目录' }))
    })
  })
  return { targets, fromCache }
}

// 安装成功后把实际写入的目标目录回写进目标缓存（渲染层传 [{slot, path}]），
// 下次启动即命中缓存，不再全盘扫描。
async function recordInstallTargetInCache(patch, targetPaths) {
  const entries = Array.isArray(targetPaths) ? targetPaths : [targetPaths]
  const normalized = entries
    .map((entry) => ({
      slot: typeof entry === 'object' && typeof entry?.slot === 'string' ? entry.slot : null,
      path: typeof entry === 'string' ? entry : entry?.path
    }))
    .filter((entry) => typeof entry.path === 'string' && entry.path.trim())
  if (!normalized.length) return
  await recordInstalledTarget({
    patchId: typeof patch?.id === 'string' ? patch.id : '',
    targetPath: normalized[0].path,
    slots: normalized.filter((entry) => entry.slot).map((entry) => ({ slot: entry.slot, targetPath: entry.path })),
    cache: installationTargetCache
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

  ipcMain.handle('catalog:refresh', async () => {
    const result = await catalog.refresh()
    logger?.line('INFO', 'catalog', `同步完成：source=${result.source} stale=${result.stale} patches=${result.catalog?.patches?.length ?? 0}${result.error ? ` error=${result.error}` : ''}`)
    return result
  })
  ipcMain.handle('patch:list-installations', () => installer.listInstallations())
  ipcMain.handle('patch:verify-installations', async () => {
    const result = await installer.verifyInstallations()
    logger?.line('INFO', 'patch', '完整性校验：' + Object.entries(result).map(([id, check]) => `${id}=${check.state}(${check.checkedFiles})`).join(', '))
    return result
  })
  ipcMain.handle('patch:reconcile-installations', (_event, { patches, targetPaths }) => installer.reconcileInstallations(patches, targetPaths))
  ipcMain.handle('patch:detect-targets', async (_event, patches, options = {}) => {
    const { targets, fromCache } = await resolvePatchTargets(patches, { force: Boolean(options?.force) })
    logger?.line('INFO', 'patch', `目录探测完成（${Object.keys(targets).length} 项，${fromCache ? '缓存命中' : '全量扫描'}）`)
    return targets
  })
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
  ipcMain.handle('patch:install', async (_event, { patch, targetPath }) => {
    const result = await installer.install(patch, targetPath)
    await recordInstallTargetInCache(patch, targetPath)
    return result
  })
  ipcMain.handle('patch:install-from-file', async (_event, { patch, targetPath, sourceArchivePath }) => {
    const result = await installer.installFromFile(patch, targetPath, sourceArchivePath)
    await recordInstallTargetInCache(patch, targetPath)
    return result
  })
  ipcMain.handle('patch:restore', async (_event, patchId) => {
    const result = await installer.restore(patchId)
    logger?.line('INFO', 'patch', `还原 ${patchId}: restored=${result.restored} conflicts=${result.conflicts?.length ?? 0}`)
    return result
  })

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

  // msfslog 游戏日志工具：状态 / 开关 / 最近日志读取 / 系统打开
  ipcMain.handle('msfslog:status', async () => {
    const status = await msfsLogBridge.status()
    logger?.line('INFO', 'msfslog', `状态：daemon=${status.daemon_alive === true} game=${status.game_alive === true}`)
    return status
  })
  ipcMain.handle('msfslog:set-recording', async (_event, enabled) => {
    const status = await msfsLogBridge.setEnabled(Boolean(enabled))
    logger?.line('INFO', 'msfslog', `记录游戏日志 ${Boolean(enabled) ? '开启' : '关闭'}：daemon=${status.daemon_alive === true} game=${status.game_alive === true}`)
    return status
  })
  ipcMain.handle('msfslog:latest', async () => {
    const files = await msfsLogBridge.latestFiles()
    const newest = files.crash && files.session
      ? (files.crash.mtimeMs >= files.session.mtimeMs ? files.crash : files.session)
      : (files.crash || files.session)
    let summary = null
    if (files.summary) {
      const summaryText = await msfsLogBridge.readTextTail(files.summary.path, 128 * 1024)
      try { summary = JSON.parse(summaryText) } catch { summary = null }
    }
    const content = newest ? await msfsLogBridge.readTextTail(newest.path) : ''
    return {
      kind: newest === files.crash && newest ? 'crash' : (newest ? 'session' : ''),
      path: newest?.path || '',
      name: newest?.name || '',
      content,
      summary
    }
  })
  ipcMain.handle('app:log:read', async () => {
    return { path: logFilePath, content: await logger.readTail(192 * 1024) }
  })
  ipcMain.handle('log:open', async (_event, kind) => {
    let target = null
    if (kind === 'game') {
      const files = await msfsLogBridge.latestFiles()
      target = (files.crash && files.session
        ? (files.crash.mtimeMs >= files.session.mtimeMs ? files.crash.path : files.session.path)
        : (files.crash?.path || files.session?.path)) || msfsLogBridge.logsDir
    } else if (kind === 'app') {
      target = logFilePath || msfsLogBridge.logsDir
    } else if (kind === 'folder') {
      target = msfsLogBridge.logsDir
    }
    if (!target) return { ok: false, error: '日志文件尚未生成' }
    const failure = await shell.openPath(target)
    logger?.line('INFO', 'logs', `打开 ${kind}: ${target}${failure ? ` 失败：${failure}` : ''}`)
    return { ok: !failure, error: failure || null }
  })

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
    // 自动静默附带运行日志尾部（≤256KB）：软件本体日志 + 最近一次生成的游戏日志；
    // 任一不可用时跳过该项，正常提交
    const logText = logger ? await logger.readTail() : ''
    const gameLog = msfsLogBridge ? await msfsLogBridge.readLatestGameLog() : { text: '' }
    const sizes = [logText, gameLog.text].map((t) => Buffer.byteLength(t || '', 'utf8'))
    logger?.line('INFO', 'feedback', `提交反馈：本体日志 ${sizes[0]} 字节，游戏日志 ${sizes[1]} 字节`)
    if (!logText && !gameLog.text) logger?.line('WARN', 'feedback', '提交反馈：两类运行日志均不可读，未附带')
    return submitFeedback({
      content: validated.content,
      username: validated.username,
      images: validated.images,
      logText,
      gameLogText: gameLog.text
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
  // 协议正文安全加载：主进程联网取钥解密内嵌密文，明文只经 IPC 交给渲染层弹窗
  ipcMain.handle('legal:get-agreement-text', () => getAgreementText())
  // 服务器推送的协议更新检查：比对已同意修订版与服务器最新修订版（含作者签名验证）
  ipcMain.handle('legal:check-agreement-update', async (_event, payload) => {
    const result = await checkAgreementUpdate(payload || {})
    logger?.line('INFO', 'legal', `协议更新检查：ok=${result?.ok} upToDate=${result?.upToDate} revision=${result?.revision || '-'}${result?.ok ? '' : ` error=${result?.error}`}`)
    return result
  })

  ipcMain.handle('gsx:status', async () => {
    const status = await gsxUpdater.getStatus()
    logger?.line('INFO', 'gsx', `installed=${status.installed} localVersion=${status.localVersion} latest=${status.latestVersion} updateAvailable=${status.updateAvailable} pending=${status.pending?.length ?? 0} versionMarkerStale=${status.versionMarkerStale === true} source=${status.source}`)
    return status
  })
  ipcMain.handle('gsx:update:start', () => runGsxUpdateFlow())
  // GSX 安装生命周期（2.3.0 下载/激活/安装/卸载闭环）
  ipcMain.handle('gsx:lifecycle', () => gsxInstaller.detectLifecycle(() => gsxUpdater.detectInstall()))
  // 启动器需 FSDT 根目录：由主进程自探，渲染层不传文件系统路径
  ipcMain.handle('gsx:launch-installer-ui', async () => gsxInstaller.launchLiveUpdateInstaller(await gsxInstaller.detectInfrastructure()))
  ipcMain.handle('gsx:activate:start', () => runGsxActivateFlow())
  ipcMain.handle('gsx:uninstall:start', () => runGsxUninstallFlow())
  // GSX 全新安装镜像（官方安装器 + 本体完整包）
  ipcMain.handle('gsx:install:manifest', () => gsxInstall.loadManifest())
  ipcMain.handle('gsx:bootstrap:start', () => runGsxBootstrapFlow())
  ipcMain.handle('gsx:package:start', () => runGsxOneClickInstallFlow())

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

app.whenReady().then(async () => {
  const userDataDirectory = app.getPath('userData')
  // 运行日志：安装目录下单一 log 文件，跨启动追加累计，256KB 上限淘汰最早日志。
  // 安装目录不可写（极少见）时回退 userData。dev 运行写 userData。
  const logFilePath = app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'MSFS_CAT_CH.log')
    : path.join(userDataDirectory, 'MSFS_CAT_CH.log')
  logger = new AppLogger({ filePath: logFilePath })
  // msfslog 游戏日志工具：打包时来自 extraResources；开发时用相邻的日志工具项目
  const msfsLogExe = app.isPackaged
    ? path.join(process.resourcesPath, 'msfslog', 'msfslog.exe')
    : path.resolve(app.getAppPath(), '..', '日志工具', 'build', 'msfslog.exe')
  msfsLogBridge = createMsfsLogBridge({ exePath: msfsLogExe })
  logger?.line('INFO', 'msfslog', `日志工具：${msfsLogExe}`)
  const logReady = await logger.init({
    header: `===== MSFS_CAT_CH v${app.getVersion()} | ${process.platform} | packaged=${app.isPackaged} | 会话开始 =====`
  })
  restoreConsole = mirrorConsoleToLogger(logger)
  process.on('unhandledRejection', (reason) => {
    logger.line('ERROR', 'unhandledRejection', String(reason instanceof Error ? reason.stack || reason.message : reason))
  })
  logger.line('INFO', 'app', `启动：v${app.getVersion()} | 日志${logReady ? '就绪' : '不可用（静默降级）'}：${logFilePath}`)

  catalog = new ServerCatalog({ cacheDirectory: path.join(userDataDirectory, 'cache') })
  installationTargetCache = new InstallationTargetCache({
    filePath: path.join(userDataDirectory, 'cache', 'installation-targets.json')
  })
  const updaterQueue = createGsxQueueClient({
    onQueue: (info) => send('gsx:progress', { phase: 'queue', position: info.position ?? null, message: info.position ? `服务器繁忙，排队中：第 ${info.position} 位` : '服务器繁忙，排队中…' })
  })
  gsxUpdater = new GsxUpdater({
    userDataDirectory,
    hotfixEtagsPath: path.join(app.getPath('appData'), 'Virtuali', 'hotfix_etags.txt'),
    download: createQueueAwareDownload(downloadToFile, updaterQueue),
    onProgress: (payload) => {
      send('gsx:progress', payload)
      if (logger && ['complete', 'error', 'component-complete', 'component-skipped'].includes(payload?.phase)) {
        logger.line(payload.phase === 'error' ? 'ERROR' : 'INFO', 'gsx', `${payload.phase}: ${payload.message || ''}`)
      }
    }
  })
  gsxInstaller = createGsxInstaller({ processLister: gsxUpdater.processLister })
  const installQueue = createGsxQueueClient({
    onQueue: (info) => send('gsx:progress', { kind: 'install', phase: 'queue', position: info.position ?? null, message: info.position ? `服务器繁忙，排队中：第 ${info.position} 位` : '服务器繁忙，排队中…' })
  })
  gsxInstall = createGsxInstall({
    cacheDirectory: path.join(userDataDirectory, 'cache', 'gsx-install'),
    download: createQueueAwareDownload(downloadToFile, installQueue),
    packagesCacheDirectory: path.join(app.getPath('appData'), 'Virtuali', 'PackagesCache'),
    opener: (filePath) => shell.openPath(filePath),
    onProgress: (payload) => {
      send('gsx:progress', payload)
      if (logger && ['bootstrap-download', 'package-download'].includes(payload?.phase)) {
        logger.line('INFO', 'gsx', `${payload.phase}: ${payload.message || ''}`)
      }
    }
  })
  installer = new PatchInstaller({
    userDataDirectory,
    onProgress: (payload) => {
      send('patch:progress', payload)
      if (logger && ['complete', 'error', 'component-complete'].includes(payload?.phase)) {
        logger.line(payload.phase === 'error' ? 'ERROR' : 'INFO', 'patch', `${payload.patchId || ''} ${payload.phase}: ${payload.message || ''}`)
      }
    },
    resolveAdditionalTarget: async (target, { patch, primaryTarget } = {}) => {
      if (target !== 'gsx-runtime-res') throw new Error(`不支持的补丁安装目标：${target}`)
      // 1) 注册表探测（部分机器枚举超时或缺少卸载键，失败后继续回退）
      const detected = await detectGsxRuntimeResTarget()
      if (detected?.targetPath) return detected.targetPath
      // 2) 由社区包主目标反推：<Addon Manager 根>\MSFS\<包名> → 根目录
      const derivedRoots = addonManagerRootsFromPrimaryPath(primaryTarget)
      if (derivedRoots.length > 0) {
        const derived = await detectGsxRuntimeResTarget({ runtimeRoots: derivedRoots })
        if (derived?.targetPath) return derived.targetPath
      }
      // 3) 上次安装记录里用过的图片资源目录（反推根目录后重新校验）
      const recordedRoots = await recordedGsxRuntimeResRoots(userDataDirectory, patch?.id)
      if (recordedRoots.length > 0) {
        const recorded = await detectGsxRuntimeResTarget({ runtimeRoots: recordedRoots })
        if (recorded?.targetPath) return recorded.targetPath
      }
      throw new Error('未检测到 FSDreamTeam Addon Manager 的 GSX 图片资源目录')
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
