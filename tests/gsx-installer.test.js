const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createGsxInstaller, parseSerialNumber, PRODUCT_PACKAGE_FOLDERS, LICENSE_WIZARD_SETTINGS_NAME } = require('../electron/gsx-installer')

const execFileAsync = promisify(execFile)

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function registryReaderStub(serial) {
  return async () => {
    if (!serial) return { present: false, stdout: '' }
    return {
      present: true,
      stdout: `HKEY_CURRENT_USER\\Software\\Fsdreamteam\r\n    SerialNumber    REG_SZ    ${serial}`
    }
  }
}

test('parseSerialNumber extracts the key from reg query output', () => {
  const stdout = 'HKEY_CURRENT_USER\\Software\\Fsdreamteam\r\n    SerialNumber    REG_SZ    AIKD3-B0G00'
  assert.equal(parseSerialNumber(stdout), 'AIKD3-B0G00')
  assert.equal(parseSerialNumber(''), null)
  assert.equal(parseSerialNumber('SerialNumber    REG_SZ    '), null)
})

test('detectActivation reflects the registry record without network access', async () => {
  const installer = createGsxInstaller({ registryReader: registryReaderStub('AIKD3-B0G00') })
  assert.deepEqual(await installer.detectActivation(), { activated: true, serialPresent: true, serial: 'AIKD3-B0G00' })

  const inactive = createGsxInstaller({ registryReader: registryReaderStub(null) })
  assert.deepEqual(await inactive.detectActivation(), { activated: false, serialPresent: false, serial: null })
})

test('detectInfrastructure finds the addon root hosting the official updater', async () => {
  const root = await temporaryDirectory('gsx-installer-infra-')
  await fs.writeFile(path.join(root, 'Couatl_Updater.exe'), 'stub')
  const other = await temporaryDirectory('gsx-installer-empty-')

  const withInfra = createGsxInstaller({
    rootLister: async () => [
      { rootPath: other, source: 'empty' },
      { rootPath: root, source: 'registry' }
    ]
  })
  const infra = await withInfra.detectInfrastructure()
  assert.equal(infra.present, true)
  assert.equal(infra.addonRoot, path.resolve(root))

  const withoutInfra = createGsxInstaller({ rootLister: async () => [{ rootPath: other, source: 'empty' }] })
  assert.equal((await withoutInfra.detectInfrastructure()).present, false)
})

test('detectLifecycle merges infrastructure, activation and product states', async () => {
  const root = await temporaryDirectory('gsx-installer-life-')
  await fs.writeFile(path.join(root, 'Couatl_Updater.exe'), 'stub')
  const installer = createGsxInstaller({
    registryReader: registryReaderStub('AIKD3-B0G00'),
    rootLister: async () => [{ rootPath: root, source: 'registry' }]
  })
  const lifecycle = await installer.detectLifecycle(async () => ({
    installed: true,
    addonRoot: root,
    packagePath: path.join(root, 'MSFS', 'fsdreamteam-gsx-pro'),
    version: '4.0.23',
    source: 'registry'
  }))
  assert.equal(lifecycle.infrastructure.present, true)
  assert.equal(lifecycle.activation.activated, true)
  assert.equal(lifecycle.product.installed, true)
})

