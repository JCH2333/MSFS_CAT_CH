<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Bell, Heart, MessageSquareText, Package, Settings } from '@lucide/vue'
import TitleBar from './components/TitleBar.vue'
import CatalogView from './views/CatalogView.vue'
import FeedbackView from './views/FeedbackView.vue'
import AnnouncementsView from './views/AnnouncementsView.vue'
import AnnouncementPopupDialog from './components/AnnouncementPopupDialog.vue'
import SupportView from './views/SupportView.vue'
import SettingsView from './views/SettingsView.vue'
import AgreementDialog from './components/AgreementDialog.vue'
import FreeNoticeDialog from './components/FreeNoticeDialog.vue'
import RequiredUpdateDialog from './components/RequiredUpdateDialog.vue'
import { createInstallationRequest, createRecognitionDescriptors } from './lib/patch-recognition.mjs'
import {
  DUAL_SIM_SLOTS,
  collectInstallTargets,
  describeDualSim,
  isDualSimPatch,
  manualSlotPaths,
  resolveSlotTarget
} from './lib/dual-sim.mjs'
import { manualTargetHint } from './lib/target-hints.mjs'
import { AGREEMENT_ACCEPTANCE_VALUE, AGREEMENT_REVISION, AGREEMENT_SECTIONS, AUTHOR_URL, hasAcceptedAgreements } from './lib/agreements.mjs'
import { PENDING_STORAGE_KEY, createPendingRecord, parsePendingRecord, pendingRecordToReportPayload, serializePendingRecord } from './lib/legal-evidence.mjs'

const ANNOUNCEMENT_POPUP_HISTORY_LIMIT = 50

const developmentBridge = {
  app: { getInfo: async () => ({ version: '0.1.0', platform: 'win32', packaged: false }), quit: async () => {} },
  catalog: {
    refresh: async () => ({
      source: 'preview',
      stale: false,
      error: null,
      catalog: { schemaVersion: 1, catalogVersion: 'preview', updatedAt: new Date().toISOString(), patches: [] }
    })
  },
  patches: {
    chooseTarget: async () => null,
    choosePackage: async () => null,
    detectTargets: async () => ({}),
    listInstallations: async () => ({}),
    verifyInstallations: async () => ({}),
    reconcileInstallations: async () => ({}),
    install: async () => { throw new Error('请在 Electron 中运行安装') },
    installFromFile: async () => { throw new Error('请在 Electron 中运行安装') },
    restore: async () => ({ restored: true, conflicts: [] }),
    onProgress: () => () => {}
  },
  updates: {
    status: async () => ({ state: 'development' }),
    check: async () => ({ state: 'development' }),
    download: async () => ({ state: 'development' }),
    install: async () => ({ state: 'development' }),
    onStatus: () => () => {}
  },
  feedback: {
    chooseImages: async () => [],
    submit: async () => ({ ok: false, message: '请在桌面应用中使用问题反馈' })
  },
  legal: {
    reportAcceptance: async () => ({ ok: false, reason: 'development' }),
    ensureDeviceId: async () => null,
    getAgreementText: async () => ({ ok: false, error: 'development' })
  },
  announcements: {
    list: async () => ({ ok: true, announcements: [] }),
    popup: async () => ({ ok: true, announcements: [] })
  },
  support: {
    qr: async () => ({ ok: false, error: 'development' })
  },
  external: { open: async () => false }
}

const bridge = window.gsxTool || developmentBridge
const activeView = ref('catalog')
const appInfo = reactive({ version: '0.1.0', platform: 'win32', packaged: false })
const catalogState = reactive({ catalog: null, source: 'idle', stale: false, error: null })
const installations = reactive({})
const installationChecks = reactive({})
const targets = reactive(JSON.parse(localStorage.getItem('patch-targets') || '{}'))
const detectedTargets = reactive({})
const operations = reactive({})
const updateStatus = reactive({ state: 'idle', info: null, progress: null, message: '' })
const loadingCatalog = ref(false)
const agreementAccepted = ref(hasAcceptedAgreements(localStorage.getItem('msfs-cat-ch-agreements')))
const showAgreement = ref(!agreementAccepted.value)
// 协议正文（密文打包方案）：弹窗打开时经主进程联网取钥解密取得，仅保存在内存
const agreementSections = ref(null)
const agreementTextsFailed = ref(false)
const freeNoticeAccepted = ref(localStorage.getItem('msfs-cat-ch-free-notice') === 'acknowledged-v1')
const showFreeNotice = ref(agreementAccepted.value && !freeNoticeAccepted.value)
const updateRequired = computed(() => ['available', 'downloading', 'downloaded'].includes(updateStatus.state))

