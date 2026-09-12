<script setup>
import { computed, ref } from 'vue'
import { CheckCircle2, LoaderCircle, MessageSquareText, Paperclip, Send, ShieldCheck, Trash2, TriangleAlert, X } from '@lucide/vue'

const props = defineProps({
  bridge: { type: Object, required: true }
})

defineEmits(['close'])

const MAX_IMAGES = 4
const MAX_CONTENT_LENGTH = 2000

const content = ref('')
const images = ref([])
const submitting = ref(false)
const submitted = ref(false)
const errorMessage = ref('')

const canSubmit = computed(() => !submitting.value && !submitted.value && content.value.trim().length > 0)

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
      images: images.value.map((image) => image.base64)
    })
    if (result?.ok) {
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
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <button class="dialog-icon-close" type="button" title="关闭" @click="$emit('close')"><X :size="18" /></button>
      <div class="feedback-dialog-heading">
        <div><p class="eyebrow">ANONYMOUS FEEDBACK</p><h2 id="feedback-title">问题反馈</h2></div>
        <MessageSquareText :size="22" />
      </div>

      <template v-if="!submitted">
        <p class="feedback-privacy"><ShieldCheck :size="15" />反馈匿名提交，仅包含你填写的内容和截图</p>
        <div class="feedback-editor">
          <textarea
            v-model="content"
            rows="6"
            maxlength="2000"
            placeholder="请描述遇到的问题，例如：补丁安装失败、界面显示异常、模拟器内出现乱码…"
            :disabled="submitting"
          ></textarea>
          <span class="feedback-counter">{{ content.length }}/{{ MAX_CONTENT_LENGTH }}</span>
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
          {{ images.length >= MAX_IMAGES ? `已达 ${MAX_IMAGES} 张截图上限` : '添加截图（最多 4 张）' }}
        </button>

        <div v-if="errorMessage" class="feedback-alert" role="alert">
          <TriangleAlert :size="16" />
          <span>{{ errorMessage }}</span>
        </div>

        <div class="dialog-actions">
          <button class="button button-secondary" type="button" :disabled="submitting" @click="$emit('close')">关闭</button>
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
        <button class="button button-primary" type="button" @click="$emit('close')">完成</button>
      </div>
    </section>
  </div>
</template>
