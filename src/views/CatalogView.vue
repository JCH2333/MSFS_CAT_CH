<script setup>
import { PackageOpen, RefreshCw, ShieldCheck, ShieldAlert, Wifi, WifiOff } from '@lucide/vue'
import PatchCard from '../components/PatchCard.vue'

const props = defineProps({
  catalogState: { type: Object, required: true },
  installations: { type: Object, required: true },
  installationChecks: { type: Object, required: true },
  targets: { type: Object, required: true },
  detectedTargets: { type: Object, required: true },
  operations: { type: Object, required: true },
  loading: { type: Boolean, default: false }
})

defineEmits(['refresh', 'install', 'restore', 'verify', 'author'])

</script>

<template>
  <section class="view-shell">
    <div class="view-header">
      <div>
        <p class="eyebrow">PATCH CATALOG</p>
        <h1>汉化补丁</h1>
      </div>
      <div class="header-actions">
        <div class="source-status" :data-offline="catalogState.source !== 'github'">
          <Wifi v-if="catalogState.source === 'github'" :size="15" />
          <WifiOff v-else :size="15" />
          <span>{{ catalogState.source === 'github' ? 'GitHub 已同步' : catalogState.source === 'cache' ? '使用本地缓存' : '等待同步' }}</span>
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
        v-for="patch in catalogState.catalog.patches"
        :key="patch.id"
        :patch="patch"
        :installation="installations[patch.id]"
        :installation-check="installationChecks[patch.id] || null"
        :target-ready="Boolean(targets[patch.id] || installations[patch.id]?.targetPath || detectedTargets[patch.id]?.targetPath)"
        :detected-target="detectedTargets[patch.id] || null"
        :progress="operations[patch.id] || null"
        :busy="operations[patch.id]?.busy || false"
        @install="$emit('install', patch)"
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
      <span>正在读取 GitHub 补丁目录</span>
    </div>
  </section>
</template>
