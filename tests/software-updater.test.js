const test = require('node:test')
const assert = require('node:assert/strict')
const {
  GITEE_SOFTWARE_RELEASE_API,
  GITHUB_SOFTWARE_FEED,
  UpdateCheckTimeoutError,
  checkForUpdatesWithFallback,
  downloadUpdate,
  resolveGiteeSoftwareFeed,
  updateStatusFromResult
} = require('../electron/software-updater')

function createUpdater(checkForUpdates) {
  const calls = { proxies: [], closeAllConnections: 0, feeds: [] }
  return {
    calls,
    checkForUpdatesPromise: Promise.resolve(),
    checkForUpdates,
    setFeedURL: (feed) => { calls.feeds.push(feed) },
    netSession: {
      setProxy: async (configuration) => { calls.proxies.push(configuration) },
      closeAllConnections: async () => { calls.closeAllConnections += 1 }
    }
  }
}

test('resolves the newest Gitee release to a generic updater feed', async () => {
  const calls = []
  const feed = await resolveGiteeSoftwareFeed({
    fetchImpl: async (url) => {
      calls.push(url)
      return { ok: true, json: async () => ({ tag_name: 'v1.2.10' }) }
    }
  })

  assert.deepEqual(calls, [GITEE_SOFTWARE_RELEASE_API])
  assert.deepEqual(feed, {
    provider: 'generic',
    url: 'https://gitee.com/ljd123456/MSFS_CAT_CH/releases/download/v1.2.10'
  })
})

test('falls back from an unavailable Gitee feed to GitHub before checking updates', async () => {
  const updater = createUpdater(async () => ({ isUpdateAvailable: false, updateInfo: { version: '1.2.9' } }))
  let giteeFallback = false

  const status = await checkForUpdatesWithFallback({
    updater,
    resolveGiteeFeed: async () => { throw new Error('Gitee unavailable') },
    onGiteeFallback: () => { giteeFallback = true },
    timeoutMs: 20
  })

  assert.equal(giteeFallback, true)
  assert.deepEqual(updater.calls.feeds, [GITHUB_SOFTWARE_FEED])
  assert.deepEqual(status, { state: 'current', info: { version: '1.2.9' } })
})

test('uses Gitee first when its release feed is available', async () => {
  const updater = createUpdater(async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.2.10' } }))
  const giteeFeed = { provider: 'generic', url: 'https://gitee.example/releases/download/v1.2.10' }

  const status = await checkForUpdatesWithFallback({
    updater,
    resolveGiteeFeed: async () => giteeFeed,
    timeoutMs: 20
  })

  assert.deepEqual(updater.calls.feeds, [giteeFeed])
  assert.deepEqual(status, { state: 'available', info: { version: '1.2.10' } })
})

test('returns the actual available state instead of leaving the renderer checking', async () => {
  const updater = createUpdater(async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: '1.2.1' }
  }))

  const status = await checkForUpdatesWithFallback({ updater, timeoutMs: 20 })

  assert.deepEqual(status, { state: 'available', info: { version: '1.2.1' } })
  assert.deepEqual(updater.calls.proxies, [{ mode: 'system' }])
})

test('switches from the system proxy to a direct GitHub connection after a timeout', async () => {
  let attempts = 0
  const updater = createUpdater(() => {
    attempts += 1
    return attempts === 1
      ? new Promise(() => {})
      : Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '1.2.0' } })
  })
  let usedDirectFallback = false

  const status = await checkForUpdatesWithFallback({
    updater,
    timeoutMs: 5,
    onDirectFallback: () => { usedDirectFallback = true }
  })

  assert.equal(usedDirectFallback, true)
  assert.equal(updater.calls.closeAllConnections, 1)
  assert.deepEqual(updater.calls.proxies, [{ mode: 'system' }, { mode: 'direct' }])
  assert.deepEqual(status, { state: 'current', info: { version: '1.2.0' } })
})

test('reports a timeout when both proxy and direct checks fail to finish', async () => {
  const updater = createUpdater(() => new Promise(() => {}))

  await assert.rejects(
    checkForUpdatesWithFallback({ updater, timeoutMs: 5 }),
    UpdateCheckTimeoutError
  )
  assert.equal(updater.calls.closeAllConnections, 2)
})

test('maps a no-update result to current', () => {
  assert.deepEqual(updateStatusFromResult({ isUpdateAvailable: false, updateInfo: { version: '1.2.0' } }), {
    state: 'current',
    info: { version: '1.2.0' }
  })
})

test('reports downloaded only after the updater has completed the download', async () => {
  const updater = { downloadUpdate: async () => ['C:\\updates\\MSFS_CAT_CH-Setup-1.2.2.exe'] }

  assert.deepEqual(await downloadUpdate(updater), { state: 'downloaded' })
})
