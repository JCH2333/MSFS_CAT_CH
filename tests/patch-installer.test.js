const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { PatchInstaller, ensureWithin, normalizeContentRoot, sha256 } = require('../electron/patch-installer')

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

function packageFor(version, archivePath, checksum) {
  return {
    id: 'test-patch',
    name: 'Test Patch',
    version,
    status: 'published',
    package: {
      downloadUrl: 'https://github.com/JCH2333/MSFS_CAT_CH_PATCHES/releases/download/test/test.zip',
      sha256: checksum,
      contentRoot: ''
    },
    archivePath
  }
}

test('ensureWithin rejects paths outside an installation target', () => {
  const root = path.resolve('C:/safe-target')
  assert.throws(() => ensureWithin(root, path.resolve(root, '..', 'outside.txt')), /越界路径/)
  assert.equal(ensureWithin(root, path.join(root, 'nested', 'file.txt')), path.join(root, 'nested', 'file.txt'))
})

test('normalizeContentRoot rejects traversal', () => {
  assert.throws(() => normalizeContentRoot('../outside'), /contentRoot/)
  assert.equal(normalizeContentRoot('payload/files'), path.normalize('payload/files'))
})

test('restore reinstates originals and removes unchanged introduced files', async () => {
  const root = await temporaryDirectory('gsx-installer-test-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const backup = path.join(userData, 'backups', 'patch', '1')
  await fs.mkdir(path.join(target, 'nested'), { recursive: true })
  await fs.mkdir(path.join(backup, 'nested'), { recursive: true })

  const replaced = path.join(target, 'nested', 'existing.txt')
  const introduced = path.join(target, 'new.txt')
  const backupFile = path.join(backup, 'nested', 'existing.txt')
  await fs.writeFile(replaced, 'translated')
  await fs.writeFile(introduced, 'introduced')
  await fs.writeFile(backupFile, 'original')

  const installer = new PatchInstaller({ userDataDirectory: userData })
  await installer.writeState({
    schemaVersion: 1,
    installations: {
      patch: {
        patchId: 'patch',
        targetPath: target,
        backupDirectory: backup,
        files: [
          { relativePath: 'nested/existing.txt', hadOriginal: true, backupPath: backupFile, installedHash: await sha256(replaced) },
          { relativePath: 'new.txt', hadOriginal: false, backupPath: null, installedHash: await sha256(introduced) }
        ]
      }
    }
  })

  const result = await installer.restore('patch')
  assert.equal(result.restored, true)
  assert.equal(await fs.readFile(replaced, 'utf8'), 'original')
  await assert.rejects(fs.stat(introduced), { code: 'ENOENT' })
  assert.deepEqual(await installer.listInstallations(), {})
  await fs.rm(root, { recursive: true, force: true })
})

test('restore preserves an introduced file modified after installation', async () => {
  const root = await temporaryDirectory('gsx-installer-conflict-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  await fs.mkdir(target, { recursive: true })
  const introduced = path.join(target, 'new.txt')
  await fs.writeFile(introduced, 'installed')
  const installedHash = await sha256(introduced)
  await fs.writeFile(introduced, 'user change')

  const installer = new PatchInstaller({ userDataDirectory: userData })
  await installer.writeState({
    schemaVersion: 1,
    installations: {
      patch: {
        patchId: 'patch',
        targetPath: target,
        backupDirectory: path.join(userData, 'backups', 'patch', '1'),
        files: [{ relativePath: 'new.txt', hadOriginal: false, backupPath: null, installedHash }]
      }
    }
  })

  const result = await installer.restore('patch')
  assert.equal(result.restored, false)
  assert.deepEqual(result.conflicts, ['new.txt'])
  assert.equal(await fs.readFile(introduced, 'utf8'), 'user change')
  await fs.rm(root, { recursive: true, force: true })
})

test('verification reports modified and missing installed files without changing the record', async () => {
  const root = await temporaryDirectory('gsx-installer-verify-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  await fs.mkdir(target, { recursive: true })
  const modified = path.join(target, 'modified.txt')
  await fs.writeFile(modified, 'installed')
  const installedHash = await sha256(modified)
  await fs.writeFile(modified, 'changed by user')

  const installer = new PatchInstaller({ userDataDirectory: userData })
  await installer.writeState({
    schemaVersion: 1,
    installations: {
      patch: {
        patchId: 'patch',
        targetPath: target,
        files: [
          { relativePath: 'modified.txt', installedHash },
          { relativePath: 'missing.txt', installedHash }
        ]
      }
    }
  })

  const result = await installer.verifyInstallations()
  assert.equal(result.patch.state, 'missing')
  assert.deepEqual(result.patch.modifiedFiles, ['modified.txt'])
  assert.deepEqual(result.patch.missingFiles, ['missing.txt'])
  assert.ok((await installer.listInstallations()).patch)
  await fs.rm(root, { recursive: true, force: true })
})

test('recognizes a complete externally installed patch from catalog file fingerprints', async () => {
  const root = await temporaryDirectory('gsx-installer-reconcile-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const localizedFile = path.join(target, 'panel.js')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(localizedFile, 'localized')

  const installer = new PatchInstaller({ userDataDirectory: userData })
  const result = await installer.reconcileInstallations([{
    id: 'recognized-patch',
    name: 'Recognized patch',
    version: '1.0.0',
    fingerprint: [{ relativePath: 'panel.js', sha256: await sha256(localizedFile) }]
  }], { 'recognized-patch': target })

  assert.deepEqual(result, { 'recognized-patch': 'recognized' })
  const installation = (await installer.listInstallations())['recognized-patch']
  assert.equal(installation.source, 'detected')
  assert.equal((await installer.verifyInstallations())['recognized-patch'].state, 'intact')
  await fs.rm(root, { recursive: true, force: true })
})

test('backs up fingerprinted files before patch download begins', async () => {
  const root = await temporaryDirectory('gsx-installer-prebackup-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'patch.zip')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'panel.txt'), 'original')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'panel.txt'), 'localized')
  await createZip(source, archive)

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destination) => {
      const versions = await fs.readdir(path.join(userData, 'backups', 'test-patch'))
      const backup = await fs.readFile(path.join(userData, 'backups', 'test-patch', versions[0], 'panel.txt'), 'utf8')
      assert.equal(backup, 'original')
      await fs.copyFile(archive, destination)
    }
  })
  const patch = packageFor('1.0.0', archive, await sha256(archive))
  patch.fingerprint = [{ relativePath: 'panel.txt', sha256: await sha256(path.join(source, 'panel.txt')) }]

  await installer.install(patch, target)
  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'localized')
  await fs.rm(root, { recursive: true, force: true })
})

test('installs, verifies, updates, and restores a real Patch Package', async () => {
  const root = await temporaryDirectory('gsx-installer-lifecycle-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const v1Source = path.join(root, 'v1-source')
  const v2Source = path.join(root, 'v2-source')
  const v1Archive = path.join(root, 'v1.zip')
  const v2Archive = path.join(root, 'v2.zip')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'panel.txt'), 'original')
  await fs.mkdir(v1Source)
  await fs.writeFile(path.join(v1Source, 'panel.txt'), 'localized v1')
  await createZip(v1Source, v1Archive)
  await fs.mkdir(v2Source)
  await fs.writeFile(path.join(v2Source, 'panel.txt'), 'localized v2')
  await fs.writeFile(path.join(v2Source, 'introduced.txt'), 'new file')
  await createZip(v2Source, v2Archive)

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destination) => {
      const source = installer.currentArchive
      await fs.copyFile(source, destination)
    }
  })

  installer.currentArchive = v1Archive
  await installer.install(packageFor('1.0.0', v1Archive, await sha256(v1Archive)), target)
  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'localized v1')
  assert.equal((await installer.verifyInstallations())['test-patch'].state, 'intact')

  installer.currentArchive = v2Archive
  await installer.install(packageFor('1.1.0', v2Archive, await sha256(v2Archive)), target)
  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'localized v2')
  assert.equal(await fs.readFile(path.join(target, 'introduced.txt'), 'utf8'), 'new file')
  assert.equal((await installer.listInstallations())['test-patch'].version, '1.1.0')

  const restored = await installer.restore('test-patch')
  assert.equal(restored.restored, true)
  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'original')
  await assert.rejects(fs.stat(path.join(target, 'introduced.txt')), { code: 'ENOENT' })
  await fs.rm(root, { recursive: true, force: true })
})
