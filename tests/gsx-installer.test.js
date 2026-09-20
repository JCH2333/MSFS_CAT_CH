const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createGsxInstaller, parseSerialNumber, PRODUCT_PACKAGE_FOLDERS } = require('../electron/gsx-installer')

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
  assert.deepEqual(await installer.detectActivation(), { activated: true, serialPresent: true })

  const inactive = createGsxInstaller({ registryReader: registryReaderStub(null) })
  assert.deepEqual(await inactive.detectActivation(), { activated: false, serialPresent: false })
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
  assert.deepEqual(result, { activated: false, timedOut: true })
})
