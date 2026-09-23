<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Heart, LoaderCircle, MessageCircleHeart, TriangleAlert } from '@lucide/vue'

const qrDataUrl = ref('')
const qrStatus = ref('loading')
const danmakuRows = ref([])

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

// 弹幕：留言随机洗牌（忽略展示顺序），按行拆分后从右向左循环飘过；
// 每行速度不同制造错落感，悬停暂停。
const DANMAKU_BASE_SECONDS = 20
const danmakuStyle = computed(() => (row, index) => ({
  animationDuration: `${Math.max(22, DANMAKU_BASE_SECONDS + row.length * 1.6 + index * 6)}s`
}))

function shuffle(list) {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function buildDanmakuRows(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return []
  const texts = shuffle(messages.map((message) => message.content.trim()).filter(Boolean))
  if (texts.length === 0) return []
  const perRow = texts.length >= 6 ? 2 : 1
  const rows = Array.from({ length: perRow }, () => [])
  texts.forEach((text, index) => rows[index % perRow].push(text))
  // 每行内容至少铺满 8 条（不足则整组重复），再复制一份实现无缝循环
  return rows
    .filter((row) => row.length > 0)
    .map((row) => {
      const filled = []
      while (filled.length < 8) filled.push(...row)
      return [...filled, ...filled]
    })
}

async function loadDanmaku() {
  try {
    const result = await window.gsxTool?.support?.messages?.()
    if (result?.ok) danmakuRows.value = buildDanmakuRows(result.messages)
  } catch {
    danmakuRows.value = []
  }
}

let qrTimer = null
// 每次进入赞助页都重新从分发服务器拉取并解密赞助码。
onMounted(() => {
  loadQr()
  loadDanmaku()
  qrTimer = setInterval(() => {
    loadQr()
    loadDanmaku()
  }, 5 * 60 * 1000)
})
onBeforeUnmount(() => {
  if (qrTimer) clearInterval(qrTimer)
})
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
      <small class="support-author-line">作者：b站 一只剑齿虎呀</small>
    </div>

    <div v-if="danmakuRows.length" class="danmaku-area" role="marquee" aria-label="赞助者留言">
      <p class="eyebrow danmaku-eyebrow"><MessageCircleHeart :size="12" />SPONSOR WALL</p>
      <div v-for="(row, rowIndex) in danmakuRows" :key="rowIndex" class="danmaku-row">
        <div class="danmaku-track" :style="danmakuStyle(row, rowIndex)">
          <span v-for="(text, index) in row" :key="index" class="danmaku-item">
            {{ text }}<span class="danmaku-sep">✦</span>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 弹幕区：赞助码下方整宽横条，留言循环滚动，悬停暂停 */
.danmaku-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(26, 28, 24, 0.5);
  overflow: hidden;
}
.danmaku-eyebrow { display: flex; align-items: center; gap: 5px; margin: 0 0 2px; opacity: 0.85; }
.danmaku-row { overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
.danmaku-track {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  width: max-content;
  animation: danmaku-scroll linear infinite;
}
.danmaku-row:hover .danmaku-track { animation-play-state: paused; }
.danmaku-item {
  display: inline-flex;
  align-items: center;
  padding: 4px 0;
  margin-right: 26px;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
}
.danmaku-sep { margin-left: 26px; color: var(--signal); opacity: 0.6; font-size: 10px; }
@keyframes danmaku-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
@media (prefers-reduced-motion: reduce) {
  .danmaku-track { animation: none; }
}
</style>
