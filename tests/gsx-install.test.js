const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  DEPLOY_TEMP_SUFFIX,
  DISK_SPACE_MARGIN_BYTES,
  createGsxInstall,
  productPrefixOf,
  validateInstallManifest
} = require('../electron/gsx-install')

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

// 假下载器：把「服务器内容」写到目标位置（模拟 downloadToFile 的原子替换语义）
function downloadStub(content) {
  const calls = []
  return {
    calls,
    impl: async (url, destination, onProgress) => {
      calls.push({ url, destination })
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, content)
      onProgress?.({ received: content.length, total: content.length })
      return destination
    }
  }
}

const BOOTSTRAP_CONTENT = 'universal-installer-payload'
const PRO_CONTENT = 'gsx-pro-v4.0.10-payload'
const WOJ_CONTENT = 'gsx-world-of-jetways-v4.0.10-payload'

function manifestFixture({ overwrites = {} } = {}) {
  return {
    schemaVersion: 1,
    updatedAt: '2026-09-21T00:00:00+08:00',
    bootstrap: {
      assetName: 'FSDT_Universal_Installer.exe',
      version: '2.5.0.3',
      size: Buffer.byteLength(BOOTSTRAP_CONTENT),
      sha256: sha256Hex(BOOTSTRAP_CONTENT),
      downloadUrl: 'http://47.109.31.236:20075/downloads/gsx/FSDT_Universal_Installer.exe',
      ...overwrites.bootstrap
    },
    packages: [
      {
        role: 'product',
        cacheName: 'fsdreamteam-gsx-pro-v4.0.10.zip',
        version: '4.0.10',
        size: Buffer.byteLength(PRO_CONTENT),
        sha256: sha256Hex(PRO_CONTENT),
        downloadUrl: 'http://47.109.31.236:20075/downloads/gsx/fsdreamteam-gsx-pro-v4.0.10.zip',
        ...overwrites.product
      },
      {
        role: 'extra',
        cacheName: 'fsdreamteam-gsx-world-of-jetways-v4.0.10.zip',
        version: '4.0.10',
        size: Buffer.byteLength(WOJ_CONTENT),
        sha256: sha256Hex(WOJ_CONTENT),
        downloadUrl: 'http://47.109.31.236:20075/downloads/gsx/fsdreamteam-gsx-world-of-jetways-v4.0.10.zip',
        ...overwrites.extra
      }
    ],
    ...overwrites.manifest
  }
}

function responseStub(body) {
  return { ok: true, json: async () => body }
}

function createClient({ manifest, cacheDirectory, packagesCacheDirectory, download, statFs }) {
  return createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => responseStub(manifest),
    download: download?.impl,
    statFs: statFs || (async () => ({ bsize: 4096, bavail: 10 * 1024 * 1024 })),
    opener: async () => null
  })
}

test('productPrefixOf extracts the official product prefix', () => {
  assert.equal(productPrefixOf('fsdreamteam-gsx-pro-v4.0.10.zip'), 'fsdreamteam-gsx-pro')
  assert.equal(productPrefixOf('fsdreamteam-gsx-world-of-jetways-2020-v4.0.10.zip'), 'fsdreamteam-gsx-world-of-jetways-2020')
  assert.equal(productPrefixOf('unrelated.zip'), null)
})

test('validateInstallManifest rejects untrusted inputs and normalizes hashes', () => {
  const valid = validateInstallManifest(manifestFixture())
  assert.equal(valid.bootstrap.sha256, sha256Hex(BOOTSTRAP_CONTENT))
  assert.equal(valid.packages.length, 2)

  assert.throws(() => validateInstallManifest(manifestFixture({ overwrites: { manifest: { schemaVersion: 2 } } })), /版本不受支持/)
  assert.throws(() => validateInstallManifest(manifestFixture({ overwrites: { bootstrap: { downloadUrl: 'https://evil.example.com/x.exe' } } })), /不受信任/)
  assert.throws(() => validateInstallManifest(manifestFixture({ overwrites: { product: { sha256: 'nothex' } } })), /SHA-256 无效/)
  assert.throws(() => validateInstallManifest(manifestFixture({ overwrites: { product: { version: '4.0.11' } } })), /版本与缓存名不一致/)
  assert.throws(() => validateInstallManifest(manifestFixture({ overwrites: { product: { cacheName: '..\\escape-v4.0.10.zip' } } })), /缓存名无效/)
})

