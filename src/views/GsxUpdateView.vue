<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ArrowRight, CheckCircle2, CloudDownload, LoaderCircle, Plane, RefreshCw, ShieldCheck, TriangleAlert } from '@lucide/vue'

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
const operation = reactive({ busy: false, phase: '', percent: 0, message: '', error: null, applied: [], received: 0, total: 0 })
const errorMessage = ref('')
const done = ref(false)
const patchCare = ref(null)
const skippedComponents = ref([])

const emit = defineEmits(['updated', 'patch-installed'])

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
  operation.received = 0
  operation.total = 0
  errorMessage.value = ''
  done.value = false
  patchCare.value = null
  skippedComponents.value = []
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
    patchCare.value = result?.patchCare || null
    skippedComponents.value = result?.skipped || []
    emit('updated')
    if (patchCare.value?.reinstalled?.length) emit('patch-installed')
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
  if (Number.isFinite(progress.received)) operation.received = progress.received
  if (Number.isFinite(progress.total)) operation.total = progress.total
  if (progress.phase === 'error') {
    operation.error = progress.error || progress.message
  }
})

onMounted(loadStatus)
onBeforeUnmount(unsubscribeProgress)
</script>

<template>
  <section class="view-shell gsx-shell">
    <header class="view-header">
      <div>
        <p class="eyebrow">GSX UPDATE</p>
        <h1>GSX 更新</h1>
        <p class="gsx-subtitle">通过国内服务器下载 FSDreamTeam 官方更新包，无需访问国外网络。</p>
      </div>
      <div class="header-actions">
        <button class="gsx-ghost" type="button" :disabled="status.loading || operation.busy" @click="loadStatus">
          <RefreshCw :size="14" :class="{ spin: status.loading }" />
          刷新状态
        </button>
      </div>
    </header>

    <div v-if="status.loading && !status.loaded" class="gsx-loading">正在检测本机 GSX 安装…</div>

    <template v-else>
      <!-- 未安装 -->
      <div v-if="!status.installed && !errorMessage" class="gsx-empty">
        <Plane :size="28" />
        <strong>未检测到 GSX 本体</strong>
        <p>本功能仅提供已安装 GSX 用户的版本更新。首次安装请使用 FSDreamTeam 官方 Universal Installer，安装完成后回到本页即可在线更新。</p>
      </div>

      <div v-if="errorMessage && !status.installed" class="gsx-alert" role="alert">
        <TriangleAlert :size="14" />
        <span>{{ errorMessage }}</span>
      </div>

      <template v-if="status.installed">
        <!-- 状态横幅 -->
        <section class="gsx-hero" :data-tone="status.updateAvailable ? 'pending' : 'current'">
          <div class="gsx-hero-main">
            <div class="gsx-hero-glyph">
              <CheckCircle2 v-if="!status.updateAvailable" :size="26" />
              <CloudDownload v-else :size="26" />
            </div>
            <div class="gsx-hero-title">
              <span class="gsx-hero-name">GSX Pro</span>
              <span class="gsx-version-flow">
                <code>v{{ status.localVersion }}</code>
                <template v-if="status.updateAvailable">
                  <ArrowRight :size="15" class="gsx-flow-arrow" />
                  <code class="gsx-version-next">v{{ status.latestVersion }}</code>
                </template>
                <span v-else class="gsx-chip gsx-chip-ok">已是最新</span>
              </span>
            </div>
            <div class="gsx-hero-action">
              <button
                v-if="status.updateAvailable && !status.stale"
                class="gsx-primary"
                type="button"
                :disabled="operation.busy"
                @click="startUpdate"
              >
                <LoaderCircle v-if="operation.busy" :size="15" class="spin" />
                <CloudDownload v-else :size="15" />
                {{ operation.busy ? '正在更新…' : `更新 GSX · ${totalMegabytes}` }}
              </button>
              <span v-else-if="status.stale" class="gsx-chip gsx-chip-warn">
                <TriangleAlert :size="13" />
                服务器暂不可达，展示缓存清单
              </span>
            </div>
          </div>
          <div class="gsx-hero-meta">
            <span>待更新组件 <b>{{ status.pending.length }}</b></span>
            <span class="gsx-meta-dot" />
            <span>下载体积 <b>{{ totalMegabytes }}</b></span>
            <span class="gsx-meta-dot" />
            <span>镜像源 <b>{{ status.stale ? '本地缓存' : '云端已同步' }}</b></span>
          </div>
        </section>

        <!-- 更新进度：总进度条（按字节加权） -->
        <section v-if="operation.busy || done || operation.phase === 'error'" class="gsx-panel gsx-progress" :data-state="operation.phase === 'error' ? 'error' : done ? 'done' : 'running'">
          <div class="gsx-progress-head">
            <strong>{{ operation.message || (done ? '更新完成' : '更新进度') }}</strong>
            <span class="gsx-progress-num">{{ progressPercent }}%</span>
          </div>
          <div class="gsx-track"><span :style="{ width: progressPercent + '%' }" /></div>
          <p v-if="operation.total > 0 && (operation.busy || done)" class="gsx-progress-bytes">
            {{ formatSize(operation.received) }} / {{ formatSize(operation.total) }}
          </p>
          <p v-if="done" class="gsx-progress-note">
            <CheckCircle2 :size="13" />
            完成后请重启一次模拟器使更新生效。
          </p>
          <div v-if="done && skippedComponents.length" class="gsx-patchcare">
            <p v-for="item in skippedComponents" :key="item.component" class="gsx-patchcare-warn">
              <TriangleAlert :size="13" />
              跳过 {{ item.component }}：{{ item.reason }}
            </p>
          </div>
          <div v-if="done && patchCare" class="gsx-patchcare">
            <p v-if="patchCare.reinstalled?.length" class="gsx-patchcare-ok">
              <CheckCircle2 :size="13" />
              汉化补丁已自动重装：{{ patchCare.reinstalled.join('、') }}
            </p>
            <p v-if="patchCare.failed?.length" class="gsx-patchcare-warn">
              <TriangleAlert :size="13" />
              部分补丁自动重装失败（{{ patchCare.failed.join('；') }}），请到「汉化补丁」页手动重装。
            </p>
          </div>
        </section>

        <!-- 组件清单 -->
        <section v-if="status.updateAvailable" class="gsx-panel">
          <header class="gsx-panel-head">
            <h3>本次更新内容</h3>
            <span>{{ status.pending.length }} 个组件 · 共 {{ totalMegabytes }}</span>
          </header>
          <ul class="gsx-components">
            <li v-for="(pkg, index) in status.pending" :key="pkg.component" :style="{ animationDelay: index * 45 + 'ms' }">
              <span class="gsx-component-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <code class="gsx-component-name" :title="pkg.deployTarget">{{ pkg.component }}</code>
              <span class="gsx-component-version">v{{ pkg.version }}</span>
              <span class="gsx-component-size">{{ formatSize(pkg.size) }}</span>
            </li>
          </ul>
        </section>

        <!-- 更新说明 -->
        <section class="gsx-panel gsx-notes">
          <header class="gsx-panel-head">
            <h3><ShieldCheck :size="14" /> 更新说明</h3>
          </header>
          <ul>
            <li>GSX 为付费插件，本页面仅供<b>已购买正版</b>的用户加速下载官方更新包；更新包为 FSDreamTeam 官方文件的逐字节镜像，经 SHA-256 校验后部署。</li>
            <li>更新会覆盖官方文件：已安装的 GSX 汉化补丁会被暂时还原为英文界面，新版本补丁适配发布后重新安装即可。</li>
            <li>更新前请完全退出微软模拟飞行；更新过程保持电源与网络连接。</li>
            <li>支持 MSFS 2020 与 2024：GSX Pro 本体为两代模拟器共用，热更组件与部署目标一致；未安装 GSX World 的用户会自动跳过对应组件。</li>
            <li>更新采用与官方热更通道一致的覆盖方式；如你的 GSX 长期未更新或基础安装不完整，请先用官方 Universal Installer 完整安装后再使用本功能。</li>
            <li>更新包较大（语音包约 229 MB），首次建议在良好网络环境下进行。</li>
          </ul>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.gsx-shell { width: min(860px, 100%); padding: 34px 32px 44px; }

