<script setup>
import { onMounted, ref } from 'vue'
import { Heart, LoaderCircle, TriangleAlert } from '@lucide/vue'

const qrDataUrl = ref('')
const qrStatus = ref('loading')

async function loadQr() {
  qrDataUrl.value = ''
  qrStatus.value = 'loading'
  try {
    const result = await window.gsxTool?.support?.qr?.()
    if (result?.ok && typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:image/')) {
      qrDataUrl.value = result.dataUrl
      qrStatus.value = 'ready'
      return
    }
  } catch {
    // 桥不可用时按加载失败处理，不让页面抛错。
  }
  qrStatus.value = 'error'
}

// 每次进入赞助页都重新从分发服务器拉取并解密赞助码。
onMounted(loadQr)
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
      <img v-if="qrDataUrl" :src="qrDataUrl" alt="微信赞助收款码" />
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