test('ensureBootstrap downloads once, verifies sha256 and skips when already valid', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-install-boot-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-install-pc-')
  const manifest = manifestFixture()
  const download = downloadStub(BOOTSTRAP_CONTENT)
  const client = createClient({ manifest, cacheDirectory, packagesCacheDirectory, download })

  const first = await client.ensureBootstrap()
  assert.equal(first.downloaded, true)
  assert.equal(path.basename(first.filePath), 'FSDT_Universal_Installer.exe')
  assert.equal(download.calls.length, 1)

  const second = await client.ensureBootstrap()
  assert.equal(second.downloaded, false)
  assert.equal(download.calls.length, 1)

  // 内容被篡改 → 重新下载覆盖
  await fs.writeFile(first.filePath, 'tampered-payload!!!!!!!')
  const third = await client.ensureBootstrap()
  assert.equal(third.downloaded, true)
  assert.equal(download.calls.length, 2)
})

test('ensureBootstrap deletes the file and throws on checksum mismatch', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-install-badcrc-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-install-badcrc-pc-')
  const manifest = manifestFixture()
  const download = downloadStub('corrupted-content')
  const client = createClient({ manifest, cacheDirectory, packagesCacheDirectory, download })

  await assert.rejects(client.ensureBootstrap(), /校验失败/)
  const entries = await fs.readdir(cacheDirectory)
  assert.deepEqual(entries, [])
})

test('presetPackages downloads only pending packages and emits install progress', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-install-preset-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-install-preset-pc-')
  const manifest = manifestFixture()
  const contents = {
    'fsdreamteam-gsx-pro-v4.0.10.zip': PRO_CONTENT,
    'fsdreamteam-gsx-world-of-jetways-v4.0.10.zip': WOJ_CONTENT
  }
  const dynamic = {
    calls: [],
    impl: async (url, destination, onProgress) => {
      dynamic.calls.push(url)
      const name = path.basename(destination)
      await fs.writeFile(destination, contents[name])
      onProgress?.({ received: contents[name].length, total: contents[name].length })
      return destination
    }
  }

  const progressEvents = []
  const client = createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => responseStub(manifest),
    download: dynamic.impl,
    statFs: async () => ({ bsize: 4096, bavail: 1024 * 1024 }),
    onProgress: (payload) => progressEvents.push(payload)
  })

  const result = await client.presetPackages()
  assert.deepEqual(result.downloaded.sort(), [
    'fsdreamteam-gsx-pro-v4.0.10.zip',
    'fsdreamteam-gsx-world-of-jetways-v4.0.10.zip'
  ])
  assert.deepEqual(result.skipped, [])
  const stored = await fs.readdir(packagesCacheDirectory)
  assert.deepEqual(stored.sort(), [
    'fsdreamteam-gsx-pro-v4.0.10.zip',
    'fsdreamteam-gsx-world-of-jetways-v4.0.10.zip'
  ])
  assert.ok(progressEvents.some((event) => event.kind === 'install' && event.phase === 'package-download'))

  // 第二次执行：全部命中缓存，零下载
  const again = await client.presetPackages()
  assert.deepEqual(again.downloaded, [])
  assert.equal(again.skipped.length, 2)
  assert.equal(dynamic.calls.length, 2)
})

test('presetPackages never downgrades a newer official package already in cache', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-install-newer-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-install-newer-pc-')
  const manifest = manifestFixture()
  // 官方已经装了 4.0.23 的完整包：清单还停在 4.0.10 时不得覆盖
  await fs.writeFile(path.join(packagesCacheDirectory, 'fsdreamteam-gsx-pro-v4.0.23.zip'), 'official-newer')
  const dynamic = {
    calls: [],
    impl: async (url, destination) => {
      dynamic.calls.push(destination)
      const content = path.basename(destination) === 'fsdreamteam-gsx-world-of-jetways-v4.0.10.zip'
        ? WOJ_CONTENT
        : 'should-not-write'
      await fs.writeFile(destination, content)
      return destination
    }
  }
  const client = createClient({ manifest, cacheDirectory, packagesCacheDirectory, download: dynamic })

  const result = await client.presetPackages()
  assert.deepEqual(result.downloaded, ['fsdreamteam-gsx-world-of-jetways-v4.0.10.zip'])
  assert.deepEqual(result.skipped, ['fsdreamteam-gsx-pro-v4.0.10.zip'])
  const kept = await fs.readFile(path.join(packagesCacheDirectory, 'fsdreamteam-gsx-pro-v4.0.23.zip'), 'utf8')
  assert.equal(kept, 'official-newer')
})

