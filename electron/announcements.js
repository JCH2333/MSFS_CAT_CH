const { buildServerUrl } = require('./distribution-server')

const ANNOUNCEMENTS_ENDPOINT_PATH = '/api/announcements'
const POPUP_ANNOUNCEMENTS_ENDPOINT_PATH = '/api/announcements/popup'
const ANNOUNCEMENTS_PAGE_SIZE = 50

// 公告类别：global 全局 / software 软件 / patch:<patchId> 具体补丁。
function isValidAnnouncementCategory(value) {
  if (typeof value !== 'string' || value === '') return false
  return value === 'global' || value === 'software' || value.startsWith('patch:')
}

function isValidAnnouncementId(value) {
  return Number.isInteger(value) && value > 0
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

// 逐条校验公告字段，非法条目直接丢弃，不影响列表中的其他公告。
function normalizeAnnouncement(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  if (!isValidAnnouncementId(entry.id)) return null
  if (!isNonEmptyString(entry.title)) return null
  if (!isNonEmptyString(entry.content)) return null
  if (!isValidAnnouncementCategory(entry.category)) return null
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    imageUrl: typeof entry.imageUrl === 'string' && entry.imageUrl !== '' ? entry.imageUrl : null,
    popup: entry.popup === true,
    pinned: entry.pinned === true,
    category: entry.category,
    createdByUsername: typeof entry.createdByUsername === 'string' ? entry.createdByUsername : '',
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : ''
  }
}

function normalizeAnnouncementList(content) {
  if (!Array.isArray(content)) return null
  return content
    .map((entry) => normalizeAnnouncement(entry))
    .filter((announcement) => announcement !== null)
}

// 两个公告接口共用同一套信封校验：HTTP 200 + body.code === 200 + data 内是数组。
async function fetchAnnouncementEnvelope(pathname, pickContent, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: '当前环境无法获取公告' }
  }

  let response
  try {
    response = await fetchImpl(buildServerUrl(pathname))
  } catch {
    return { ok: false, error: '暂时无法连接公告服务器，请检查网络后重试' }
  }

  if (!response.ok || response.status !== 200) {
    return { ok: false, error: `公告获取失败（HTTP ${response.status}），请稍后重试` }
  }

  let body
  try {
    body = await response.json()
  } catch {
    return { ok: false, error: '公告数据格式无效，请稍后重试' }
  }

  if (!body || body.code !== 200) {
    return { ok: false, error: `公告接口返回异常（code ${body?.code ?? '未知'}），请稍后重试` }
  }

  const announcements = normalizeAnnouncementList(pickContent(body))
  if (!announcements) {
    return { ok: false, error: '公告数据格式无效，请稍后重试' }
  }

  return { ok: true, announcements }
}

// 已发布公告列表，服务端已按“置顶优先 + createdAt 倒序”排序。
function fetchAnnouncements(options = {}) {
  return fetchAnnouncementEnvelope(
    `${ANNOUNCEMENTS_ENDPOINT_PATH}?page=0&size=${ANNOUNCEMENTS_PAGE_SIZE}`,
    (body) => body?.data?.content,
    options
  )
}

// 弹窗公告列表，信封的 data 直接是数组。
function fetchPopupAnnouncements(options = {}) {
  return fetchAnnouncementEnvelope(POPUP_ANNOUNCEMENTS_ENDPOINT_PATH, (body) => body?.data, options)
}

module.exports = {
  ANNOUNCEMENTS_ENDPOINT_PATH,
  ANNOUNCEMENTS_PAGE_SIZE,
  POPUP_ANNOUNCEMENTS_ENDPOINT_PATH,
  fetchAnnouncements,
  fetchPopupAnnouncements,
  normalizeAnnouncement,
  normalizeAnnouncementList
}
