<script setup>
import { computed, ref } from 'vue'
import {
  Check,
  CheckCircle2,
  Copy,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert
} from '@lucide/vue'

const props = defineProps({
  bridge: { type: Object, required: true }
})

const MAX_IMAGES = 10
const MAX_CONTENT_LENGTH = 2000
const MAX_USERNAME_LENGTH = 50

const content = ref('')
const username = ref('')
const images = ref([])
const submitting = ref(false)
const submitted = ref(false)
const feedbackCode = ref('')
const codeCopied = ref(false)
const errorMessage = ref('')

const canSubmit = computed(() => !submitting.value && !submitted.value && content.value.trim().length > 0)

// ─── 反馈码查询 ───
const queryCode = ref('')
const querying = ref(false)
const queryResult = ref(null)
const queryError = ref('')

function removeImage(index) {
  if (submitting.value) return
  images.value.splice(index, 1)
}

async function chooseImages() {
  if (submitting.value || submitted.value) return
  try {
    const selected = await props.bridge.feedback.chooseImages()
    if (!Array.isArray(selected) || selected.length === 0) return
    if (images.value.length + selected.length > MAX_IMAGES) {
      errorMessage.value = `截图最多添加 ${MAX_IMAGES} 张`
      return
    }
    images.value.push(...selected)
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error.message
  }
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    const result = await props.bridge.feedback.submit({
      content: content.value,
      username: username.value,
      images: images.value.map((image) => image.base64)
    })
    if (result?.ok) {
      feedbackCode.value = result.feedbackCode || ''
      submitted.value = true
      return
    }
    errorMessage.value = result?.reason === 'rate-limited'
      ? '今日反馈次数已达上限'
      : result?.message || '反馈提交失败，请稍后再试'
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    submitting.value = false
  }
}

async function copyFeedbackCode() {
  if (!feedbackCode.value) return
  try {
    await navigator.clipboard.writeText(feedbackCode.value)
    codeCopied.value = true
    setTimeout(() => { codeCopied.value = false }, 1600)
  } catch {
    // 剪贴板不可用时的降级方案
    const helper = document.createElement('textarea')
    helper.value = feedbackCode.value
    helper.style.position = 'fixed'
    helper.style.opacity = '0'
    document.body.appendChild(helper)
    helper.select()
    try { document.execCommand('copy') } catch { /* 忽略 */ }
    document.body.removeChild(helper)
    codeCopied.value = true
    setTimeout(() => { codeCopied.value = false }, 1600)
  }
}

function resetForm() {
  content.value = ''
  username.value = ''
  images.value = []
  errorMessage.value = ''
  submitted.value = false
  feedbackCode.value = ''
}

async function queryStatus() {
  if (!queryCode.value.trim() || querying.value) return
  querying.value = true
  queryError.value = ''
  queryResult.value = null
  try {
    const result = await props.bridge.feedback.query(queryCode.value.trim())
    if (result?.ok) {
      queryResult.value = result
    } else {
      queryError.value = result?.error || '查询失败，请稍后再试'
    }
  } catch (error) {
    queryError.value = error.message
  } finally {
    querying.value = false
  }
}

const queryStatusText = computed(() => {
  switch (queryResult.value?.status) {
    case 'PENDING': return '未处理'
    case 'PROCESSED': return '已处理'
    case 'NOT_FOUND': return '反馈码不存在'
    case 'EXPIRED': return '已过保留期'
    default: return ''
  }
})

function resetQuery() {
  queryCode.value = ''
  queryResult.value = null
  queryError.value = ''
}
</script>

