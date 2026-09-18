const { buildServerUrl } = require('./distribution-server')
const { compareVersions, isSemanticVersion } = require('./versioning')

const UPDATE_CHECK_TIMEOUT_MS = 15000
const QUICK_CHECK_TIMEOUT_MS = 3000
const SERVER_SOFTWARE_FEED_PATH = '/downloads/software/'
const SERVER_SOFTWARE_FEED_URL = buildServerUrl(SERVER_SOFTWARE_FEED_PATH)

function serverSoftwareFeed(url = SERVER_SOFTWARE_FEED_URL) {
  if (typeof url !== 'string' || url.trim() === '') return null
  return { provider: 'generic', url: url.trim() }
}

class UpdateCheckTimeoutError extends Error {
  constructor() {
    super('Software update check timed out')
    this.name = 'UpdateCheckTimeoutError'
  }
}

function withTimeout(promise, timeoutMs) {
  let timer = null
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new UpdateCheckTimeoutError()), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

function updateStatusFromResult(result) {
  return {
    state: result?.isUpdateAvailable ? 'available' : 'current',
    info: result?.updateInfo || null
  }
}

async function downloadUpdate(updater) {
  await updater.downloadUpdate()
  return { state: 'downloaded' }
}

async function resetTimedOutCheck(updater) {
  await updater.netSession.closeAllConnections?.()
  // electron-updater caches an in-flight check. The request has been closed, so allow one direct retry.
  if ('checkForUpdatesPromise' in updater) updater.checkForUpdatesPromise = null
}

// 启动快速预检：Node fetch 直连国内服务器拉 latest.yml 做纯版本对比（不走系统
// 代理——代理会把国内 IP 绕道境外出口，单次检查可达 10 秒以上）。返回：
// - { updateAvailable: false }：已是最新，调用方直接返回，完全不碰 electron-updater；
// - { updateAvailable: true }：确有更新，继续走完整更新流程获取更新信息并下载；
// - null：预检失败或响应不可解析，回退到完整流程。
async function quickCurrentCheck({ feed, currentVersion, fetchImpl = globalThis.fetch, timeoutMs = QUICK_CHECK_TIMEOUT_MS } = {}) {
  if (!currentVersion || !isSemanticVersion(currentVersion) || !feed?.url) return null
  try {
    const url = `${String(feed.url).replace(/\/+$/, '')}/latest.yml`
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null
    const match = (await response.text()).match(/^\s*version:\s*(\S+)/m)
    const latest = match ? match[1].trim() : null
    if (!latest || !isSemanticVersion(latest)) return null
    return { updateAvailable: compareVersions(latest, currentVersion) > 0 }
  } catch {
    return null
  }
}

// 2.0 起自建分发服务器是唯一的软件更新源，不再提供多级回退链。
async function checkForUpdates({
  updater,
  timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
  feed = serverSoftwareFeed()
} = {}) {
  if (!feed) throw new Error('未配置软件更新服务器地址')

  updater.setFeedURL(feed)
  // 直连而不是跟随系统代理：分发服务器在国内（阿里云），走代理（加速器/Clash）
  // 会把请求绕道境外出口，检查与安装包下载都可能慢到不可用。
  await updater.netSession.setProxy({ mode: 'direct' })

  try {
    return updateStatusFromResult(await withTimeout(updater.checkForUpdates(), timeoutMs))
  } catch (error) {
    if (error instanceof UpdateCheckTimeoutError) await resetTimedOutCheck(updater)
    throw error
  }
}

async function startRequiredUpdate({
  updater,
  currentVersion = null,
  fetchImpl = globalThis.fetch,
  feed = serverSoftwareFeed(),
  timeoutMs
}) {
  // 快速预检：无更新时秒回，不再为一次版本对比走 electron-updater + 代理
  const quick = await quickCurrentCheck({ feed, currentVersion, fetchImpl })
  if (quick && !quick.updateAvailable) return { state: 'current', info: null }
  const status = await checkForUpdates({ updater, feed, timeoutMs })
  if (status.state !== 'available') return status
  await downloadUpdate(updater)
  return { state: 'downloading', info: status.info }
}

module.exports = {
  SERVER_SOFTWARE_FEED_PATH,
  SERVER_SOFTWARE_FEED_URL,
  UPDATE_CHECK_TIMEOUT_MS,
  QUICK_CHECK_TIMEOUT_MS,
  UpdateCheckTimeoutError,
  checkForUpdates,
  downloadUpdate,
  quickCurrentCheck,
  serverSoftwareFeed,
  startRequiredUpdate,
  updateStatusFromResult
}
