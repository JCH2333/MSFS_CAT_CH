<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { CheckCircle2, CloudDownload, Gauge, LoaderCircle, Plane, RefreshCw, ShieldCheck, TriangleAlert } from '@lucide/vue'

const props = defineProps({
  bridge: { type: Object, required: true }
})

const status = reactive({
  loaded: false,
  loading: false,
  installed: false,
  localVersion: null,
  latestVersion: null,
  versionState: 'unknown',
  pending: [],
  totalBytes: 0,
  updateAvailable: false,
  source: 'idle',
  stale: false,
  error: null
})
const operation = reactive({ busy: false, phase: '', percent: 0, message: '', error: null, applied: [] })
const errorMessage = ref('')
const done = ref(false)

const totalMegabytes = computed(() => {
  if (!status.totalBytes) return '—'
  return `${(status.totalBytes / 1024 / 1024).toFixed(1)} MB`
})

const progressPercent = computed(() => {
  if (!operation.busy && ['complete'].includes(operation.phase)) return 100
  if (!operation.busy && operation.phase === 'error') return 0
  return Math.min(100, Math.max(0, operation.percent || 0))
})

async function loadStatus() {
  status.loading = true
  errorMessage.value = ''
  try {
    const result = await props.bridge.gsx.status()
    Object.assign(status, result, { loaded: true })
  } catch (error) {
    Object.assign(status, { loaded: true, installed: false, pending: [], updateAvailable: false, error: error.message })
    errorMessage.value = error.message
  } finally {
    status.loading = false
  }
}

