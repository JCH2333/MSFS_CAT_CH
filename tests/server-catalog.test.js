const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { buildServerUrl } = require('../electron/distribution-server')
const { CATALOG_TIMEOUT_MS, CATALOG_URL, ServerCatalog, validateCatalog
} = require('../electron/server-catalog')

function catalogWith(patch) {
  return {
    schemaVersion: 1,
    catalogVersion: '2026.09.13',
    updatedAt: '2026-09-13T00:00:00Z',
    patches: [patch]
  }
}

test('validates the server catalog manifest URL', () => {
  assert.equal(CATALOG_URL, buildServerUrl('/api/catalog/manifest.json'))
})

test('validates a published package and keeps its server download URL', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    summary: 'Test patch',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'published',
    fingerprint: [{ relativePath: 'html_ui/panel.js', sha256: 'b'.repeat(64) }],
    compatibility: ['MSFS 2024'],
    targetFolders: ['fsdreamteam-gsx-pro'],
    releaseNotes: ['全新 2.0 版本'],
    package: {
      releaseTag: 'gsx-pro-v2.0.0',
      assetName: 'gsx-pro-zh-cn.zip',
      sha256: 'a'.repeat(64),
      size: 100,
      downloadUrl: buildServerUrl('/downloads/patches/gsx-pro-v2.0.0/gsx-pro-zh-cn.zip')
    }
  }))

  assert.equal(result.patches[0].package.downloadUrl,
    buildServerUrl('/downloads/patches/gsx-pro-v2.0.0/gsx-pro-zh-cn.zip'))
  assert.equal(result.patches[0].addonVersion, '4.0.19')
  assert.deepEqual(result.patches[0].fingerprint, [{ relativePath: 'html_ui/panel.js', sha256: 'b'.repeat(64) }])
  assert.deepEqual(result.patches[0].targetFolders, ['fsdreamteam-gsx-pro'])
  assert.deepEqual(result.patches[0].releaseNotes, ['全新 2.0 版本'])
})

test('keeps the server-provided dual-sim marker for the A380 patch', () => {
  const result = validateCatalog(catalogWith({
    id: 'inia380-efb-zh-cn',
    name: 'INIA380 EFB 简体中文',
    summary: 'INI A380 EFB 界面简体中文汉化',
    version: '0.1.6',
    addonVersion: '1.0.0',
    status: 'published',
    targetKind: 'addon',
    targetFolders: ['zzz-a380-efb-zh-patch'],
    dualSim: { slots: [{ slot: 'msfs2024', communityFolder: 'Community' }] },
    fingerprint: [{ relativePath: 'zzz-a380-efb-zh-patch/layout.json', sha256: 'c'.repeat(64) }],
    package: {
      releaseTag: 'patch-inia380-efb-zh-cn-v0.1.6',
      assetName: 'msfs-cat-ch-inia380-efb-zh-cn-v0.1.6.zip',
      sha256: 'd'.repeat(64),
      size: 30917445,
      downloadUrl: buildServerUrl('/api/patches/package/7')
    }
  }))

  assert.deepEqual(result.patches[0].dualSim, { slots: [{ slot: 'msfs2024', communityFolder: 'Community' }] })
  assert.deepEqual(result.patches[0].targetFolders, ['zzz-a380-efb-zh-patch'])
  assert.equal(result.patches[0].targetKind, 'addon')
  assert.equal(result.patches[0].package.downloadUrl, buildServerUrl('/api/patches/package/7'))
})

test('normalizes dual-sim slots with casing, whitespace and duplicate entries', () => {
  const result = validateCatalog(catalogWith({
    id: 'ini350-efb-zh-cn',
    name: 'INI A350 EFB 简体中文',
    version: '0.1.1',
    status: 'published',
    dualSim: { slots: [{ slot: 'MSFS2024' }, { slot: 'msfs2020', communityFolder: ' Community ' }, { slot: 'msfs2020' }], ignored: true },
    package: {
      releaseTag: 'patch-ini350-efb-zh-cn-v0.1.1',
      assetName: 'msfs-cat-ch-ini350-efb-zh-cn-v0.1.1.zip',
      sha256: 'e'.repeat(64),
      size: 100
    }
  }))

  assert.deepEqual(result.patches[0].dualSim, { slots: [{ slot: 'msfs2024' }, { slot: 'msfs2020', communityFolder: 'Community' }] })
})

test('rejects a dual-sim slot folder with path separators', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'ini350-efb-zh-cn',
    name: 'INI A350 EFB 简体中文',
    version: '0.1.1',
    status: 'published',
    dualSim: { slots: [{ slot: 'msfs2024', communityFolder: '../escape' }] },
    package: {
      releaseTag: 'patch-ini350-efb-zh-cn-v0.1.1',
      assetName: 'msfs-cat-ch-ini350-efb-zh-cn-v0.1.1.zip',
      sha256: 'a'.repeat(64),
      size: 100
    }
  })), /communityFolder 格式无效/)
})

