<script setup>
import { Download, LoaderCircle, RotateCw } from '@lucide/vue'

defineProps({
  updateStatus: { type: Object, required: true }
})

defineEmits(['download', 'install'])
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="required-update-dialog" role="dialog" aria-modal="true" aria-labelledby="required-update-title">
      <div class="required-update-icon"><Download :size="28" /></div>
      <p class="eyebrow">REQUIRED UPDATE</p>
      <h2 id="required-update-title">需要更新才能继续使用</h2>
      <p>发现新版本 v{{ updateStatus.info?.version || '' }}。请完成更新后继续使用 MSFS CAT CH。</p>

      <div v-if="updateStatus.state === 'downloading'" class="required-update-progress" aria-live="polite">
        <LoaderCircle :size="19" class="support-qr-spinner" />
        <span>正在下载更新 {{ Math.round(updateStatus.progress?.percent || 0) }}%</span>
      </div>

      <button
        v-else-if="updateStatus.state === 'available'"
        class="button button-primary required-update-action"
        type="button"
        @click="$emit('download')"
      >
        <Download :size="17" />立即下载更新
      </button>
      <button
        v-else-if="updateStatus.state === 'downloaded'"
        class="button button-primary required-update-action"
        type="button"
        @click="$emit('install')"
      >
        <RotateCw :size="17" />立即重启并安装
      </button>
    </section>
  </div>
</template>