<template>
  <section class="view-shell feedback-view">
    <div class="view-header">
      <div>
        <p class="eyebrow">FEEDBACK</p>
        <h1>问题反馈</h1>
      </div>
      <MessageSquareText :size="24" class="view-header-glyph" />
    </div>

    <div class="feedback-panel">
      <template v-if="!submitted">
        <p class="feedback-privacy"><ShieldCheck :size="15" />仅提交你填写的内容和截图；提交后获得反馈码，可随时查询处理进度</p>
        <div class="feedback-editor">
          <textarea
            v-model="content"
            rows="7"
            maxlength="2000"
            placeholder="请描述遇到的问题，例如：补丁安装失败、界面显示异常、模拟器内出现乱码…"
            :disabled="submitting"
          ></textarea>
          <span class="feedback-counter">{{ content.length }}/{{ MAX_CONTENT_LENGTH }}</span>
        </div>

        <div class="feedback-username">
          <input
            v-model="username"
            type="text"
            :maxlength="MAX_USERNAME_LENGTH"
            placeholder="用户名（选填）"
            :disabled="submitting"
          />
          <span>留空则匿名提交</span>
        </div>

        <div v-if="images.length" class="feedback-images">
          <figure v-for="(image, index) in images" :key="`${image.name}-${index}`" class="feedback-image">
            <img :src="`data:${image.type};base64,${image.base64}`" :alt="image.name" />
            <button class="icon-button" type="button" title="移除截图" aria-label="移除截图" :disabled="submitting" @click="removeImage(index)">
              <Trash2 :size="14" />
            </button>
          </figure>
        </div>

        <button
          class="button button-secondary feedback-add-images"
          type="button"
          :disabled="submitting || images.length >= MAX_IMAGES"
          @click="chooseImages"
        >
          <Paperclip :size="16" />
          {{ images.length >= MAX_IMAGES ? `已达 ${MAX_IMAGES} 张截图上限` : `添加截图（最多 ${MAX_IMAGES} 张，每张不超过 5MB）` }}
        </button>

        <div v-if="errorMessage" class="feedback-alert" role="alert">
          <TriangleAlert :size="16" />
          <span>{{ errorMessage }}</span>
        </div>

        <div class="dialog-actions">
          <button class="button button-primary" type="button" :disabled="!canSubmit" @click="submit">
            <LoaderCircle v-if="submitting" :size="16" class="feedback-spinner" />
            <Send v-else :size="16" />
            {{ submitting ? '正在提交…' : '提交反馈' }}
          </button>
        </div>
      </template>

      <div v-else class="feedback-success" aria-live="polite">
        <CheckCircle2 :size="30" />
        <strong>反馈已提交</strong>
        <p>感谢你的反馈，我们会尽快查看并处理。</p>
        <div v-if="feedbackCode" class="feedback-code-box">
          <span class="feedback-code-label">你的反馈码</span>
          <div class="feedback-code-row">
            <code class="feedback-code">{{ feedbackCode }}</code>
            <button class="button button-secondary feedback-code-copy" type="button" @click="copyFeedbackCode">
              <Check v-if="codeCopied" :size="14" />
              <Copy v-else :size="14" />
              {{ codeCopied ? '已复制' : '复制' }}
            </button>
          </div>
          <small>请保存反馈码，可随时在下方查询处理进度与管理员回复</small>
        </div>
        <button class="button button-primary" type="button" @click="resetForm">继续填写</button>
      </div>
    </div>

    <div class="feedback-panel feedback-query">
      <p class="eyebrow feedback-query-title"><Search :size="13" />查询反馈进度</p>
      <div class="feedback-query-row">
        <input
          v-model="queryCode"
          type="text"
          placeholder="输入反馈码，例如 FB-ABC123"
          :disabled="querying"
          @keydown.enter="queryStatus"
        />
        <button class="button button-primary" type="button" :disabled="!queryCode.trim() || querying" @click="queryStatus">
          <LoaderCircle v-if="querying" :size="15" class="feedback-spinner" />
          <Search v-else :size="15" />
          查询
        </button>
      </div>

      <div v-if="queryError" class="feedback-alert" role="alert">
        <TriangleAlert :size="16" />
        <span>{{ queryError }}</span>
      </div>

      <div v-if="queryResult" class="feedback-query-result">
        <template v-if="queryResult.status === 'NOT_FOUND'">
          <span class="feedback-query-state state-missing"><TriangleAlert :size="15" />反馈码不存在，请检查后重新输入</span>
        </template>
        <template v-else-if="queryResult.status === 'EXPIRED'">
          <span class="feedback-query-state state-expired"><CheckCircle2 :size="15" />该反馈已处理完毕并超过保留期被清理</span>
        </template>
        <template v-else>
          <div class="feedback-query-head">
            <span class="feedback-query-state" :class="queryResult.status === 'PROCESSED' ? 'state-done' : 'state-pending'">
              <CheckCircle2 :size="15" />{{ queryStatusText }}
            </span>
            <span class="feedback-query-name">{{ queryResult.username }}</span>
          </div>
          <p v-if="queryResult.createdAt" class="feedback-query-meta">提交时间：{{ queryResult.createdAt }}</p>
          <p v-if="queryResult.status === 'PROCESSED' && queryResult.adminReply" class="feedback-query-reply">
            {{ queryResult.adminReply }}
          </p>
          <p v-else-if="queryResult.status === 'PENDING'" class="feedback-query-meta">我们会尽快处理你的反馈，处理完成后可在此看到回复。</p>
        </template>
        <button class="button button-secondary feedback-query-reset" type="button" @click="resetQuery">重新查询</button>
      </div>
    </div>
  </section>
</template>
