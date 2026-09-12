const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const {
  PatchInstaller,
  currentWindowsFileTime,
  downloadToFile,
  ensureWithin,
  isAllowedDownloadUrl,
  normalizeContentRoot,
  serverPatchDownloadUrl,
  sha256,
  validateInstallationTarget,
  validatePatchFiles,
  validatePatchLayoutEntries
} = require('../electron/patch-installer')
const { buildServerUrl } = require('../electron/distribution-server')

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
      downloadUrl: 'https://jianchihu.online/downloads/patches/test/test.zip',
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

test('requires the GSX audio installation target to contain sounds', async () => {
  const root = await temporaryDirectory('gsx-audio-target-')
  await assert.rejects(
    validateInstallationTarget({ targetKind: 'gsx-audio' }, root),
    /sounds/
  )
  await fs.mkdir(path.join(root, 'sounds'))
  await assert.doesNotReject(validateInstallationTarget({ targetKind: 'gsx-audio' }, root))
  await fs.rm(root, { recursive: true, force: true })
})

test('protects FSR+ and ChasePlane core runtime files from patch packages', () => {
  assert.throws(
    () => validatePatchFiles('fsrealistic-plus-zh-cn', ['html_ui/InGamePanels/FSRealistic/FSRealistic.js']),
    /核心文件/
  )
  assert.throws(
    () => validatePatchFiles('fsrealistic-plus-zh-cn', ['html_ui/InGamePanels/FSRealistic/FSRealistic.html']),
    /核心文件/
  )
  assert.throws(
    () => validatePatchFiles('chaseplane-zh-cn', ['modules/ChasePlaneModule.wasm']),
    /核心文件/
  )
  assert.throws(() => validatePatchFiles('chaseplane-zh-cn', [
    'HTML_UI/InGamePanels/P42ChasePlane/P42ChasePlane.html',
    'HTML_UI/InGamePanels/P42ChasePlane/ChasePlane.zh-CN.js',
    'manifest.json',
    'layout.json'
  ]))
})

test('allows patch metadata manifest.json to be absent from layout content entries', async () => {
  const root = await temporaryDirectory('gsx-installer-layout-metadata-')
  const source = path.join(root, 'source')
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify({
    package_version: '26.32.4',
    total_package_size: '38358240'
  }))
  await fs.writeFile(path.join(source, 'panel.js'), 'localized')
  await fs.writeFile(path.join(source, 'layout.json'), JSON.stringify({
    content: [{ path: 'panel.js', size: 9, date: 1 }]
  }))

  const files = [
    path.join(source, 'manifest.json'),
    path.join(source, 'panel.js'),
    path.join(source, 'layout.json')
  ]
  assert.doesNotThrow(() => validatePatchLayoutEntries(files, source))
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects a patch layout whose file size does not match its payload', async () => {
  const root = await temporaryDirectory('gsx-installer-layout-size-')
  const source = path.join(root, 'source')
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(path.join(source, 'panel.html'), 'localized')
  await fs.writeFile(path.join(source, 'layout.json'), JSON.stringify({
    content: [{ path: 'panel.html', size: 999, date: 1 }]
  }))

  const files = [path.join(source, 'panel.html'), path.join(source, 'layout.json')]
  assert.throws(() => validatePatchLayoutEntries(files, source), /文件大小不匹配/)
  await fs.rm(root, { recursive: true, force: true })
})

test('permits only https downloads from the distribution server host', () => {
  assert.equal(isAllowedDownloadUrl('https://jianchihu.online/downloads/patches/test/test.zip'), true)
  assert.equal(isAllowedDownloadUrl('http://jianchihu.online/downloads/patches/test/test.zip'), false)
  assert.equal(isAllowedDownloadUrl('https://evil.example/test.zip'), false)
  assert.equal(isAllowedDownloadUrl('https://jianchihu.online.evil.example/test.zip'), false)
})

