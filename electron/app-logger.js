const fsp = require('node:fs/promises')
const path = require('node:path')

const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_KEEP_BYTES = 128 * 1024

function formatLocalTimestamp(date) {
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/**
 * 运行日志（主进程）：单一持久文件，跨启动追加累计；文件超过 maxBytes（默认 256KB）
 * 时裁剪只保留末尾 keepBytes（默认 128KB），即"删除最早的日志"。所有写入经串行
 * 队列保证顺序；任何失败都静默降级，绝不影响主流程。
 * （模式参考 DLSS5 项目的 AppLog：反馈提交时附带日志尾部。）
 */
class AppLogger {
  constructor({ filePath, maxBytes = DEFAULT_MAX_BYTES, keepBytes = DEFAULT_KEEP_BYTES, now = () => new Date() } = {}) {
    if (!filePath) throw new Error('AppLogger 需要 filePath')
    this.filePath = filePath
    this.maxBytes = maxBytes
    this.keepBytes = Math.min(keepBytes, maxBytes)
    this.now = now
    this.size = 0
    this.ready = false
    this.queue = Promise.resolve()
  }

  async init({ header = '' } = {}) {
    try {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true })
      const stats = await fsp.stat(this.filePath).catch(() => null)
      this.size = stats?.isFile() ? stats.size : 0
      await this.trimIfNeeded()
      // 试写会话头：路径不可写（被目录占用/权限不足）时在此失败，静默降级为不可用
      await this.append(header || '—— session started ——')
      this.ready = true
    } catch {
      this.ready = false
    }
    return this.ready
  }

  timestamp() {
    return formatLocalTimestamp(this.now())
  }

  line(level, component, message) {
    if (!this.ready) return
    const text = String(message ?? '')
    const flat = text.includes('\n') ? text.replace(/\r?\n\s*/g, ' ⏎ ') : text
    this.write(`[${level}] [${component}] ${flat}`)
  }

  write(text) {
    if (!this.ready) return
    this.queue = this.queue
      .then(() => this.append(text))
      .catch(() => { /* 日志失败静默 */ })
    return this.queue
  }

  // 等待排队中的日志全部落盘（测试与"提交反馈前"使用）
  flush() {
    return this.queue
  }

  async append(text) {
    const stamped = `${this.timestamp()} ${text}\n`
    await fsp.appendFile(this.filePath, stamped, 'utf8')
    this.size += Buffer.byteLength(stamped, 'utf8')
    if (this.size > this.maxBytes) await this.trimIfNeeded()
  }

  // 超限时"删除最早的日志"：整文件只保留末尾 keepBytes，并丢弃首行残缺片段
  async trimIfNeeded() {
    if (this.size <= this.maxBytes) return
    try {
      const keep = Math.min(this.keepBytes, this.size)
      const handle = await fsp.open(this.filePath, 'r')
      let tail
      try {
        const buffer = Buffer.alloc(keep)
        const { bytesRead } = await handle.read(buffer, 0, keep, this.size - keep)
        tail = buffer.toString('utf8', 0, bytesRead)
      } finally {
        await handle.close()
      }
      const firstNewline = tail.indexOf('\n')
      if (firstNewline >= 0) tail = tail.slice(firstNewline + 1)
      tail = `[LOG TRIMMED] 最早的日志已按 256KB 上限淘汰\n${tail}`
      await fsp.writeFile(this.filePath, tail, 'utf8')
      this.size = Buffer.byteLength(tail, 'utf8')
    } catch {
      // 裁剪失败不影响使用
    }
  }

  // 读取日志尾部（≤maxBytes），丢弃开头残缺行；用于反馈提交时附带。失败返回空串。
  async readTail(maxBytes = DEFAULT_MAX_BYTES) {
    try {
      const stats = await fsp.stat(this.filePath).catch(() => null)
      if (!stats?.isFile() || stats.size === 0) return ''
      const length = Math.min(stats.size, maxBytes)
      const handle = await fsp.open(this.filePath, 'r')
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
}

// 把主进程 console 的输出镜像进日志文件（保留原有行为）；返回还原函数。
function mirrorConsoleToLogger(logger, util = require('node:util')) {
  const original = {}
  const levels = [['log', 'INFO'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]
  for (const [method, level] of levels) {
    original[method] = console[method]
    console[method] = (...args) => {
      try {
        original[method](...args)
        const message = args.map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { depth: 2 }))).join(' ')
        logger.line(level, 'console', message)
      } catch {
        // 镜像失败不影响原输出
      }
    }
  }
  return () => {
    for (const [method, restore] of Object.entries(original)) console[method] = restore
  }
}

module.exports = {
  AppLogger,
  DEFAULT_MAX_BYTES,
  DEFAULT_KEEP_BYTES,
  mirrorConsoleToLogger
}
