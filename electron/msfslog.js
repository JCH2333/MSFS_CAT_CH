const { execFile, spawn } = require('node:child_process')
const fsp = require('node:fs/promises')
const path = require('node:path')

const DEFAULT_LOGS_DIR = path.join(process.env.LOCALAPPDATA || '', 'msfslog', 'logs')
const DEFAULT_TIMEOUT_MS = 8000

/**
 * msfslog（MSFS 2024 日志记录工具）客户端桥。
 *
 * 该工具为独立 exe：`start` 在调用进程内常驻为守护（需 detached + unref 派生，
 * 与软件生命周期解耦）；`stop` 通过 PID 文件结束守护；`status --json` 输出
 * 守护/游戏状态与最近会话统计。日志目录 %LOCALAPPDATA%\msfslog\logs\ 下有
 * session-*.log（会话）、crash-*.txt（崩溃档案）、summary-*.json（结构化摘要）。
 */
function createMsfsLogBridge({
  exePath,
  logsDir = DEFAULT_LOGS_DIR,
  execImpl = execFile,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!exePath) throw new Error('msfslog 桥需要 exePath')

  function run(args, { timeout = timeoutMs } = {}) {
    return new Promise((resolve) => {
      execImpl(exePath, args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        // start 在"守护已在运行"时返回非零，属正常情况，交由调用方结合 status 判断
        resolve({ code: error && typeof error.code === 'number' ? error.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') })
      })
    })
  }

  async function status() {
    const result = await run(['status', '--json'])
    try {
      return { ok: true, ...JSON.parse(result.stdout) }
    } catch {
      return { ok: false, daemon_alive: false, game_alive: false, error: result.stderr || 'status 输出不可解析' }
    }
  }

  // 派生 detached 守护：与软件生命周期解耦（用户关闭软件记录也可继续，
  // 与"开启后需保持软件本体在后台运行"的提示口径一致地允许后台常驻）
  async function start() {
    const child = spawnImpl(exePath, ['start'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    // 派生失败（exe 缺失等）由下方状态轮询如实反映，这里只吞掉错误事件
    child.on('error', () => {})
    child.unref()
    // 轮询确认守护拉起（start 的单例检查会在已有守护时直接退出，同样视为已开启）
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      const state = await status()
      if (state.daemon_alive) return state
    }
    return status()
  }

  async function stop() {
    await run(['stop'])
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      const state = await status()
      if (!state.daemon_alive) return state
    }
    return status()
  }

  async function setEnabled(enabled) {
    return enabled ? start() : stop()
  }

  // 日志目录里最新的会话日志 / 崩溃档案 / 结构化摘要（按修改时间）
  async function latestFiles() {
    const result = { session: null, crash: null, summary: null }
    let entries
    try {
      entries = await fsp.readdir(logsDir)
    } catch {
      return result
    }
    const newest = async (prefix) => {
      let best = null
      for (const name of entries) {
        if (!name.startsWith(prefix)) continue
        const full = path.join(logsDir, name)
        const stats = await fsp.stat(full).catch(() => null)
        if (!stats?.isFile()) continue
        if (!best || stats.mtimeMs > best.mtimeMs) best = { path: full, name, mtimeMs: stats.mtimeMs }
      }
      return best
    }
    result.session = await newest('session-')
    result.crash = await newest('crash-')
    result.summary = await newest('summary-')
    return result
  }

  // 读取文本文件尾部（≤maxBytes），丢弃开头残缺行
  async function readTextTail(file, maxBytes = 192 * 1024) {
    if (!file) return ''
    try {
      const stats = await fsp.stat(file).catch(() => null)
      if (!stats?.isFile() || stats.size === 0) return ''
      const length = Math.min(stats.size, maxBytes)
      const handle = await fsp.open(file, 'r')
      try {
        const buffer = Buffer.alloc(length)
        const start = stats.size - length
        const { bytesRead } = await handle.read(buffer, 0, length, start)
        let text = buffer.toString('utf8', 0, bytesRead)
        if (start > 0) {
          const firstNewline = text.indexOf('\n')
          if (firstNewline >= 0) text = text.slice(firstNewline + 1)
        }
        return text
      } finally {
        await handle.close()
      }
    } catch {
      return ''
    }
  }

  return { exePath, logsDir, run, status, start, stop, setEnabled, latestFiles, readTextTail }
}

module.exports = { DEFAULT_LOGS_DIR, createMsfsLogBridge }
