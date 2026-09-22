const { buildServerUrl } = require('./distribution-server')

const SPONSOR_MESSAGES_ENDPOINT_PATH = '/api/sponsor/messages'
const MAX_MESSAGES = 50
const MAX_CONTENT_LENGTH = 100

// 不可信输入逐字段收紧：content 截断到 100 字、条数截断到 50、顺序号钳位。
function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, MAX_MESSAGES)
    .map((item) => ({
      id: typeof item?.id === 'number' ? item.id : 0,
      content: typeof item?.content === 'string' ? item.content.trim().slice(0, MAX_CONTENT_LENGTH) : '',
      displayOrder: typeof item?.displayOrder === 'number' ? item.displayOrder : 0
    }))
    .filter((item) => item.content.trim().length > 0)
}

/** 拉取赞助页滚动弹幕留言（公开只读端点）。失败返回空列表，页面隐藏弹幕区。 */
async function fetchSponsorMessages({ fetchImpl = globalThis.fetch } = {}) {
  try {
    if (typeof fetchImpl !== 'function') return { ok: false, messages: [] }
    const response = await fetchImpl(buildServerUrl(SPONSOR_MESSAGES_ENDPOINT_PATH), {
      headers: { Accept: 'application/json', 'User-Agent': 'msfs-cat-ch' }
    })
    if (!response.ok) return { ok: false, messages: [] }
    const body = await response.json()
    const messages = sanitizeMessages(body?.data?.messages)
    return { ok: messages.length > 0, messages }
  } catch {
    return { ok: false, messages: [] }
  }
}

module.exports = {
  SPONSOR_MESSAGES_ENDPOINT_PATH,
  fetchSponsorMessages,
  sanitizeMessages
}