test('derives the server download endpoint for a patch id', () => {
  assert.equal(serverPatchDownloadUrl('gsx-pro-zh-cn'), buildServerUrl('/api/patches/download/gsx-pro-zh-cn'))
  assert.equal(serverPatchDownloadUrl('gsx-pro-zh-cn'), 'https://jianchihu.online/api/patches/download/gsx-pro-zh-cn')
})

test('rejects a download URL outside the trusted server hosts before any request', async () => {
  await assert.rejects(
    downloadToFile('https://evil.example/test.zip', 'C:/temporary/test.zip', () => {}),
    /受信任的云端服务器地址/
  )
})

test('downloads a published patch from the catalog server URL and reports server progress', async () => {
  const root = await temporaryDirectory('gsx-installer-server-download-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'patch.zip')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'panel.txt'), 'original')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'panel.txt'), 'localized')
  await createZip(source, archive)

  const calls = []
  const events = []
  const installer = new PatchInstaller({
    userDataDirectory: userData,
    onProgress: (event) => events.push(event),
    download: async (url, destination, onProgress) => {
      calls.push(url)
      await fs.copyFile(archive, destination)
      onProgress?.({ received: 10, total: 10 })
    }
  })
  const patch = packageFor('1.0.0', archive, await sha256(archive))
  await installer.install(patch, target)

  assert.deepEqual(calls, ['https://jianchihu.online/downloads/patches/test/test.zip'])
  const downloadEvents = events.filter((event) => event.phase === 'download')
  assert.equal(downloadEvents[0].message, '正在从云端服务器下载补丁')
  const progressEvent = downloadEvents.find((event) => event.source !== undefined)
  assert.equal(progressEvent.source, 'server')
  assert.equal(progressEvent.message, '正在从云端服务器下载补丁')
  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'localized')
  await fs.rm(root, { recursive: true, force: true })
})

test('falls back to the server download endpoint when the catalog omits a download URL', async () => {
  const root = await temporaryDirectory('gsx-installer-server-fallback-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'patch.zip')
  await fs.mkdir(target, { recursive: true })
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'panel.txt'), 'localized')
  await createZip(source, archive)

  const calls = []
  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (url, destination) => {
      calls.push(url)
      await fs.copyFile(archive, destination)
    }
  })
  const patch = packageFor('1.0.0', archive, await sha256(archive))
  patch.package.downloadUrl = ''
  await installer.install(patch, target)

  assert.deepEqual(calls, ['https://jianchihu.online/api/patches/download/test-patch'])
  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'localized')
  await fs.rm(root, { recursive: true, force: true })
})

test('refuses to install when the downloaded package fails the catalog checksum', async () => {
  const root = await temporaryDirectory('gsx-installer-download-checksum-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'patch.zip')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'panel.txt'), 'original')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'panel.txt'), 'unexpected content')
  await createZip(source, archive)

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destination) => fs.copyFile(archive, destination)
  })
  await assert.rejects(
    installer.install(packageFor('1.0.0', archive, '0'.repeat(64)), target),
    /SHA-256/
  )
  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'original')
  assert.deepEqual(await installer.listInstallations(), {})
  await fs.rm(root, { recursive: true, force: true })
})

test('synchronizes installed layout dates with copied patch files', async () => {
  const root = await temporaryDirectory('gsx-installer-layout-date-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'patch.zip')
  await fs.mkdir(target, { recursive: true })
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(path.join(source, 'panel.js'), 'localized')
  await fs.writeFile(path.join(source, 'layout.json'), JSON.stringify({
    content: [{ path: 'panel.js', size: 9, date: 1 }]
  }, null, 2))
  await createZip(source, archive)

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destination) => fs.copyFile(archive, destination)
  })
  const patch = packageFor('1.0.0', archive, await sha256(archive))
  await installer.install(patch, target)

  const layoutText = await fs.readFile(path.join(target, 'layout.json'), 'utf8')
  const installedTime = await currentWindowsFileTime(path.join(target, 'panel.js'))
  assert.match(layoutText, new RegExp(`\\"date\\": ${installedTime}`))
  assert.equal((await installer.verifyInstallations())['test-patch'].state, 'intact')
  await fs.rm(root, { recursive: true, force: true })
})

