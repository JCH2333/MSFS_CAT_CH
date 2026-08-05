<script setup>
import { computed } from 'vue'
import { Download, FolderSearch, RotateCcw, ShieldCheck } from '@lucide/vue'

const props = defineProps({
  patch: { type: Object, required: true },
  installation: { type: Object, default: null },
  progress: { type: Object, default: null },
  targetPath: { type: String, default: '' },
  busy: { type: Boolean, default: false }
})

defineEmits(['choose-target', 'install', 'restore'])

const published = computed(() => props.patch.status === 'published')
const hasUpdate = computed(() => props.installation && props.installation.version !== props.patch.version)
const status = computed(() => {
  if (!published.value) return { label: '等待发布', tone: 'muted' }
  if (hasUpdate.value) return { label: '可更新', tone: 'warning' }
  if (props.installation) return { label: '已安装', tone: 'success' }
  return { label: '未安装', tone: 'neutral' }
})

const packageSize = computed(() => {
  const size = props.patch.package?.size || 0
  if (!size) return ''
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${Math.ceil(size / 1024)} KB`
})
</script>

<template>
  <article class="patch-card">
    <div class="patch-card-main">
      <div class="patch-heading-row">
        <div class="patch-title-group">
          <h2>{{ patch.name }}</h2>
          <span class="status-badge" :data-tone="status.tone">{{ status.label }}</span>
        </div>
        <div class="version-block">
          <span>最新版本</span>
          <strong>v{{ patch.version }}</strong>
        </div>
      </div>

      <p class="patch-summary">{{ patch.summary || 'GSX 简体中文补丁' }}</p>

      <div class="patch-meta">
        <span v-for="item in patch.compatibility" :key="item">{{ item }}</span>
        <span v-if="packageSize">{{ packageSize }}</span>
        <span v-if="installation">本机 v{{ installation.version }}</span>
      </div>

      <div class="target-row">
        <div class="target-copy">
          <span class="field-label">安装目录</span>
          <span class="target-value" :title="targetPath || patch.targetHint">
            {{ targetPath || installation?.targetPath || patch.targetHint }}
          </span>
        </div>
        <button class="icon-button" type="button" title="选择安装目录" aria-label="选择安装目录" :disabled="busy" @click="$emit('choose-target', patch)">
          <FolderSearch :size="18" />
        </button>
      </div>

      <div v-if="progress" class="operation-progress" :data-error="progress.phase === 'error'">
        <div class="progress-track"><span :style="{ width: `${progress.percent || 0}%` }" /></div>
        <span>{{ progress.message }}</span>
      </div>
    </div>

    <div class="patch-actions">
      <div v-if="installation" class="verified-copy">
        <ShieldCheck :size="16" />
        <span>{{ new Date(installation.installedAt).toLocaleDateString('zh-CN') }}</span>
      </div>
      <div class="action-buttons">
        <button v-if="installation" class="button button-secondary" type="button" :disabled="busy" @click="$emit('restore', patch)">
          <RotateCcw :size="17" />
          还原
        </button>
        <button class="button button-primary" type="button" :disabled="busy || !published" @click="$emit('install', patch)">
          <Download :size="17" />
          {{ installation ? '更新补丁' : '安装补丁' }}
        </button>
      </div>
    </div>
  </article>
</template>
