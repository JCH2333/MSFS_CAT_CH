const UPDATE_CHECK_TIMEOUT_MS = 15000
const GITEE_RELEASE_LOOKUP_TIMEOUT_MS = 5000
const GITEE_SOFTWARE_RELEASE_API = 'https://gitee.com/api/v5/repos/ljd123456/MSFS_CAT_CH/releases/latest'
const GITEE_SOFTWARE_RELEASE_BASE = 'https://gitee.com/ljd123456/MSFS_CAT_CH/releases/download'
const GITHUB_SOFTWARE_RELEASE_LATEST = 'https://github.com/JCH2333/MSFS_CAT_CH/releases/latest/download'
const GITHUB_SOFTWARE_MIRROR_FEED = Object.freeze({
  provider: 'generic',
  url: `https://ghfast.top/${GITHUB_SOFTWARE_RELEASE_LATEST}`
})
const GITHUB_SOFTWARE_FEED = Object.freeze({
  provider: 'github',
  owner: 'JCH2333',
  repo: 'MSFS_CAT_CH'
})

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

function assertReleaseTag(tag) {
  if (typeof tag !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) {
    throw new Error('Gitee latest release is missing a valid tag')
  }
  return tag
}

async function resolveGiteeSoftwareFeed({
  fetchImpl = globalThis.fetch,
  timeoutMs = GITEE_RELEASE_LOOKUP_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Gitee update checks are unavailable in this environment')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(GITEE_SOFTWARE_RELEASE_API, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Gitee update source returned HTTP ${response.status}`)
    const release = await response.json()
    const tag = assertReleaseTag(release?.tag_name)
    return {
      provider: 'generic',
      url: `${GITEE_SOFTWARE_RELEASE_BASE}/${encodeURIComponent(tag)}`
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new UpdateCheckTimeoutError('Gitee software release lookup timed out')
    throw error
  } finally {
    clearTimeout(timer)
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

async function checkForUpdatesWithFallback({
  updater,
  timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
  resolveGiteeFeed = null,
  githubFeed = GITHUB_SOFTWARE_FEED,
  onGiteeFallback = () => {},
  onDirectFallback = () => {},
  mirrorFeed = GITHUB_SOFTWARE_MIRROR_FEED,
  onMirrorFallback = () => {}
}) {
  if (resolveGiteeFeed) {
    try {
      const giteeFeed = await resolveGiteeFeed()
      updater.setFeedURL(giteeFeed)
      await updater.netSession.setProxy({ mode: 'system' })
      return updateStatusFromResult(await withTimeout(updater.checkForUpdates(), timeoutMs))
    } catch (error) {
      onGiteeFallback(error)
      await resetTimedOutCheck(updater)
    }
  }

  updater.setFeedURL?.(githubFeed)
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
    if (!(error instanceof UpdateCheckTimeoutError)) throw error
  }

  onMirrorFallback()
  updater.setFeedURL?.(mirrorFeed)
  await updater.netSession.setProxy({ mode: 'direct' })
  try {
    return updateStatusFromResult(await withTimeout(updater.checkForUpdates(), timeoutMs))
  } catch (error) {
    if (error instanceof UpdateCheckTimeoutError) await resetTimedOutCheck(updater)
    throw error
  }
}

module.exports = {
  GITEE_RELEASE_LOOKUP_TIMEOUT_MS,
  GITEE_SOFTWARE_RELEASE_API,
  GITEE_SOFTWARE_RELEASE_BASE,
  GITHUB_SOFTWARE_MIRROR_FEED,
  GITHUB_SOFTWARE_RELEASE_LATEST,
  GITHUB_SOFTWARE_FEED,
  UPDATE_CHECK_TIMEOUT_MS,
  UpdateCheckTimeoutError,
  checkForUpdatesWithFallback,
  downloadUpdate,
  resolveGiteeSoftwareFeed,
  updateStatusFromResult
}
