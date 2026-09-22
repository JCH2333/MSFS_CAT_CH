const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { PatchInstaller, sha256 } = require('../electron/patch-installer')
const { buildServerUrl } = require('../electron/distribution-server')

// 复用主测试文件的辅助函数（通过相对导入不可行，这里内联同样实现）
async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function createZip(sourceDirectory, archivePath) {
  const { execFile } = require('node:child_process')
  const { promisify } = require('node:util')
  const execFileAsync = promisify(execFile)
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
      downloadUrl: buildServerUrl('/downloads/patches/test/test.zip'),
      sha256: checksum,
      contentRoot: ''
    },
    archivePath
  }
}

test('reinstall with a renamed package folder removes the old managed folder without leftovers', async () => {
  const root = await temporaryDirectory('gsx-installer-rename-upgrade-')
  const community = path.join(root, 'community')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'patch-new.zip')

  // 旧版本（托管安装）：旧目录名 zzz-pmdg-efb-zh-patch，含补丁文件与一个有备份的厂商覆盖文件
  const oldFolder = path.join(community, 'zzz-pmdg-efb-zh-patch')
  const vendorOriginal = 'vendor original text'
  await fs.mkdir(path.join(oldFolder, 'html_ui'), { recursive: true })
  await fs.writeFile(path.join(oldFolder, 'manifest.json'), '{"package_version":"0.1.1"}')
  await fs.writeFile(path.join(oldFolder, 'html_ui', 'efb.js'), 'old engine')
  await fs.writeFile(path.join(community, 'vendor-orig.txt'), vendorOriginal)
  const oldFileHashes = {
    'manifest.json': await sha256(path.join(oldFolder, 'manifest.json')),
    'html_ui/efb.js': await sha256(path.join(oldFolder, 'html_ui', 'efb.js'))
  }
  const backupDirectory = path.join(userData, 'backups', 'pmdg-efb-zh-cn', '1')
  await fs.mkdir(backupDirectory, { recursive: true })
  await fs.writeFile(path.join(backupDirectory, 'vendor-orig.txt'), vendorOriginal)

  // 新版本 ZIP：目录名换成 zzz-JCH-pmdg-efb-zh-patch
  await fs.mkdir(path.join(source, 'zzz-JCH-pmdg-efb-zh-patch', 'html_ui'), { recursive: true })
  await fs.writeFile(path.join(source, 'zzz-JCH-pmdg-efb-zh-patch', 'manifest.json'), '{"package_version":"0.1.2"}')
  await fs.writeFile(path.join(source, 'zzz-JCH-pmdg-efb-zh-patch', 'html_ui', 'efb.js'), 'new engine')
  await createZip(source, archive)

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destinationPath) => fs.copyFile(archive, destinationPath)
  })
  await installer.writeState({
    schemaVersion: 1,
    installations: {
      'pmdg-efb-zh-cn': {
        patchId: 'pmdg-efb-zh-cn',
        name: 'PMDG 全系 EFB 简体中文',
        version: '0.1.1',
        targetPath: community,
        installedAt: new Date().toISOString(),
        source: 'managed',
        backupDirectory,
        files: [
          { relativePath: 'zzz-pmdg-efb-zh-patch/manifest.json', hadOriginal: false, backupPath: null, installedHash: oldFileHashes['manifest.json'] },
          { relativePath: 'zzz-pmdg-efb-zh-patch/html_ui/efb.js', hadOriginal: false, backupPath: null, installedHash: oldFileHashes['html_ui/efb.js'] },
          { relativePath: 'vendor-orig.txt', hadOriginal: true, backupPath: path.join(backupDirectory, 'vendor-orig.txt'), installedHash: await sha256(path.join(community, 'vendor-orig.txt')) }
        ]
      }
    }
  })

  const patch = packageFor('0.1.2', archive, await sha256(archive))
  patch.id = 'pmdg-efb-zh-cn'
  const installation = await installer.install(patch, community)

  // 旧目录连同其中文件完全消失（没有空目录残留），新目录就位
  assert.equal(await fs.access(oldFolder).then(() => true, () => false), false)
  assert.equal(
    await fs.readFile(path.join(community, 'zzz-JCH-pmdg-efb-zh-patch', 'html_ui', 'efb.js'), 'utf8'),
    'new engine'
  )
  // 安装记录只包含新目录前缀；旧记录里与新包无关的文件不残留
  const installedPaths = installation.files.map((file) => file.relativePath.replace(/\\/g, '/'))
  assert.ok(installedPaths.every((relativePath) => relativePath.startsWith('zzz-JCH-pmdg-efb-zh-patch/')),
    '安装记录应只包含新目录前缀')
  assert.ok(!installedPaths.includes('vendor-orig.txt'), '旧记录的无关文件不应残留进新记录')

  await fs.rm(root, { recursive: true, force: true })
})