test('synchronizes layout.json own date after patch metadata is rewritten', async () => {
  const root = await temporaryDirectory('gsx-installer-layout-self-date-')
  const target = path.join(root, 'target')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'panel.js'), 'localized')
  await fs.writeFile(path.join(target, 'layout.json'), JSON.stringify({
    content: [
      { path: 'panel.js', size: 9, date: 1 },
      { path: 'layout.json', size: 0, date: 1 }
    ]
  }, null, 2))

  const files = [
    { relativePath: 'panel.js' },
    { relativePath: 'layout.json' }
  ]
  const { synchronizeInstalledLayoutDates } = require('../electron/patch-installer')
  await synchronizeInstalledLayoutDates(target, files)

  const layoutText = await fs.readFile(path.join(target, 'layout.json'), 'utf8')
  const layout = JSON.parse(layoutText)
  const layoutEntry = layout.content.find((entry) => entry.path === 'layout.json')
  assert.equal(String(layoutEntry.date), await currentWindowsFileTime(path.join(target, 'layout.json')))
  await fs.rm(root, { recursive: true, force: true })
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

test('restore refuses to overwrite an existing file changed after installation', async () => {
  const root = await temporaryDirectory('gsx-installer-restore-changed-original-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const backup = path.join(userData, 'backups', 'patch', '1')
  await fs.mkdir(path.join(target, 'sounds'), { recursive: true })
  await fs.mkdir(path.join(backup, 'sounds'), { recursive: true })
  const destination = path.join(target, 'sounds', 'boarding.wav')
  const backupFile = path.join(backup, 'sounds', 'boarding.wav')
  await fs.writeFile(destination, 'new addon original')
  await fs.writeFile(backupFile, 'old addon original')
  const installedFile = path.join(root, 'installed.wav')
  await fs.writeFile(installedFile, 'localized')
  const installer = new PatchInstaller({ userDataDirectory: userData })
  await installer.writeState({ schemaVersion: 1, installations: { patch: { patchId: 'patch', targetPath: target, backupDirectory: path.join(userData, 'backups', 'patch', '1'), files: [{ relativePath: 'sounds/boarding.wav', hadOriginal: true, backupPath: backupFile, installedHash: await sha256(installedFile) }] } } })
  const result = await installer.restore('patch')
  assert.equal(result.restored, false)
  assert.deepEqual(result.conflicts, ['sounds/boarding.wav'])
  assert.equal(await fs.readFile(destination, 'utf8'), 'new addon original')
  await fs.rm(root, { recursive: true, force: true })
})

test('reinstalls a detected same-version patch and backs up the current files', async () => {
  const root = await temporaryDirectory('gsx-installer-detected-reinstall-')
  const target = path.join(root, 'GSX')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'voice.zip')
  await fs.mkdir(path.join(target, 'sounds'), { recursive: true })
  await fs.mkdir(path.join(source, 'sounds'), { recursive: true })
  const destination = path.join(target, 'sounds', 'boarding.wav')
  await fs.writeFile(destination, 'current addon original')
  await fs.writeFile(path.join(source, 'sounds', 'boarding.wav'), 'localized voice')
  await createZip(source, archive)
  const patch = packageFor('1.0.0', archive, await sha256(archive))
  patch.id = 'gsx-pro-zh-cn-voice'
  patch.targetKind = 'gsx-audio'
  patch.fingerprint = [{ relativePath: 'sounds/boarding.wav', sha256: await sha256(path.join(source, 'sounds', 'boarding.wav')) }]
  const installer = new PatchInstaller({ userDataDirectory: userData, download: async (_url, destinationPath) => fs.copyFile(archive, destinationPath) })
  await installer.writeState({ schemaVersion: 1, installations: { [patch.id]: { patchId: patch.id, name: patch.name, version: patch.version, targetPath: target, installedAt: new Date().toISOString(), source: 'detected', backupDirectory: null, files: [{ relativePath: 'sounds/boarding.wav', hadOriginal: false, backupPath: null, installedHash: '0'.repeat(64) }] } } })
  assert.equal((await installer.verifyInstallations())[patch.id].state, 'reinstallable')
  const installation = await installer.install(patch, target)
  assert.equal(installation.source, 'managed')
  assert.equal(await fs.readFile(destination, 'utf8'), 'localized voice')
  const backups = await fs.readdir(path.join(userData, 'backups', patch.id))
  assert.equal(await fs.readFile(path.join(userData, 'backups', patch.id, backups[0], 'sounds', 'boarding.wav'), 'utf8'), 'current addon original')
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

test('backs up GSX original voice files before download and restores them after installation', async () => {
  const root = await temporaryDirectory('gsx-audio-backup-')
  const target = path.join(root, 'GSX')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'voice.zip')
  const events = []
  await fs.mkdir(path.join(target, 'sounds'), { recursive: true })
  await fs.writeFile(path.join(target, 'sounds', 'boarding.wav'), 'original voice')
  await fs.mkdir(path.join(source, 'sounds'), { recursive: true })
  await fs.writeFile(path.join(source, 'sounds', 'boarding.wav'), 'localized voice')
  await createZip(source, archive)

  const patch = packageFor('1.0.0', archive, await sha256(archive))
  patch.id = 'gsx-pro-zh-cn-voice'
  patch.targetKind = 'gsx-audio'
  patch.fingerprint = [{ relativePath: 'sounds/boarding.wav', sha256: await sha256(path.join(source, 'sounds', 'boarding.wav')) }]

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    onProgress: (event) => events.push(event),
    download: async (_url, destination) => {
      const versions = await fs.readdir(path.join(userData, 'backups', patch.id))
      const backup = await fs.readFile(path.join(userData, 'backups', patch.id, versions[0], 'sounds', 'boarding.wav'), 'utf8')
      assert.equal(backup, 'original voice')
      await fs.copyFile(archive, destination)
    }
  })

  await installer.install(patch, target)
  assert.equal(events[0].phase, 'backup')
  assert.equal(await fs.readFile(path.join(target, 'sounds', 'boarding.wav'), 'utf8'), 'localized voice')

  const restored = await installer.restore(patch.id)
  assert.equal(restored.restored, true)
  assert.equal(await fs.readFile(path.join(target, 'sounds', 'boarding.wav'), 'utf8'), 'original voice')
  await fs.rm(root, { recursive: true, force: true })
})

