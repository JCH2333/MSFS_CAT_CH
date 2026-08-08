const test = require('node:test')
const assert = require('node:assert/strict')

test('creates cloneable patch recognition descriptors from reactive-like catalog objects', async () => {
  const { createRecognitionDescriptors } = await import('../src/lib/patch-recognition.mjs')
  const patch = new Proxy({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '1.0.0',
    fingerprint: [new Proxy({ relativePath: 'html_ui/panel.js', sha256: 'a'.repeat(64) }, {})],
    package: { downloadUrl: 'https://github.com/example/test.zip' }
  }, {})

  const descriptors = createRecognitionDescriptors([patch])

  assert.deepEqual(descriptors, [{
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '1.0.0',
    fingerprint: [{ relativePath: 'html_ui/panel.js', sha256: 'a'.repeat(64) }]
  }])
  assert.deepEqual(structuredClone(descriptors), descriptors)
})