const announcements = ref([])
const popupAnnouncements = ref([])
const announcementsLoading = ref(false)
const announcementsError = ref('')
const lastReadAnnouncementId = ref(Number(localStorage.getItem('announcement-last-read-id')) || 0)
const shownAnnouncementPopupIds = ref(readShownAnnouncementPopupIds())
const hasUnreadAnnouncements = computed(() => announcements.value.some((announcement) => announcement.id > lastReadAnnouncementId.value))
const pendingPopupAnnouncements = computed(() => popupAnnouncements.value.filter((announcement) => !shownAnnouncementPopupIds.value.includes(announcement.id)))
const activePopupAnnouncement = computed(() => {
  if (!agreementAccepted.value || !freeNoticeAccepted.value) return null
  if (updateRequired.value) return null
  return pendingPopupAnnouncements.value[0] || null
})
let unsubscribeProgress = () => {}
let unsubscribeUpdates = () => {}

function readShownAnnouncementPopupIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem('announcement-shown-popup-ids') || '[]')
    return Array.isArray(parsed) ? parsed.filter((id) => Number.isInteger(id)) : []
  } catch {
    return []
  }
}

function replaceReactive(target, value) {
  Object.keys(target).forEach((key) => delete target[key])
  Object.assign(target, value || {})
}

async function loadInstallations() {
  replaceReactive(installations, await bridge.patches.listInstallations())
  await verifyInstallations()
}

async function verifyInstallations() {
  replaceReactive(installationChecks, await bridge.patches.verifyInstallations())
}

async function detectTargets(patches = catalogState.catalog?.patches || []) {
  const descriptors = patches.map((patch) => ({
    id: patch.id,
    targetKind: patch.targetKind,
    targetFolders: Array.isArray(patch.targetFolders) ? [...patch.targetFolders] : [],
    dualSim: describeDualSim(patch)
  }))
  replaceReactive(detectedTargets, await bridge.patches.detectTargets(descriptors))
}

// 目标路径选择顺序：手动指定 > 已安装记录 > 自动检测；双版本补丁按槽位分别解析
function resolveSlotTargetFor(patch, slotId) {
  return resolveSlotTarget({ targets, installations, detectedTargets }, patch, slotId)
}

async function reconcileInstallations(patches = catalogState.catalog?.patches || []) {
  const descriptors = createRecognitionDescriptors(patches)
  const targetPaths = Object.fromEntries(descriptors.map((patch) => [
    patch.id,
    isDualSimPatch(patch)
      ? Object.fromEntries(DUAL_SIM_SLOTS
        .map(({ id }) => [id, resolveSlotTargetFor(patch, id)])
        .filter(([, value]) => value))
      : targets[patch.id] || installations[patch.id]?.targetPath || detectedTargets[patch.id]?.targetPath || null
  ]))
  await bridge.patches.reconcileInstallations(descriptors, targetPaths)
}

async function refreshCatalog() {
  loadingCatalog.value = true
  catalogState.error = null
  try {
    Object.assign(catalogState, await bridge.catalog.refresh())
    await detectTargets(catalogState.catalog?.patches)
    await reconcileInstallations(catalogState.catalog?.patches)
    await loadInstallations()
  } catch (error) {
    catalogState.source = 'error'
    catalogState.error = error.message
    catalogState.catalog = { patches: [] }
  } finally {
    loadingCatalog.value = false
  }
}

async function chooseTarget(patch, slot = null) {
  const slotMeta = isDualSimPatch(patch)
    ? DUAL_SIM_SLOTS.find(({ id }) => id === (slot || 'msfs2024')) || null
    : null
  const selected = await bridge.patches.chooseTarget({
    title: slotMeta ? slotMeta.hint : manualTargetHint(patch),
    defaultPath: slotMeta
      ? resolveSlotTargetFor(patch, slotMeta.id) || undefined
      : targets[patch.id] || installations[patch.id]?.targetPath || detectedTargets[patch.id]?.targetPath || undefined
  })
  if (!selected) return
  if (slotMeta) {
    targets[patch.id] = { ...manualSlotPaths(targets, patch.id), [slotMeta.id]: selected }
  } else {
    targets[patch.id] = selected
  }
  localStorage.setItem('patch-targets', JSON.stringify(targets))
}