test('installs and restores a GSX combined text and image patch across both targets', async () => {
  const root = await temporaryDirectory('gsx-installer-combined-')
  const communityTarget = path.join(root, 'Community', 'fsdreamteam-gsx-pro')
  const runtimeResTarget = path.join(root, 'Addon Manager', 'couatl', 'GSX', 'res')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'combined.zip')
  const userData = path.join(root, 'user-data')
  const panelRelative = path.join('html_ui', 'InGamePanels', 'FSDT_GSX_Panel', 'FSDT_GSX_Panel.js')
  const localizedPanel = 'localized panel'
  const localizedImage = 'localized select image'

  await fs.mkdir(path.join(communityTarget, path.dirname(panelRelative)), { recursive: true })
  await fs.mkdir(runtimeResTarget, { recursive: true })
  await fs.writeFile(path.join(communityTarget, panelRelative), 'original panel')
  await fs.writeFile(path.join(communityTarget, 'layout.json'), JSON.stringify({
    content: [{ path: panelRelative.replace(/\\/g, '/'), size: 14, date: 1 }]
  }))
  await fs.writeFile(path.join(runtimeResTarget, 'btn_select.png'), 'original select image')

  const communitySource = path.join(source, 'community')
  const runtimeSource = path.join(source, 'runtime-res')
  await fs.mkdir(path.join(communitySource, path.dirname(panelRelative)), { recursive: true })
  await fs.mkdir(runtimeSource, { recursive: true })
  await fs.writeFile(path.join(communitySource, panelRelative), localizedPanel)
  await fs.writeFile(path.join(communitySource, 'layout.json'), JSON.stringify({
    content: [{ path: panelRelative.replace(/\\/g, '/'), size: Buffer.byteLength(localizedPanel), date: 1 }]
  }))
  await fs.writeFile(path.join(runtimeSource, 'btn_select.png'), localizedImage)
  await createZip(source, archive)

  const patch = packageFor('1.2.7', archive, await sha256(archive))
  patch.id = 'gsx-pro-zh-cn'
  patch.targetKind = 'gsx-combined'
  patch.fingerprint = [
    { target: 'primary', relativePath: 'layout.json', sha256: await sha256(path.join(communitySource, 'layout.json')) },
    { target: 'primary', relativePath: panelRelative.replace(/\\/g, '/'), sha256: await sha256(path.join(communitySource, panelRelative)) },
    { target: 'gsx-runtime-res', relativePath: 'btn_select.png', sha256: await sha256(path.join(runtimeSource, 'btn_select.png')) }
  ]
  patch.package.installPlan = [
    { target: 'primary', contentRoot: 'community' },
    { target: 'gsx-runtime-res', contentRoot: 'runtime-res' }
  ]

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    resolveAdditionalTarget: async (target) => {
      assert.equal(target, 'gsx-runtime-res')
      return runtimeResTarget
    }
  })
  const installation = await installer.installFromFile(patch, communityTarget, archive)

  assert.equal(await fs.readFile(path.join(communityTarget, panelRelative), 'utf8'), localizedPanel)
  assert.equal(await fs.readFile(path.join(runtimeResTarget, 'btn_select.png'), 'utf8'), localizedImage)
  assert.equal(installation.files.filter((file) => file.target === 'gsx-runtime-res').length, 1)
  const imageRecord = installation.files.find((file) => file.target === 'gsx-runtime-res')
  assert.equal(await fs.readFile(imageRecord.backupPath, 'utf8'), 'original select image')
  assert.equal((await installer.verifyInstallations())[patch.id].state, 'intact')

  const restored = await installer.restore(patch.id)
  assert.equal(restored.restored, true)
  assert.equal(await fs.readFile(path.join(communityTarget, panelRelative), 'utf8'), 'original panel')
  assert.equal(await fs.readFile(path.join(runtimeResTarget, 'btn_select.png'), 'utf8'), 'original select image')
  await fs.rm(root, { recursive: true, force: true })
})

test('installs a checksum-verified local offline package without downloading', async () => {
  const root = await temporaryDirectory('gsx-installer-offline-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'offline.zip')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'panel.txt'), 'original')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'panel.txt'), 'localized from offline package')
  await createZip(source, archive)

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async () => { throw new Error('offline import must not download') }
  })
  const patch = packageFor('1.0.0', archive, await sha256(archive))
  await installer.installFromFile(patch, target, archive)

  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'localized from offline package')
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects an offline package that does not match the catalog checksum', async () => {
  const root = await temporaryDirectory('gsx-installer-offline-invalid-')
  const target = path.join(root, 'target')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'offline.zip')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'panel.txt'), 'original')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'panel.txt'), 'unexpected content')
  await createZip(source, archive)

  const installer = new PatchInstaller({ userDataDirectory: userData })
  await assert.rejects(
    installer.installFromFile(packageFor('1.0.0', archive, '0'.repeat(64)), target, archive),
    /SHA-256/
  )
  assert.equal(await fs.readFile(path.join(target, 'panel.txt'), 'utf8'), 'original')
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