test('reinstall removes a detected installation that used the old package folder name', async () => {
  const root = await temporaryDirectory('gsx-installer-detected-rename-')
  const community = path.join(root, 'community')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'patch-new.zip')

  // 识别安装（source: detected，无备份）：旧目录名 zzz-syna220-efb-zh-patch
  const oldFolder = path.join(community, 'zzz-syna220-efb-zh-patch')
  await fs.mkdir(path.join(oldFolder, 'html_ui'), { recursive: true })
  await fs.writeFile(path.join(oldFolder, 'manifest.json'), '{"package_version":"0.1.1"}')
  await fs.writeFile(path.join(oldFolder, 'html_ui', 'efb.js'), 'old engine')

  await fs.mkdir(path.join(source, 'zzz-JCH-syna220-efb-zh-patch', 'html_ui'), { recursive: true })
  await fs.writeFile(path.join(source, 'zzz-JCH-syna220-efb-zh-patch', 'manifest.json'), '{"package_version":"0.1.2"}')
  await fs.writeFile(path.join(source, 'zzz-JCH-syna220-efb-zh-patch', 'html_ui', 'efb.js'), 'new engine')
  await createZip(source, archive)

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destinationPath) => fs.copyFile(archive, destinationPath)
  })
  await installer.writeState({
    schemaVersion: 1,
    installations: {
      'syna220-efb-zh-cn': {
        patchId: 'syna220-efb-zh-cn',
        name: 'Synaptic A220 EFB 简体中文',
        version: '0.1.1',
        targetPath: community,
        installedAt: new Date().toISOString(),
        detectedAt: new Date().toISOString(),
        source: 'detected',
        backupDirectory: null,
        files: [
          { relativePath: 'zzz-syna220-efb-zh-patch/manifest.json', hadOriginal: false, backupPath: null, installedHash: await sha256(path.join(oldFolder, 'manifest.json')) },
          { relativePath: 'zzz-syna220-efb-zh-patch/html_ui/efb.js', hadOriginal: false, backupPath: null, installedHash: await sha256(path.join(oldFolder, 'html_ui', 'efb.js')) }
        ]
      }
    }
  })

  const patch = packageFor('0.1.2', archive, await sha256(archive))
  patch.id = 'syna220-efb-zh-cn'
  await installer.install(patch, community)

  assert.equal(await fs.access(oldFolder).then(() => true, () => false), false)
  assert.equal(
    await fs.readFile(path.join(community, 'zzz-JCH-syna220-efb-zh-patch', 'html_ui', 'efb.js'), 'utf8'),
    'new engine'
  )

  await fs.rm(root, { recursive: true, force: true })
})