async function startUpdate() {
  if (operation.busy) return
  operation.busy = true
  operation.phase = 'starting'
  operation.percent = 0
  operation.message = '准备更新…'
  operation.error = null
  operation.applied = []
  errorMessage.value = ''
  done.value = false
  try {
    const result = await props.bridge.gsx.startUpdate()
    if (result?.state === 'current') {
      done.value = true
      operation.phase = 'complete'
      operation.message = '已是最新版本'
    } else {
      operation.phase = 'complete'
      operation.applied = result?.applied || []
      operation.message = 'GSX 已更新到最新版本'
      done.value = true
    }
    await loadStatus()
  } catch (error) {
    operation.phase = 'error'
    operation.error = error.message
    errorMessage.value = error.message
  } finally {
    operation.busy = false
  }
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const unsubscribeProgress = props.bridge.gsx.onProgress((progress) => {
  operation.phase = progress.phase
  operation.percent = progress.percent || 0
  operation.message = progress.message || ''
  if (progress.phase === 'error') {
    operation.error = progress.error || progress.message
  }
})

onMounted(loadStatus)
onBeforeUnmount(unsubscribeProgress)
</script>

<template>
  <section class="view-shell">
    <header class="view-header">
      <div>
        <p class="eyebrow">GSX UPDATE</p>
        <h1>GSX 更新</h1>
        <p class="header-note">通过国内服务器下载 FSDreamTeam 官方更新包，无需访问国外网络。</p>
      </div>
      <div class="header-actions">
        <button class="button button-secondary" type="button" :disabled="status.loading || operation.busy" @click="loadStatus">
          <RefreshCw :size="15" :class="{ spin: status.loading }" />
          刷新状态
        </button>
      </div>
    </header>

    <div v-if="status.loading && !status.loaded" class="catalog-loading">正在检测本机 GSX 安装…</div>

    <template v-else>
      <!-- 未安装 -->
      <div v-if="!status.installed && !errorMessage" class="empty-state">
        <Plane :size="30" />
        <strong>未检测到 GSX 本体</strong>
        <p>本功能仅提供已安装 GSX 用户的版本更新。首次安装请使用 FSDreamTeam 官方 Universal Installer，安装完成后回到本页即可在线更新。</p>
      </div>

      <div v-if="errorMessage && !status.installed" class="inline-alert" role="alert">
        <TriangleAlert :size="15" />
        <span>{{ errorMessage }}</span>
      </div>

      <template v-if="status.installed">
        <!-- 版本状态卡 -->
        <article class="patch-card gsx-status-card">
          <div class="gsx-status-main">
            <div class="gsx-status-icon" :data-tone="status.updateAvailable ? 'warning' : 'success'">
              <Gauge v-if="!status.updateAvailable" :size="24" />
              <CloudDownload v-else :size="24" />
            </div>
            <div>
              <p class="eyebrow">INSTALLED VERSION</p>
              <h2 class="gsx-version-line">
                GSX Pro
                <code>v{{ status.localVersion }}</code>
                <span v-if="!status.updateAvailable" class="status-badge" data-tone="success">已是最新</span>
                <span v-else class="status-badge" data-tone="warning">可更新到 v{{ status.latestVersion }}</span>
              </h2>
            </div>
          </div>
          <p v-if="status.stale" class="gsx-cache-note">
            <TriangleAlert :size="14" />
            服务器暂时无法连接，当前显示的是本地缓存清单，更新按钮暂不可用。
          </p>
          <button
            v-if="status.updateAvailable && !status.stale"
            class="button button-primary"
            type="button"
            :disabled="operation.busy"
            @click="startUpdate"
          >
            <LoaderCircle v-if="operation.busy" :size="16" class="spin" />
            <CloudDownload v-else :size="16" />
            {{ operation.busy ? '正在更新…' : `更新 GSX（约 ${totalMegabytes}）` }}
          </button>
        </article>

        <!-- 待更新组件清单 -->
        <article v-if="status.updateAvailable" class="patch-card">
          <h3 class="gsx-section-title">本次更新内容（{{ status.pending.length }} 个组件，共 {{ totalMegabytes }}）</h3>
          <ul class="gsx-component-list">
            <li v-for="pkg in status.pending" :key="pkg.component">
              <code>{{ pkg.component }}</code>
              <span>v{{ pkg.version }}</span>
              <small>{{ formatSize(pkg.size) }}</small>
            </li>
          </ul>
        </article>

        <!-- 更新进度 -->
        <article v-if="operation.busy || done || operation.phase === 'error'" class="patch-card">
          <div class="operation-progress">
            <div class="gsx-progress-head">
              <strong>{{ operation.message || (done ? '更新完成' : '更新进度') }}</strong>
              <span>{{ progressPercent }}%</span>
            </div>
            <div class="progress-track"><span :style="{ width: progressPercent + '%' }" /></div>
            <p v-if="done" class="gsx-done-note">
              <CheckCircle2 :size="14" />
              更新完成后请重启一次模拟器；游戏内 GSX 界面将暂时回到英文，等待对应版本的汉化补丁发布。
            </p>
          </div>
        </article>

        <!-- 安全与合规说明 -->
        <article class="patch-card gsx-notes">
          <h3 class="gsx-section-title"><ShieldCheck :size="15" /> 更新说明</h3>
          <ul>
            <li>GSX 为付费插件，本页面仅供<b>已购买正版</b>的用户加速下载官方更新包；更新包为 FSDreamTeam 官方文件的逐字节镜像，经 SHA-256 校验后部署。</li>
            <li>更新会覆盖官方文件：已安装的 GSX 汉化补丁会被暂时还原为英文界面，新版本补丁适配发布后重新安装即可。</li>
            <li>更新前请完全退出微软模拟飞行；更新过程保持电源与网络连接。</li>
            <li>更新包较大（语音包约 229 MB），首次建议在良好网络环境下进行。</li>
          </ul>
        </article>
      </template>
    </template>
  </section>
</template>

<style scoped>
.gsx-status-card { display: flex; flex-direction: column; gap: 14px; }
.gsx-status-main { display: flex; align-items: center; gap: 16px; }
.gsx-status-icon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: rgba(148, 163, 184, 0.14); }
.gsx-status-icon[data-tone='success'] { color: #4ade80; }
.gsx-status-icon[data-tone='warning'] { color: #fbbf24; }
.gsx-version-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 0; font-size: 18px; }
.gsx-version-line code { font-family: ui-monospace, Consolas, monospace; font-size: 15px; opacity: 0.85; }
.gsx-cache-note { display: flex; align-items: center; gap: 8px; font-size: 13px; opacity: 0.85; margin: 0; }
.gsx-section-title { display: flex; align-items: center; gap: 8px; font-size: 14px; margin: 0 0 12px; }
.gsx-component-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.gsx-component-list li { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 8px; background: rgba(148, 163, 184, 0.08); font-size: 13px; }
.gsx-component-list code { font-family: ui-monospace, Consolas, monospace; }
.gsx-component-list small { margin-left: auto; opacity: 0.7; }
.gsx-progress-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
.gsx-done-note { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 12px 0 0; opacity: 0.9; }
.gsx-notes ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; font-size: 13px; opacity: 0.85; }
.spin { animation: gsx-spin 1s linear infinite; }
@keyframes gsx-spin { to { transform: rotate(360deg); } }
</style>
