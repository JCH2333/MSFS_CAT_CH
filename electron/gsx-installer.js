const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { registeredAddonManagerRoots } = require('./installation-targets')
const { SIM_PROCESS_NAMES } = require('./gsx-updater')

const execFileAsync = promisify(execFile)

// GSX 安装生命周期（下载/激活/安装/卸载闭环）的主进程辅助模块。
//
// 红线：激活与许可归 FSDreamTeam。本模块绝不与许可服务器（qlm1.net）通信、
// 不解析或伪造激活协议；激活一律由官方组件执行——QlmLicenseWizard.exe 或
// Live Update 界面，本模块只负责启动它们并检测激活结果。
//
// 已实测事实（2026-09 安装实验，见 .local-lab 实验记录）：
// - 激活状态存储于注册表 HKCU\Software\Fsdreamteam\SerialNumber（非空 = 已激活），
//   客户端离线读取即可判定，无需联网；
// - 激活请求由官方组件直连许可服务器（qlm1.net，国内直连可达，无需加速器）；
// - 产品“卸载/重装”的作用域仅为 MSFS 社区包——couatl 引擎目录、运行时资源、
//   激活状态与机场配置全部保留，本模块的卸载遵循同一作用域。

const FSDT_REGISTRY_KEY = 'HKCU\\Software\\Fsdreamteam'
const SERIAL_NUMBER_VALUE_NAME = 'SerialNumber'
const LIVE_UPDATE_EXECUTABLE = 'Couatl_Updater.exe'
// 与官方桌面快捷方式一致的参数：进入产品安装管理界面（含 Install/卸载入口）
const LIVE_UPDATE_LAUNCH_ARGS = ['/SILENT', '/INSTALLMODE=TRUE']
const LICENSE_WIZARD_EXECUTABLE = 'QlmLicenseWizard.exe'
// 官方向导必须携带产品设置文件（/settings <*.lw.xml>），裸启动会报
// "No settings file was specified"。GSX Pro 的现行定义即此文件（ProductName="GSX Pro"）。
const LICENSE_WIZARD_SETTINGS_NAME = 'GSX Pro 3.0.lw.xml'
// 卸载作用域：仅这两个 GSX 产品包。GSX EFB 为随安装器分发的独立免费产品，不动。
const PRODUCT_PACKAGE_FOLDERS = ['fsdreamteam-gsx-pro', 'fsdreamteam-gsx-world-of-jetways']
const COMMUNITY_LEAF_CANDIDATES = ['Community2024', 'Community']

const ACTIVATION_POLL_INTERVAL_MS = 3000
// 常规出口是“向导窗口关闭”或“注册表出现激活记录”，超时仅为兜底
// （例如用户把向导一直开着，或经官方安装器/下载器激活的机器）
const ACTIVATION_POLL_TIMEOUT_MS = 1800000

async function defaultRegistryReader() {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', FSDT_REGISTRY_KEY, '/v', SERIAL_NUMBER_VALUE_NAME], {
      windowsHide: true,
      timeout: 8000
    })
    return { present: true, stdout }
  } catch (error) {
    // 值或键不存在时 reg.exe 以非零码退出，同样视为“无激活记录”
    return { present: false, stdout: String(error?.stdout || '') }
  }
}

async function defaultProcessExists(pid) {
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', `PID eq ${pid}`], {
      windowsHide: true,
      timeout: 8000
    })
    return new RegExp(`\\s${pid}\\s`).test(stdout)
  } catch {
    return false
  }
}

function parseSerialNumber(stdout) {
  const match = /SerialNumber\s+REG_SZ\s+(\S+)/.exec(stdout || '')
  return match ? match[1] : null
}

async function defaultProcessLister() {
  const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 1024 * 1024
  })
  return stdout
}

