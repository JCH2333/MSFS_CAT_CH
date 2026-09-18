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
    knownIssues: Array.isArray(s.known_issues) ? s.known_issues : [],
    kbHits: Array.isArray(s.kb_hits) ? s.kb_hits : []
  }
})
const sessionFileName = computed(() => gameLog.name || '（暂无会话日志）')

onMounted(() => {
  void refreshStatus()
  void refreshGameLog()
  void refreshAppLog()
})
</script>

<template>
  <section class="logs-view">
    <header class="logs-header">
      <p class="eyebrow">GAME LOGS</p>
      <h2>日志</h2>
      <p class="logs-subtitle">记录《微软模拟飞行 2024》的运行日志与崩溃档案，帮助定位问题。</p>
    </header>

    <!-- 记录开关 -->
    <section class="gsx-panel logs-recording">
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
        <LoaderCircle v-if="toggling" :size="17" class="spin" />
      </label>
      <div class="recording-status">
        <span class="gsx-chip" :class="recording ? 'gsx-chip-ok' : 'gsx-chip-warn'">
          {{ recording ? '记录中' : '未开启' }}
        </span>
        <span class="gsx-chip" :class="gameRunning ? 'gsx-chip-ok' : ''">
          {{ gameRunning ? '游戏运行中' : '游戏未运行' }}
        </span>
        <span v-if="statusError" class="gsx-chip gsx-chip-warn">{{ statusError }}</span>
      </div>
    </section>

    <!-- 最近生成的游戏日志 -->
    <section class="gsx-panel logs-box">
      <div class="logs-box-head">
        <strong><FileText :size="15" /> 最近生成的游戏日志</strong>
        <span class="logs-file-name">{{ sessionFileName }}</span>
        <span v-if="crashDetected" class="gsx-chip gsx-chip-warn">
          <TriangleAlert :size="13" /> 检测到崩溃，已生成崩溃档案
        </span>
        <div class="logs-box-actions">
          <button class="button button-secondary" type="button" :disabled="gameLog.loading" @click="refreshGameLog">
            <RefreshCw :size="14" /> 刷新
          </button>
          <button class="button button-secondary" type="button" :disabled="!gameLog.path" @click="openLog('game')">
            <ExternalLink :size="14" /> 打开文件
          </button>
          <button class="button button-secondary" type="button" @click="openLog('folder')">
            <FolderOpen :size="14" /> 日志文件夹
          </button>
        </div>
      </div>

      <div v-if="summaryStats" class="logs-summary">
        <div class="logs-summary-stats">
          <span>会话时长 <b>{{ summaryStats.duration }}</b></span>
          <span>日志行 <b>{{ summaryStats.lines }}</b></span>
          <span class="logs-warn">警告 <b>{{ summaryStats.warnings }}</b></span>
          <span class="logs-err">错误 <b>{{ summaryStats.errors }}</b></span>
          <span v-if="crashDetected" class="logs-err">崩溃 <b>是</b></span>
        </div>
        <div v-if="summaryStats.knownIssues.length" class="logs-issues">
          <div v-for="issue in summaryStats.knownIssues" :key="issue.tag" class="logs-issue">
            <b>{{ issue.tag }}</b><span v-if="issue.count">（{{ issue.count }} 次）</span>
            <p v-if="issue.explain">{{ issue.explain }}</p>
            <p v-if="issue.action" class="logs-issue-action">建议：{{ issue.action }}</p>
          </div>
        </div>
        <div v-if="summaryStats.clusters.length" class="logs-clusters">
          <span class="logs-clusters-label">错误 / 警告聚类：</span>
          <div v-for="cluster in summaryStats.clusters" :key="cluster.sample || cluster.first" class="logs-cluster">
            <b v-if="cluster.count">{{ cluster.count }} 次</b>
            <code>{{ (cluster.sample || cluster.first || '').slice(0, 160) }}</code>
          </div>
        </div>
      </div>

      <div v-if="gameLog.loading" class="logs-loading"><LoaderCircle :size="18" class="spin" /> 正在读取…</div>
      <pre v-else class="logs-content">{{ gameLog.content || '暂无会话日志。开启记录并进入一次游戏后，这里会显示最近生成的日志。' }}</pre>
    </section>

    <!-- 软件本体日志 -->
    <section class="gsx-panel logs-box">
      <div class="logs-box-head">
        <strong><FileText :size="15" /> 软件本体日志（MSFS_CAT_CH.log）</strong>
        <div class="logs-box-actions">
          <button class="button button-secondary" type="button" :disabled="appLog.loading" @click="refreshAppLog">
            <RefreshCw :size="14" /> 刷新
          </button>
          <button class="button button-secondary" type="button" :disabled="!appLog.path" @click="openLog('app')">
            <ExternalLink :size="14" /> 打开文件
          </button>
        </div>
      </div>
      <div v-if="appLog.loading" class="logs-loading"><LoaderCircle :size="18" class="spin" /> 正在读取…</div>
      <pre v-else class="logs-content">{{ appLog.content || '暂无内容。' }}</pre>
    </section>
  </section>
