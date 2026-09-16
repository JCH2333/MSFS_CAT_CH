<script setup>
import { ShieldCheck, TriangleAlert } from '@lucide/vue'

defineEmits(['close'])
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="patch-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="patch-notice-title">
      <div class="patch-notice-icon"><ShieldCheck :size="28" /></div>
      <p class="eyebrow">PATCH INSTALLED</p>
      <h2 id="patch-notice-title">汉化补丁安装成功</h2>
      <div class="patch-notice-warning">
        <TriangleAlert :size="17" />
        <p>
          进入游戏后如果看到 GSX 的 <b>hotfix 更新提示，请务必选择忽略 / 拒绝</b>——
          接受会把按钮图片与语音打回英文，导致汉化失效。
        </p>
      </div>
      <p class="patch-notice-detail">若不慎点了接受，回到本软件重新安装补丁即可恢复。</p>
      <button class="button button-primary patch-notice-continue" type="button" @click="$emit('close')">我知道了</button>
    </section>
  </div>
</template>

<style scoped>
.patch-notice-dialog {
  width: min(420px, 100%);
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 30px 28px 24px;
  border: 1px solid var(--glass-border); border-radius: var(--radius);
  background: var(--surface); backdrop-filter: var(--glass-blur); box-shadow: var(--shadow-soft);
}
.patch-notice-icon {
  width: 52px; height: 52px; display: grid; place-items: center; margin-bottom: 12px;
  border-radius: 14px; background: rgba(98, 214, 163, 0.12); color: var(--signal);
}
.patch-notice-dialog h2 { margin: 6px 0 0; font: 600 20px/1.2 "Bahnschrift", "Microsoft YaHei UI", sans-serif; }
.patch-notice-warning {
  display: flex; align-items: flex-start; gap: 10px; width: 100%;
  margin: 16px 0 0; padding: 12px 14px;
  border: 1px solid rgba(227, 178, 83, 0.32); border-radius: 9px; background: rgba(227, 178, 83, 0.08);
  color: var(--warning); text-align: left;
}
.patch-notice-warning p { margin: 0; font-size: 12px; line-height: 1.65; }
.patch-notice-warning b { color: var(--warning); }
.patch-notice-warning :deep(svg) { flex: 0 0 auto; margin-top: 2px; }
.patch-notice-detail { margin: 13px 0 0; color: var(--text-secondary); font-size: 11.5px; }
.patch-notice-continue { margin-top: 18px; width: 100%; }
</style>
