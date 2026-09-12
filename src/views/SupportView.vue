<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Heart, LoaderCircle, TriangleAlert } from '@lucide/vue'
import { SUPPORT_QR_SOURCES } from '../lib/support-qr.mjs'

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
  qrStatus.value = 'loading'
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
  <section class="view-shell support-view">
    <div class="view-header">
      <div>
        <p class="eyebrow">OPTIONAL SUPPORT</p>
        <h1>赞助支持</h1>
      </div>
      <Heart :size="24" class="view-header-glyph" />
    </div>

    <div class="support-panel">
      <p>免费制作更新不易，还请各位大佬支持！</p>
      <img v-if="qrUrl" :src="qrUrl" alt="微信赞助收款码" />
      <div v-else-if="qrStatus !== 'error'" class="support-qr-state" aria-live="polite">
        <LoaderCircle :size="22" class="support-qr-spinner" />
        <span>正在加载赞助码…</span>
      </div>
      <div v-else class="support-qr-state support-qr-error" role="alert">
        <TriangleAlert :size="22" />
        <span>赞助码暂时无法加载，请检查网络后重试。</span>
      </div>
      <small>微信扫码赞助，金额完全自愿。</small>
    </div>
  </section>
</template>