test('normalizes a package without an optional download URL to an empty string', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'published',
    package: {
      releaseTag: 'gsx-pro-v2.0.0',
      assetName: 'gsx-pro-zh-cn.zip',
      sha256: 'a'.repeat(64),
      size: 100
    }
  }))

  assert.equal(result.patches[0].package.downloadUrl, '')
})

test('rejects a download URL that is not https or not on the distribution server host', () => {
  const base = {
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'published',
    package: {
      releaseTag: 'gsx-pro-v2.0.0',
      assetName: 'gsx-pro-zh-cn.zip',
      sha256: 'a'.repeat(64),
      size: 100
    }
  }

  assert.throws(() => validateCatalog(catalogWith({
    ...base,
    package: { ...base.package, downloadUrl: 'http://jianchihu.online/downloads/patches/a.zip' }
  })), /downloadUrl/)
  assert.throws(() => validateCatalog(catalogWith({
    ...base,
    package: { ...base.package, downloadUrl: 'https://evil.example/downloads/patches/a.zip' }
  })), /downloadUrl/)
  assert.throws(() => validateCatalog(catalogWith({
    ...base,
    package: { ...base.package, downloadUrl: 'http://47.109.31.236.evil.example/a.zip' }
  })), /downloadUrl/)
  assert.throws(() => validateCatalog(catalogWith({
    ...base,
    package: { ...base.package, downloadUrl: 'not a url' }
  })), /downloadUrl/)
})

test('validates a GSX combined patch installation plan', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'published',
    targetKind: 'gsx-combined',
    fingerprint: [
      { target: 'primary', relativePath: 'html_ui/panel.js', sha256: 'b'.repeat(64) },
      { target: 'gsx-runtime-res', relativePath: 'btn_select.png', sha256: 'c'.repeat(64) }
    ],
    package: {
      releaseTag: 'gsx-pro-zh-cn-v2.0.0',
      assetName: 'gsx-total.zip',
      sha256: 'a'.repeat(64),
      size: 100,
      installPlan: [
        { target: 'primary', contentRoot: 'community' },
        { target: 'gsx-runtime-res', contentRoot: 'runtime-res' }
      ]
    }
  }))

  assert.deepEqual(result.patches[0].package.installPlan, [
    { target: 'primary', contentRoot: 'community' },
    { target: 'gsx-runtime-res', contentRoot: 'runtime-res' }
  ])
  assert.deepEqual(result.patches[0].fingerprint[1], {
    target: 'gsx-runtime-res',
    relativePath: 'btn_select.png',
    sha256: 'c'.repeat(64)
  })
})

test('allows planned patches without a package', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '0.0.0',
    addonVersion: '4.0.19',
    status: 'planned'
  }))
  assert.equal(result.patches[0].package, null)
})

test('keeps the GSX voice package target kind for safe audio installation', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn-voice',
    name: 'GSX 中文语音包',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'planned',
    targetKind: 'gsx-audio'
  }))
  assert.equal(result.patches[0].targetKind, 'gsx-audio')
})

test('keeps every server catalog entry — display is fully server-controlled', () => {
  const gsx = {
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'planned'
  }
  const retired = {
    id: 'fsrealistic-plus-zh-cn',
    name: 'FSRealistic+',
    version: '1.1.0',
    addonVersion: '1.1.9',
    status: 'withdrawn'
  }
  const result = validateCatalog({
    schemaVersion: 1,
    catalogVersion: '2026.09.13',
    updatedAt: '2026-09-13T00:00:00Z',
    patches: [gsx, retired]
  })
  assert.deepEqual(result.patches.map((patch) => patch.id), ['gsx-pro-zh-cn', 'fsrealistic-plus-zh-cn'])
  assert.deepEqual(result.patches.map((patch) => patch.status), ['planned', 'withdrawn'])
  assert.equal(result.patches[1].package, null)
})

test('keeps legacy cached catalogs readable when add-on version metadata is absent', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '2.0.0',
    status: 'planned'
  }))
  assert.equal(result.patches[0].addonVersion, null)
})

test('rejects published patches with an invalid checksum', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'published',
    package: {
      releaseTag: 'gsx-pro-v2.0.0',
      assetName: 'patch.zip',
      size: 100,
      sha256: 'not-a-sha'
    }
  })), /SHA-256/)
})

