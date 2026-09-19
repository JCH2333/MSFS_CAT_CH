<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ExternalLink, FileText, FolderOpen, LoaderCircle, Play, RefreshCw, Square, TriangleAlert
} from '@lucide/vue'

// msfslog 日志工具桥（主进程 IPC）；开发环境无桥时给出空实现避免报错
const bridge = window.gsxTool || {
  msfslog: {
    status: async () => ({ ok: false, daemon_alive: false, game_alive: false }),
    setRecording: async () => ({ daemon_alive: false, game_alive: false }),
    latest: async () => ({ kind: '', path: '', name: '', content: '', summary: null }),
    readAppLog: async () => ({ path: '', content: '' }),
    open: async () => ({ ok: false })
  }
}

const status = ref(null)
const statusError = ref('')
const toggling = ref(false)
const gameLog = reactive({ loading: false, path: '', name: '', kind: '', content: '', summary: null })
const appLog = reactive({ loading: false, path: '', content: '' })

const recording = computed(() => Boolean(status.value?.daemon_alive))
const gameRunning = computed(() => Boolean(status.value?.game_alive))
const lastStatus = computed(() => status.value?.last_status || null)

async function refreshStatus() {
  try {
    status.value = await bridge.msfslog.status()
    statusError.value = status.value?.ok ? '' : '记录工具状态不可用'
  } catch {
    statusError.value = '无法获取记录状态'
  }
}

// 开关：开启=派生日志守护（软件需保持在后台运行）；关闭=结束守护
async function toggleRecording() {
  if (toggling.value) return
  toggling.value = true
  statusError.value = ''
  try {
    status.value = await bridge.msfslog.setRecording(!recording.value)
  } catch {
    statusError.value = '切换失败，请重试'
  } finally {
    toggling.value = false
  }
}

async function refreshGameLog() {
  gameLog.loading = true
  try {
    Object.assign(gameLog, { path: '', name: '', kind: '', content: '', summary: null })
    const result = await bridge.msfslog.latest()
    gameLog.path = result.path || ''
    gameLog.name = result.name || ''
    gameLog.kind = result.kind || ''
    gameLog.content = result.content || ''
    gameLog.summary = result.summary || null
  } catch {
    gameLog.content = '读取失败，请重试。'
  } finally {
    gameLog.loading = false
  }
}

async function refreshAppLog() {
  appLog.loading = true
  try {
    const result = await bridge.msfslog.readAppLog()
    appLog.path = result.path || ''
    appLog.content = result.content || ''
  } catch {
    appLog.content = '读取失败，请重试。'
  } finally {
    appLog.loading = false
  }
}

async function openLog(kind) {
  try { await bridge.msfslog.open(kind) } catch { /* 打开失败静默 */ }
}

const crashDetected = computed(() => {
  if (gameLog.kind === 'crash') return true
  return Boolean(gameLog.summary?.crashed || lastStatus.value?.crashed)
})
const summaryStats = computed(() => {
  const s = gameLog.summary
  if (!s) return null
  return {
    duration: s.duration_sec ? `${Math.floor(s.duration_sec / 60)} 分 ${s.duration_sec % 60} 秒` : '—',
    lines: s.lines ?? 0,
    warnings: s.warnings ?? 0,
    errors: s.errors ?? 0,
    clusters: Array.isArray(s.clusters) ? s.clusters : [],
    knownIssues: Array.isArray(s.known_issues) ? s.known_issues : []
  }
})

onMounted(() => {
  void refreshStatus()
  void refreshGameLog()
  void refreshAppLog()
})
</script>