test('reinstall keeps files the user modified and prunes only emptied directories', async () => {
  const root = await temporaryDirectory('gsx-installer-keep-modified-')
  const community = path.join(root, 'community')
  const userData = path.join(root, 'user-data')
  const source = path.join(root, 'source')
  const archive = path.join(root, 'patch-new.zip')

  const oldFolder = path.join(community, 'zzz-old')
  await fs.mkdir(oldFolder, { recursive: true })
  await fs.writeFile(path.join(oldFolder, 'intact.js'), 'intact engine')
  await fs.writeFile(path.join(oldFolder, 'tweaked.js'), 'installed text')
  const intactHash = await sha256(path.join(oldFolder, 'intact.js'))
  const tweakedInstalledHash = await sha256(path.join(oldFolder, 'tweaked.js'))
  await fs.writeFile(path.join(oldFolder, 'tweaked.js'), 'user changed this')

  await fs.mkdir(path.join(source, 'zzz-JCH-new'), { recursive: true })
  await fs.writeFile(path.join(source, 'zzz-JCH-new', 'manifest.json'), '{}')
  await createZip(source, archive)

  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destinationPath) => fs.copyFile(archive, destinationPath)
  })
  await installer.writeState({
    schemaVersion: 1,
    installations: {
      patch: {
        patchId: 'patch',
        targetPath: community,
        installedAt: new Date().toISOString(),
        source: 'managed',
        backupDirectory: path.join(userData, 'backups', 'patch', '1'),
        files: [
          { relativePath: 'zzz-old/intact.js', hadOriginal: false, backupPath: null, installedHash: intactHash },
          { relativePath: 'zzz-old/tweaked.js', hadOriginal: false, backupPath: null, installedHash: tweakedInstalledHash }
        ]
      }
    }
  })

  const patch = packageFor('2.0.0', archive, await sha256(archive))
  patch.id = 'patch'
  await installer.install(patch, community)

  // 用户改过的引入文件移入隔离区（内容不丢）；完好文件删除；旧目录随之清空删除
  const quarantineRoot = path.join(userData, 'quarantine', 'patch')
  const quarantinedFile = (await filesUnder(quarantineRoot)).find((f) => f.endsWith('tweaked.js'))
  assert.ok(quarantinedFile, '被改动的旧文件应移入隔离区')
  assert.equal(await fs.readFile(quarantinedFile, 'utf8'), 'user changed this')
  assert.equal(await fs.access(path.join(community, 'zzz-old', 'tweaked.js')).then(() => true, () => false), false)
  assert.equal(await fs.access(path.join(community, 'zzz-old')).then(() => true, () => false), false)
  assert.equal(await fs.readFile(path.join(community, 'zzz-JCH-new', 'manifest.json'), 'utf8'), '{}')

  await fs.rm(root, { recursive: true, force: true })
})

async function filesUnder(dir) {
  const out = []
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(full)
      else out.push(full)
    }
  }
  await visit(dir)
  return out
}

