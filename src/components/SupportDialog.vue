<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Heart, LoaderCircle, TriangleAlert, X } from '@lucide/vue'
import { SUPPORT_QR_SOURCES } from '../lib/support-qr.mjs'

defineEmits(['close'])

const qrUrl = ref('')
const qrStatus = ref('loading')
let fallbackTimer = null
let sourceIndex = 0

function clearFallbackTimer() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
}

function loadQr(index) {
  const entry = SUPPORT_QR_SOURCES[index]
  if (!entry) {
    clearFallbackTimer()
    qrStatus.value = 'error'
    return
  }

  sourceIndex = index
  qrStatus.value = index === 0 ? 'gitee-loading' : 'fallback-loading'
  const image = new Image()
  image.onload = () => {
    if (sourceIndex !== index) return
    clearFallbackTimer()
    qrUrl.value = entry.url
    qrStatus.value = entry.source
  }
  image.onerror = () => {
    if (sourceIndex === index) useFallback()
  }
  image.src = entry.url
}

function useFallback() {
  clearFallbackTimer()
  loadQr(sourceIndex + 1)
}

onMounted(() => {
  loadQr(0)
  fallbackTimer = setTimeout(() => {
    if (!qrUrl.value && sourceIndex === 0) useFallback()
  }, 2000)
})

onBeforeUnmount(clearFallbackTimer)
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="support-dialog" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <button class="dialog-icon-close" type="button" title="关闭" @click="$emit('close')"><X :size="18" /></button>
      <Heart :size="25" />
      <p class="eyebrow">OPTIONAL SUPPORT</p>
      <h2 id="support-title">赞助支持</h2>
      <p>免费制作更新不易，还请各位大佬支持！</p>
      <img v-if="qrUrl" :src="qrUrl" alt="微信赞助收款码" />
      <div v-else-if="qrStatus !== 'error'" class="support-qr-state" aria-live="polite">
        <LoaderCircle :size="22" class="support-qr-spinner" />
        <span>{{ qrStatus === 'fallback-loading' ? 'Gitee 加载较慢，正在切换备用源…' : '正在从 Gitee 加载赞助码…' }}</span>
      </div>
      <div v-else class="support-qr-state support-qr-error" role="alert">
        <TriangleAlert :size="22" />
        <span>赞助码暂时无法加载，请检查网络后重新打开此窗口。</span>
      </div>
      <small>微信扫码赞助，金额完全自愿。</small>
    </section>
  </div>
</template>
