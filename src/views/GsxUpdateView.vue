<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  ArrowRight, CheckCircle2, CircleHelp, CloudDownload, ExternalLink, KeyRound, LoaderCircle,
  Plane, RefreshCw, Rocket, ShieldCheck, Trash2, TriangleAlert
} from '@lucide/vue'
import GsxTutorialDialog from '../components/GsxTutorialDialog.vue'
import GsxMiniGames from '../components/GsxMiniGames.vue'
import activateWizardHome from '../assets/gsx/activate-1-wizard-home.png'
import activateChooseOnline from '../assets/gsx/activate-2-choose-online.png'
import activateLicenseKey from '../assets/gsx/activate-3-license-key.png'

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
const operation = reactive({
  busy: false,
  phase: '',
  percent: 0,
  message: '',
  error: null,
  applied: [],
  received: 0,
  total: 0,
  currentPhase: '',
  queuePosition: null,
  speed: 0,
  lastSample: null,
  startedAt: 0,
  elapsedMs: 0
})
const errorMessage = ref('')
const done = ref(false)
const patchCare = ref(null)
const skippedComponents = ref([])

// —— 安装向导（未安装状态）——
const lifecycle = reactive({
  loaded: false,
  infrastructure: { present: false },
  activation: { activated: false },
  product: { installed: false },
  error: null
})
const activationFlow = reactive({ launching: false, waiting: false, failed: false, timedOut: false, wizardClosed: false, error: null })
const officialDownloadPage = 'https://www.fsdreamteam.com/products_msfs.html'
let activationWaitTimer = null

// —— 安装步骤教程（问号按钮弹窗）——
const TUTORIALS = {
  step1: {
    title: '教程 · 安装 FSDT 官方安装器',
    sections: [
      { text: '点击「下载官方安装器并运行」——安装器（Universal Installer）由国内服务器直连分发，下载完成并校验通过后会自动打开。' },
      { text: '在官方安装器中完成基础组件安装（couatl 引擎与更新组件，约 400 MB）。' },
      { text: '如果可以正常进入安装器中，点击 GSX Pro 旁边的 Active 进行激活即可——激活服务器国内直连，无需加速器。', tag: '激活捷径' },
      { text: '完成后回到本页点「刷新状态」确认，即可进入下一步。' }
    ]
  },
  step2: {
    title: '教程 · 激活 GSX Pro',
    sections: [
      { text: '本页拉起的是 FSDreamTeam 官方权威激活工具（QLM License Wizard）。激活服务器国内可以直连访问，无需加速器；我们的软件不接触任何激活码——激活全程在官方向导内完成。', tag: '官方工具' },
      { text: '向导打开后，点击「Activate your license」（激活许可）。', image: activateWizardHome, alt: 'License Wizard 首页，选择 Activate your license' },
      { text: '选择「Activate Online」（在线激活）——国内网络直连即可完成。', image: activateChooseOnline, alt: '选择 Activate Online 在线激活' },
      { text: '粘贴您的激活码（Activation Key），点击「Activate license key」。出现 "Your license is activated." 即激活成功；随后可关闭向导，本页会自动检测。', image: activateLicenseKey, alt: '输入激活码并点击 Activate license key' },
      { text: '激活码可在 SimMarket 订单页查询。一个激活码绑定一台电脑；重装系统前请先在官方界面点击 Deactivate 释放名额。' }
    ]
  },
  step3: {
    title: '教程 · 一键安装 GSX Pro 本体',
    sections: [
      { text: '点击「一键安装」后，应用把 GSX 本体完整包（约 7.3 GB）从国内服务器直连下载到本地缓存，全程逐字节 SHA-256 校验，不连接国外网络。' },
      { text: '下载完成后由本应用直接解压部署到官方目录结构（Addon Manager\\MSFS\\<包名>），并在模拟器社区目录创建链接——不需要打开官方安装器。' },
      { text: '部署完成后，应用会自动通过国内镜像把 GSX 更新到最新版本——全程无需任何手动操作。更新完成后 GSX 为官方原版，如需汉化，请到「汉化补丁」页安装适配版本的补丁。' },
      { text: '页面自动刷新显示最新状态后，直接启动模拟器即可使用。' }
    ]
  }
}
const tutorial = reactive({ open: false, title: '', sections: [] })

function openTutorial(kind) {
  const data = TUTORIALS[kind]
  if (!data) return
  tutorial.title = data.title
  tutorial.sections = data.sections
  tutorial.open = true
}

// —— 全新安装镜像（官方安装器 + 本体完整包，均走国内服务器）——
const installInfo = ref(null)
const installFlow = reactive({
  busy: false,
  kind: '',
  percent: 0,
  received: 0,
  total: 0,
  message: '',
  error: null,
  bootstrapReady: false,
  presetDone: false,
  currentPhase: '',
  queuePosition: null,
  speed: 0,
  lastSample: null,
  startedAt: 0,
  elapsedMs: 0
})
let statusTicker = null