test('injective reinstall restores vendor originals from the previous install before injecting', async () => {
  const root = await temporaryDirectory('gsx-installer-injective-reinstall-')
  const community = path.join(root, 'community')
  const vendor = path.join(community, 'fycyc-aircraft-c919x')
  const userData = path.join(root, 'user-data')
  const gaugeRelative = 'html_ui/Pages/VCockpit/Instruments/C919X/EFB/efb.index.js'

  // 机模包原版
  await fs.mkdir(path.join(vendor, 'html_ui', 'Pages', 'VCockpit', 'Instruments', 'C919X', 'EFB'), { recursive: true })
  await fs.writeFile(path.join(vendor, 'manifest.json'), '{"package_version":"0.0.1"}')
  const originalGauge = 'var ORIGINAL = true;'
  await fs.writeFile(path.join(vendor, gaugeRelative), originalGauge)
  // date 是 18 位 FILETIME：手拼字符串避免 JSON 精度丢失
  const originalLayout = '{"content": [\n    {\n      "path": "' + gaugeRelative
    + '",\n      "size": ' + Buffer.byteLength(originalGauge) + ',\n      "date": 134254064046392362\n    }\n  ]}'
  await fs.writeFile(path.join(vendor, 'layout.json'), originalLayout)

  // v1：覆盖 gauge + 新增 zh 引擎与 v1 独有文件（v2 中被移除，重装后必须消失）
  const sourceV1 = path.join(root, 'source-v1')
  await fs.mkdir(path.join(sourceV1, 'files', 'html_ui', 'Pages', 'VCockpit', 'Instruments', 'C919X', 'EFB'), { recursive: true })
  await fs.mkdir(path.join(sourceV1, 'files', 'html_ui', 'Pages', 'VCockpit', 'Instruments', 'C919X', 'zh'), { recursive: true })
  await fs.writeFile(path.join(sourceV1, 'files', gaugeRelative), 'var LOCALIZED = true;')
  await fs.writeFile(path.join(sourceV1, 'files', 'html_ui/Pages/VCockpit/Instruments/C919X/zh/c919x-zh.js'), '// zh engine v1')
  await fs.writeFile(path.join(sourceV1, 'files', 'html_ui/Pages/VCockpit/Instruments/C919X/zh/v1-only.js'), '// v1 only')
  const archiveV1 = path.join(root, 'injective-v1.zip')
  await createZip(sourceV1, archiveV1)

  const patchV1 = {
    id: 'fycyc919x-efb-zh-cn',
    name: 'fYcyc C919X EFB 简体中文',
    version: '0.1.0',
    status: 'published',
    targetKind: 'addon-inject',
    targetFolders: ['fycyc-aircraft-c919x'],
    package: { sha256: await sha256(archiveV1), installPlan: [{ target: 'primary', contentRoot: 'files' }] }
  }
  const installer = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destinationPath) => fs.copyFile(archiveV1, destinationPath)
  })
  await installer.install(patchV1, vendor)

  // v2：同名文件新内容，且不再包含 v1 独有文件
  const sourceV2 = path.join(root, 'source-v2')
  await fs.mkdir(path.join(sourceV2, 'files', 'html_ui', 'Pages', 'VCockpit', 'Instruments', 'C919X', 'EFB'), { recursive: true })
  await fs.mkdir(path.join(sourceV2, 'files', 'html_ui', 'Pages', 'VCockpit', 'Instruments', 'C919X', 'zh'), { recursive: true })
  await fs.writeFile(path.join(sourceV2, 'files', gaugeRelative), 'var LOCALIZED = 2;')
  await fs.writeFile(path.join(sourceV2, 'files', 'html_ui/Pages/VCockpit/Instruments/C919X/zh/c919x-zh.js'), '// zh engine v2')
  const archiveV2 = path.join(root, 'injective-v2.zip')
  await createZip(sourceV2, archiveV2)

  const patchV2 = {
    ...patchV1,
    version: '0.1.1',
    package: { sha256: await sha256(archiveV2), installPlan: [{ target: 'primary', contentRoot: 'files' }] }
  }
  const installerV2 = new PatchInstaller({
    userDataDirectory: userData,
    download: async (_url, destinationPath) => fs.copyFile(archiveV2, destinationPath)
  })
  const installation = await installerV2.install(patchV2, vendor)

  // 先还原再嵌入：v1 独有文件消失；gauge 与 zh 引擎均为 v2 内容；layout 尺寸与 v2 一致
  assert.equal(await fs.access(path.join(vendor, 'html_ui/Pages/VCockpit/Instruments/C919X/zh/v1-only.js')).then(() => true, () => false), false)
  assert.equal(await fs.readFile(path.join(vendor, gaugeRelative), 'utf8'), 'var LOCALIZED = 2;')
  assert.equal(await fs.readFile(path.join(vendor, 'html_ui/Pages/VCockpit/Instruments/C919X/zh/c919x-zh.js'), 'utf8'), '// zh engine v2')
  const layout = JSON.parse(await fs.readFile(path.join(vendor, 'layout.json'), 'utf8'))
  const layoutEntry = layout.content.find((entry) => entry.path === gaugeRelative)
  assert.equal(layoutEntry.size, Buffer.byteLength('var LOCALIZED = 2;'))
  assert.equal(installation.files.filter((file) => file.relativePath === 'html_ui/Pages/VCockpit/Instruments/C919X/zh/v1-only.js').length, 0)

  await fs.rm(root, { recursive: true, force: true })
})

test('translateWriteError converts protected-location EPERM into actionable Chinese guidance', async () => {
  const { translateWriteError } = require('../electron/patch-installer')
  const path = require('node:path')
  const destination = path.join('C:\Program Files (x86)', 'Addon Manager', 'couatl', 'GSX', 'res', 'btn.png')
  const perm = Object.assign(new Error("EPERM: operation not permitted, copyfile 'a' -> 'b'"), { code: 'EPERM' })
  const translated = translateWriteError(perm, destination)
  assert.match(translated.message, /以管理员身份运行/)
  assert.match(translated.message, /目标目录受 Windows 系统保护/)
  assert.ok(translated.message.includes('btn.png'), '应包含目标路径')
  assert.match(translated.message, /（EPERM）/, '保留原始错误码')
  const access = Object.assign(new Error('EACCES'), { code: 'EACCES' })
  assert.match(translateWriteError(access, destination).message, /以管理员身份运行/)
  const busy = Object.assign(new Error('EBUSY resource busy'), { code: 'EBUSY' })
  assert.equal(translateWriteError(busy, destination), busy, '非权限错误应原样透传')
})
