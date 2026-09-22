const { buildServerUrl } = require('./distribution-server')

// 分发服务器下载排队客户端：大文件（GSX 安装器/完整包/热更组件）按“先来后到”
// 过闸。流程：begin 取票（携带稳定 clientId，等待中重试/重启应用拿回同一排位）→
// 轮询 status 直到 ready → 携票下载 → 流程结束后 done 归还槽位。
//
// 会话化：createQueueAwareDownload 返回的下载函数会在首次使用时取票，并在整个
// 流程期间复用同一张票（下载间隙校验/解压不重新排队），空闲超过 idleReleaseMs
// 才归还槽位；服务端租约以“下载请求/轮询”为心跳续期。

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
  timeoutMs = 21600000, // 排队等待上限（6 小时）；clientId 粘性保证超时重试不丢排位
  clientId = null
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
    const beginBody = JSON.stringify({ scope, clientId })
    let begin = await requestJson(QUEUE_BEGIN_PATH, { method: 'POST', body: beginBody })
    let ticket = begin.ticket
    if (!ticket) throw new Error('排队服务未返回票号')
    if (begin.status === 'ready') return ticket
    onQueue({ position: begin.position ?? null })
    for (;;) {
      if (Date.now() > deadline) throw new Error('排队等待超时，请稍后重试（会保留您的排队位）')
      await defaultSleep(pollIntervalMs)
      const state = await requestJson(`${QUEUE_STATUS_PATH}?ticket=${encodeURIComponent(ticket)}`)
      if (state.status === 'ready') return ticket
      if (state.status === 'waiting') {
        onQueue({ position: state.position ?? null })
        continue
      }
      // 票已失效（服务端等待超期等）：重新取票——clientId 粘性会尽量找回排位
      begin = await requestJson(QUEUE_BEGIN_PATH, { method: 'POST', body: beginBody })
      ticket = begin.ticket ?? ticket
      if (begin.status === 'ready') return ticket
      onQueue({ position: begin.position ?? null })
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

  return { acquire, release, clientId }
}

function withTicket(url, ticket) {
  if (!ticket) return url
  return `${url}${url.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket)}`
}

// 会话化下载包装：首次下载取票，整个流程复用同一张票（跨多个文件不重新排队），
// 空闲超过 idleReleaseMs 才归还槽位（服务端租约另行兜底）。
function createQueueAwareDownload(downloadImpl, queue, { idleReleaseMs = 180000 } = {}) {
  let session = null // { ticket }
  let idleTimer = null

  function touchIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(async () => {
      const current = session
      session = null
      if (current) await queue.release(current.ticket).catch(() => {})
    }, idleReleaseMs)
    if (typeof idleTimer.unref === 'function') idleTimer.unref()
  }

  const wrapped = async (url, destination, onProgress) => {
    if (!session) {
      const ticket = await queue.acquire()
      session = { ticket }
    }
    const ticket = session.ticket
    touchIdleTimer()
    try {
      return await downloadImpl(withTicket(url, ticket), destination, onProgress)
    } catch (error) {
      // 下载失败即结束会话：让出槽位，避免后续文件拿失效票
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = null
      const current = session
      session = null
      if (current) await queue.release(current.ticket).catch(() => {})
      throw error
    }
  }
  // 主动让出带宽槽位（宽限期内原顺位恢复）
  wrapped.releaseSession = async () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    const current = session
    session = null
    if (current) await queue.release(current.ticket).catch(() => {})
  }
  return wrapped
}

module.exports = {
  QUEUE_BEGIN_PATH,
  QUEUE_STATUS_PATH,
  QUEUE_DONE_PATH,
  createGsxQueueClient,
  createQueueAwareDownload,
  withTicket
}
