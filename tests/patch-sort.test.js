const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PATCH_SORT_FIELDS,
  formatDownloadCount,
  normalizePatchSort,
  sortPatches
} = require('../src/lib/patch-sort.mjs')

function patch(overrides = {}) {
  return {
    id: 'patch',
    name: '补丁',
    downloadCount: 0,
    publishedAt: null,
    ...overrides
  }
}

test('normalizePatchSort falls back to 更新时间降序 for invalid or missing state', () => {
  assert.deepEqual(normalizePatchSort(null), { sortBy: 'updated', sortOrder: 'desc' })
  assert.deepEqual(normalizePatchSort({}), { sortBy: 'updated', sortOrder: 'desc' })
  assert.deepEqual(normalizePatchSort({ sortBy: 'downloads' }), { sortBy: 'downloads', sortOrder: 'desc' })
  assert.deepEqual(normalizePatchSort({ sortBy: 'name', sortOrder: 'asc' }), { sortBy: 'name', sortOrder: 'asc' })
  assert.deepEqual(normalizePatchSort({ sortBy: 'hacker', sortOrder: 'sideways' }), { sortBy: 'updated', sortOrder: 'desc' })
})

test('sorts by downloads in both directions', () => {
  const patches = [
    patch({ id: 'a', downloadCount: 120 }),
    patch({ id: 'b', downloadCount: 0 }),
    patch({ id: 'c', downloadCount: 45 }),
    patch({ id: 'd', downloadCount: undefined })
  ]
  assert.deepEqual(sortPatches(patches, 'downloads', 'desc').map((p) => p.id), ['a', 'c', 'b', 'd'])
  assert.deepEqual(sortPatches(patches, 'downloads', 'asc').map((p) => p.id), ['b', 'd', 'c', 'a'])
})

test('sorts by publish time, missing dates last in desc order', () => {
  const patches = [
    patch({ id: 'old', publishedAt: '2026-09-01T00:00:00Z' }),
    patch({ id: 'none' }),
    patch({ id: 'new', publishedAt: '2026-09-19T00:00:00Z' })
  ]
  assert.deepEqual(sortPatches(patches, 'updated', 'desc').map((p) => p.id), ['new', 'old', 'none'])
  assert.deepEqual(sortPatches(patches, 'updated', 'asc').map((p) => p.id), ['none', 'old', 'new'])
})

test('sorts by Chinese name using pinyin collation', () => {
  // ICU zh-Hans-CN 排序：中文按拼音（阿 a < 微 w），拉丁字母名称排在其后
  const patches = [
    patch({ id: 'y', name: '微软飞行模拟' }),
    patch({ id: 'g', name: 'GSX Pro 简体中文' }),
    patch({ id: 'a', name: '阿卡姆' })
  ]
  assert.deepEqual(sortPatches(patches, 'name', 'asc').map((p) => p.id), ['a', 'y', 'g'])
  assert.deepEqual(sortPatches(patches, 'name', 'desc').map((p) => p.id), ['g', 'y', 'a'])
})

test('keeps catalog order for ties instead of jumping', () => {
  const patches = [
    patch({ id: 'first', downloadCount: 5 }),
    patch({ id: 'second', downloadCount: 5 }),
    patch({ id: 'third', downloadCount: 5 })
  ]
  assert.deepEqual(sortPatches(patches, 'downloads', 'desc').map((p) => p.id), ['first', 'second', 'third'])
  assert.deepEqual(sortPatches([...patches].reverse(), 'downloads', 'asc').map((p) => p.id), ['third', 'second', 'first'])
})

test('formatDownloadCount uses 万 folding and thousands separators', () => {
  assert.equal(formatDownloadCount(0), '0')
  assert.equal(formatDownloadCount(999), '999')
  assert.equal(formatDownloadCount(9999), '9,999')
  assert.equal(formatDownloadCount(12345), '1.2 万')
  assert.equal(formatDownloadCount(42000), '4.2 万')
  assert.equal(formatDownloadCount(10000), '1 万')
  assert.equal(formatDownloadCount(undefined), '0')
})

test('sort field ids stay wired to the UI labels', () => {
  assert.deepEqual(PATCH_SORT_FIELDS.map((field) => field.id), ['downloads', 'updated', 'name'])
})
