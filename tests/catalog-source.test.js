const test = require('node:test')
const assert = require('node:assert/strict')

test('shows a healthy server catalog as synchronized', async () => {
  const { catalogSourcePresentation } = await import('../src/lib/catalog-source.mjs')

  assert.deepEqual(catalogSourcePresentation('server'), {
    label: '云端已同步',
    online: true
  })
})

test('shows a cached catalog as a local offline fallback', async () => {
  const { catalogSourcePresentation } = await import('../src/lib/catalog-source.mjs')

  assert.deepEqual(catalogSourcePresentation('cache'), {
    label: '使用本地缓存',
    online: false
  })
})

test('treats unknown sources as waiting for sync', async () => {
  const { catalogSourcePresentation } = await import('../src/lib/catalog-source.mjs')

  assert.deepEqual(catalogSourcePresentation('idle'), {
    label: '等待同步',
    online: false
  })
})
