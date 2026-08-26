<script setup>
import { Download, LoaderCircle, RotateCw } from '@lucide/vue'

defineProps({
  updateStatus: { type: Object, required: true }
})
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
      <div v-else class="required-update-progress" aria-live="polite">
        <RotateCw v-if="updateStatus.state === 'installing'" :size="19" class="support-qr-spinner" />
        <Download v-else :size="19" />
        <span>{{ updateStatus.state === 'installing' ? '更新已下载，正在重启并安装' : '已发现新版本，正在自动开始更新' }}</span>
      </div>
    </section>
  </div>
</template>