test('uninstallProduct removes only the product scope and keeps engine and caches', async () => {
  const addonRoot = await temporaryDirectory('gsx-uninstall-addon-')
  const communityRoot = await temporaryDirectory('gsx-uninstall-community-')
  const community = path.join(communityRoot, 'Community')

  // 产品的 MSFS 真身
  for (const folder of PRODUCT_PACKAGE_FOLDERS) {
    await fs.mkdir(path.join(addonRoot, 'MSFS', folder), { recursive: true })
    await fs.writeFile(path.join(addonRoot, 'MSFS', folder, 'marker.txt'), 'x')
  }
  // 卸载必须保留的内容
  await fs.mkdir(path.join(addonRoot, 'couatl', 'GSX', 'res'), { recursive: true })
  await fs.writeFile(path.join(addonRoot, 'couatl', 'GSX', 'res', 'keep.png'), '官方资源')
  await fs.mkdir(path.join(addonRoot, 'PackagesCache'), { recursive: true })
  await fs.writeFile(path.join(addonRoot, 'PackagesCache', 'GSX.zip'), '缓存')
  await fs.mkdir(path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-efb'), { recursive: true })
  await fs.writeFile(path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-efb', 'keep.txt'), '独立产品')

  // 社区目录链接：优先 junction（与官方一致），失败时退化为真实目录
  const linkTargets = {}
  for (const folder of PRODUCT_PACKAGE_FOLDERS) {
    const linkPath = path.join(community, folder)
    await fs.mkdir(path.dirname(linkPath), { recursive: true })
    try {
      await execFileAsync('cmd.exe', ['/c', 'mklink', '/J', linkPath, path.join(addonRoot, 'MSFS', folder)], { windowsHide: true })
      linkTargets[folder] = 'junction'
    } catch {
      await fs.mkdir(linkPath, { recursive: true })
      await fs.writeFile(path.join(linkPath, 'copy.txt'), 'copy')
      linkTargets[folder] = 'directory'
    }
  }

  const installer = createGsxInstaller({
    processLister: async () => '',
    launcher: async () => { throw new Error('测试中不应启动 GUI') }
  })
  const result = await installer.uninstallProduct({
    addonRoot,
    communityDirectories: [communityRoot, path.join(communityRoot, 'Community2024'), community]
  })

  assert.equal(result.removedPackages.length, PRODUCT_PACKAGE_FOLDERS.length, 'MSFS 真身应被移除')
  for (const folder of PRODUCT_PACKAGE_FOLDERS) {
    assert.equal(fsSync.existsSync(path.join(addonRoot, 'MSFS', folder)), false, `真身 ${folder} 应被删除`)
    assert.equal(fsSync.existsSync(path.join(community, folder)), false, `社区链接 ${folder} 应被移除`)
  }
  assert.equal(fsSync.existsSync(path.join(addonRoot, 'couatl', 'GSX', 'res', 'keep.png')), true, '引擎目录必须保留')
  assert.equal(fsSync.existsSync(path.join(addonRoot, 'PackagesCache', 'GSX.zip')), true, '缓存必须保留')
  assert.equal(fsSync.existsSync(path.join(addonRoot, 'MSFS', 'fsdreamteam-gsx-efb')), true, 'GSX EFB 属独立产品，不得移除')
})

test('uninstallProduct refuses to run while the simulator is open', async () => {
  const installer = createGsxInstaller({ processLister: async () => '"FlightSimulator2024.exe","123"' })
  await assert.rejects(
    () => installer.uninstallProduct({ addonRoot: 'F:/nowhere', communityDirectories: [] }),
    /模拟器或 GSX 引擎正在运行/
  )
})

test('pollForActivation resolves once the serial appears', async () => {
  let serial = null
  let calls = 0
  const installer = createGsxInstaller({
    registryReader: async () => {
      calls += 1
      if (calls >= 3) serial = 'NEW-KEY'
      return serial
        ? { present: true, stdout: `SerialNumber    REG_SZ    ${serial}` }
        : { present: false, stdout: '' }
    },
    sleep: async () => {},
    pollIntervalMs: 1,
    pollTimeoutMs: 5000
  })
  const result = await installer.pollForActivation({ baselineSerial: null })
  assert.equal(result.activated, true)
  assert.equal(result.timedOut, false)
})

test('pollForActivation times out when the serial never appears', async () => {
  const installer = createGsxInstaller({
    registryReader: registryReaderStub(null),
    sleep: async () => {},
    pollIntervalMs: 1,
    pollTimeoutMs: 30
  })
  const result = await installer.pollForActivation({ baselineSerial: null })
  assert.deepEqual(result, { activated: false, timedOut: true, wizardClosed: false })
})

test('launchLicenseWizard passes the official GSX Pro settings file', async () => {
  const addonRoot = await temporaryDirectory('gsx-installer-qlm-')
  await fs.writeFile(path.join(addonRoot, 'QlmLicenseWizard.exe'), 'stub')
  await fs.writeFile(path.join(addonRoot, LICENSE_WIZARD_SETTINGS_NAME), '<licensewizard ProductName="GSX Pro" />')
  let invoked = null
  const installer = createGsxInstaller({
    launcher: async (exePath, args, workingDirectory) => {
      invoked = { exePath, args, workingDirectory }
      return 4321
    }
  })
  await installer.launchLicenseWizard({ addonRoot })
  assert.equal(path.basename(invoked.exePath), 'QlmLicenseWizard.exe')
  assert.deepEqual(invoked.args, ['/settings', path.join(addonRoot, LICENSE_WIZARD_SETTINGS_NAME)])
  assert.equal(invoked.workingDirectory, addonRoot)
})

test('launchLicenseWizard scans *.lw.xml by ProductName when the known file is absent', async () => {
  const addonRoot = await temporaryDirectory('gsx-installer-qlm-scan-')
  await fs.writeFile(path.join(addonRoot, 'QlmLicenseWizard.exe'), 'stub')
  await fs.writeFile(path.join(addonRoot, 'Legacy.lw.xml'), '<licensewizard ProductName="GSX" />')
  const expected = path.join(addonRoot, 'Renamed GSX Pro.lw.xml')
  await fs.writeFile(expected, '<licensewizard ProductName="GSX Pro" />')
  let invoked = null
  const installer = createGsxInstaller({
    launcher: async (exePath, args) => {
      invoked = { exePath, args }
      return 1
    }
  })
  await installer.launchLicenseWizard({ addonRoot })
  assert.deepEqual(invoked.args, ['/settings', expected])
})

test('launchLicenseWizard refuses to start without a settings file', async () => {
  const addonRoot = await temporaryDirectory('gsx-installer-qlm-empty-')
  await fs.writeFile(path.join(addonRoot, 'QlmLicenseWizard.exe'), 'stub')
  const installer = createGsxInstaller({
    launcher: async () => { throw new Error('测试中不应启动 GUI') }
  })
  await assert.rejects(
    () => installer.launchLicenseWizard({ addonRoot }),
    /产品设置文件/
  )
})

test('pollForActivation returns after the close grace once the wizard window closes', async () => {
  let serial = null
  let wizardAlive = true
  let processChecks = 0
  const installer = createGsxInstaller({
    registryReader: async () => (serial
      ? { present: true, stdout: `SerialNumber    REG_SZ    ${serial}` }
      : { present: false, stdout: '' }),
    processExists: async () => {
      processChecks += 1
      if (processChecks >= 3) wizardAlive = false
      return wizardAlive
    },
    sleep: async () => {},
    pollIntervalMs: 1,
    pollTimeoutMs: 60000,
    closeGraceMs: 1
  })
  // 向导关闭且宽限期内始终无激活记录：返回 wizardClosed，而不是等满超时
  const result = await installer.pollForActivation({ baselineSerial: null, watchPid: 4321 })
  assert.deepEqual(result, { activated: false, timedOut: false, wizardClosed: true })
  assert.equal(processChecks, 3)
})

test('pollForActivation keeps waiting while the wizard window is open', async () => {
  let serial = null
  const installer = createGsxInstaller({
    registryReader: async () => (serial
      ? { present: true, stdout: `SerialNumber    REG_SZ    ${serial}` }
      : { present: false, stdout: '' }),
    processExists: async () => serial === null,
    sleep: async () => { serial = 'LATE-KEY' },
    pollIntervalMs: 1,
    pollTimeoutMs: 60000
  })
  const result = await installer.pollForActivation({ baselineSerial: null, watchPid: 4321 })
  assert.deepEqual(result, { activated: true, timedOut: false, wizardClosed: false })
})

function scriptedReader(responses) {
  let index = 0
  return async () => {
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return response
  }
}

const EMPTY_READ = { present: false, stdout: '' }
const serialRead = (serial) => ({ present: true, stdout: `    SerialNumber    REG_SZ    ${serial}` })

test('detectActivation accepts the new Universal Installer HKLM location first', async () => {
  const installer = createGsxInstaller({
    registryReader: scriptedReader([serialRead('NEW-KEY'), EMPTY_READ])
  })
  assert.deepEqual(await installer.detectActivation(), { activated: true, serialPresent: true, serial: 'NEW-KEY' })
})

test('detectActivation falls back to the legacy HKCU location', async () => {
  const installer = createGsxInstaller({
    registryReader: scriptedReader([EMPTY_READ, EMPTY_READ, EMPTY_READ, serialRead('LEGACY-KEY')])
  })
  assert.deepEqual(await installer.detectActivation(), { activated: true, serialPresent: true, serial: 'LEGACY-KEY' })
})

test('pollForActivation recognizes re-activation with the same key after deactivation', async () => {
  // 激活记录先清空（停用）再恢复（同码重激）：经过“无记录”状态后同码也算新激活
  let serial = 'SAME-KEY'
  let phase = 0
  const installer = createGsxInstaller({
    registryReader: async () => (serial
      ? { present: true, stdout: `    SerialNumber    REG_SZ    ${serial}` }
      : { present: false, stdout: '' }),
    sleep: async () => {
      phase += 1
      if (phase === 1) serial = null
      else if (phase === 3) serial = 'SAME-KEY'
    },
    pollIntervalMs: 1,
    pollTimeoutMs: 60000
  })
  const result = await installer.pollForActivation({ baselineSerial: 'SAME-KEY' })
  assert.deepEqual(result, { activated: true, timedOut: false, wizardClosed: false })
})

test('pollForActivation keeps checking during the close grace and accepts a late record', async () => {
  // 实测案例：向导关闭 21 秒后官方下载器才把激活记录补写进注册表
  let wizardAlive = true
  let serial = null
  let sleeps = 0
  const installer = createGsxInstaller({
    registryReader: async () => (serial
      ? { present: true, stdout: '    SerialNumber    REG_SZ    LATE-KEY' }
      : { present: false, stdout: '' }),
    processExists: async () => wizardAlive,
    sleep: async () => {
      sleeps += 1
      if (sleeps === 2) wizardAlive = false
      if (sleeps === 4) serial = 'LATE-KEY'
    },
    pollIntervalMs: 1,
    pollTimeoutMs: 60000,
    closeGraceMs: 60000
  })
  const result = await installer.pollForActivation({ baselineSerial: null, watchPid: 4321 })
  assert.deepEqual(result, { activated: true, timedOut: false, wizardClosed: true })
})

test('pollForActivation reports failure only after the close grace expires', async () => {
  const installer = createGsxInstaller({
    registryReader: registryReaderStub(null),
    processExists: async () => false,
    sleep: async () => {},
    pollIntervalMs: 1,
    closeGraceMs: 5
  })
  const result = await installer.pollForActivation({ baselineSerial: null, watchPid: 4321 })
  assert.deepEqual(result, { activated: false, timedOut: false, wizardClosed: true })
})