function clearTarget(patch, slot = null) {
  const patchId = typeof patch === 'string' ? patch : patch?.id
  if (patchId && isDualSimPatch({ id: patchId }) && slot) {
    const next = { ...manualSlotPaths(targets, patchId), [slot]: '' }
    if (next.msfs2024 || next.msfs2020) targets[patchId] = next
    else delete targets[patchId]
  } else {
    delete targets[patchId]
  }
  localStorage.setItem('patch-targets', JSON.stringify(targets))
}

// 把主进程解密出的正文 [{id, body}] 与渲染层章节元数据（标题）按 id 合并；
// 任一章节缺失正文都视为失败，避免出现可同意但不完整的协议
function mergeAgreementSections(loaded) {
  const sections = AGREEMENT_SECTIONS.map((section) => ({
    ...section,
    body: loaded.find((item) => item?.id === section.id)?.body || ''
  }))
  return sections.every((section) => section.body) ? sections : null
}

async function loadAgreementTexts() {
  if (agreementSections.value) return
  agreementTextsFailed.value = false
  try {
    const result = await bridge.legal.getAgreementText()
    agreementSections.value = result?.ok ? mergeAgreementSections(result.agreements || []) : null
  } catch {
    agreementSections.value = null
  }
  if (!agreementSections.value) agreementTextsFailed.value = true
}

watch(showAgreement, (open) => {
  if (open) void loadAgreementTexts()
}, { immediate: true })

function acceptAgreements() {
  const sections = agreementSections.value
  // 未取得完整协议全文（解密失败/离线）时绝不允许同意
  if (!sections || sections.length !== AGREEMENT_SECTIONS.length) return
  const previous = localStorage.getItem('msfs-cat-ch-agreements')
  localStorage.setItem('msfs-cat-ch-agreements', AGREEMENT_ACCEPTANCE_VALUE)
  agreementAccepted.value = true
  showAgreement.value = false
  showFreeNotice.value = true
  if (hasAcceptedAgreements(previous)) return // 同一修订版内重复确认，无需再次存证
  // 协议同意存证：先落本地待补报记录，再匿名上报服务器（fire-and-forget）
  const record = createPendingRecord({
    revision: AGREEMENT_REVISION,
    userAgreement: sections.find((section) => section.id === 'user')?.body || '',
    disclaimer: sections.find((section) => section.id === 'notice')?.body || ''
  })
  localStorage.setItem(PENDING_STORAGE_KEY, serializePendingRecord(record))
  void submitAgreementEvidence(record)
}

function declineAgreements() {
  // 用户最终未同意（或撤回同意）：丢弃未报成的旧存证，避免上报已撤回的同意
  localStorage.removeItem(PENDING_STORAGE_KEY)
  localStorage.removeItem('msfs-cat-ch-agreements')
  bridge.app.quit()
}

async function submitAgreementEvidence(record) {
  try {
    const result = await bridge.legal.reportAcceptance(pendingRecordToReportPayload(record))
    if (result?.ok) localStorage.removeItem(PENDING_STORAGE_KEY)
  } catch {
    // 上报失败保持暂存，等待下次启动补报
  }
}

async function retryPendingAgreementEvidence() {
  const record = parsePendingRecord(localStorage.getItem(PENDING_STORAGE_KEY))
  if (record) await submitAgreementEvidence(record)
}

function acknowledgeFreeNotice() {
  localStorage.setItem('msfs-cat-ch-free-notice', 'acknowledged-v1')
  freeNoticeAccepted.value = true
  showFreeNotice.value = false
}

async function loadAnnouncements() {
  announcementsLoading.value = true
  announcementsError.value = ''
  try {
    const [listResult, popupResult] = await Promise.all([
      bridge.announcements.list(),
      bridge.announcements.popup()
    ])
    if (listResult?.ok) {
      announcements.value = Array.isArray(listResult.announcements) ? listResult.announcements : []
    } else {
      announcementsError.value = listResult?.error || '公告获取失败，请稍后重试'
    }
    if (popupResult?.ok) {
      popupAnnouncements.value = Array.isArray(popupResult.announcements) ? popupResult.announcements : []
    }
  } catch {
    announcementsError.value = '公告获取失败，请稍后重试'
  } finally {
    announcementsLoading.value = false
  }
  if (activeView.value === 'announcements') markAnnouncementsRead()
}