<template>
  <section class="view-shell logs-shell">
    <header class="view-header">
      <div>
        <p class="eyebrow">GAME LOGS</p>
        <h1>日志</h1>
        <p class="logs-subtitle">记录《微软模拟飞行 2024》的运行日志与崩溃档案，帮助定位问题。</p>
      </div>
      <div class="header-actions">
        <span class="logs-chip" :class="recording ? 'is-on' : 'is-off'">
          <span class="logs-dot" :class="{ on: recording }" />{{ recording ? '记录中' : '未开启' }}
        </span>
        <span class="logs-chip" :class="{ 'is-on': gameRunning }">
          {{ gameRunning ? '游戏运行中' : '游戏未运行' }}
        </span>
      </div>
    </header>

    <!-- 记录开关 -->
    <section class="logs-card">
      <label class="recording-row">
        <input
          type="checkbox"
          class="recording-switch"
          :checked="recording"
          :disabled="toggling"
          @change="toggleRecording"
        />
        <span class="recording-text">
          <strong>记录游戏日志</strong>
          <small>开启后需保持软件本体在后台运行；进入游戏即自动持续记录日志信息，游戏崩溃时会生成崩溃档案。</small>
        </span>
        <LoaderCircle v-if="toggling" :size="18" class="spin" />
      </label>
      <p v-if="statusError" class="logs-error"><TriangleAlert :size="13" /> {{ statusError }}</p>
    </section>

    <!-- 最近生成的游戏日志 -->
    <section class="logs-card">
      <div class="logs-card-head">
        <div class="logs-card-title">
          <FileText :size="15" />
          <strong>最近生成的游戏日志</strong>
          <code v-if="gameLog.name" class="logs-file-name">{{ gameLog.name }}</code>
        </div>
        <div class="logs-actions">
          <button class="logs-button" type="button" :disabled="gameLog.loading" @click="refreshGameLog">
            <RefreshCw :size="13" /> 刷新
          </button>
          <button class="logs-button" type="button" :disabled="!gameLog.path" @click="openLog('game')">
            <ExternalLink :size="13" /> 打开文件
          </button>
          <button class="logs-button" type="button" @click="openLog('folder')">
            <FolderOpen :size="13" /> 日志文件夹
          </button>
        </div>
      </div>

      <div v-if="crashDetected" class="logs-crash-banner">
        <TriangleAlert :size="14" />
        检测到游戏崩溃，已生成崩溃档案（会话日志尾部 + 游戏 Console 转档 + 崩溃报告）。
      </div>

      <div v-if="summaryStats" class="logs-summary">
        <div class="logs-stat">
          <span class="logs-stat-label">会话时长</span>
          <span class="logs-stat-value">{{ summaryStats.duration }}</span>
        </div>
        <div class="logs-stat">
          <span class="logs-stat-label">日志行</span>
          <span class="logs-stat-value">{{ summaryStats.lines }}</span>
        </div>
        <div class="logs-stat">
          <span class="logs-stat-label">警告</span>
          <span class="logs-stat-value" :class="{ 'is-warn': summaryStats.warnings > 0 }">{{ summaryStats.warnings }}</span>
        </div>
        <div class="logs-stat">
          <span class="logs-stat-label">错误</span>
          <span class="logs-stat-value" :class="{ 'is-err': summaryStats.errors > 0 }">{{ summaryStats.errors }}</span>
        </div>
      </div>

      <div v-if="summaryStats?.knownIssues.length" class="logs-issues">
        <p class="logs-subhead">已知问题</p>
        <div v-for="issue in summaryStats.knownIssues" :key="issue.tag" class="logs-issue">
          <b>{{ issue.tag }}</b><span v-if="issue.count">（{{ issue.count }} 次）</span>
          <p v-if="issue.explain">{{ issue.explain }}</p>
          <p v-if="issue.action" class="is-action">建议：{{ issue.action }}</p>
        </div>
      </div>

      <div v-if="summaryStats?.clusters.length" class="logs-clusters">
        <p class="logs-subhead">错误 / 警告聚类</p>
        <div v-for="(cluster, index) in summaryStats.clusters" :key="index" class="logs-cluster">
          <b v-if="cluster.count">{{ cluster.count }} 次</b>
          <code>{{ (cluster.sample || cluster.first || '').slice(0, 180) }}</code>
        </div>
      </div>

      <div v-if="gameLog.loading" class="logs-loading"><LoaderCircle :size="18" class="spin" /> 正在读取…</div>
      <pre v-else class="logs-pre">{{ gameLog.content || '暂无会话日志。开启记录并进入一次游戏后，这里会显示最近生成的日志。' }}</pre>
    </section>

    <!-- 软件本体日志 -->
    <section class="logs-card">
      <div class="logs-card-head">
        <div class="logs-card-title">
          <FileText :size="15" />
          <strong>软件本体日志</strong>
          <code class="logs-file-name">MSFS_CAT_CH.log</code>
        </div>
        <div class="logs-actions">
          <button class="logs-button" type="button" :disabled="appLog.loading" @click="refreshAppLog">
            <RefreshCw :size="13" /> 刷新
          </button>
          <button class="logs-button" type="button" :disabled="!appLog.path" @click="openLog('app')">
            <ExternalLink :size="13" /> 打开文件
          </button>
        </div>
      </div>
      <div v-if="appLog.loading" class="logs-loading"><LoaderCircle :size="18" class="spin" /> 正在读取…</div>
      <pre v-else class="logs-pre">{{ appLog.content || '暂无内容。' }}</pre>
    </section>
  </section>
</template>

<style scoped>
.logs-shell { width: min(1080px, 100%); }
.logs-subtitle { margin: 8px 0 0; color: var(--text-secondary); font-size: 12.5px; }

/* 状态徽章 */
.logs-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  border: 1px solid var(--glass-border); border-radius: 999px;
  background: var(--surface); font-size: 12px; color: var(--text-secondary);
}
.logs-chip.is-on { border-color: rgba(98, 214, 163, 0.32); background: var(--signal-bg); color: var(--signal); }
.logs-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); }
.logs-dot.on { background: var(--signal); box-shadow: 0 0 6px rgba(98, 214, 163, 0.6); }

