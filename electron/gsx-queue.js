const { buildServerUrl } = require('./distribution-server')

// 分发服务器下载排队客户端：大文件（GSX 安装器/完整包/热更组件）按“先来后到”
// 过闸，后到的用户排队等待。流程：begin 取票（容量满则 waiting + 排位）→
// 轮询 status 直到 ready → 携票下载 → done 归还槽位。票过期/丢失时自动重取。

const QUEUE_BEGIN_PATH = '/api/gsx/queue/begin'
const QUEUE_STATUS_PATH = '/api/gsx/queue/status'
const QUEUE_DONE_PATH = '/api/gsx/queue/done'

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createGsxQueueClient({
  fetchImpl = globalThis.fetch,
  onQueue = () => {},
  pollIntervalMs = 3000,
  timeoutMs = 7200000
} = {}) {
  async function requestJson(url, options = {}) {
    const response = await fetchImpl(buildServerUrl(url), {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'msfs-cat-ch' },
      signal: AbortSignal.timeout(15000),
      ...options
    })
    if (!response.ok) throw new Error(`排队服务请求失败：HTTP ${response.status}`)
    return response.json()
  }

  // 取票并阻塞到就绪；返回票号。onQueue({ position }) 向界面汇报排位。
  async function acquire({ scope = 'gsx' } = {}) {
    const deadline = Date.now() + timeoutMs
    const begin = await requestJson(QUEUE_BEGIN_PATH, { method: 'POST', body: JSON.stringify({ scope }) })
    let ticket = begin.ticket
    if (!ticket) throw new Error('排队服务未返回票号')
    if (begin.status === 'ready') return ticket
    onQueue({ position: begin.position ?? null })
    for (;;) {
      if (Date.now() > deadline) throw new Error('排队等待超时，请稍后重试')
      await defaultSleep(pollIntervalMs)
      const state = await requestJson(`${QUEUE_STATUS_PATH}?ticket=${encodeURIComponent(ticket)}`)
      if (state.status === 'ready') return ticket
      if (state.status === 'waiting') {
        onQueue({ position: state.position ?? null })
        continue
      }
      // 票已过期/丢失：重新取票（可能直接就绪）
      const again = await requestJson(QUEUE_BEGIN_PATH, { method: 'POST', body: JSON.stringify({ scope }) })
      ticket = again.ticket ?? ticket
      if (again.status === 'ready') return ticket
      onQueue({ position: again.position ?? null })
    }
  }

  // 归还槽位（尽力而为：失败只影响槽位回收时效，服务端租约会兜底过期）
  async function release(ticket) {
    if (!ticket) return
    try {
      await requestJson(`${QUEUE_DONE_PATH}?ticket=${encodeURIComponent(ticket)}`, { method: 'POST' })
    } catch {
      // 归还失败不阻塞下载结果
    }
  }

  return { acquire, release }
}

function withTicket(url, ticket) {
  if (!ticket) return url
  return `${url}${url.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket)}`
}

// 包装下载函数：下载前取票排队，结束（无论成败）归还槽位。
function createQueueAwareDownload(downloadImpl, queue) {
  return async (url, destination, onProgress) => {
    const ticket = await queue.acquire()
    try {
      return await downloadImpl(withTicket(url, ticket), destination, onProgress)
    } finally {
      await queue.release(ticket)
    }
  }
}

module.exports = {
  QUEUE_BEGIN_PATH,
  QUEUE_STATUS_PATH,
  QUEUE_DONE_PATH,
  createGsxQueueClient,
  createQueueAwareDownload,
  withTicket
}
