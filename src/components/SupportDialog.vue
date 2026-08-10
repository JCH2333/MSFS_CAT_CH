<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Heart, LoaderCircle, TriangleAlert, X } from '@lucide/vue'

defineEmits(['close'])

const githubQrUrl = 'https://raw.githubusercontent.com/JCH2333/MSFS_CAT_CH/main/remote-assets/wechat-support.jpg'
const mirrorQrUrl = `https://ghfast.top/${githubQrUrl}`
const qrUrl = ref('')
const qrStatus = ref('loading')
let fallbackTimer = null
let hasFallenBack = false

function clearFallbackTimer() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
}

function loadQr(url, source) {
  const image = new Image()
  image.onload = () => {
    clearFallbackTimer()
    qrUrl.value = url
    qrStatus.value = source
  }
  image.onerror = () => {
    if (source === 'github') {
      useMirror()
      return
    }
    clearFallbackTimer()
    qrStatus.value = 'error'
  }
  image.src = url
}

function useMirror() {
  if (hasFallenBack) return
  hasFallenBack = true
  clearFallbackTimer()
  qrStatus.value = 'mirror-loading'
  loadQr(mirrorQrUrl, 'mirror')
}

onMounted(() => {
  loadQr(githubQrUrl, 'github')
  fallbackTimer = setTimeout(useMirror, 2000)
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
        <span>{{ qrStatus === 'mirror-loading' ? 'GitHub 连接超时，正在切换国内镜像…' : '正在从 GitHub 加载赞助码…' }}</span>
      </div>
      <div v-else class="support-qr-state support-qr-error" role="alert">
        <TriangleAlert :size="22" />
        <span>赞助码暂时无法加载，请检查网络后重新打开此窗口。</span>
      </div>
      <small>微信扫码赞助，金额完全自愿。</small>
    </section>
  </div>
</template>
