// 补丁目录排序（汉化补丁页右上角排序控件的数据逻辑，纯函数便于测试）。

export const PATCH_SORT_FIELDS = [
  { id: 'downloads', label: '按下载量' },
  { id: 'updated', label: '按更新时间' },
  { id: 'name', label: '按首字母' }
]

export const PATCH_SORT_ORDERS = [
  { id: 'desc', label: '降序' },
  { id: 'asc', label: '升序' }
]

const DEFAULT_SORT = { sortBy: 'downloads', sortOrder: 'desc' }

const SORT_FIELD_IDS = new Set(PATCH_SORT_FIELDS.map((field) => field.id))
const SORT_ORDER_IDS = new Set(PATCH_SORT_ORDERS.map((order) => order.id))

// 从 localStorage 等存储值恢复排序状态；非法值回退默认（下载量降序）
export function normalizePatchSort(saved) {
  const value = saved && typeof saved === 'object' ? saved : {}
  return {
    sortBy: SORT_FIELD_IDS.has(value.sortBy) ? value.sortBy : DEFAULT_SORT.sortBy,
    sortOrder: SORT_ORDER_IDS.has(value.sortOrder) ? value.sortOrder : DEFAULT_SORT.sortOrder
  }
}

function publishedTime(patch) {
  const timestamp = Date.parse(typeof patch?.publishedAt === 'string' ? patch.publishedAt : '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function downloadCount(patch) {
  const count = Number(patch?.downloadCount)
  return Number.isSafeInteger(count) && count > 0 ? count : 0
}

// 单字段比较：updated 按发布时间，downloads 按下载量，name 按中文拼音序
function fieldCompare(a, b, sortBy) {
  if (sortBy === 'downloads') {
    return downloadCount(a) - downloadCount(b)
  }
  if (sortBy === 'name') {
    const nameA = typeof a?.name === 'string' ? a.name : ''
    const nameB = typeof b?.name === 'string' ? b.name : ''
    return nameA.localeCompare(nameB, 'zh-Hans-CN')
  }
  return publishedTime(a) - publishedTime(b)
}

export function sortPatches(patches, sortBy, sortOrder) {
  const list = Array.isArray(patches) ? [...patches] : []
  const indexes = new Map(list.map((patch, index) => [patch, index]))
  const direction = sortOrder === 'asc' ? 1 : -1
  return list.sort((a, b) => {
    const result = direction * fieldCompare(a, b, sortBy)
    // 同值并列始终保持目录原顺序（stable），升/降序都不跳动
    return result !== 0 ? result : (indexes.get(a) ?? 0) - (indexes.get(b) ?? 0)
  })
}

// 下载量展示：≥1 万折叠为「x.x 万」，其余千分位
export function formatDownloadCount(count) {
  const value = downloadCount({ downloadCount: count })
  if (value >= 10000) {
    const trimmed = (value / 10000).toFixed(1).replace(/\.0$/, '')
    return `${trimmed} 万`
  }
  return value.toLocaleString('en-US')
}
