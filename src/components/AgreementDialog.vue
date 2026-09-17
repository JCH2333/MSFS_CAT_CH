<script setup>
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, ScrollText, WifiOff } from '@lucide/vue'
import { AGREEMENT_REVISION, AUTHOR_NAME } from '../lib/agreements.mjs'

// 协议正文不随安装包分发：弹窗打开时由 App.vue 经 bridge（IPC → 主进程取钥解密）异步取得，
// sections 为 null 表示加载中，loadFailed 表示取文失败（断网/服务器不可达/校验不过）。
const props = defineProps({
  required: { type: Boolean, default: false },
  sections: { type: Array, default: null },
  loadFailed: { type: Boolean, default: false },
  // 服务器推送的更新修订版会传入其修订号；缺省回退到内置修订号
  revision: { type: String, default: '' }
})
defineEmits(['accept', 'decline', 'close', 'retry'])

const active = ref('user')
const read = ref({ user: false, notice: false })
const visibleSections = computed(() => (Array.isArray(props.sections) ? props.sections.filter((section) => section?.body) : []))
const allRead = computed(() => visibleSections.value.length > 0 && visibleSections.value.every((section) => read.value[section.id]))
function markRead(event) {
  const element = event.target
  if (element.scrollTop + element.clientHeight >= element.scrollHeight - 4) read.value[active.value] = true
}
// 正文到达（或重试成功）后重置阅读进度，确保重新完整阅读
watch(visibleSections, (sections) => {
  read.value = Object.fromEntries(sections.map((section) => [section.id, false]))
  active.value = sections[0]?.id || 'user'
}, { immediate: true })
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="agreement-dialog" role="dialog" aria-modal="true" aria-labelledby="agreement-title">
      <div class="agreement-dialog-header">
        <div><p class="eyebrow">FREE SOFTWARE NOTICE</p><h2 id="agreement-title">使用前请阅读</h2></div>
        <AlertTriangle :size="22" />
      </div>
      <p class="agreement-lead">本软件完全免费。作者：{{ AUTHOR_NAME }}。协议修订号：{{ revision || AGREEMENT_REVISION }}。请完整阅读并确认两份文件后继续。</p>

      <div v-if="!sections" class="agreement-loading" :class="{ failed: loadFailed }" role="status">
        <template v-if="!loadFailed">
          <LoaderCircle :size="22" class="spinning" />
          <p>正在加载协议全文（需要联网）……</p>
        </template>
        <template v-else>
          <WifiOff :size="22" />
          <p>协议需要联网加载，请联网后重试。</p>
          <button class="button button-secondary" type="button" @click="$emit('retry')"><RefreshCw :size="14" />重试</button>
        </template>
      </div>

      <template v-else>
        <div class="agreement-tabs" role="tablist">
          <button v-for="section in visibleSections" :key="section.id" type="button" :class="{ active: active === section.id }" @click="active = section.id">
            <CheckCircle2 v-if="read[section.id]" :size="14" />{{ section.title }}
          </button>
        </div>
        <div v-for="section in visibleSections" v-show="active === section.id" :key="section.id" class="agreement-text" @scroll="markRead">
          <ScrollText :size="17" /><pre>{{ section.body }}</pre>
        </div>
        <p class="agreement-read-state">{{ allRead ? '已完整阅读两份协议。' : '请滚动阅读当前文件至末尾，并阅读另一份文件。' }}</p>
        <div class="dialog-actions">
          <button class="button button-secondary" type="button" @click="$emit('decline')">不同意并退出</button>
          <button class="button button-primary" type="button" :disabled="!allRead" @click="$emit('accept')">同意并继续使用</button>
        </div>
      </template>

      <button v-if="!required" class="dialog-close" type="button" @click="$emit('close')">关闭</button>
    </section>
  </div>
</template>
