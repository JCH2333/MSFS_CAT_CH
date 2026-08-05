const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { PatchInstaller, ensureWithin, normalizeContentRoot, sha256 } = require('../electron/patch-installer')

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
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
