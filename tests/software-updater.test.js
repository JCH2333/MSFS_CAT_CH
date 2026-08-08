const test = require('node:test')
const assert = require('node:assert/strict')
const {
  UpdateCheckTimeoutError,
  checkForUpdatesWithFallback,
  downloadUpdate,
  updateStatusFromResult
} = require('../electron/software-updater')

function createUpdater(checkForUpdates) {
  const calls = { proxies: [], closeAllConnections: 0 }
  return {
    calls,
    checkForUpdatesPromise: Promise.resolve(),
    checkForUpdates,
    netSession: {
      setProxy: async (configuration) => { calls.proxies.push(configuration) },
      closeAllConnections: async () => { calls.closeAllConnections += 1 }
    }
  }
}

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
