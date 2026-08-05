<script setup>
import { computed } from 'vue'
import { CheckCircle2, Download, ExternalLink, GitBranch, RefreshCw, RotateCw } from '@lucide/vue'

const props = defineProps({
  appInfo: { type: Object, required: true },
  updateStatus: { type: Object, required: true }
})

defineEmits(['check-update', 'download-update', 'install-update', 'open-link'])

const updateLabel = computed(() => {
  const labels = {
    idle: '尚未检查',
    checking: '正在检查',
    current: '当前已是最新版本',
    available: `发现 v${props.updateStatus.info?.version || ''}`,
    downloading: `下载中 ${Math.round(props.updateStatus.progress?.percent || 0)}%`,
    downloaded: '更新已下载',
    development: '开发模式',
    error: props.updateStatus.message || '检查失败'
  }
  return labels[props.updateStatus.state] || props.updateStatus.state
})
</script>

<template>
  <section class="view-shell settings-view">
    <div class="view-header">
      <div>
        <p class="eyebrow">LOCAL SETTINGS</p>
        <h1>设置</h1>
      </div>
    </div>

    <div class="settings-band">
      <div class="settings-copy">
        <span class="settings-label">软件版本</span>
        <strong>v{{ appInfo.version }}</strong>
        <span class="settings-detail">{{ updateLabel }}</span>
      </div>
      <div class="settings-actions">
        <button v-if="updateStatus.state === 'available'" class="button button-primary" type="button" @click="$emit('download-update')">
          <Download :size="17" />
          下载更新
        </button>
        <button v-else-if="updateStatus.state === 'downloaded'" class="button button-primary" type="button" @click="$emit('install-update')">
          <RotateCw :size="17" />
          重启安装
        </button>
        <button v-else class="button button-secondary" type="button" :disabled="updateStatus.state === 'checking' || updateStatus.state === 'downloading'" @click="$emit('check-update')">
          <RefreshCw :size="17" :class="{ spinning: updateStatus.state === 'checking' }" />
          检查更新
        </button>
      </div>
    </div>

    <div class="settings-list">
      <button class="repository-row" type="button" @click="$emit('open-link', 'https://github.com/JCH2333/gsx-chinese-tool')">
        <GitBranch :size="20" />
        <span><strong>软件仓库</strong><small>JCH2333/gsx-chinese-tool</small></span>
        <ExternalLink :size="17" />
      </button>
      <button class="repository-row" type="button" @click="$emit('open-link', 'https://github.com/JCH2333/gsx-chinese-patches')">
        <GitBranch :size="20" />
        <span><strong>补丁仓库</strong><small>JCH2333/gsx-chinese-patches</small></span>
        <ExternalLink :size="17" />
      </button>
    </div>

    <div class="privacy-line">
      <CheckCircle2 :size="17" />
      <span>不需要账号，不上传使用记录</span>
    </div>
  </section>
</template>
