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
    targetKind: 'addon',
    fingerprint: [{ relativePath: 'html_ui/panel.js', sha256: 'a'.repeat(64) }]
  }])
  assert.deepEqual(structuredClone(descriptors), descriptors)
})

test('creates a cloneable installation request from a reactive-like catalog object', async () => {
  const { createInstallationRequest } = await import('../src/lib/patch-recognition.mjs')
  const patch = new Proxy({
    id: 'fsrealistic-plus-zh-cn',
    name: 'FSRealistic+ 简体中文',
    version: '1.0.0',
    status: 'published',
    fingerprint: [new Proxy({ relativePath: 'html_ui/panel.js', sha256: 'b'.repeat(64) }, {})],
    package: new Proxy({
      downloadUrl: 'https://github.com/JCH2333/MSFS_CAT_CH_PATCHES/releases/download/fsr/fsr.zip',
      githubDownloadUrl: 'https://github.com/JCH2333/MSFS_CAT_CH_PATCHES/releases/download/fsr/fsr.zip',
      sha256: 'c'.repeat(64),
      contentRoot: 'payload',
      giteeParts: [{
        assetName: 'fsr.zip.001',
        downloadUrl: 'https://gitee.com/example/fsr.zip.001',
        sha256: 'd'.repeat(64),
        size: 100
      }]
    }, {})
  }, {})

  const request = createInstallationRequest(patch)

  assert.deepEqual(structuredClone(request), request)
  assert.equal(request.package.downloadUrl, 'https://github.com/JCH2333/MSFS_CAT_CH_PATCHES/releases/download/fsr/fsr.zip')
  assert.equal(request.package.githubDownloadUrl, request.package.downloadUrl)
  assert.deepEqual(request.package.giteeParts, [{
    assetName: 'fsr.zip.001',
    downloadUrl: 'https://gitee.com/example/fsr.zip.001',
    sha256: 'd'.repeat(64),
    size: 100
  }])
  assert.equal(request.fingerprint[0].relativePath, 'html_ui/panel.js')
})
