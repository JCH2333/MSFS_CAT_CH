const { buildServerUrl } = require('./distribution-server')

const UPDATE_CHECK_TIMEOUT_MS = 15000
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

// 2.0 起自建分发服务器是唯一的软件更新源，不再提供多级回退链。
async function checkForUpdates({
  updater,
  timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
  feed = serverSoftwareFeed()
} = {}) {
  if (!feed) throw new Error('未配置软件更新服务器地址')

  updater.setFeedURL(feed)
  await updater.netSession.setProxy({ mode: 'system' })

  try {
    return updateStatusFromResult(await withTimeout(updater.checkForUpdates(), timeoutMs))
  } catch (error) {
    if (error instanceof UpdateCheckTimeoutError) await resetTimedOutCheck(updater)
    throw error
  }
}

async function startRequiredUpdate({
  updater,
  ...options
}) {
  const status = await checkForUpdates({ updater, ...options })
  if (status.state !== 'available') return status
  await downloadUpdate(updater)
  return { state: 'downloading', info: status.info }
}

module.exports = {
  SERVER_SOFTWARE_FEED_PATH,
  SERVER_SOFTWARE_FEED_URL,
  UPDATE_CHECK_TIMEOUT_MS,
  UpdateCheckTimeoutError,
  checkForUpdates,
  downloadUpdate,
  serverSoftwareFeed,
  startRequiredUpdate,
  updateStatusFromResult
}
