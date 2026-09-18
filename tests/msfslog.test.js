const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createMsfsLogBridge } = require('../electron/msfslog')

function fakeExec(script) {
  const calls = []
  const execImpl = (exe, args, options, callback) => {
    calls.push({ exe, args })
    const output = script(args, calls.length)
    setImmediate(() => callback(null, output, ''))
  }
  return { calls, execImpl }
}

test('status parses the structured json output', async () => {
  const { execImpl } = fakeExec(() => JSON.stringify({
    daemon_alive: true, game_alive: false, version: '0.2.0', last_status: { lines: 42, crashed: false }
  }))
  const bridge = createMsfsLogBridge({ exePath: 'msfslog.exe', execImpl })
  const status = await bridge.status()
  assert.equal(status.ok, true)
  assert.equal(status.daemon_alive, true)
  assert.equal(status.last_status.lines, 42)
})

test('setEnabled derives the daemon and stop ends it', async () => {
  let daemonAlive = false
  const calls = { starts: 0, stops: 0 }
  const execImpl = (exe, args, options, callback) => {
    if (args[0] === 'stop') daemonAlive = false
    setImmediate(() => callback(null, JSON.stringify({ daemon_alive: daemonAlive, game_alive: false }), ''))
  }
  const spawnImpl = (exe, args, options) => {
    calls.starts += 1
    daemonAlive = true
    return { on: () => {}, unref: () => {} }
  }
  const bridge = createMsfsLogBridge({ exePath: 'msfslog.exe', execImpl, spawnImpl })

  const started = await bridge.setEnabled(true)
  assert.equal(started.daemon_alive, true)
  assert.equal(calls.starts, 1)

  const stopped = await bridge.setEnabled(false)
  assert.equal(stopped.daemon_alive, false)
})

test('latestFiles picks the newest session, crash and summary by mtime', async () => {
  const root = await temporaryDirectoryAppLog()
  await fs.mkdir(root, { recursive: true })
  const write = async (name, msOffset) => {
    const full = path.join(root, name)
    await fs.writeFile(full, name)
    const now = Date.now()
    await fs.utimes(full, new Date(now - 10000 + msOffset), new Date(now - 10000 + msOffset))
  }
  await write('session-20260919-060001.log', 0)
  await write('session-20260919-070002.log', 5000)
  await write('crash-20260919-070003.txt', 6000)
  await write('summary-20260919-070002.json', 5500)
  await write('unrelated.txt', 9000)

  const bridge = createMsfsLogBridge({ exePath: 'msfslog.exe', execImpl: async () => '', logsDir: root })
  const latest = await bridge.latestFiles()
  assert.equal(path.basename(latest.session.path), 'session-20260919-070002.log')
  assert.equal(path.basename(latest.crash.path), 'crash-20260919-070003.txt')
  assert.equal(path.basename(latest.summary.path), 'summary-20260919-070002.json')
})

test('readTextTail reads the file tail without broken leading lines', async () => {
  const root = await temporaryDirectoryAppLog()
  const file = path.join(root, 'session.log')
  const big = Array.from({ length: 500 }, (_, i) => `第 ${i} 行日志内容 0123456789`).join('\n')
  await fs.writeFile(file, big, 'utf8')
  const bridge = createMsfsLogBridge({ exePath: 'msfslog.exe', execImpl: async () => '', logsDir: root })
  const tail = await bridge.readTextTail(file, 512)
  assert.ok(tail.length <= 512 + 80, `尾部长度应受控，实际 ${tail.length}`)
  // 起始残缺行已被丢弃：不允许出现 UTF-8 断字符，末行完整
  assert.ok(!tail.includes('\uFFFD'), '不得出现 UTF-8 断字符')
  assert.match(tail, /第 49\d 行日志内容 0123456789$/)
})

async function temporaryDirectoryAppLog() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'msfslog-bridge-'))
}
