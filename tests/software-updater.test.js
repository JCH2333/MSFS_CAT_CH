const test = require('node:test')
const assert = require('node:assert/strict')
const {
  SERVER_SOFTWARE_FEED_URL,
  UPDATE_CHECK_TIMEOUT_MS,
  UpdateCheckTimeoutError,
  checkForUpdates,
  downloadUpdate,
  serverSoftwareFeed,
  startRequiredUpdate,
  updateStatusFromResult
} = require('../electron/software-updater')
const { SERVER_ORIGIN, buildServerUrl } = require('../electron/distribution-server')

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

test('builds the only software feed from the distribution server origin', () => {
  assert.equal(SERVER_ORIGIN, 'http://47.109.31.236:20075')
  assert.equal(SERVER_SOFTWARE_FEED_URL, buildServerUrl('/downloads/software/'))
  assert.deepEqual(serverSoftwareFeed(), {
    provider: 'generic',
    url: buildServerUrl('/downloads/software/')
  })
})

test('builds a generic server feed only when a server URL is configured', () => {
  assert.equal(serverSoftwareFeed(''), null)
  assert.equal(serverSoftwareFeed(null), null)
  assert.deepEqual(serverSoftwareFeed('https://dist.example.com/downloads/software/'), {
    provider: 'generic',
    url: 'https://dist.example.com/downloads/software/'
  })
})

test('checks the distribution server feed with the system proxy and reports current', async () => {
  const updater = createUpdater(async () => ({ isUpdateAvailable: false, updateInfo: { version: '2.0.0' } }))

  const status = await checkForUpdates({ updater, timeoutMs: 20 })

  assert.deepEqual(updater.calls.feeds, [{ provider: 'generic', url: SERVER_SOFTWARE_FEED_URL }])
  assert.deepEqual(updater.calls.proxies, [{ mode: 'system' }])
  assert.deepEqual(status, { state: 'current', info: { version: '2.0.0' } })
})

test('reports an available update from the server feed', async () => {
  const updater = createUpdater(async () => ({ isUpdateAvailable: true, updateInfo: { version: '2.1.0' } }))

  const status = await checkForUpdates({ updater, timeoutMs: 20 })

  assert.deepEqual(updater.calls.feeds, [{ provider: 'generic', url: SERVER_SOFTWARE_FEED_URL }])
  assert.deepEqual(status, { state: 'available', info: { version: '2.1.0' } })
})

test('uses an explicitly provided feed instead of the default server feed', async () => {
  const updater = createUpdater(async () => ({ isUpdateAvailable: false, updateInfo: { version: '2.0.0' } }))
  const feed = serverSoftwareFeed('https://dist.example.com/downloads/software/')

  const status = await checkForUpdates({ updater, feed, timeoutMs: 20 })

  assert.deepEqual(updater.calls.feeds, [feed])
  assert.deepEqual(status, { state: 'current', info: { version: '2.0.0' } })
})

test('refuses to check updates when no server feed is configured', async () => {
  const updater = createUpdater(async () => ({ isUpdateAvailable: false }))

  await assert.rejects(checkForUpdates({ updater, feed: null, timeoutMs: 20 }), /未配置软件更新服务器地址/)
  assert.deepEqual(updater.calls.feeds, [])
})

test('resets a timed-out server check, closes connections, and raises UpdateCheckTimeoutError', async () => {
  const keepAlive = setInterval(() => {}, 1000)
  const updater = createUpdater(() => new Promise(() => {}))

  try {
    await assert.rejects(checkForUpdates({ updater, timeoutMs: 5 }), UpdateCheckTimeoutError)
  } finally {
    clearInterval(keepAlive)
  }
  assert.equal(updater.calls.closeAllConnections, 1)
  assert.equal(updater.checkForUpdatesPromise, null)
  assert.deepEqual(updater.calls.proxies, [{ mode: 'system' }])
})

test('rethrows non-timeout server errors without closing connections', async () => {
  const updater = createUpdater(() => Promise.reject(new Error('server feed returned HTTP 503')))
  const originalPromise = updater.checkForUpdatesPromise

  await assert.rejects(checkForUpdates({ updater, timeoutMs: 20 }), /server feed returned HTTP 503/)
  assert.equal(updater.calls.closeAllConnections, 0)
  assert.equal(updater.checkForUpdatesPromise, originalPromise)
})

test('maps a no-update result to current', () => {
  assert.deepEqual(updateStatusFromResult({ isUpdateAvailable: false, updateInfo: { version: '2.0.0' } }), {
    state: 'current',
    info: { version: '2.0.0' }
  })
})

test('reports downloaded only after the updater has completed the download', async () => {
  const updater = { downloadUpdate: async () => ['C:\\updates\\MSFS_CAT_CH-Setup-2.0.1.exe'] }

  assert.deepEqual(await downloadUpdate(updater), { state: 'downloaded' })
})

test('downloads an available update immediately in the required update flow', async () => {
  let downloads = 0
  const updater = createUpdater(async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: '2.0.1' }
  }))
  updater.downloadUpdate = async () => { downloads += 1 }

  const status = await startRequiredUpdate({ updater, timeoutMs: 20 })

  assert.equal(downloads, 1)
  assert.deepEqual(status, { state: 'downloading', info: { version: '2.0.1' } })
})

test('keeps the required update flow on current without downloading', async () => {
  let downloads = 0
  const updater = createUpdater(async () => ({ isUpdateAvailable: false, updateInfo: { version: '2.0.0' } }))
  updater.downloadUpdate = async () => { downloads += 1 }

  const status = await startRequiredUpdate({ updater, timeoutMs: 20 })

  assert.equal(downloads, 0)
  assert.deepEqual(status, { state: 'current', info: { version: '2.0.0' } })
})

test('retains the 15 second update check timeout', () => {
  assert.equal(UPDATE_CHECK_TIMEOUT_MS, 15000)
})
