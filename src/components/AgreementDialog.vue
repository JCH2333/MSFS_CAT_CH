<script setup>
import { computed, ref } from 'vue'
import { AlertTriangle, CheckCircle2, ScrollText } from '@lucide/vue'
import { AGREEMENT_REVISION, agreements, AUTHOR_NAME } from '../lib/agreements.mjs'

defineProps({ required: { type: Boolean, default: false } })
defineEmits(['accept', 'decline', 'close'])

const active = ref('user')
const read = ref({ user: false, notice: false })
const allRead = computed(() => agreements.every((agreement) => read.value[agreement.id]))
function markRead(event) {
  const element = event.target
  if (element.scrollTop + element.clientHeight >= element.scrollHeight - 4) read.value[active.value] = true
}
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="agreement-dialog" role="dialog" aria-modal="true" aria-labelledby="agreement-title">
      <div class="agreement-dialog-header">
        <div><p class="eyebrow">FREE SOFTWARE NOTICE</p><h2 id="agreement-title">使用前请阅读</h2></div>
        <AlertTriangle :size="22" />
      </div>
      <p class="agreement-lead">本软件完全免费。作者：{{ AUTHOR_NAME }}。协议修订号：{{ AGREEMENT_REVISION }}。请完整阅读并确认两份文件后继续。</p>
      <div class="agreement-tabs" role="tablist">
        <button v-for="agreement in agreements" :key="agreement.id" type="button" :class="{ active: active === agreement.id }" @click="active = agreement.id">
          <CheckCircle2 v-if="read[agreement.id]" :size="14" />{{ agreement.title }}
        </button>
      </div>
      <div v-for="agreement in agreements" v-show="active === agreement.id" :key="agreement.id" class="agreement-text" @scroll="markRead">
        <ScrollText :size="17" /><pre>{{ agreement.body }}</pre>
      </div>
      <p class="agreement-read-state">{{ allRead ? '已完整阅读两份协议。' : '请滚动阅读当前文件至末尾，并阅读另一份文件。' }}</p>
      <div class="dialog-actions">
        <button class="button button-secondary" type="button" @click="$emit('decline')">不同意并退出</button>
        <button class="button button-primary" type="button" :disabled="!allRead" @click="$emit('accept')">同意并继续使用</button>
      </div>
      <button v-if="!required" class="dialog-close" type="button" @click="$emit('close')">关闭</button>
    </section>
  </div>
</template>