test('rejects published patches missing the asset name or size', () => {
  const base = {
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'published',
    package: {
      releaseTag: 'gsx-pro-v2.0.0',
      assetName: 'patch.zip',
      sha256: 'a'.repeat(64),
      size: 100
    }
  }

  assert.throws(() => validateCatalog(catalogWith({
    ...base,
    package: { ...base.package, assetName: undefined }
  })), /assetName/)
  assert.throws(() => validateCatalog(catalogWith({
    ...base,
    package: { ...base.package, size: undefined }
  })), /size/)
  assert.throws(() => validateCatalog(catalogWith({
    ...base,
    package: { ...base.package, size: 0 }
  })), /size/)
  assert.throws(() => validateCatalog(catalogWith({
    ...base,
    package: { ...base.package, sha256: undefined }
  })), /sha256/)
})

test('rejects duplicate patch ids', () => {
  const patch = { id: 'same', name: 'Same', version: '2.0.0', addonVersion: '4.0.19', status: 'planned' }
  assert.throws(() => validateCatalog({
    schemaVersion: 1,
    catalogVersion: '1',
    updatedAt: 'now',
    patches: [patch, patch]
  }), /重复/)
})

test('rejects a patch version that is not semantic versioning', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: 'latest',
    addonVersion: '4.0.19',
    status: 'planned'
  })), /语义化/)
})

test('rejects a patch add-on version that is not semantic versioning', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '2.0.0',
    addonVersion: 'current',
    status: 'planned'
  })), /addonVersion/)
})

test('rejects unsafe patch fingerprint paths', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '2.0.0',
    addonVersion: '4.0.19',
    status: 'planned',
    fingerprint: [{ relativePath: '../outside.js', sha256: 'a'.repeat(64) }]
  })), /fingerprint/)
})

test('fetches the catalog from the distribution server with a cache-busting query', async () => {
  const calls = []
  const catalog = catalogWith({ id: 'gsx-pro-zh-cn', name: 'GSX Pro', version: '2.0.0', addonVersion: '4.0.19', status: 'planned' })
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-server-'))
  const client = new ServerCatalog({
    cacheDirectory,
    fetchImpl: async (url, options) => {
      calls.push({ url, accept: options?.headers?.Accept })
      return { ok: true, json: async () => catalog }
    }
  })

  const result = await client.refresh()

  assert.equal(result.source, 'server')
  assert.equal(result.stale, false)
  assert.equal(result.error, null)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /^http:\/\/47\.109\.31\.236:20075\/api\/catalog\/manifest\.json\?t=\d+$/)
  assert.equal(calls[0].accept, 'application/json')
  assert.ok(JSON.parse(await fs.readFile(client.cachePath, 'utf8')))
  await fs.rm(cacheDirectory, { recursive: true, force: true })
})

test('falls back to the local cache when the server is unavailable', async () => {
  const catalog = catalogWith({ id: 'gsx-pro-zh-cn', name: 'GSX Pro', version: '2.0.0', addonVersion: '4.0.19', status: 'planned' })
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-cache-'))
  const client = new ServerCatalog({
    cacheDirectory,
    fetchImpl: async () => { throw new Error('server unreachable') }
  })
  await client.writeCache(validateCatalog(catalog))

  const result = await client.refresh()

  assert.equal(result.source, 'cache')
  assert.equal(result.stale, true)
  assert.match(result.error, /server unreachable/)
  assert.equal(result.catalog.patches[0].id, 'gsx-pro-zh-cn')
  await fs.rm(cacheDirectory, { recursive: true, force: true })
})

test('throws when the server fails and no cache exists', async () => {
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-nocache-'))
  const client = new ServerCatalog({
    cacheDirectory,
    fetchImpl: async () => ({ ok: false, status: 503 })
  })

  await assert.rejects(client.refresh(), /无法从云端服务器读取补丁目录.*HTTP 503/)
  await fs.rm(cacheDirectory, { recursive: true, force: true })
})

test('raises a wrapped timeout error when the server request never settles', async () => {
  const keepAlive = setInterval(() => {}, 1000)
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-timeout-'))
  const client = new ServerCatalog({
    cacheDirectory,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
    timeoutMs: 5
  })

  try {
    await assert.rejects(client.refresh(), /无法从云端服务器读取补丁目录/)
  } finally {
    clearInterval(keepAlive)
    await fs.rm(cacheDirectory, { recursive: true, force: true })
  }
})

test('uses a five-second catalog timeout', () => {
  assert.equal(CATALOG_TIMEOUT_MS, 5000)
  const client = new ServerCatalog({ cacheDirectory: path.join(os.tmpdir(), 'catalog-timeout-test') })
  assert.equal(client.timeoutMs, 5000)
})

