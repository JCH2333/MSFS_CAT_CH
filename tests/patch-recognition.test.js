const { buildServerUrl } = require('../electron/distribution-server')
const test = require('node:test')
const assert = require('node:assert/strict')

test('creates cloneable patch recognition descriptors from reactive-like catalog objects', async () => {
  const { createRecognitionDescriptors } = await import('../src/lib/patch-recognition.mjs')
  const patch = new Proxy({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '2.0.0',
    fingerprint: [new Proxy({ relativePath: 'html_ui/panel.js', sha256: 'a'.repeat(64) }, {})],
    package: { downloadUrl: buildServerUrl('/downloads/patches/test/test.zip') }
  }, {})

  const descriptors = createRecognitionDescriptors([patch])

  assert.deepEqual(descriptors, [{
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '2.0.0',
    targetKind: 'addon',
    dualSim: null,
    fingerprint: [{ target: 'primary', relativePath: 'html_ui/panel.js', sha256: 'a'.repeat(64) }]
  }])
  assert.deepEqual(structuredClone(descriptors), descriptors)
})

test('carries the dual-sim marker for the A350 patch into recognition descriptors', async () => {
  const { createRecognitionDescriptors, createInstallationRequest } = await import('../src/lib/patch-recognition.mjs')
  const patch = {
    id: 'ini350-efb-zh-cn',
    name: 'INI A350 EFB 简体中文',
    version: '0.1.1',
    targetKind: 'addon',
    dualSim: { markerFolder: 'inibuilds-aircraft-a350' },
    fingerprint: [{ relativePath: 'zzz-a350-efb-zh-patch/manifest.json', sha256: 'c'.repeat(64) }],
    package: { downloadUrl: 'https://example.test/a.zip', sha256: 'd'.repeat(64), contentRoot: '' }
  }

  const [descriptor] = createRecognitionDescriptors([patch])
  assert.deepEqual(descriptor.dualSim, { markerFolder: 'inibuilds-aircraft-a350' })
  assert.deepEqual(createInstallationRequest(patch).dualSim, { markerFolder: 'inibuilds-aircraft-a350' })
})

test('creates a cloneable installation request from a reactive-like catalog object', async () => {
  const { createInstallationRequest } = await import('../src/lib/patch-recognition.mjs')
  const serverUrl = buildServerUrl('/downloads/patches/fsr/fsr.zip')
  const patch = new Proxy({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '2.0.0',
    status: 'published',
    fingerprint: [new Proxy({ relativePath: 'html_ui/panel.js', sha256: 'b'.repeat(64) }, {})],
    package: new Proxy({
      downloadUrl: serverUrl,
      sha256: 'c'.repeat(64),
      contentRoot: 'payload',
      installPlan: [{
        target: 'primary',
        contentRoot: 'community'
      }, {
        target: 'gsx-runtime-res',
        contentRoot: 'runtime-res'
      }]
    }, {})
  }, {})

  const request = createInstallationRequest(patch)

  assert.deepEqual(structuredClone(request), request)
  assert.equal(request.package.downloadUrl, serverUrl)
  assert.equal(request.package.sha256, 'c'.repeat(64))
  assert.equal(request.package.contentRoot, 'payload')
  assert.deepEqual(request.package.installPlan, [{
    target: 'primary',
    contentRoot: 'community'
  }, {
    target: 'gsx-runtime-res',
    contentRoot: 'runtime-res'
  }])
  assert.equal(request.fingerprint[0].target, 'primary')
  assert.equal(request.fingerprint[0].relativePath, 'html_ui/panel.js')
})
