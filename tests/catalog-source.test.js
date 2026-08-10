const test = require('node:test')
const assert = require('node:assert/strict')

test('shows a healthy Gitee catalog as synchronized', async () => {
  const { catalogSourcePresentation } = await import('../src/lib/catalog-source.mjs')

  assert.deepEqual(catalogSourcePresentation('gitee'), {
    label: 'Gitee 已同步',
    online: true
  })
})
