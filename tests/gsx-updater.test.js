const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { buildServerUrl } = require('../electron/distribution-server')
const {
  GSX_MANIFEST_URL,
  GsxUpdater,
  fetchGsxManifest,
  normalizeEtag,
  validateGsxManifest
} = require('../electron/gsx-updater')
const { sha256 } = require('../electron/patch-installer')

const execFileAsync = promisify(execFile)

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function createZip(sourceDirectory, archivePath) {
  if (process.platform !== 'win32') throw new Error('This integration helper requires Windows PowerShell')
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${sourceDirectory}\\*' -DestinationPath '${archivePath}' -CompressionLevel Optimal`
  ])
}

const TRUSTED_URL = buildServerUrl('/api/gsx/package/1')

function manifestPackage(overrides = {}) {
  return {
    component: 'GSX',
    version: '4.0.23',
    etag: '0x8DF112D9F24F2B6',
    sha256: 'a'.repeat(64),
    size: 1024,
    deployTarget: 'couatl/GSX',
    assetName: 'GSX.zip',
    downloadUrl: TRUSTED_URL,
    ...overrides
  }
}

test('normalizeEtag strips surrounding quotes', () => {
  assert.equal(normalizeEtag('"0x8DF1"'), '0x8DF1')
  assert.equal(normalizeEtag('  0x8DF1  '), '0x8DF1')
  assert.equal(normalizeEtag(null), '')
})

test('validateGsxManifest accepts a valid manifest and normalizes fields', () => {
  const manifest = validateGsxManifest({
    schemaVersion: 1,
    latestVersion: '4.0.23',
    packages: [manifestPackage({ sha256: 'A'.repeat(64), etag: '"0xABC"' })]
  })
  assert.equal(manifest.packages.length, 1)
  assert.equal(manifest.packages[0].sha256, 'a'.repeat(64))
  assert.equal(manifest.packages[0].etag, '0xABC')
})

test('validateGsxManifest rejects untrusted download URLs', () => {
  assert.throws(() => validateGsxManifest({
    schemaVersion: 1,
    packages: [manifestPackage({ downloadUrl: 'https://evil.example.com/GSX.zip' })]
  }), /不受信任/)
})

test('validateGsxManifest rejects path traversal in deployTarget', () => {
  assert.throws(() => validateGsxManifest({
    schemaVersion: 1,
    packages: [manifestPackage({ deployTarget: 'couatl/../..' })]
  }), /部署目标无效/)
})

test('validateGsxManifest rejects malformed SHA-256 and duplicate components', () => {
  assert.throws(() => validateGsxManifest({
    schemaVersion: 1,
    packages: [manifestPackage({ sha256: 'zz'.repeat(32) })]
  }), /SHA-256 无效/)
  assert.throws(() => validateGsxManifest({
    schemaVersion: 1,
    packages: [manifestPackage(), manifestPackage({ etag: '0xOTHER' })]
  }), /重复/)
})

test('fetchGsxManifest rejects server error responses', async () => {
  await assert.rejects(() => fetchGsxManifest({
    fetchImpl: async () => ({ ok: false, status: 503 }),
    timeoutMs: 1000
  }), /HTTP 503/)
})

test('GsxUpdater.getStatus marks pending components by official sidecar etag', async () => {
  const userData = await temporaryDirectory('gsx-updater-status-')
  const etagDir = await temporaryDirectory('gsx-updater-etags-')
  const addonRoot = await temporaryDirectory('gsx-addon-root-')
  await fs.mkdir(path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-pro'), { recursive: true })
  await fs.writeFile(
    path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-pro', 'manifest.json'),
    JSON.stringify({ package_version: '4.0.21' })
  )
  // 官方 sidecar 与镜像清单不一致 → GSX 待更新；couatl64 一致 → 跳过
  await fs.writeFile(path.join(etagDir, 'GSX.zip.etag'), '0xOLD')
  await fs.writeFile(path.join(etagDir, 'couatl64.zip.etag'), '"0x8DF103EE75B95D4"')

  const updater = new GsxUpdater({
    userDataDirectory: userData,
    officialEtagDirectory: etagDir,
    processLister: async () => '',
    detectInstall: async () => ({
      installed: true,
      addonRoot,
      packagePath: path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-pro'),
      version: '4.0.21',
      source: 'test'
    }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        latestVersion: '4.0.23',
        packages: [
          manifestPackage(),
          manifestPackage({ component: 'couatl64', etag: '0x8DF103EE75B95D4', deployTarget: 'couatl64' })
        ]
      })
    })
  })

  const status = await updater.getStatus()
  assert.equal(status.installed, true)
  assert.equal(status.localVersion, '4.0.21')
  assert.equal(status.versionState, 'older')
  assert.equal(status.pending.length, 1)
  assert.equal(status.pending[0].component, 'GSX')
  assert.equal(status.updateAvailable, true)
})

