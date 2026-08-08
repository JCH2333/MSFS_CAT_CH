const UPDATE_CHECK_TIMEOUT_MS = 15000

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

async function checkForUpdatesWithFallback({ updater, timeoutMs = UPDATE_CHECK_TIMEOUT_MS, onDirectFallback = () => {} }) {
  await updater.netSession.setProxy({ mode: 'system' })

  try {
    return updateStatusFromResult(await withTimeout(updater.checkForUpdates(), timeoutMs))
  } catch (error) {
    if (!(error instanceof UpdateCheckTimeoutError)) throw error
  }

  onDirectFallback()
  await resetTimedOutCheck(updater)
  await updater.netSession.setProxy({ mode: 'direct' })

  try {
    return updateStatusFromResult(await withTimeout(updater.checkForUpdates(), timeoutMs))
  } catch (error) {
    if (error instanceof UpdateCheckTimeoutError) await resetTimedOutCheck(updater)
    throw error
  }
}

module.exports = {
  UPDATE_CHECK_TIMEOUT_MS,
  UpdateCheckTimeoutError,
  checkForUpdatesWithFallback,
  downloadUpdate,
  updateStatusFromResult
}
