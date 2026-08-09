<script setup>
import { BadgeAlert, ExternalLink, Heart, ShieldCheck } from '@lucide/vue'
import { AUTHOR_NAME } from '../lib/agreements.mjs'

defineEmits(['continue', 'author', 'support'])
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="free-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="free-notice-title">
      <div class="free-notice-icon"><BadgeAlert :size="30" /></div>
      <p class="eyebrow">FREE SOFTWARE NOTICE</p>
      <h2 id="free-notice-title">软件和补丁完全免费</h2>
      <p class="free-notice-warning">如果您是付费购买，请立即退款并举报。</p>
      <p class="free-notice-detail">MSFS CAT CH 与全部汉化补丁均免费提供，不出售、不收取账号费用，也未授权任何人、店铺或平台收费分发。</p>
      <div class="free-notice-author">
        <ShieldCheck :size="18" />
        <span>作者：<strong>{{ AUTHOR_NAME }}</strong></span>
      </div>
      <div class="free-notice-actions">
        <button class="button button-secondary" type="button" @click="$emit('author')">
          <ExternalLink :size="15" />访问作者主页
        </button>
        <button class="button button-secondary" type="button" @click="$emit('support')">
          <Heart :size="15" />赞助作者
        </button>
      </div>
      <button class="button button-primary free-notice-continue" type="button" @click="$emit('continue')">我已了解，继续使用</button>
    </section>
  </div>
</template>