test('GsxUpdater.applyUpdate downloads, verifies, backs up and records state', async () => {
  const userData = await temporaryDirectory('gsx-updater-apply-')
  const etagDir = await temporaryDirectory('gsx-updater-etags-')
  const addonRoot = await temporaryDirectory('gsx-addon-apply-')
  const targetDir = path.join(addonRoot, 'couatl', 'GSX')
  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(path.join(targetDir, 'existing.pye'), 'original')

  const sourceDirectory = await temporaryDirectory('gsx-payload-')
  await fs.writeFile(path.join(sourceDirectory, 'existing.pye'), 'updated')
  await fs.mkdir(path.join(sourceDirectory, 'res'), { recursive: true })
  await fs.writeFile(path.join(sourceDirectory, 'res', 'new.png'), 'new-file')
  const archivePath = path.join(await temporaryDirectory('gsx-archive-'), 'GSX.zip')
  await createZip(sourceDirectory, archivePath)
  const checksum = await sha256(archivePath)

  const updater = new GsxUpdater({
    userDataDirectory: userData,
    officialEtagDirectory: etagDir,
    processLister: async () => '',
    detectInstall: async () => ({ installed: true, addonRoot, version: '4.0.21', source: 'test' }),
    download: async (_url, destination) => fs.copyFile(archivePath, destination),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ schemaVersion: 1, latestVersion: '4.0.23', packages: [manifestPackage({ sha256: checksum })] })
    })
  })

  const result = await updater.applyUpdate()
  assert.equal(result.state, 'complete')
  assert.equal(result.applied[0].component, 'GSX')
  assert.equal(result.applied[0].files, 2)
  assert.equal(await fs.readFile(path.join(targetDir, 'existing.pye'), 'utf8'), 'updated')
  assert.equal(await fs.readFile(path.join(targetDir, 'res', 'new.png'), 'utf8'), 'new-file')

  const state = JSON.parse(await fs.readFile(path.join(userData, 'gsx-state.json'), 'utf8'))
  assert.equal(state.appliedComponents.GSX.etag, '0x8DF112D9F24F2B6')
  assert.equal(state.appliedComponents.GSX.version, '4.0.23')

  const sidecar = await fs.readFile(path.join(etagDir, 'GSX.zip.etag'), 'utf8')
  assert.equal(normalizeEtag(sidecar), '0x8DF112D9F24F2B6')

  // 备份目录应包含被覆盖文件的原始内容（gsx-backups/GSX/<时间戳>/existing.pye）
  const backupRoot = path.join(userData, 'gsx-backups')
  const componentBackupDirs = await fs.readdir(backupRoot)
  assert.deepEqual(componentBackupDirs, ['GSX'])
  const timestampDirs = await fs.readdir(path.join(backupRoot, 'GSX'))
  assert.equal(timestampDirs.length, 1)
  const backupFiles = await fs.readdir(path.join(backupRoot, 'GSX', timestampDirs[0]), { recursive: true })
  assert.ok(backupFiles.some((file) => String(file).endsWith('existing.pye')))

  // 二次应用：ETag 已记录 → 无待更新组件
  const second = await updater.applyUpdate()
  assert.equal(second.state, 'current')
})

test('GsxUpdater.applyUpdate rolls back and keeps state untouched on checksum mismatch', async () => {
  const userData = await temporaryDirectory('gsx-updater-bad-')
  const addonRoot = await temporaryDirectory('gsx-addon-bad-')
  const targetDir = path.join(addonRoot, 'couatl', 'GSX')
  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(path.join(targetDir, 'existing.pye'), 'original')

  const sourceDirectory = await temporaryDirectory('gsx-payload-bad-')
  await fs.writeFile(path.join(sourceDirectory, 'existing.pye'), 'tampered')
  const archivePath = path.join(await temporaryDirectory('gsx-archive-bad-'), 'GSX.zip')
  await createZip(sourceDirectory, archivePath)

  const updater = new GsxUpdater({
    userDataDirectory: userData,
    officialEtagDirectory: await temporaryDirectory('gsx-etags-bad-'),
    processLister: async () => '',
    detectInstall: async () => ({ installed: true, addonRoot, version: '4.0.21', source: 'test' }),
    download: async (_url, destination) => fs.copyFile(archivePath, destination),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ schemaVersion: 1, latestVersion: '4.0.23', packages: [manifestPackage({ sha256: 'b'.repeat(64) })] })
    })
  })

  await assert.rejects(() => updater.applyUpdate(), /SHA-256 与镜像清单不符/)
  assert.equal(await fs.readFile(path.join(targetDir, 'existing.pye'), 'utf8'), 'original')
  const state = JSON.parse(await fs.readFile(path.join(userData, 'gsx-state.json'), 'utf8').catch(() => '{}'))
  assert.ok(!state.appliedComponents?.GSX)
})

test('GsxUpdater refuses to run while the simulator is running', async () => {
  const updater = new GsxUpdater({
    userDataDirectory: await temporaryDirectory('gsx-updater-sim-'),
    officialEtagDirectory: null,
    processLister: async () => '"FlightSimulator2024.exe","123"',
    detectInstall: async () => ({ installed: true, addonRoot: 'C:\\x', version: '4.0.21' }),
    fetchImpl: async () => { throw new Error('should not be called') }
  })
  await assert.rejects(() => updater.applyUpdate(), /模拟器或 GSX 引擎正在运行/)
})
