<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Package, Settings } from '@lucide/vue'
import TitleBar from './components/TitleBar.vue'
import CatalogView from './views/CatalogView.vue'
import SettingsView from './views/SettingsView.vue'

const developmentBridge = {
  app: { getInfo: async () => ({ version: '0.1.0', platform: 'win32', packaged: false }) },
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
    listInstallations: async () => ({}),
    install: async () => { throw new Error('请在 Electron 中运行安装') },
    restore: async () => ({ restored: true, conflicts: [] }),
    onProgress: () => () => {}
  },
  updates: {
    check: async () => ({ state: 'development' }),
    download: async () => ({ state: 'development' }),
    install: async () => ({ state: 'development' }),
    onStatus: () => () => {}
  },
  external: { open: async () => false }
}

const bridge = window.gsxTool || developmentBridge
const activeView = ref('catalog')
const appInfo = reactive({ version: '0.1.0', platform: 'win32', packaged: false })
const catalogState = reactive({ catalog: null, source: 'idle', stale: false, error: null })
const installations = reactive({})
const targets = reactive(JSON.parse(localStorage.getItem('patch-targets') || '{}'))
const operations = reactive({})
const updateStatus = reactive({ state: 'idle', info: null, progress: null, message: '' })
const loadingCatalog = ref(false)
let unsubscribeProgress = () => {}
let unsubscribeUpdates = () => {}

function replaceReactive(target, value) {
  Object.keys(target).forEach((key) => delete target[key])
  Object.assign(target, value || {})
}

async function loadInstallations() {
  replaceReactive(installations, await bridge.patches.listInstallations())
}

async function refreshCatalog() {
  loadingCatalog.value = true
  catalogState.error = null
  try {
    Object.assign(catalogState, await bridge.catalog.refresh())
  } catch (error) {
    catalogState.source = 'error'
    catalogState.error = error.message
    catalogState.catalog = { patches: [] }
  } finally {
    loadingCatalog.value = false
  }
}

async function chooseTarget(patch) {
  const selected = await bridge.patches.chooseTarget({
    title: patch.targetHint,
    defaultPath: targets[patch.id] || installations[patch.id]?.targetPath
  })
  if (!selected) return
  targets[patch.id] = selected
  localStorage.setItem('patch-targets', JSON.stringify(targets))
}

async function installPatch(patch) {
  if (!targets[patch.id] && installations[patch.id]?.targetPath) {
    targets[patch.id] = installations[patch.id].targetPath
  }
  if (!targets[patch.id]) {
    await chooseTarget(patch)
  }
  if (!targets[patch.id]) return

  operations[patch.id] = { busy: true, phase: 'prepare', percent: 0, message: '准备安装' }
  try {
    await bridge.patches.install(patch, targets[patch.id])
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

async function downloadUpdate() {
  try {
    Object.assign(updateStatus, await bridge.updates.download())
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
  await Promise.all([refreshCatalog(), loadInstallations()])
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
          <img src="/logo.png" alt="GSX 汉化工具" />
          <div><strong>GSX</strong><span>中文工具</span></div>
        </div>

        <nav class="primary-nav" aria-label="主导航">
          <button type="button" :class="{ active: activeView === 'catalog' }" @click="activeView = 'catalog'">
            <Package :size="19" />
            <span>汉化补丁</span>
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
        <CatalogView
          v-if="activeView === 'catalog'"
          :catalog-state="catalogState"
          :installations="installations"
          :targets="targets"
          :operations="operations"
          :loading="loadingCatalog"
          @refresh="refreshCatalog"
          @choose-target="chooseTarget"
          @install="installPatch"
          @restore="restorePatch"
        />
        <SettingsView
          v-else
          :app-info="appInfo"
          :update-status="updateStatus"
          @check-update="checkUpdate"
          @download-update="downloadUpdate"
          @install-update="bridge.updates.install()"
          @open-link="bridge.external.open"
        />
      </main>
    </div>
  </div>
</template>