.gsx-subtitle { margin: 8px 0 0; color: var(--text-secondary); font-size: 12px; }
.gsx-ghost {
  min-height: 34px; display: inline-flex; align-items: center; gap: 7px; padding: 0 12px;
  border: 1px solid var(--glass-border); border-radius: 8px; background: transparent;
  color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: border-color 140ms ease, color 140ms ease;
}
.gsx-ghost:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-primary, #e8eadf); }
.gsx-ghost:disabled { opacity: 0.55; cursor: default; }

.gsx-loading { padding: 42px 0; text-align: center; color: var(--text-muted); font-size: 12px; }

.gsx-empty, .gsx-alert { margin-bottom: 14px; }
.gsx-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 28px;
  border: 1px dashed var(--glass-border); border-radius: var(--radius); text-align: center;
}
.gsx-empty svg { color: var(--text-muted); }
.gsx-empty p { margin: 0; max-width: 460px; color: var(--text-secondary); font-size: 12px; line-height: 1.7; }
.gsx-alert {
  display: flex; align-items: center; gap: 8px; padding: 11px 14px;
  border: 1px solid rgba(227, 178, 83, 0.3); border-radius: 8px; background: rgba(227, 178, 83, 0.08);
  color: var(--warning); font-size: 12px;
}

/* —— 状态横幅 —— */
.gsx-hero {
  padding: 20px 22px 16px; margin-bottom: 14px;
  border: 1px solid var(--glass-border); border-radius: var(--radius);
  background: linear-gradient(135deg, rgba(98, 214, 163, 0.07), rgba(98, 214, 163, 0.015) 46%, transparent), var(--surface);
  backdrop-filter: var(--glass-blur); box-shadow: var(--shadow-soft);
  animation: gsx-rise 240ms ease both;
}
.gsx-hero[data-tone='pending'] { border-color: rgba(98, 214, 163, 0.32); }
.gsx-hero-main { display: flex; align-items: center; gap: 15px; flex-wrap: wrap; }
.gsx-hero-glyph {
  width: 44px; height: 44px; flex: 0 0 44px; display: grid; place-items: center;
  border-radius: 12px; background: rgba(98, 214, 163, 0.1); color: var(--signal);
}
.gsx-hero-title { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.gsx-hero-name { font: 600 17px/1 "Bahnschrift", "Microsoft YaHei UI", sans-serif; letter-spacing: 0.02em; }
.gsx-version-flow { display: inline-flex; align-items: center; gap: 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; color: var(--text-secondary); }
.gsx-version-flow code { padding: 2px 8px; border: 1px solid var(--glass-border); border-radius: 6px; background: rgba(255, 255, 255, 0.03); }
.gsx-version-next { border-color: rgba(98, 214, 163, 0.42) !important; color: var(--signal); }
.gsx-flow-arrow { color: var(--text-muted); }
.gsx-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 11px; }
.gsx-chip-ok { border: 1px solid rgba(98, 214, 163, 0.32); background: rgba(98, 214, 163, 0.08); color: var(--signal); }
.gsx-chip-warn { border: 1px solid rgba(227, 178, 83, 0.3); background: rgba(227, 178, 83, 0.08); color: var(--warning); }
.gsx-hero-action { margin-left: auto; }
.gsx-primary {
  min-height: 42px; display: inline-flex; align-items: center; gap: 8px; padding: 0 22px;
  border: 1px solid rgba(98, 214, 163, 0.5); border-radius: 10px;
  background: linear-gradient(180deg, rgba(98, 214, 163, 0.22), rgba(98, 214, 163, 0.12));
  color: var(--signal); font: 600 13px/1 "Microsoft YaHei UI", sans-serif; cursor: pointer;
  transition: filter 140ms ease, transform 140ms ease; box-shadow: 0 4px 18px rgba(98, 214, 163, 0.12);
}
.gsx-primary:hover:not(:disabled) { filter: brightness(1.14); transform: translateY(-1px); }
.gsx-primary:disabled { opacity: 0.6; cursor: default; transform: none; }
.gsx-hero-meta {
  display: flex; align-items: center; gap: 10px; margin-top: 15px; padding-top: 12px;
  border-top: 1px solid var(--border); color: var(--text-muted); font-size: 11.5px;
}
.gsx-hero-meta b { color: var(--text-secondary); font-weight: 600; }
.gsx-meta-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); opacity: 0.6; }

