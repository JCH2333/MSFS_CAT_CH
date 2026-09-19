<script setup>
import { computed, ref, watch } from 'vue'
import { ArrowDownNarrowWide, ArrowUpNarrowWide, PackageOpen, RefreshCw, ShieldCheck, ShieldAlert, Wifi, WifiOff } from '@lucide/vue'
import PatchCard from '../components/PatchCard.vue'
import { catalogSourcePresentation } from '../lib/catalog-source.mjs'
import { hasAnyTarget } from '../lib/dual-sim.mjs'
import { PATCH_SORT_FIELDS, normalizePatchSort, sortPatches } from '../lib/patch-sort.mjs'

const props = defineProps({
  catalogState: { type: Object, required: true },
  installations: { type: Object, required: true },
  installationChecks: { type: Object, required: true },
  targets: { type: Object, required: true },
  detectedTargets: { type: Object, required: true },
  operations: { type: Object, required: true },
  loading: { type: Boolean, default: false },
  // 启动期目录扫描/完整性校验进行中：禁用补丁操作按钮
  initializing: { type: Boolean, default: false }
})

defineEmits(['refresh', 'install', 'import', 'restore', 'verify', 'author'])

// 双版本补丁（A350 汉化）任一模拟器槽位有目标即可安装；单目标补丁维持原判断
function patchHasTarget(patch) {
  return hasAnyTarget(
    { targets: props.targets, installations: props.installations, detectedTargets: props.detectedTargets },
    patch
  )
}

// 排序状态持久化在本地：下载量 / 更新时间 / 首字母 × 升降序
const SORT_STORAGE_KEY = 'patch-catalog-sort'

function readSavedSort() {
  try {
    return normalizePatchSort(JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) || '{}'))
  } catch {
    return normalizePatchSort(null)
  }
}

const sortBy = ref(readSavedSort().sortBy)
const sortOrder = ref(readSavedSort().sortOrder)

watch([sortBy, sortOrder], () => {
  localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ sortBy: sortBy.value, sortOrder: sortOrder.value }))
})

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
}

const sortedPatches = computed(() => sortPatches(props.catalogState.catalog?.patches || [], sortBy.value, sortOrder.value))
const isAsc = computed(() => sortOrder.value === 'asc')
const orderTitle = computed(() => (isAsc.value ? '当前升序，点击切换为降序' : '当前降序，点击切换为升序'))

</script>

<template>
  <section class="view-shell">
    <div class="view-header">
      <div>
        <p class="eyebrow">PATCH CATALOG</p>
        <h1>汉化补丁</h1>
      </div>
      <div class="header-actions">
        <div class="sort-control" role="group" aria-label="补丁排序">
          <label class="sort-field">
            <select v-model="sortBy" aria-label="排序依据">
              <option v-for="field in PATCH_SORT_FIELDS" :key="field.id" :value="field.id">{{ field.label }}</option>
            </select>
          </label>
          <button class="sort-order" type="button" :title="orderTitle" :aria-label="orderTitle" @click="toggleSortOrder">
            <ArrowUpNarrowWide v-if="isAsc" :size="15" />
            <ArrowDownNarrowWide v-else :size="15" />
          </button>
        </div>
        <div class="source-status" :data-offline="!catalogSourcePresentation(catalogState.source).online">
          <Wifi v-if="catalogSourcePresentation(catalogState.source).online" :size="15" />
          <WifiOff v-else :size="15" />
          <span>{{ catalogSourcePresentation(catalogState.source).label }}</span>
        </div>
        <button class="icon-button" type="button" title="刷新补丁目录" aria-label="刷新补丁目录" :disabled="loading" @click="$emit('refresh')">
          <RefreshCw :size="18" :class="{ spinning: loading }" />
        </button>
      </div>
    </div>

    <div v-if="catalogState.error" class="inline-alert">{{ catalogState.error }}</div>

    <div v-if="Object.keys(installations).length" class="verification-bar">
      <div>
        <ShieldCheck v-if="Object.values(installationChecks).every((check) => check.state === 'intact')" :size="18" />
        <ShieldAlert v-else :size="18" />
        <span>{{ Object.values(installationChecks).every((check) => check.state === 'intact') ? '已检查：已安装文件完整' : '发现文件被修改或缺失，请重新安装或还原' }}</span>
      </div>
      <button class="button button-secondary" type="button" :disabled="loading" @click="$emit('verify')">
        <RefreshCw :size="16" :class="{ spinning: loading }" />
        检查完整性
      </button>
    </div>

    <div v-if="catalogState.catalog?.patches?.length" class="patch-list compact-card-grid">
      <PatchCard
        v-for="patch in sortedPatches"
        :key="patch.id"
        :patch="patch"
        :installation="installations[patch.id]"
        :installation-check="installationChecks[patch.id] || null"
        :target-ready="patchHasTarget(patch)"
        :detected-target="detectedTargets[patch.id] || null"
        :progress="operations[patch.id] || null"
        :busy="operations[patch.id]?.busy || false"
        :initializing="initializing"
        @install="$emit('install', patch)"
        @import="$emit('import', patch)"
        @restore="$emit('restore', patch)"
        @author="$emit('author')"
      />
    </div>

    <div v-else-if="!loading" class="empty-state">
      <PackageOpen :size="36" stroke-width="1.5" />
      <h2>暂无已发布补丁</h2>
      <p>补丁仓库已经就绪，最新版本完成后会显示在这里。</p>
    </div>

    <div v-else class="catalog-loading">
      <RefreshCw :size="24" class="spinning" />
      <span>正在读取云端补丁目录</span>
    </div>
  </section>
</template>
