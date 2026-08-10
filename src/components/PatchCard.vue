<script setup>
import { computed } from 'vue'
import { Download, FolderUp, Heart, MapPin, ShieldAlert, ShieldCheck, RotateCcw, UserRound } from '@lucide/vue'
import { compareVersions } from '../lib/versioning'

const props = defineProps({
  patch: { type: Object, required: true },
  installation: { type: Object, default: null },
  installationCheck: { type: Object, default: null },
  progress: { type: Object, default: null },
  detectedTarget: { type: Object, default: null },
  targetReady: { type: Boolean, default: false },
  busy: { type: Boolean, default: false }
})

defineEmits(['install', 'import', 'restore', 'author'])

const published = computed(() => props.patch.status === 'published')
const versionComparison = computed(() => props.installation ? compareVersions(props.patch.version, props.installation.version) : 0)
const needsInstall = computed(() => !props.installation || versionComparison.value > 0 || props.installationCheck?.state !== 'intact')
const status = computed(() => {
  if (!published.value) return { label: '等待发布', tone: 'muted' }
  if (props.installationCheck && props.installationCheck.state !== 'intact') return { label: '需要修复', tone: 'danger' }
  if (versionComparison.value > 0) return { label: '可更新', tone: 'warning' }
  if (versionComparison.value < 0) return { label: '本地版本较新', tone: 'muted' }
  if (props.installation?.source === 'detected') return { label: '已识别安装', tone: 'success' }
  if (props.installation) return { label: '已安装', tone: 'success' }
  return { label: '未安装', tone: 'neutral' }
})

const verificationLabel = computed(() => {
  if (!props.installation) return ''
  if (!props.installationCheck) return '尚未检查文件完整性'
  if (props.installationCheck.state === 'intact') return `已验证 ${props.installationCheck.checkedFiles} 个文件`
  const changed = props.installationCheck.modifiedFiles?.length || 0
  const missing = props.installationCheck.missingFiles?.length || 0
  return `需处理：${changed} 个已修改，${missing} 个缺失`
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
          <span>{{ patch.addonVersion ? `插件 v${patch.addonVersion}` : '插件版本未声明' }}</span>
          <strong>补丁 v{{ patch.version }}</strong>
        </div>
      </div>

      <p class="patch-summary">{{ patch.summary || 'GSX 简体中文补丁' }}</p>
      <div class="patch-free-note"><span>补丁完全免费</span><button type="button" @click="$emit('author')"><UserRound :size="13" />B站 一只剑齿虎呀</button></div>

      <div class="patch-meta">
        <span v-for="item in patch.compatibility" :key="item">{{ item }}</span>
        <span v-if="packageSize">{{ packageSize }}</span>
        <span v-if="installation">本机 v{{ installation.version }}</span>
        <span v-else-if="detectedTarget"><MapPin :size="11" /> {{ detectedTarget.source }}</span>
      </div>

      <div v-if="progress" class="operation-progress" :data-error="progress.phase === 'error'">
        <div class="progress-track"><span :style="{ width: `${progress.percent || 0}%` }" /></div>
        <span>{{ progress.message }}</span>
      </div>
    </div>

    <div class="patch-actions">
      <div v-if="installation" class="verified-copy">
        <ShieldCheck v-if="installationCheck?.state === 'intact'" :size="16" />
        <ShieldAlert v-else :size="16" />
        <span>{{ verificationLabel }} · {{ new Date(installation.installedAt).toLocaleDateString('zh-CN') }}</span>
      </div>
      <div class="action-buttons">
        <button v-if="installation && installation.source !== 'detected'" class="button button-secondary" type="button" :disabled="busy" @click="$emit('restore', patch)">
          <RotateCcw :size="17" />
          还原
        </button>
        <button v-if="needsInstall" class="button button-primary" type="button" :disabled="busy || !published" @click="$emit('install', patch)">
          <Download :size="17" />
          {{ installationCheck?.state !== 'intact' && installation ? '重新安装补丁' : installation ? '更新补丁' : targetReady ? '安装补丁' : '前往设置' }}
        </button>
        <button v-if="patch.targetKind === 'gsx-audio' && needsInstall" class="button button-secondary" type="button" :disabled="busy || !published" @click="$emit('import', patch)">
          <FolderUp :size="17" />
          导入离线包
        </button>
        <button class="text-action" type="button" @click="$emit('author')"><Heart :size="14" />完全免费制作，关注作者</button>
      </div>
    </div>
  </article>
</template>