function markAnnouncementsRead() {
  const maxId = announcements.value.reduce((max, announcement) => Math.max(max, announcement.id), 0)
  if (maxId <= lastReadAnnouncementId.value) return
  lastReadAnnouncementId.value = maxId
  localStorage.setItem('announcement-last-read-id', String(maxId))
}

function dismissAnnouncementPopup() {
  const announcement = activePopupAnnouncement.value
  if (!announcement) return
  const next = shownAnnouncementPopupIds.value.filter((id) => id !== announcement.id)
  next.push(announcement.id)
  shownAnnouncementPopupIds.value = next.slice(-ANNOUNCEMENT_POPUP_HISTORY_LIMIT)
  localStorage.setItem('announcement-shown-popup-ids', JSON.stringify(shownAnnouncementPopupIds.value))
}

watch(activeView, (view) => {
  if (view === 'announcements') markAnnouncementsRead()
})

function openAuthorPage() {
  bridge.external.open(AUTHOR_URL)
}

async function installPatch(patch) {
  const installTargets = collectInstallTargets({ targets, installations, detectedTargets }, patch)
  if (!installTargets.length) {
    operations[patch.id] = {
      busy: false,
      phase: 'error',
      percent: 0,
      message: isDualSimPatch(patch)
        ? '未找到 MSFS 2020/2024 的 A350 社区目录，请在设置中手动选择'
        : '请先在设置中选择安装目录'
    }
    return
  }

  operations[patch.id] = { busy: true, phase: 'prepare', percent: 0, message: '准备安装' }
  try {
    await bridge.patches.install(createInstallationRequest(patch), installTargets)
    await loadInstallations()
  } catch (error) {
    operations[patch.id] = { busy: false, phase: 'error', percent: 0, message: error.message }
    return
  }
  setTimeout(() => { delete operations[patch.id] }, 1800)
}

async function importPatch(patch) {
  const installTargets = collectInstallTargets({ targets, installations, detectedTargets }, patch)
  if (!installTargets.length) {
    operations[patch.id] = {
      busy: false,
      phase: 'error',
      percent: 0,
      message: isDualSimPatch(patch)
        ? '未找到 MSFS 2020/2024 的 A350 社区目录，请在设置中手动选择'
        : '请先在设置中选择安装目录'
    }
    return
  }

  const sourceArchivePath = await bridge.patches.choosePackage()
  if (!sourceArchivePath) return

  operations[patch.id] = { busy: true, phase: 'import', percent: 0, message: '正在导入离线补丁包' }
  try {
    await bridge.patches.installFromFile(createInstallationRequest(patch), installTargets, sourceArchivePath)
    await loadInstallations()
  } catch (error) {
    operations[patch.id] = { busy: false, phase: 'error', percent: 0, message: error.message }
    return
  }
  setTimeout(() => { delete operations[patch.id] }, 1800)
}

async function restorePatch(patch) {
  operations[patch.id] = { busy: true, phase: 'restore', percent: 35, message: '正在还原原文件' }
  try {
    const result = await bridge.patches.restore(patch.id)
    if (!result.restored) {
      operations[patch.id] = {
        busy: false,
        phase: 'error',
        percent: 0,
        message: `以下文件已被修改，未自动删除：${result.conflicts.join('、')}`
      }
      return
    }
    await loadInstallations()
    operations[patch.id] = { busy: false, phase: 'complete', percent: 100, message: '已还原原文件' }
    setTimeout(() => { delete operations[patch.id] }, 1800)
  } catch (error) {
    operations[patch.id] = { busy: false, phase: 'error', percent: 0, message: error.message }
  }
}

async function checkUpdate() {
  updateStatus.state = 'checking'
  try {
    Object.assign(updateStatus, await bridge.updates.check())
  } catch (error) {
    Object.assign(updateStatus, { state: 'error', message: error.message })
  }
}

