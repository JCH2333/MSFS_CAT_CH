const test = require('node:test')
const assert = require('node:assert/strict')
const { createGsxQueueClient, createQueueAwareDownload, withTicket } = require('../electron/gsx-queue')

function response(body) {
  return { ok: true, json: async () => body }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('queue client polls until ready, holds the session across files and releases once', async () => {
  const calls = []
  let polls = 0
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body || null })
    if (url.includes('/queue/begin')) {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : {}
      assert.equal(body.clientId, 'CLIENT-1', 'begin 应携带粘性 clientId')
      return response({ status: 'waiting', ticket: 'T1', position: 2 })
    }
    if (url.includes('/queue/status')) {
      polls += 1
      return response(polls >= 2 ? { status: 'ready', ticket: 'T1' } : { status: 'waiting', position: 1 })
    }
    if (url.includes('/queue/done')) return response({ ok: true })
    throw new Error('unexpected url ' + url)
  }
  const positions = []
  const queue = createGsxQueueClient({
    fetchImpl,
    pollIntervalMs: 1,
    timeoutMs: 60000,
    clientId: 'CLIENT-1',
    onQueue: (info) => positions.push(info.position)
  })
  const download = createQueueAwareDownload(async (url) => url, queue, { idleReleaseMs: 80 })
  const first = await download('http://47.109.31.236:20075/api/gsx/package/6', 'D:/tmp/6.zip', () => {})
  assert.equal(first, 'http://47.109.31.236:20075/api/gsx/package/6?ticket=T1')
  const second = await download('http://47.109.31.236:20075/api/gsx/package/7', 'D:/tmp/7.zip', () => {})
  assert.equal(second, 'http://47.109.31.236:20075/api/gsx/package/7?ticket=T1')
  assert.ok(positions.includes(2) && positions.includes(1), '应向界面汇报排位变化')
  await sleep(150)
  const begins = calls.filter((call) => call.url.includes('/queue/begin'))
  assert.equal(begins.length, 1, '整个流程只取一次票')
  const dones = calls.filter((call) => call.url.includes('/queue/done'))
  assert.equal(dones.length, 1, '空闲后归还槽位一次')
})

test('queue client re-begins when the ticket is reported unknown', async () => {
  let begins = 0
  const fetchImpl = async (url) => {
    if (url.includes('/queue/begin')) {
      begins += 1
      return response(begins === 1 ? { status: 'waiting', ticket: 'T-OLD', position: 5 } : { status: 'ready', ticket: 'T-NEW' })
    }
    if (url.includes('/queue/status')) return response({ status: 'unknown' })
    if (url.includes('/queue/done')) return response({ ok: true })
    throw new Error('unexpected url ' + url)
  }
  const queue = createGsxQueueClient({ fetchImpl, pollIntervalMs: 1, clientId: 'CLIENT-2' })
  const ticket = await queue.acquire()
  assert.equal(ticket, 'T-NEW')
  assert.equal(begins, 2)
})

test('a failed download releases the session so the next one re-acquires cleanly', async () => {
  let attempts = 0
  const fetchImpl = async (url) => {
    if (url.includes('/queue/begin')) {
      attempts += 1
      return response({ status: 'ready', ticket: 'T-' + attempts })
    }
    if (url.includes('/queue/done')) return response({ ok: true })
    throw new Error('unexpected url ' + url)
  }
  const downloadImpl = async (url) => {
    if (attempts === 1) throw new Error('网络中断')
    return url
  }
  const queue = createGsxQueueClient({ fetchImpl })
  const download = createQueueAwareDownload(downloadImpl, queue, { idleReleaseMs: 60000 })
  await assert.rejects(() => download('http://x/1.zip', 'D:/1.zip'), /网络中断/)
  const recovered = await download('http://x/2.zip', 'D:/2.zip')
  assert.equal(recovered, 'http://x/2.zip?ticket=T-2')
})

test('withTicket appends the parameter safely', () => {
  assert.equal(withTicket('http://x/a.zip?ticket=a', 'b'), 'http://x/a.zip?ticket=a&ticket=b')
  assert.equal(withTicket('http://x/a.zip', 'b'), 'http://x/a.zip?ticket=b')
  assert.equal(withTicket('http://x/a.zip', null), 'http://x/a.zip')
})
