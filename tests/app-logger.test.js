const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { AppLogger, DEFAULT_MAX_BYTES } = require('../electron/app-logger')

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('appends across sessions, mirrors console output and caps the file at 256KB', async () => {
  const root = await temporaryDirectory('app-logger-')
  const filePath = path.join(root, 'MSFS_CAT_CH.log')
  const logger = new AppLogger({ filePath })

  assert.equal(await logger.init({ header: '===== session 1 =====' }), true)
  logger.line('INFO', 'app', '启动完成')
  logger.line('ERROR', 'patch', '多行消息\n第二行')
  await logger.readTail(1)

  // 第二次 init 模拟再次打开应用：同一文件继续累计
  const second = new AppLogger({ filePath })
  await second.init({ header: '===== session 2 =====' })
  second.line('INFO', 'catalog', '同步完成：source=server patches=5')

  const text = await fs.readFile(filePath, 'utf8')
  assert.match(text, /===== session 1 =====/)
  assert.match(text, /===== session 2 =====/)
  assert.match(text, /\[INFO\] \[app\] 启动完成/)
  // 多行内容折叠为单行，不破坏日志逐行结构
  assert.doesNotMatch(text, /\[ERROR\] \[patch\] 多行消息\n第二行/)

  // 超过 256KB 上限：最早的日志被淘汰，保留尾部
  for (let i = 0; i < 3000; i += 1) {
    second.line('INFO', 'filler', `填充日志行 ${i} —— 012345678901234567890123456789012345678901234567890123456789`)
  }
  await second.flush()
  const stats = await fs.stat(filePath)
  assert.ok(stats.size <= DEFAULT_MAX_BYTES + 4096, `文件应不超过 256KB（+行缓冲），实际 ${stats.size}`)
  const trimmed = await fs.readFile(filePath, 'utf8')
  assert.match(trimmed, /\[LOG TRIMMED\]/)
  // 读取尾部接口
  const tail = await second.readTail(512)
  assert.ok(tail.length > 0 && tail.length <= 512 + 64)
})

test('readTail and logging degrade silently when the log file is unavailable', async () => {
  const root = await temporaryDirectory('app-logger-broken-')
  const logger = new AppLogger({ filePath: path.join(root, 'missing-dir', 'sub', 'app.log') })
  // 目录可创建：先验证正常路径
  assert.equal(await logger.init({}), true)
  logger.line('INFO', 'app', '正常写入')
  await logger.flush()
  assert.match(await logger.readTail(1024), /正常写入/)

  // 文件路径被目录占用（打开失败）时静默降级为不可用
  const blocked = new AppLogger({ filePath: path.join(root, 'app.log') })
  await fs.mkdir(path.join(root, 'app.log'), { recursive: true })
  assert.equal(await blocked.init({}), false, '文件路径为目录时静默降级为不可用')
  blocked.line('INFO', 'app', '不应抛异常')
  assert.equal(await blocked.readTail(10), '')
})