test('presetPackages refuses to run when disk space is insufficient', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-install-disk-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-install-disk-pc-')
  const manifest = manifestFixture()
  const neededBytes = Buffer.byteLength(PRO_CONTENT) + Buffer.byteLength(WOJ_CONTENT)
  const client = createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => responseStub(manifest),
    download: downloadStub('x').impl,
    // 可用空间 = 需求 - 1 字节（低于余量要求）
    statFs: async () => ({ bsize: 1, bavail: neededBytes + DISK_SPACE_MARGIN_BYTES - 1 })
  })
  await assert.rejects(client.presetPackages(), /磁盘空间不足/)
})

test('loadManifest falls back to the last good copy when the server fails', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-install-fallback-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-install-fallback-pc-')
  const manifest = manifestFixture()
  let healthy = true
  const client = createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => {
      if (healthy) return responseStub(manifest)
      throw new Error('server down')
    },
    download: downloadStub(BOOTSTRAP_CONTENT).impl
  })

  const first = await client.loadManifest()
  assert.equal(first.source, 'server')

  healthy = false
  const second = await client.loadManifest({ force: true })
  assert.equal(second.source, 'memory')
  assert.equal(second.stale, true)
  assert.equal(second.manifest.bootstrap.assetName, 'FSDT_Universal_Installer.exe')
})

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)
// 用 PowerShell Compress-Archive 构造真实 zip（含子目录），供部署测试消费
async function createTestZip(zipPath, files) {
  const stage = await temporaryDirectory('gsx-zip-stage-')
  for (const file of files) {
    const target = path.join(stage, ...file.name.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.content)
  }
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`
  ])
}

async function fileSha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}


// 部署清单：单个 GSX Pro 完整包（zip 由测试现场构建，大小/校验和随之回填）
async function buildDeployFixture({ packagesCacheDirectory, withProTarget }) {
  const cacheName = 'fsdreamteam-gsx-pro-v4.0.10.zip'
  const zipPath = path.join(packagesCacheDirectory, cacheName)
  await createTestZip(zipPath, [
    { name: 'manifest.json', content: JSON.stringify({ package_version: '4.0.10' }) },
    { name: 'html_ui/panel/test-file.txt', content: 'deploy-payload' }
  ])
  const manifest = manifestFixture({
    overwrites: {
      product: {
        size: (await fs.stat(zipPath)).size,
        sha256: await fileSha256(zipPath)
      },
      // 部署场景只关注产品包：移除 extra 包避免噪音
      extra: { role: '__absent__' }
    }
  })
  // manifestFixture 不支持剔除条目——手工重建 packages
  manifest.packages = manifest.packages.filter((pkg) => pkg.role !== '__absent__')
  return { manifest, cacheName }
}

test('deployPackages extracts packages into the addon root and creates community junctions', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-deploy-cache-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-deploy-pc-')
  const addonRoot = await temporaryDirectory('gsx-deploy-addon-')
  const communityDirectory = path.join(addonRoot, 'community2024')
  await fs.mkdir(communityDirectory, { recursive: true })
  const { manifest } = await buildDeployFixture({ packagesCacheDirectory })
  const client = createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => responseStub(manifest),
    statFs: async () => ({ bsize: 4096, bavail: 64 * 1024 * 1024 }),
    opener: async () => null
  })

  const result = await client.deployPackages({
    addonRoot,
    communityTargets: [{ directory: communityDirectory, slot: 'msfs2024' }]
  })

  const target = path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-pro')
  assert.equal(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'), JSON.stringify({ package_version: '4.0.10' }))
  assert.equal(await fs.readFile(path.join(target, 'html_ui', 'panel', 'test-file.txt'), 'utf8'), 'deploy-payload')
  assert.deepEqual(result.deployed, ['fsdreamteam-gsx-pro'])
  assert.deepEqual(result.skipped, [])
  const linkStats = await fs.lstat(path.join(communityDirectory, 'fsdreamteam-gsx-pro'))
  assert.equal(linkStats.isSymbolicLink(), true, '社区目录应创建 junction 链接')
  // 链接可直接读通目标内容
  assert.equal(await fs.readFile(path.join(communityDirectory, 'fsdreamteam-gsx-pro', 'manifest.json'), 'utf8'), JSON.stringify({ package_version: '4.0.10' }))
  // 临时部署目录不残留
  const leftovers = (await fs.readdir(path.join(addonRoot, 'MSFS'))).filter((name) => name.endsWith(DEPLOY_TEMP_SUFFIX))
  assert.deepEqual(leftovers, [])
})

test('deployPackages skips products that are already deployed', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-deploy-skip-cache-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-deploy-skip-pc-')
  const addonRoot = await temporaryDirectory('gsx-deploy-skip-addon-')
  const communityDirectory = path.join(addonRoot, 'community2024')
  await fs.mkdir(communityDirectory, { recursive: true })
  const { manifest } = await buildDeployFixture({ packagesCacheDirectory })
  const existing = path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-pro')
  await fs.mkdir(existing, { recursive: true })
  await fs.writeFile(path.join(existing, 'manifest.json'), JSON.stringify({ package_version: '4.0.10' }))

  const client = createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => responseStub(manifest),
    statFs: async () => ({ bsize: 4096, bavail: 64 * 1024 * 1024 })
  })
  const result = await client.deployPackages({
    addonRoot,
    communityTargets: [{ directory: communityDirectory, slot: 'msfs2024' }]
  })
  assert.deepEqual(result.skipped, ['fsdreamteam-gsx-pro'])
  assert.deepEqual(result.deployed, [])
  assert.equal(result.linked.length, 1, '已部署产品仍需补齐社区链接')
})

test('deployPackages cleans an empty leftover target directory and deploys normally', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-deploy-empty-cache-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-deploy-empty-pc-')
  const addonRoot = await temporaryDirectory('gsx-deploy-empty-addon-')
  const communityDirectory = path.join(addonRoot, 'community2024')
  await fs.mkdir(communityDirectory, { recursive: true })
  // 旧版本残留：目录存在但为空（用户报障场景）
  const leftover = path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-pro')
  await fs.mkdir(leftover, { recursive: true })
  const { manifest } = await buildDeployFixture({ packagesCacheDirectory })
  const client = createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => responseStub(manifest),
    statFs: async () => ({ bsize: 4096, bavail: 64 * 1024 * 1024 })
  })
  const result = await client.deployPackages({
    addonRoot,
    communityTargets: [{ directory: communityDirectory, slot: 'msfs2024' }]
  })
  assert.deepEqual(result.deployed, ['fsdreamteam-gsx-pro'])
  assert.equal(await fs.readFile(path.join(leftover, 'manifest.json'), 'utf8'), JSON.stringify({ package_version: '4.0.10' }))
})

test('deployPackages refuses a partial deployment target instead of overwriting', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-deploy-part-cache-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-deploy-part-pc-')
  const addonRoot = await temporaryDirectory('gsx-deploy-part-addon-')
  const partial = path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-pro')
  await fs.mkdir(partial, { recursive: true })
  await fs.writeFile(path.join(partial, 'broken.tmp'), 'x')
  const { manifest } = await buildDeployFixture({ packagesCacheDirectory })
  const client = createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => responseStub(manifest),
    statFs: async () => ({ bsize: 4096, bavail: 64 * 1024 * 1024 })
  })
  await assert.rejects(
    () => client.deployPackages({ addonRoot, communityTargets: [] }),
    /部署目标已存在但不完整/
  )
})

test('deployPackages links the 2020-only package into 2020 community slots', async () => {
  const cacheDirectory = await temporaryDirectory('gsx-deploy-2020-cache-')
  const packagesCacheDirectory = await temporaryDirectory('gsx-deploy-2020-pc-')
  const addonRoot = await temporaryDirectory('gsx-deploy-2020-addon-')
  const community2024 = path.join(addonRoot, 'community2024')
  const community2020 = path.join(addonRoot, 'community2020')
  await fs.mkdir(community2024, { recursive: true })
  await fs.mkdir(community2020, { recursive: true })
  const cacheName = 'fsdreamteam-gsx-world-of-jetways-2020-v4.0.10.zip'
  const zipPath = path.join(packagesCacheDirectory, cacheName)
  await createTestZip(zipPath, [
    { name: 'manifest.json', content: JSON.stringify({ package_version: '4.0.10' }) }
  ])
  const manifest = manifestFixture()
  manifest.packages = [{
    role: 'extra',
    cacheName,
    version: '4.0.10',
    size: (await fs.stat(zipPath)).size,
    sha256: await fileSha256(zipPath),
    downloadUrl: 'http://47.109.31.236:20075/downloads/gsx/' + cacheName
  }]
  const client = createGsxInstall({
    cacheDirectory,
    packagesCacheDirectory,
    fetchImpl: async () => responseStub(manifest),
    statFs: async () => ({ bsize: 4096, bavail: 64 * 1024 * 1024 })
  })
  const result = await client.deployPackages({
    addonRoot,
    communityTargets: [
      { directory: community2024, slot: 'msfs2024' },
      { directory: community2020, slot: 'msfs2020' }
    ]
  })
  assert.deepEqual(result.deployed, ['fsdreamteam-gsx-world-of-jetways-2020'])
  assert.equal((await fs.readdir(community2024)).length, 0, '2020 专属产品不得链接进 2024 槽位')
  const linkStats = await fs.lstat(path.join(community2020, cacheName.replace(/-v4\.0\.10\.zip$/, '')))
  assert.equal(linkStats.isSymbolicLink(), true)
})

test('detectPatchTargets auto-resolves gsx-combined patches to the community package folder', async () => {
  const { detectPatchTargets } = require('../electron/installation-targets')
  const root = await temporaryDirectory('gsx-combined-root-')
  const community2024 = path.join(root, 'Community2024')
  await fs.mkdir(path.join(community2024, 'fsdreamteam-gsx-pro'), { recursive: true })
  await fs.writeFile(path.join(community2024, 'fsdreamteam-gsx-pro', 'manifest.json'), '{}')

  const targets = await detectPatchTargets(
    [{ id: 'gsx-pro-zh-cn', targetKind: 'gsx-combined', targetFolders: [] }],
    { packageRoots: [{ packageRoot: root, source: 'Steam / MSFS 2024' }] }
  )
  assert.equal(targets['gsx-pro-zh-cn']?.targetPath, path.join(community2024, 'fsdreamteam-gsx-pro'))

  // 2020 槽位的 Community 目录同样可作为回退目标
  const root2020 = await temporaryDirectory('gsx-combined-root2020-')
  const community2020 = path.join(root2020, 'Community')
  await fs.mkdir(path.join(community2020, 'fsdreamteam-gsx-pro'), { recursive: true })
  const targets2020 = await detectPatchTargets(
    [{ id: 'gsx-pro-zh-cn', targetKind: 'gsx-combined', targetFolders: [] }],
    { packageRoots: [{ packageRoot: root2020, source: 'Steam / MSFS 2020' }] }
  )
  assert.equal(targets2020['gsx-pro-zh-cn']?.targetPath, path.join(community2020, 'fsdreamteam-gsx-pro'))

  // 完全没有 GSX 包时不产出目标（保持「请先选择目录」引导）
  const emptyRoot = await temporaryDirectory('gsx-combined-empty-')
  const targetsEmpty = await detectPatchTargets(
    [{ id: 'gsx-pro-zh-cn', targetKind: 'gsx-combined', targetFolders: [] }],
    { packageRoots: [{ packageRoot: emptyRoot, source: 'Steam / MSFS 2024' }] }
  )
  assert.equal(targetsEmpty['gsx-pro-zh-cn'], undefined)
})