onMounted(async () => {
  Object.assign(appInfo, await bridge.app.getInfo())
  unsubscribeProgress = bridge.patches.onProgress((progress) => {
    operations[progress.patchId] = { ...progress, busy: !['complete', 'error'].includes(progress.phase) }
  })
  unsubscribeUpdates = bridge.updates.onStatus((status) => Object.assign(updateStatus, status))
  Object.assign(updateStatus, await bridge.updates.status())
  await refreshCatalog()
  void loadAnnouncements()
  void retryPendingAgreementEvidence() // 离线时未报成的协议同意存证自动补报
})

onBeforeUnmount(() => {
  unsubscribeProgress()
  unsubscribeUpdates()
})
</script>

<template>
  <div class="app-frame">
    <TitleBar />
    <div class="workspace">
      <aside class="sidebar">
        <div class="brand-block">
          <img src="/logo.png" alt="MSFS_CAT_CH" />
          <div><strong>MSFS</strong><span>CAT CH</span></div>
          <button type="button" class="brand-bell" title="公告" aria-label="查看公告" @click="activeView = 'announcements'">
            <Bell :size="15" />
            <span v-if="hasUnreadAnnouncements" class="bell-dot" />
          </button>
        </div>

        <nav class="primary-nav" aria-label="主导航">
          <button type="button" :class="{ active: activeView === 'catalog' }" @click="activeView = 'catalog'">
            <Package :size="19" />
            <span>汉化补丁</span>
          </button>
          <button type="button" :class="{ active: activeView === 'feedback' }" @click="activeView = 'feedback'">
            <MessageSquareText :size="19" />
            <span>问题反馈</span>
          </button>
          <button type="button" :class="{ active: activeView === 'support' }" @click="activeView = 'support'">
            <Heart :size="19" />
            <span>赞助</span>
          </button>
          <button type="button" :class="{ active: activeView === 'settings' }" @click="activeView = 'settings'">
            <Settings :size="19" />
            <span>设置</span>
          </button>
        </nav>

        <div class="sidebar-footer">
          <span class="local-indicator" />
          <div><strong>本地模式</strong><small>v{{ appInfo.version }}</small></div>
        </div>
      </aside>

      <main class="content-area">
        <Transition name="view" mode="out-in">
          <CatalogView
            v-if="activeView === 'catalog'"
            key="catalog"
            :catalog-state="catalogState"
            :installations="installations"
            :installation-checks="installationChecks"
            :targets="targets"
            :detected-targets="detectedTargets"
            :operations="operations"
            :loading="loadingCatalog"
            @refresh="refreshCatalog"
            @install="installPatch"
            @import="importPatch"
            @restore="restorePatch"
            @verify="verifyInstallations"
            @author="bridge.external.open('https://space.bilibili.com/472309803?spm_id_from=333.1007.0.0')"
          />
          <FeedbackView
            v-else-if="activeView === 'feedback'"
            key="feedback"
            :bridge="bridge"
          />
          <AnnouncementsView
            v-else-if="activeView === 'announcements'"
            key="announcements"
            :announcements="announcements"
            :loading="announcementsLoading"
            :error="announcementsError"
            @reload="loadAnnouncements"
          />
          <SupportView
            v-else-if="activeView === 'support'"
            key="support"
          />
          <SettingsView
            v-else
            key="settings"
            :app-info="appInfo"
            :update-status="updateStatus"
            :patches="catalogState.catalog?.patches || []"
            :targets="targets"
            :detected-targets="detectedTargets"
            :installations="installations"
            @choose-target="chooseTarget"
            @clear-target="clearTarget"
            @check-update="checkUpdate"
            @open-link="bridge.external.open"
            @show-agreements="showAgreement = true"
          />
        </Transition>
      </main>
    </div>
    <AgreementDialog
      v-if="showAgreement"
      :required="!agreementAccepted"
      :sections="agreementSections"
      :load-failed="agreementTextsFailed"
      @retry="loadAgreementTexts"
      @accept="acceptAgreements"
      @decline="declineAgreements"
      @close="showAgreement = false"
    />
    <FreeNoticeDialog v-if="showFreeNotice" @continue="acknowledgeFreeNotice" @author="openAuthorPage" @support="activeView = 'support'" />
    <RequiredUpdateDialog v-if="updateRequired" :update-status="updateStatus" />
    <AnnouncementPopupDialog
      v-if="activePopupAnnouncement"
      :announcement="activePopupAnnouncement"
      @close="dismissAnnouncementPopup"
    />
  </div>
</template>