/* 卡片 */
.logs-card {
  padding: 18px 20px; margin-bottom: 16px;
  border: 1px solid var(--glass-border); border-radius: var(--radius);
  background: var(--surface); backdrop-filter: var(--glass-blur); box-shadow: var(--shadow-soft);
}
.logs-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  margin-bottom: 14px;
}
.logs-card-title { display: inline-flex; align-items: center; gap: 8px; color: var(--text-primary); }
.logs-file-name {
  font-family: ui-monospace, Consolas, monospace; font-size: 11px;
  color: var(--text-secondary); background: rgba(255, 255, 255, 0.04);
  padding: 2px 8px; border-radius: 6px; border: 1px solid var(--glass-border);
}
.logs-actions { display: flex; gap: 8px; }
.logs-button {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
  border: 1px solid var(--glass-border); border-radius: 8px;
  background: rgba(255, 255, 255, 0.04); color: var(--text-primary); font-size: 12px; cursor: pointer;
}
.logs-button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
.logs-button:disabled { opacity: 0.45; cursor: not-allowed; }

/* 记录开关卡片 */
.recording-row { display: flex; align-items: center; gap: 16px; cursor: pointer; }
.recording-switch {
  appearance: none; flex: none; width: 46px; height: 25px; border-radius: 999px; position: relative;
  background: rgba(255, 255, 255, 0.14); border: 1px solid var(--glass-border);
  transition: background 160ms ease; cursor: pointer;
}
.recording-switch:checked { background: var(--signal); border-color: var(--signal); }
.recording-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 19px; height: 19px;
  border-radius: 50%; background: #fff; transition: transform 160ms ease;
}
.recording-switch:checked::after { transform: translateX(21px); }
.recording-text { display: flex; flex-direction: column; gap: 5px; }
.recording-text strong { font-size: 14.5px; }
.recording-text small { color: var(--text-secondary); font-size: 11.5px; line-height: 1.65; }
.logs-error {
  display: flex; align-items: center; gap: 6px; margin: 12px 0 0;
  color: var(--warning); font-size: 12px;
}

/* 崩溃横幅 */
.logs-crash-banner {
  display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 10px 14px;
  border: 1px solid rgba(226, 105, 79, 0.4); border-radius: 8px;
  background: rgba(226, 105, 79, 0.09); color: var(--danger, #e2694f); font-size: 12.5px;
}

/* 会话统计 */
.logs-summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.logs-stat {
  flex: 1; min-width: 130px; display: flex; flex-direction: column; gap: 5px;
  padding: 11px 15px; border: 1px solid var(--glass-border); border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
.logs-stat-label { font-size: 11px; color: var(--text-secondary); }
.logs-stat-value { font: 600 16px/1 "Bahnschrift", "Microsoft YaHei UI", sans-serif; }
.logs-stat-value.is-warn { color: var(--warning); }
.logs-stat-value.is-err { color: var(--danger, #e2694f); }

.logs-subhead { margin: 0 0 8px; font-size: 12.5px; color: var(--text-primary); }
.logs-issues { display: flex; flex-direction: column; gap: 8px; }
.logs-issue {
  padding: 10px 14px; border: 1px solid rgba(227, 178, 83, 0.3); border-radius: 8px;
  background: rgba(227, 178, 83, 0.05); font-size: 12.5px;
}
.logs-issue p { margin: 4px 0 0; color: var(--text-secondary); font-size: 12px; }
.logs-issue .is-action { color: var(--warning); }
.logs-clusters { display: flex; flex-direction: column; gap: 6px; }
.logs-cluster {
  display: flex; gap: 10px; align-items: baseline; padding: 7px 12px;
  border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(255, 255, 255, 0.03);
  font-size: 11.5px;
}
.logs-cluster b { flex: none; color: var(--warning); }
.logs-cluster code { font-family: ui-monospace, Consolas, monospace; word-break: break-all; color: var(--text-secondary); }

/* 日志正文 */
.logs-pre {
  margin: 0; padding: 14px 16px; max-height: 320px; overflow: auto;
  border: 1px solid var(--glass-border); border-radius: 8px;
  background: rgba(0, 0, 0, 0.28); color: var(--text-secondary);
  font: 11.5px/1.65 ui-monospace, Consolas, monospace;
  white-space: pre-wrap; word-break: break-all;
}
.logs-loading { display: flex; align-items: center; gap: 8px; padding: 14px 0 2px; color: var(--text-secondary); font-size: 12.5px; }
.spin { animation: logs-spin 1s linear infinite; }
@keyframes logs-spin { to { transform: rotate(360deg); } }
</style>
