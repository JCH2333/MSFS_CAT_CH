// 公告在列表页与弹窗共用的展示格式化逻辑。
// 服务端 createdAt 形如 "2026-09-13T14:00:00"（无时区标记），
// 按字符串原样展示为 "2026-09-13 14:00"，避免浏览器时区换算造成偏移。

const ANNOUNCEMENT_CATEGORY_LABELS = {
  global: '全局',
  software: '软件'
}

export function announcementCategoryKind(category) {
  if (category === 'global' || category === 'software') return category
  if (typeof category === 'string' && category.startsWith('patch:')) return 'patch'
  return 'global'
}

export function announcementCategoryLabel(category) {
  if (ANNOUNCEMENT_CATEGORY_LABELS[category]) return ANNOUNCEMENT_CATEGORY_LABELS[category]
  if (typeof category === 'string' && category.startsWith('patch:')) {
    return `补丁 · ${category.slice('patch:'.length)}`
  }
  return '公告'
}

export function formatAnnouncementTime(value) {
  if (typeof value !== 'string') return ''
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!match) return value
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
}
