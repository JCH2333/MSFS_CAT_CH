<script setup>
import { Heart, X } from '@lucide/vue'
defineEmits(['close'])
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="support-dialog" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <button class="dialog-icon-close" type="button" title="关闭" @click="$emit('close')"><X :size="18" /></button>
      <Heart :size="25" />
      <p class="eyebrow">OPTIONAL SUPPORT</p>
      <h2 id="support-title">赞助支持</h2>
      <p>免费制作更新不易，还请各位大佬支持！</p>
      <img src="/wechat-support.png" alt="微信赞助收款码" />
      <small>微信扫码赞助，金额完全自愿。</small>
    </section>
  </div>
</template>