</template>

<style scoped>
.logs-view { max-width: 980px; }
.logs-header h2 { margin: 2px 0 0; font: 600 22px/1.2 "Bahnschrift", "Microsoft YaHei UI", sans-serif; }
.logs-subtitle { margin: 6px 0 0; color: var(--text-secondary); font-size: 12.5px; }

.logs-recording { padding: 16px 20px; }
.recording-row { display: flex; align-items: center; gap: 14px; cursor: pointer; }
.recording-switch {
  appearance: none; width: 44px; height: 24px; border-radius: 999px; position: relative;
  background: rgba(255, 255, 255, 0.14); border: 1px solid var(--glass-border);
  transition: background 160ms ease; cursor: pointer; flex: none;
}
.recording-switch:checked { background: var(--signal); border-color: var(--signal); }
.recording-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: transform 160ms ease;
}
.recording-switch:checked::after { transform: translateX(20px); }
.recording-text { display: flex; flex-direction: column; gap: 4px; }
.recording-text strong { font-size: 14px; }
.recording-text small { color: var(--text-secondary); font-size: 11.5px; line-height: 1.6; }
.recording-status { display: flex; gap: 8px; margin-top: 12px; }

.logs-box-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.logs-box-head strong { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; }
.logs-file-name { color: var(--text-secondary); font-size: 11.5px; font-family: ui-monospace, Consolas, monospace; }
.logs-box-actions { margin-left: auto; display: flex; gap: 8px; }

.logs-summary { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.logs-summary-stats { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 12px; color: var(--text-secondary); }
.logs-summary-stats b { color: var(--text-primary); }
.logs-warn b { color: var(--warning); }
.logs-err b { color: var(--danger, #e2694f); }
.logs-issues { display: flex; flex-direction: column; gap: 8px; }
.logs-issue { padding: 8px 12px; border: 1px solid rgba(227, 178, 83, 0.3); border-radius: 8px; font-size: 12px; }
.logs-issue p { margin: 4px 0 0; color: var(--text-secondary); }
.logs-issue-action { color: var(--warning); }
.logs-clusters { display: flex; flex-direction: column; gap: 6px; }
.logs-clusters-label { font-size: 12px; color: var(--text-secondary); }
.logs-cluster { font-size: 11.5px; display: flex; gap: 8px; align-items: baseline; }
.logs-cluster b { flex: none; color: var(--warning); }

.logs-content {
  margin: 12px 0 0; padding: 12px 14px; max-height: 320px; overflow: auto;
  border: 1px solid var(--glass-border); border-radius: 8px;
  background: rgba(0, 0, 0, 0.25); color: var(--text-secondary);
  font: 11.5px/1.6 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-all;
}
.logs-loading { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--text-secondary); font-size: 12.5px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