// —— 卸载（已安装状态）——
const uninstallFlow = reactive({ confirming: false, busy: false, done: false, error: null, message: '' })

const emit = defineEmits(['updated', 'patch-installed'])

const totalMegabytes = computed(() => {
  if (!status.totalBytes) return '—'
  return `${(status.totalBytes / 1024 / 1024).toFixed(1)} MB`
})

const bootstrapSizeLabel = computed(() => {
  if (!installInfo.value?.bootstrap?.size) return '61 MB'
  return `${(installInfo.value.bootstrap.size / 1024 / 1024).toFixed(0)} MB`
})

const presetSizeLabel = computed(() => {
  const packages = installInfo.value?.packages
  if (!packages?.length) return '—'
  const total = packages.reduce((sum, pkg) => sum + (pkg.size || 0), 0)
  return `${(total / 1024 / 1024 / 1024).toFixed(1)} GB`
})

const NET_PHASES = new Set(['bootstrap-download', 'package-download', 'download'])
const DISK_PHASES = new Set(['deploy', 'install', 'verify', 'patch-restore', 'patch-reinstall'])

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—'
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`
}

function sampleSpeed(flow, received) {
  const now = Date.now()
  if (flow.lastSample && Number.isFinite(received) && received >= flow.lastSample.received) {
    const seconds = (now - flow.lastSample.t) / 1000
    if (seconds >= 0.25) {
      const instant = (received - flow.lastSample.received) / seconds
      flow.speed = flow.speed > 0 ? flow.speed * 0.6 + instant * 0.4 : instant
      flow.lastSample = { t: now, received }
    }
  } else {
    flow.lastSample = Number.isFinite(received) ? { t: now, received } : null
  }
}

function startStatusTicker() {
  installFlow.startedAt = Date.now()
  installFlow.elapsedMs = 0
  clearInterval(statusTicker)
  statusTicker = setInterval(() => {
    installFlow.elapsedMs = Date.now() - installFlow.startedAt
    if (operation.busy && operation.startedAt) operation.elapsedMs = Date.now() - operation.startedAt
  }, 250)
}

function stopStatusTicker() {
  clearInterval(statusTicker)
  statusTicker = null
}

const statusPercent = computed(() => {
  if (!installFlow.busy) return Math.min(100, installFlow.percent || 0)
  // 假进度动画：0 → 10% 匀速走 20 秒（解压前常有 10-20 秒准备期），真实进度超过后取实值
  const fake = Math.min(10, (installFlow.elapsedMs / 1000) * 0.5)
  return Math.max(Math.min(100, installFlow.percent || 0), fake)
})
const updateStatusPercent = computed(() => {
  if (!operation.busy) return Math.min(100, operation.percent || 0)
  const fake = Math.min(10, (operation.elapsedMs / 1000) * 0.5)
  return Math.max(Math.min(100, operation.percent || 0), fake)
})
const updateNetSpeedLabel = computed(() =>
  operation.busy && NET_PHASES.has(operation.currentPhase) ? formatSpeed(operation.speed) : '—')
const updateDiskSpeedLabel = computed(() =>
  operation.busy && DISK_PHASES.has(operation.currentPhase) ? formatSpeed(operation.speed) : '—')
const updateElapsedLabel = computed(() => formatDuration(operation.elapsedMs / 1000))
const updateEtaLabel = computed(() => {
  if (!operation.busy || !NET_PHASES.has(operation.currentPhase) || !operation.speed || !operation.total) return '- 秒'
  return formatDuration((operation.total - operation.received) / operation.speed)
})
const netSpeedLabel = computed(() =>
  installFlow.busy && NET_PHASES.has(installFlow.currentPhase) ? formatSpeed(installFlow.speed) : '—')
const diskSpeedLabel = computed(() =>
  installFlow.busy && DISK_PHASES.has(installFlow.currentPhase) ? formatSpeed(installFlow.speed) : '—')
const elapsedLabel = computed(() => formatDuration(installFlow.elapsedMs / 1000))
const ETA_PHASES = new Set(['bootstrap-download', 'package-download', 'download', 'deploy'])
const etaLabel = computed(() => {
  if (!installFlow.busy) return '—'
  // 校验/部署切换等阶段无法准确估计剩余时间，如实显示占位
  if (!ETA_PHASES.has(installFlow.currentPhase) || !installFlow.speed || !installFlow.total) return '- 秒'
  return formatDuration((installFlow.total - installFlow.received) / installFlow.speed)
})

const progressPercent = computed(() => {
  if (!operation.busy && ['complete'].includes(operation.phase)) return 100
  if (!operation.busy && operation.phase === 'error') return 0
  if (operation.busy) return updateStatusPercent.value
  return Math.min(100, Math.max(0, operation.percent || 0))
})

const wizardStep = computed(() => {
  if (!lifecycle.loaded) return 0
  if (!lifecycle.infrastructure.present) return 1
  if (!lifecycle.activation.activated) return 2
  return 3
})

async function loadLifecycle() {
  lifecycle.loading = true
  lifecycle.error = null
  try {
    const result = await props.bridge.gsx.lifecycle()
    lifecycle.infrastructure = result?.infrastructure || { present: false }
    lifecycle.activation = result?.activation || { activated: false }
    lifecycle.product = result?.product || { installed: false }
    lifecycle.loaded = true
  } catch (error) {
    lifecycle.error = error.message
  } finally {
    lifecycle.loading = false
  }
}

async function openOfficialDownloadPage() {
  try {
    await props.bridge.external.open(officialDownloadPage)
  } catch { /* 浏览器打开失败不阻塞引导 */ }
}

async function startLicenseWizard() {
  if (activationFlow.launching || activationFlow.waiting) return
  activationFlow.launching = true
  activationFlow.failed = false
  activationFlow.timedOut = false
  activationFlow.wizardClosed = false
  activationFlow.error = null
  // 单次 IPC 同时完成"启动向导 + 监视窗口/激活记录"；几秒后把按钮文案切到等待态
  activationWaitTimer = setTimeout(() => {
    if (activationFlow.launching) {
      activationFlow.waiting = true
      activationFlow.launching = false
    }
  }, 3000)
  try {
    const result = await props.bridge.gsx.startActivation()
    if (result?.activated) {
      await loadLifecycle()
      await loadStatus()
    } else if (result?.wizardClosed) {
      activationFlow.wizardClosed = true
    } else {
      activationFlow.timedOut = true
    }
  } catch (error) {
    activationFlow.failed = true
    activationFlow.error = error.message
  } finally {
    clearTimeout(activationWaitTimer)
    activationWaitTimer = null
    activationFlow.launching = false
    activationFlow.waiting = false
  }
}

async function loadInstallManifest() {
  try {
    installInfo.value = await props.bridge.gsx.installManifest()
  } catch {
    installInfo.value = null
  }
}

async function startBootstrap() {
  if (installFlow.busy) return
  installFlow.busy = true
  installFlow.kind = 'bootstrap'
  installFlow.error = null
  installFlow.percent = 0
  installFlow.received = 0
  installFlow.total = 0
  installFlow.speed = 0
  installFlow.lastSample = null
  installFlow.currentPhase = ''
  installFlow.queuePosition = null
  startStatusTicker()
  installFlow.message = '正在准备下载…'
  try {
    await props.bridge.gsx.startBootstrap()
    installFlow.bootstrapReady = true
    installFlow.message = '官方安装器已启动'
  } catch (error) {
    installFlow.error = error.message
  } finally {
    stopStatusTicker()
    installFlow.busy = false
  }
}

// 一键安装：预置官方完整包（国内直连下载 + SHA-256 校验 + 写入官方缓存）后，
// 由本应用直接解压部署到官方目录结构并创建社区链接——不拉起官方安装器。
async function startOneClickInstall() {
  if (installFlow.busy) return
  installFlow.busy = true
  installFlow.kind = 'preset'
  installFlow.error = null
  installFlow.presetDone = false
  installFlow.percent = 0
  installFlow.received = 0
  installFlow.total = 0
  installFlow.speed = 0
  installFlow.lastSample = null
  installFlow.currentPhase = ''
  installFlow.queuePosition = null
  startStatusTicker()
  installFlow.message = '正在准备下载…'
  try {
    await props.bridge.gsx.startPackagePreset()
    installFlow.presetDone = true
    installFlow.percent = 100
    installFlow.message = 'GSX Pro 已安装并更新到最新版本'
    // 自动刷新：检测安装与更新状态，无需用户手动操作
    await loadStatus()
    await loadLifecycle()
  } catch (error) {
    installFlow.error = error.message
  } finally {
    stopStatusTicker()
    installFlow.busy = false
  }
}

async function requestUninstall() {
  if (uninstallFlow.busy) return
  if (!uninstallFlow.confirming) {
    uninstallFlow.confirming = true
    return
  }
  uninstallFlow.busy = true
  uninstallFlow.error = null
  uninstallFlow.done = false
  uninstallFlow.message = '正在确认模拟器已完全退出…'
  try {
    await props.bridge.gsx.uninstall()
    uninstallFlow.done = true
    uninstallFlow.confirming = false
    uninstallFlow.message = 'GSX Pro 已卸载（引擎与激活状态保留）'
    await loadStatus()
    await loadLifecycle()
    emit('updated')
  } catch (error) {
    uninstallFlow.error = error.message
  } finally {
    uninstallFlow.busy = false
  }
}

async function loadStatus() {
  status.loading = true
  errorMessage.value = ''
  try {
    const result = await props.bridge.gsx.status()
    Object.assign(status, result, { loaded: true })
    if (!result.installed) {
      if (!lifecycle.loaded) void loadLifecycle()
      void loadInstallManifest()
    }
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
  operation.received = 0
  operation.total = 0
  operation.speed = 0
  operation.lastSample = null
  operation.currentPhase = ''
  operation.queuePosition = null
  operation.startedAt = Date.now()
  operation.elapsedMs = 0
  startStatusTicker()
  operation.message = '准备更新…'
  operation.error = null
  operation.applied = []
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
    // 补丁记录已失效（不再自动重装）：通知补丁页刷新安装状态
    if (patchCare.value?.restored?.length) emit('patch-installed')
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

const UNINSTALL_PHASES = new Set(['check', 'forget-records', 'remove', 'reset-state'])

const unsubscribeProgress = props.bridge.gsx.onProgress((progress) => {
  // 一键安装（含自动更新链）进行中：所有 GSX 进度统一导向状态条
  if (installFlow.busy) {
    installFlow.currentPhase = progress.phase || ''
    if (progress.phase === 'queue') {
      installFlow.queuePosition = progress.position ?? null
      installFlow.message = progress.message || '服务器繁忙，排队中…'
      return
    }
    installFlow.queuePosition = null
    if (Number.isFinite(progress.percent)) installFlow.percent = progress.percent
    if (progress.message) installFlow.message = progress.message
    if (Number.isFinite(progress.received)) {
      installFlow.received = progress.received
      sampleSpeed(installFlow, progress.received)
    }
    if (Number.isFinite(progress.total)) installFlow.total = progress.total
    if (progress.phase === 'error') installFlow.error = progress.error || progress.message
    return
  }
  if (progress.kind === 'install') return
  if (uninstallFlow.busy && UNINSTALL_PHASES.has(progress.phase)) {
    uninstallFlow.message = progress.message || ''
    return
  }
  if (uninstallFlow.busy && progress.phase === 'complete') {
    uninstallFlow.message = progress.message || '卸载完成'
    return
  }
  if (operation.busy) {
    operation.currentPhase = progress.phase || ''
    if (progress.phase === 'queue') {
      operation.queuePosition = progress.position ?? null
      operation.message = progress.message || '服务器繁忙，排队中…'
      return
    }
    operation.queuePosition = null
    if (Number.isFinite(progress.percent)) operation.percent = progress.percent
    if (progress.message) operation.message = progress.message
    if (Number.isFinite(progress.received)) {
      operation.received = progress.received
      sampleSpeed(operation, progress.received)
    }
    if (Number.isFinite(progress.total)) operation.total = progress.total
    if (progress.phase === 'error') {
      operation.error = progress.error || progress.message
    }
    return
  }
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
onBeforeUnmount(() => {
  clearTimeout(activationWaitTimer)
  activationWaitTimer = null
  stopStatusTicker()
  unsubscribeProgress()
})
</script>

<template>
  <section class="view-shell gsx-shell">
    <header class="view-header">
      <div>
        <p class="eyebrow">GSX DOWNLOAD &amp; UPDATE</p>
        <h1>GSX 下载与更新</h1>
        <p class="gsx-subtitle">安装、激活、更新全流程国内直连：本体安装包与官方更新包均由国内服务器分发（逐字节镜像校验），高峰期自动排队。</p>
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
      <!-- 未安装：三步安装向导 -->
      <div v-if="!status.installed && !errorMessage" class="gsx-empty">
        <Plane :size="28" />
        <strong>未检测到 GSX 本体</strong>
        <p>
          已购买正版 GSX Pro？跟随下面三步即可完成安装：官方安装器与本体安装包均由国内服务器直连下载，
          激活服务器国内可达，无需加速器。一键安装完成后会自动更新到最新版本并重装汉化补丁。
        </p>
      </div>

      <!-- 安装向导（未安装时显示） -->
      <section v-if="!status.installed && !errorMessage" class="gsx-panel gsx-wizard">
        <header class="gsx-panel-head">
          <h3><KeyRound :size="14" /> 安装 GSX Pro</h3>
          <span>三步完成 · 安装器与本体均由国内服务器分发</span>
        </header>

        <ol class="gsx-steps">
          <!-- 第一步：基础组件 -->
          <li class="gsx-step" :data-state="lifecycle.infrastructure.present ? 'done' : wizardStep === 1 ? 'active' : 'wait'">
            <div class="gsx-step-head">
              <span class="gsx-step-state">
                <CheckCircle2 v-if="lifecycle.infrastructure.present" :size="15" />
                <span v-else class="gsx-step-index">1</span>
              </span>
              <strong>安装 FSDT 官方安装器（基础组件，约 400 MB）</strong>
              <button class="gsx-step-help" type="button" title="查看教程" @click="openTutorial('step1')">
                <CircleHelp :size="14" />
              </button>
            </div>
            <p class="gsx-step-body">
              从国内服务器下载官方安装器（{{ bootstrapSizeLabel }}）并自动运行。如果可以正常进入安装器中，
              点击 GSX Pro 旁边的 Active 进行激活即可——激活服务器国内直连，无需加速器。
            </p>
            <div v-if="!(installFlow.busy && installFlow.kind === 'bootstrap')" class="gsx-step-actions">
              <button
                class="gsx-secondary" type="button"
                :disabled="installFlow.busy"
                @click="startBootstrap"
              >
                <CloudDownload :size="13" />
                下载官方安装器并运行（{{ bootstrapSizeLabel }}）
              </button>
              <button class="gsx-ghost" type="button" @click="openOfficialDownloadPage">
                <ExternalLink :size="13" /> 打开官方下载页
              </button>
            </div>
            <div v-if="installFlow.busy && installFlow.kind === 'bootstrap'" class="gsx-statusbar">
              <div class="gsx-statusbar-head">
                <LoaderCircle :size="13" class="spin" />
                <span>{{ installFlow.message || '正在准备下载…' }}</span>
              </div>
              <div class="gsx-track"><span :style="{ width: statusPercent + '%' }" /></div>
              <div class="gsx-statusbar-stats">
                <span>网速 <b>{{ netSpeedLabel }}</b></span>
                <span>硬盘写入 <b>{{ diskSpeedLabel }}</b></span>
                <span>已用 <b>{{ elapsedLabel }}</b></span>
                <span>剩余约 <b>{{ etaLabel }}</b></span>
              </div>
            </div>
            <p v-if="installFlow.bootstrapReady" class="gsx-step-note">
              安装器已启动——请在其中完成基础组件安装，完成后点右上角「刷新状态」确认，即可进入下一步。
            </p>
            <p v-if="installFlow.error && installFlow.kind === 'bootstrap'" class="gsx-step-note gsx-note-warn">
              <TriangleAlert :size="12" />
              {{ installFlow.error }}
            </p>
          </li>

          <!-- 第二步：激活 -->
          <li class="gsx-step" :data-state="lifecycle.activation.activated ? 'done' : wizardStep === 2 ? 'active' : 'wait'">
            <div class="gsx-step-head">
              <span class="gsx-step-state">
                <CheckCircle2 v-if="lifecycle.activation.activated" :size="15" />
                <span v-else class="gsx-step-index">2</span>
              </span>
              <strong>激活 GSX Pro（需要您的正版激活码）</strong>
              <button class="gsx-step-help" type="button" title="查看教程" @click="openTutorial('step2')">
                <CircleHelp :size="14" />
              </button>
            </div>
            <p class="gsx-step-body">
              点击下方按钮启动<b>官方激活向导</b>，选择 <b>Activate Online（在线激活）</b>，
              把激活码粘贴进去并点激活——激活服务器在国内直连可达，<b>无需加速器</b>，
              激活码全程只在官方向导内输入。一个激活码绑定一台电脑；重装系统前请先在官方界面点击 Deactivate 释放名额。
            </p>
            <div class="gsx-step-actions">
              <button
                v-if="!lifecycle.activation.activated"
                class="gsx-secondary" type="button"
                :disabled="!lifecycle.infrastructure.present || activationFlow.launching || activationFlow.waiting || installFlow.busy"
                @click="startLicenseWizard"
              >
                <LoaderCircle v-if="activationFlow.launching || activationFlow.waiting" :size="13" class="spin" />
                <KeyRound v-else :size="13" />
                {{ activationFlow.launching ? '正在启动向导…' : activationFlow.waiting ? '已打开向导，等待激活完成…' : '启动官方激活向导' }}
              </button>
            </div>
            <p v-if="activationFlow.waiting" class="gsx-step-note">
              检测到官方向导已打开——请在向导中选择 Activate Online 并输入激活码；向导关闭或激活成功后，本页会自动检测并进入下一步。
            </p>
            <p v-if="!lifecycle.infrastructure.present" class="gsx-step-note">
              官方激活向导随第一步的基础组件一同安装——请先完成第一步，再启动激活。
            </p>
            <p v-if="activationFlow.failed" class="gsx-step-note gsx-note-warn">
              <TriangleAlert :size="12" />
              激活向导启动失败：{{ activationFlow.error || '未检测到 FSDT 安装根目录' }}。请先完成第一步，再重试。
            </p>
            <p v-if="activationFlow.wizardClosed" class="gsx-step-note gsx-note-warn">
              <TriangleAlert :size="12" />
              向导已关闭，暂未检测到激活记录。可重新启动向导完成激活，或在官方安装器中点击 Active 激活；
              若您已在其它官方窗口完成激活，点「刷新状态」即可。
            </p>
            <p v-if="activationFlow.timedOut" class="gsx-step-note gsx-note-warn">
              <TriangleAlert :size="12" />
              等待超时：若向导提示名额已满，请凭 SimMarket 订单联系 FSDT 支持重置激活；
              若已激活成功，点击「刷新状态」。
            </p>
          </li>

          <!-- 第三步：一键安装 -->
          <li class="gsx-step" :data-state="wizardStep === 3 ? 'active' : 'wait'">
            <div class="gsx-step-head">
              <span class="gsx-step-state">
                <span class="gsx-step-index">3</span>
              </span>
              <strong>安装 GSX Pro 本体（约 {{ presetSizeLabel }}，国内直连）</strong>
              <button class="gsx-step-help" type="button" title="查看教程" @click="openTutorial('step3')">
                <CircleHelp :size="14" />
              </button>
            </div>
            <p class="gsx-step-body">
              点击「一键安装」：应用把 GSX 本体完整包从国内服务器下载到本地缓存（逐字节 SHA-256 校验），
              <b>直接解压部署</b>到官方目录结构并在模拟器社区目录创建链接，随后<b>自动更新到最新版本</b>
              ——全程无需打开官方安装器，也不连接国外网络。更新完成后可到「汉化补丁」页按需安装汉化。
            </p>
            <div v-if="!(installFlow.busy && installFlow.kind === 'preset')" class="gsx-step-actions">
              <button
                class="gsx-install-all" type="button"
                :disabled="!lifecycle.infrastructure.present || !lifecycle.activation.activated || installFlow.busy"
                @click="startOneClickInstall"
              >
                <Rocket :size="17" />
                一键安装 GSX Pro 本体
              </button>
            </div>
            <p v-if="!lifecycle.infrastructure.present || !lifecycle.activation.activated" class="gsx-step-note">
              需先完成第一、二步（基础组件与激活）才能一键安装。
            </p>
            <div v-if="installFlow.busy && installFlow.kind === 'preset'" class="gsx-statusbar">
              <div class="gsx-statusbar-head">
                <LoaderCircle :size="13" class="spin" />
                <span>{{ installFlow.message || '正在准备下载…' }}</span>
                <span v-if="installFlow.queuePosition" class="gsx-statusbar-queue">排队第 {{ installFlow.queuePosition }} 位</span>
              </div>
              <div class="gsx-track"><span :style="{ width: statusPercent + '%' }" /></div>
              <div class="gsx-statusbar-stats">
                <span>网速 <b>{{ netSpeedLabel }}</b></span>
                <span>硬盘写入 <b>{{ diskSpeedLabel }}</b></span>
                <span>已用 <b>{{ elapsedLabel }}</b></span>
                <span>剩余约 <b>{{ etaLabel }}</b></span>
              </div>
            </div>
            <p v-if="installFlow.presetDone && !installFlow.busy" class="gsx-step-note">
              GSX Pro 已安装并更新到最新版本（官方内容逐字节镜像）。直接启动模拟器即可使用；
              如需汉化，请到「汉化补丁」页安装适配版本的补丁。
            </p>
            <p v-if="installFlow.error && installFlow.kind === 'preset'" class="gsx-step-note gsx-note-warn">
              <TriangleAlert :size="12" />
              {{ installFlow.error }}
            </p>
          </li>
        </ol>
      </section>

      <GsxTutorialDialog
        v-if="tutorial.open"
        :title="tutorial.title"
        :sections="tutorial.sections"
        @close="tutorial.open = false"
      />

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
                <span v-else-if="status.versionMarkerStale" class="gsx-chip gsx-chip-warn">
                  <TriangleAlert :size="13" />
                  版本标记异常
                </span>
                <span v-else class="gsx-chip gsx-chip-ok">已是最新</span>
              </span>
            </div>
            <div class="gsx-hero-action">
              <span v-if="operation.busy" class="gsx-chip gsx-chip-busy">
                <LoaderCircle :size="13" class="spin" />
                {{ operation.currentPhase === 'queue' ? '排队等待中…' : '更新进行中' }}
              </span>
              <button
                v-else-if="status.updateAvailable && !status.stale"
                class="gsx-primary"
                type="button"
                @click="startUpdate"
              >
                <CloudDownload :size="15" />
                更新 GSX · {{ totalMegabytes }}
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

        <!-- 幽灵版本：内容已是最新但版本标记落后，通常为旧版补丁覆盖 manifest 所致 -->
        <section v-if="status.versionMarkerStale" class="gsx-panel gsx-marker-stale">
          <strong><TriangleAlert :size="15" /> 检测到 GSX 版本标记异常</strong>
          <p>
            本机版本标记显示 v{{ status.localVersion }}，低于镜像源的 v{{ status.latestVersion }}，
            但全部组件已与官方同步——版本标记文件大概率被旧版汉化补丁覆盖。
            点击上方「更新 GSX」即可自动重应用组件并把版本标记恢复到最新；
            也可以在「汉化补丁」页对该补丁执行「还原文字与图片」后重新安装。
          </p>
        </section>

        <!-- 更新进度：总进度条（按字节加权） -->
        <section v-if="operation.busy || done || operation.phase === 'error'" class="gsx-panel gsx-progress" :data-state="operation.phase === 'error' ? 'error' : done ? 'done' : 'running'">
          <div class="gsx-progress-head">
            <strong>{{ operation.message || (done ? '更新完成' : '更新进度') }}</strong>
            <span v-if="operation.busy && operation.queuePosition" class="gsx-chip gsx-chip-warn">排队第 {{ operation.queuePosition }} 位</span>
            <span class="gsx-progress-num">{{ progressPercent }}%</span>
          </div>
          <div class="gsx-track"><span :style="{ width: progressPercent + '%' }" /></div>
          <div v-if="operation.busy" class="gsx-statusbar-stats">
            <span>网速 <b>{{ updateNetSpeedLabel }}</b></span>
            <span>硬盘写入 <b>{{ updateDiskSpeedLabel }}</b></span>
            <span>已用 <b>{{ updateElapsedLabel }}</b></span>
            <span>剩余约 <b>{{ updateEtaLabel }}</b></span>
          </div>
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
          <div v-if="done && patchCare?.restored?.length" class="gsx-patchcare">
            <p class="gsx-patchcare-warn">
              <TriangleAlert :size="13" />
              GSX 更新会还原官方文件：受影响的汉化补丁（{{ patchCare.restored.join('、') }}）已还原并失效，请到「汉化补丁」页重新安装适配版本。
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
            <li>GSX 为付费插件，本页面仅供<b>已购买正版</b>的用户使用；安装包与更新包均为 FSDreamTeam 官方文件的逐字节镜像，经 SHA-256 校验后部署。</li>
            <li>更新前会自动还原已安装的 GSX 汉化补丁（安装记录同步失效）；GSX 更新不会自动重装汉化，请更新后在「汉化补丁」页安装适配版本。</li>
            <li>更新与部署前请完全退出微软模拟飞行；过程保持电源与网络连接。</li>
            <li>支持 MSFS 2020 与 2024：GSX Pro 本体为两代模拟器共用，热更组件与部署目标一致；未安装 GSX World 的用户会自动跳过对应组件。</li>
            <li>未安装 GSX 时请使用上方三步<b>一键安装</b>（国内直连）；如提示基础组件不完整，先完成第一步的官方安装器安装即可修复。</li>
            <li>下载高峰期会自动排队（先来后到），状态条会显示排队位；语音包等更新体积较大，建议在良好网络环境下进行。</li>
          </ul>
        </section>

        <!-- 卸载（危险区） -->
        <section class="gsx-panel gsx-danger">
          <header class="gsx-panel-head">
            <h3><Trash2 :size="14" /> 卸载 GSX Pro</h3>
          </header>
          <p class="gsx-danger-text">
            卸载仅移除 MSFS 社区包与产品文件；couatl 引擎、您的激活状态与机场配置会保留。
            已安装的 GSX 汉化补丁会随产品一并移除，重新安装 GSX 后可再次安装补丁。
          </p>
          <p class="gsx-danger-text gsx-danger-warn">
            <TriangleAlert :size="12" />
            提醒：重装系统或更换电脑前，请先在官方界面点击 Deactivate ALL 释放激活名额。
          </p>
          <div v-if="uninstallFlow.done" class="gsx-danger-ok">
            <CheckCircle2 :size="13" />
            {{ uninstallFlow.message || '已卸载。' }}
          </div>
          <p v-if="uninstallFlow.error" class="gsx-danger-text gsx-danger-warn">
            <TriangleAlert :size="12" />
            {{ uninstallFlow.error }}
          </p>
          <div class="gsx-danger-actions">
            <button
              class="gsx-danger-btn" type="button"
              :disabled="uninstallFlow.busy"
              @click="requestUninstall"
            >
              <LoaderCircle v-if="uninstallFlow.busy" :size="13" class="spin" />
              <Trash2 v-else :size="13" />
              {{ uninstallFlow.busy ? (uninstallFlow.message || '正在卸载…') : uninstallFlow.confirming ? '再点一次确认卸载' : '卸载 GSX Pro' }}
            </button>
            <button v-if="uninstallFlow.confirming && !uninstallFlow.busy" class="gsx-ghost" type="button" @click="uninstallFlow.confirming = false">
              取消
            </button>
          </div>
        </section>
      </template>
    </template>

    <!-- 排队与下载等待期间的小游戏区（任一流程进行中即出现，完成后自动消失） -->
    <GsxMiniGames v-if="installFlow.busy || operation.busy" />
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
.gsx-chip-busy { border: 1px solid rgba(98, 214, 163, 0.4); background: rgba(98, 214, 163, 0.1); color: var(--signal); padding: 4px 12px; font-size: 12px; }
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
.gsx-marker-stale { border-color: rgba(227, 178, 83, 0.35); }
.gsx-marker-stale strong { display: inline-flex; align-items: center; gap: 6px; color: var(--warning); font-size: 13px; }
.gsx-marker-stale p { margin: 8px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.7; }
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

/* —— 安装向导 —— */
.gsx-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.gsx-step {
  padding: 13px 16px; border: 1px solid var(--glass-border); border-radius: 10px;
  background: rgba(255, 255, 255, 0.02); transition: border-color 160ms ease;
}
.gsx-step[data-state='active'] { border-color: rgba(98, 214, 163, 0.38); background: rgba(98, 214, 163, 0.045); }
.gsx-step[data-state='done'] { border-color: rgba(98, 214, 163, 0.2); }
.gsx-step[data-state='wait'] { opacity: 0.72; }
.gsx-step-head { display: flex; align-items: center; gap: 9px; }
.gsx-step-head strong { font-size: 12.5px; color: var(--text-primary, #e8eadf); flex: 1; min-width: 0; }
.gsx-step-help {
  flex: 0 0 auto; display: inline-grid; place-items: center;
  width: 24px; height: 24px; border: 1px solid var(--glass-border); border-radius: 50%;
  background: transparent; color: var(--text-muted); cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}
.gsx-step-help:hover { border-color: rgba(98, 214, 163, 0.5); color: var(--signal); }
.gsx-step-state { display: inline-flex; color: var(--signal); }
.gsx-step-index {
  display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
  border: 1px solid var(--glass-border); font: 600 11px/1 ui-monospace, Consolas, monospace; color: var(--text-secondary);
}
.gsx-step[data-state='done'] .gsx-step-state { color: var(--signal); }
.gsx-step-body { margin: 8px 0 0; color: var(--text-secondary); font-size: 11.5px; line-height: 1.7; }
.gsx-step-body b { color: var(--text-primary, #e8eadf); }
.gsx-step-actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-top: 10px; }
.gsx-secondary {
  min-height: 32px; display: inline-flex; align-items: center; gap: 7px; padding: 0 13px;
  border: 1px solid rgba(98, 214, 163, 0.4); border-radius: 8px;
  background: rgba(98, 214, 163, 0.1); color: var(--signal);
  font: 600 11.5px/1 "Microsoft YaHei UI", sans-serif; cursor: pointer; transition: filter 140ms ease;
}
.gsx-secondary:hover:not(:disabled) { filter: brightness(1.15); }
.gsx-secondary:disabled { opacity: 0.5; cursor: default; }
/* 一键安装：向导中的主行动按钮，比常规按钮更大更醒目 */
.gsx-install-all {
  min-height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  width: 100%; max-width: 420px; padding: 0 30px;
  border: 1px solid rgba(98, 214, 163, 0.55); border-radius: 12px;
  background: linear-gradient(180deg, rgba(98, 214, 163, 0.28), rgba(98, 214, 163, 0.13));
  color: var(--signal); font: 600 14px/1 "Microsoft YaHei UI", sans-serif; letter-spacing: 0.02em;
  cursor: pointer; box-shadow: 0 6px 22px rgba(98, 214, 163, 0.18);
  transition: filter 140ms ease, transform 140ms ease;
}
.gsx-install-all:hover:not(:disabled) { filter: brightness(1.14); transform: translateY(-1px); }
.gsx-install-all:disabled { opacity: 0.55; cursor: default; transform: none; }
.gsx-step-note { display: flex; align-items: center; gap: 6px; margin: 9px 0 0; color: var(--text-muted); font-size: 11px; }
.gsx-note-warn { color: var(--warning); }
.gsx-statusbar { display: grid; gap: 8px; margin-top: 12px; }
.gsx-statusbar-head { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 12px; }
.gsx-statusbar-queue { padding: 1px 8px; border: 1px solid rgba(227, 178, 83, 0.35); border-radius: 999px; color: var(--warning); font-size: 10.5px; }
.gsx-statusbar-stats { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--text-muted); font-size: 11px; }
.gsx-statusbar-stats b { color: var(--text-secondary); font-family: ui-monospace, Consolas, monospace; font-weight: 600; }
.gsx-step-progress { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.gsx-step-progress .gsx-track { flex: 1; }
.gsx-step-progress-text { flex: 0 0 auto; color: var(--text-muted); font-size: 11px; font-family: ui-monospace, Consolas, monospace; }

/* —— 卸载危险区 —— */
.gsx-danger { border-color: rgba(224, 106, 106, 0.28); }
.gsx-danger h3 { color: var(--danger, #e06a6a); }
.gsx-danger-text { margin: 0 0 8px; color: var(--text-secondary); font-size: 11.5px; line-height: 1.65; }
.gsx-danger-warn { display: flex; align-items: center; gap: 6px; color: var(--warning); }
.gsx-danger-ok { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; color: var(--signal); font-size: 11.5px; }
.gsx-danger-actions { display: flex; align-items: center; gap: 9px; margin-top: 4px; }
.gsx-danger-btn {
  min-height: 32px; display: inline-flex; align-items: center; gap: 7px; padding: 0 13px;
  border: 1px solid rgba(224, 106, 106, 0.45); border-radius: 8px;
  background: rgba(224, 106, 106, 0.1); color: var(--danger, #e06a6a);
  font: 600 11.5px/1 "Microsoft YaHei UI", sans-serif; cursor: pointer; transition: filter 140ms ease;
}
.gsx-danger-btn:hover:not(:disabled) { filter: brightness(1.15); }
.gsx-danger-btn:disabled { opacity: 0.6; cursor: default; }

.spin { animation: gsx-spin 1s linear infinite; }
@keyframes gsx-spin { to { transform: rotate(360deg); } }
@keyframes gsx-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

@media (max-width: 760px) {
  .gsx-hero-action { margin-left: 0; width: 100%; }
  .gsx-primary { width: 100%; justify-content: center; }
}
</style>