function defaultLauncher(exePath, args, workingDirectory) {
  const child = spawn(exePath, args, {
    cwd: workingDirectory || path.dirname(exePath),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
  return child.pid
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createGsxInstaller({
  registryReader = defaultRegistryReader,
  rootLister = registeredAddonManagerRoots,
  processLister = defaultProcessLister,
  processExists = defaultProcessExists,
  launcher = defaultLauncher,
  sleep = defaultSleep,
  pollIntervalMs = ACTIVATION_POLL_INTERVAL_MS,
  pollTimeoutMs = ACTIVATION_POLL_TIMEOUT_MS
} = {}) {
  async function detectActivation() {
    const { present, stdout } = await registryReader()
    const serial = present ? parseSerialNumber(stdout) : null
    return { activated: Boolean(serial), serialPresent: Boolean(serial), serial }
  }

  async function detectInfrastructure() {
    const roots = await rootLister()
    for (const root of roots) {
      const updaterPath = path.join(root.rootPath, LIVE_UPDATE_EXECUTABLE)
      const exists = await fs.stat(updaterPath).then((s) => s.isFile()).catch(() => false)
      if (exists) {
        return { present: true, addonRoot: path.resolve(root.rootPath), source: root.source }
      }
    }
    return { present: false, addonRoot: null, source: null }
  }

  async function detectLifecycle(detectProductInstall) {
    const [infrastructure, activation, product] = await Promise.all([
      detectInfrastructure(),
      detectActivation(),
      detectProductInstall()
    ])
    return { infrastructure, activation, product }
  }

  async function assertSimClosed() {
    const listing = await processLister()
    const running = SIM_PROCESS_NAMES.filter((name) => listing.toLowerCase().includes(name.toLowerCase()))
    if (running.length > 0) {
      throw new Error(`检测到模拟器或 GSX 引擎正在运行（${running[0]}），请完全退出后重试`)
    }
  }

  // 启动官方 Live Update 界面（产品安装管理；也是激活的兜底入口）
  function launchLiveUpdateInstaller({ addonRoot }) {
    if (!addonRoot) throw new Error('未检测到 FSDT 安装根目录：请先完成第一步；若已安装过官方安装器，请确认其安装目录未被改名或移动')
    return launcher(path.join(addonRoot, LIVE_UPDATE_EXECUTABLE), LIVE_UPDATE_LAUNCH_ARGS, addonRoot)
  }

  // 定位官方向导的 GSX Pro 设置文件：优先已知官方文件名，否则按内容扫描
  // 根目录下 ProductName="GSX Pro" 的 *.lw.xml（不同官方版本可能更新文件名）。
  async function findLicenseWizardSettings(addonRoot) {
    const fallbackPath = path.join(addonRoot, LICENSE_WIZARD_SETTINGS_NAME)
    const fallbackExists = await fs.stat(fallbackPath).then((s) => s.isFile()).catch(() => false)
    if (fallbackExists) return fallbackPath
    const entries = await fs.readdir(addonRoot).catch(() => [])
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.lw.xml')) continue
      const fullPath = path.join(addonRoot, entry)
      try {
        if (/ProductName="GSX Pro"/.test(await fs.readFile(fullPath, 'utf8'))) return fullPath
      } catch {
        // 无法读取的候选文件跳过
      }
    }
    return null
  }

  // 启动官方 QLM 许可向导（在线/离线激活）。许可码由用户在向导中粘贴，不经过本模块。
  async function launchLicenseWizard({ addonRoot }) {
    if (!addonRoot) throw new Error('未检测到 FSDT 安装根目录：请先完成第一步；若已安装过官方安装器，请确认其安装目录未被改名或移动')
    const settingsPath = await findLicenseWizardSettings(addonRoot)
    if (!settingsPath) throw new Error('官方安装器目录中缺少激活向导的产品设置文件（*.lw.xml），请改在官方安装界面中点击激活')
    return launcher(path.join(addonRoot, LICENSE_WIZARD_EXECUTABLE), ['/settings', settingsPath], addonRoot)
  }

  // 轮询激活结果：SerialNumber 出现且不同于基线即视为激活完成。
  // watchPid 存在时同时监视官方向导窗口——向导一旦关闭，做最后一次注册表
  // 复查后立即返回，不再干等固定超时；激活记录先出现则提前返回。
  async function pollForActivation({ baselineSerial = null, timeoutMs = pollTimeoutMs, watchPid = null } = {}) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const { present, stdout } = await registryReader()
      const serial = present ? parseSerialNumber(stdout) : null
      if (serial && serial !== baselineSerial) return { activated: true, timedOut: false, wizardClosed: false }
      if (watchPid != null && !(await processExists(watchPid))) {
        const finalCheck = await registryReader()
        const finalSerial = finalCheck.present ? parseSerialNumber(finalCheck.stdout) : null
        return {
          activated: Boolean(finalSerial && finalSerial !== baselineSerial),
          timedOut: false,
          wizardClosed: true
        }
      }
      if (Date.now() >= deadline) return { activated: false, timedOut: true, wizardClosed: null }
      await sleep(pollIntervalMs)
    }
  }

  // 卸载 GSX 产品（官方作用域）：移除社区目录中的链接与 Addon Manager\MSFS 下的
  // 产品真身。引擎目录（couatl/couatl64）、激活状态、PackagesCache、机场配置与
  // GSX EFB 一律保留——与官方卸载器的行为一致。
  async function uninstallProduct({ addonRoot, communityDirectories }) {
    await assertSimClosed()
    if (!addonRoot) throw new Error('未检测到 FSDT 安装根目录')
    let resolvedAddonRoot = path.resolve(addonRoot)
    try {
      resolvedAddonRoot = await fs.realpath(resolvedAddonRoot)
    } catch {
      // 根目录被符号链接等场景：退回字面解析
    }
    const removedLinks = []
    const removedPackages = []
    const skipped = []

    for (const directory of communityDirectories || []) {
      for (const folderName of PRODUCT_PACKAGE_FOLDERS) {
        const linkPath = path.join(directory, folderName)
        let stats = null
        try {
          stats = await fs.lstat(linkPath)
        } catch {
          continue
        }
        if (stats.isSymbolicLink()) {
          // 官方部署形态是目录符号链接：只移除链接本身，真身由下一步删除
          await fs.rm(linkPath, { force: true })
          removedLinks.push(linkPath)
          continue
        }
        if (stats.isDirectory()) {
          // 非链接的真实目录 = 用户自行复制的产品副本，按官方语义一并删除
          await fs.rm(linkPath, { recursive: true, force: true })
          removedLinks.push(linkPath)
          continue
        }
        skipped.push(linkPath)
      }
    }

    for (const folderName of PRODUCT_PACKAGE_FOLDERS) {
      const packageDirectory = path.join(resolvedAddonRoot, 'MSFS', folderName)
      // 越界防御：目标由固定常量拼接而成，仍以相对路径校验确保不逃出安装根
      const relative = path.relative(resolvedAddonRoot, packageDirectory)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`检测到越界的卸载目标（${packageDirectory}），已中止`)
      }
      try {
        const stats = await fs.lstat(packageDirectory)
        if (stats.isDirectory()) {
          await fs.rm(packageDirectory, { recursive: true, force: true })
          removedPackages.push(packageDirectory)
        }
      } catch {
        // 目录不存在 = 本就未安装该产品包
      }
    }

    return { removedLinks, removedPackages, skipped }
  }

  return {
    detectActivation,
    detectInfrastructure,
    detectLifecycle,
    assertSimClosed,
    launchLiveUpdateInstaller,
    launchLicenseWizard,
    pollForActivation,
    uninstallProduct
  }
}

module.exports = {
  FSDT_REGISTRY_KEY,
  LICENSE_WIZARD_EXECUTABLE,
  LICENSE_WIZARD_SETTINGS_NAME,
  LIVE_UPDATE_EXECUTABLE,
  LIVE_UPDATE_LAUNCH_ARGS,
  PRODUCT_PACKAGE_FOLDERS,
  SERIAL_NUMBER_VALUE_NAME,
  createGsxInstaller,
  parseSerialNumber
}
