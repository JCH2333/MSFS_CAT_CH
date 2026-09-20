const test = require('node:test')
const assert = require('node:assert/strict')
const { createGsxQueueClient, createQueueAwareDownload, withTicket } = require('../electron/gsx-queue')

function response(body) {
  return { ok: true, json: async () => body }
}

test('queue client polls until ready, passes the ticket and releases it', async () => {
  const seen = []
  let polls = 0
  const fetchImpl = async (url, options = {}) => {
    seen.push({ url, method: options.method || 'GET' })
    if (url.includes('/queue/begin')) return response({ status: 'waiting', ticket: 'T1', position: 2 })
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
    onQueue: (info) => positions.push(info.position)
  })
  const downloadCalls = []
  const download = createQueueAwareDownload(async (url) => {
    downloadCalls.push(url)
    return url
  }, queue)
  const result = await download('http://47.109.31.236:20075/api/gsx/install/a.zip', 'D:/tmp/a.zip', () => {})
  assert.equal(downloadCalls.length, 1)
  assert.ok(downloadCalls[0].includes('ticket=T1'), '下载地址应携带票号')
  assert.ok(positions.includes(2) && positions.includes(1), '应向界面汇报排位变化')
  const doneCalls = seen.filter((call) => call.url.includes('/queue/done'))
  assert.equal(doneCalls.length, 1, '下载结束后应归还槽位')
  assert.equal(result, 'http://47.109.31.236:20075/api/gsx/install/a.zip?ticket=T1')
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
  const queue = createGsxQueueClient({ fetchImpl, pollIntervalMs: 1 })
  const ticket = await queue.acquire()
  assert.equal(ticket, 'T-NEW')
  assert.equal(begins, 2)
})

test('withTicket appends the parameter safely', () => {
  assert.equal(withTicket('http://x/a.zip?ticket=a', 'b'), 'http://x/a.zip?ticket=a&ticket=b')
  assert.equal(withTicket('http://x/a.zip', 'b'), 'http://x/a.zip?ticket=b')
  assert.equal(withTicket('http://x/a.zip', null), 'http://x/a.zip')
})