/* —— 面板通用 —— */
.gsx-panel {
  padding: 16px 20px; margin-bottom: 14px;
  border: 1px solid var(--glass-border); border-radius: var(--radius);
  background: var(--surface); backdrop-filter: var(--glass-blur); box-shadow: var(--shadow-soft);
  animation: gsx-rise 240ms ease both;
}
.gsx-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.gsx-panel-head h3 { display: inline-flex; align-items: center; gap: 7px; margin: 0; font: 600 13.5px/1 "Microsoft YaHei UI", sans-serif; }
.gsx-panel-head span { color: var(--text-muted); font-size: 11.5px; }

/* —— 组件清单 —— */
.gsx-components { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.gsx-components li {
  display: flex; align-items: center; gap: 12px; padding: 9px 13px;
  border: 1px solid transparent; border-radius: 8px; background: rgba(255, 255, 255, 0.025);
  font-size: 12px; animation: gsx-rise 240ms ease both; transition: border-color 140ms ease, background 140ms ease;
}
.gsx-components li:hover { border-color: var(--glass-border); background: rgba(255, 255, 255, 0.045); }
.gsx-component-index { color: var(--text-muted); font: 600 10px/1 ui-monospace, Consolas, monospace; }
.gsx-component-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.gsx-component-version { color: var(--text-secondary); font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
.gsx-component-size { min-width: 62px; text-align: right; color: var(--text-muted); font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }

/* —— 进度 —— */
.gsx-progress[data-state='running'] { border-color: rgba(98, 214, 163, 0.32); }
.gsx-progress[data-state='error'] { border-color: rgba(224, 106, 106, 0.4); }
.gsx-progress[data-state='done'] { border-color: rgba(98, 214, 163, 0.26); }
.gsx-progress-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; font-size: 12.5px; }
.gsx-progress-num { font: 600 13px/1 "Bahnschrift", sans-serif; color: var(--signal); }
.gsx-track { height: 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.06); overflow: hidden; }
.gsx-track span {
  display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, rgba(98, 214, 163, 0.65), var(--signal));
  transition: width 220ms ease;
}
.gsx-progress-note { display: flex; align-items: center; gap: 7px; margin: 11px 0 0; color: var(--text-secondary); font-size: 11.5px; }
.gsx-progress-bytes { margin: 8px 0 0; text-align: right; color: var(--text-muted); font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
.gsx-patchcare { display: grid; gap: 7px; margin-top: 12px; padding-top: 11px; border-top: 1px solid var(--border); }
.gsx-patchcare p { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 11.5px; }
.gsx-patchcare-ok { color: var(--signal); }
.gsx-patchcare-warn { color: var(--warning); }

/* —— 说明 —— */
.gsx-notes ul { margin: 0; padding-left: 16px; display: grid; gap: 7px; color: var(--text-muted); font-size: 11.5px; line-height: 1.65; }
.gsx-notes b { color: var(--text-secondary); }

.spin { animation: gsx-spin 1s linear infinite; }
@keyframes gsx-spin { to { transform: rotate(360deg); } }
@keyframes gsx-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

@media (max-width: 760px) {
  .gsx-hero-action { margin-left: 0; width: 100%; }
  .gsx-primary { width: 100%; justify-content: center; }
}
</style>