test('accepts null or blank addonVersion for version-agnostic patches', () => {
  for (const addonVersion of [null, '', undefined]) {
    const result = validateCatalog(catalogWith({
      id: 'gsx-pro-zh-cn-voice',
      name: 'GSX 中文语音包',
      summary: 'Network voice pack',
      version: '1.0.1',
      addonVersion,
      status: 'published',
      targetKind: 'gsx-audio',
      package: {
        releaseTag: 'patch-gsx-pro-zh-cn-voice-v1.0.1',
        assetName: 'voice.zip',
        sha256: 'e'.repeat(64),
        size: 100,
        downloadUrl: buildServerUrl('/api/patches/package/8')
      }
    }))
    assert.equal(result.patches[0].addonVersion, null)
  }
})

test('normalizes downloadCount and publishedAt for sorting and display', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    summary: 'Test patch',
    version: '2.0.0',
    addonVersion: '4.0.23',
    status: 'published',
    downloadCount: 1234,
    publishedAt: ' 2026-09-18T10:00:00+08:00 ',
    package: {
      releaseTag: 'gsx-pro-v2.0.0',
      assetName: 'gsx-pro-zh-cn.zip',
      sha256: 'a'.repeat(64),
      size: 100,
      downloadUrl: buildServerUrl('/api/patches/package/6')
    }
  }))
  assert.equal(result.patches[0].downloadCount, 1234)
  assert.equal(result.patches[0].publishedAt, '2026-09-18T10:00:00+08:00')

  // 旧缓存/旧服务端缺失新字段时取安全默认值，不破坏目录加载
  const legacy = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    summary: 'Test patch',
    version: '2.0.0',
    addonVersion: '4.0.23',
    status: 'published',
    downloadCount: -5,
    package: {
      releaseTag: 'gsx-pro-v2.0.0',
      assetName: 'gsx-pro-zh-cn.zip',
      sha256: 'a'.repeat(64),
      size: 100,
      downloadUrl: buildServerUrl('/api/patches/package/6')
    }
  }))
  assert.equal(legacy.patches[0].downloadCount, 0)
  assert.equal(legacy.patches[0].publishedAt, null)
})

test('uses the plugin title as display name and validates the vendor logo object', () => {
  const result = validateCatalog(catalogWith({
    id: 'pmdg-efb-zh-cn',
    name: 'pmdg-efb-zh-cn',
    title: 'PMDG 全系 EFB 简体中文',
    summary: 'Test patch',
    version: '0.1.1',
    addonVersion: null,
    status: 'published',
    logo: {
      url: buildServerUrl('/api/catalog/logos/8?v=1789887734000'),
      position: 'bottom-right',
      lift: true
    },
    package: {
      releaseTag: 'pmdg-v0.1.1',
      assetName: 'pmdg.zip',
      sha256: 'a'.repeat(64),
      size: 100,
      downloadUrl: buildServerUrl('/api/patches/package/8')
    }
  }))
  assert.equal(result.patches[0].title, 'PMDG 全系 EFB 简体中文')
  assert.equal(result.patches[0].name, 'pmdg-efb-zh-cn')
  assert.deepEqual(result.patches[0].logo, {
    url: buildServerUrl('/api/catalog/logos/8?v=1789887734000'),
    position: 'bottom-right',
    lift: true
  })

  // 非法位置回退右下；lift 非布尔收敛为 false
  const normalized = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'gsx-pro-zh-cn',
    title: '  ',
    summary: '',
    version: '1.2.10',
    status: 'published',
    logo: { url: buildServerUrl('/api/catalog/logos/1'), position: 'center', lift: 'yes' },
    package: {
      releaseTag: 'gsx-v1.2.10',
      assetName: 'gsx.zip',
      sha256: 'b'.repeat(64),
      size: 100,
      downloadUrl: buildServerUrl('/api/patches/package/6')
    }
  }))
  assert.equal(normalized.patches[0].title, null)
  assert.equal(normalized.patches[0].logo.position, 'bottom-right')
  assert.equal(normalized.patches[0].logo.lift, false)

  // 旧缓存没有 logo 字段 → null；logo 指向外部地址 → 拒绝
  const legacy = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'gsx-pro-zh-cn',
    summary: '',
    version: '1.2.10',
    status: 'published',
    package: {
      releaseTag: 'gsx-v1.2.10',
      assetName: 'gsx.zip',
      sha256: 'b'.repeat(64),
      size: 100,
      downloadUrl: buildServerUrl('/api/patches/package/6')
    }
  }))
  assert.equal(legacy.patches[0].logo, null)
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'gsx-pro-zh-cn',
    summary: '',
    version: '1.2.10',
    status: 'published',
    logo: { url: 'https://cdn.example.com/logo.png', position: 'bottom-right' },
    package: {
      releaseTag: 'gsx-v1.2.10',
      assetName: 'gsx.zip',
      sha256: 'b'.repeat(64),
      size: 100,
      downloadUrl: buildServerUrl('/api/patches/package/6')
    }
  })), /必须指向分发服务器/)
})
