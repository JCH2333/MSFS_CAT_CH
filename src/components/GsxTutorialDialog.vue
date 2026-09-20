<script setup>
import { X } from '@lucide/vue'

// 安装向导教程弹窗：贴合全应用的玻璃面板风格（.modal-backdrop 全局遮罩 +
// 深色圆角面板）。sections: [{ text, tag?, image?, alt? }]，tag 用于高亮说明块，
// image 为打包内资源（import 进来的 URL）。
defineProps({
  title: { type: String, required: true },
  sections: { type: Array, required: true }
})

defineEmits(['close'])
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="$emit('close')">
    <section class="gsx-tutorial" role="dialog" aria-modal="true" aria-labelledby="gsx-tutorial-title">
      <button class="dialog-icon-close" type="button" aria-label="关闭教程" @click="$emit('close')">
        <X :size="15" />
      </button>
      <p class="eyebrow">GSX SETUP GUIDE</p>
      <h2 id="gsx-tutorial-title">{{ title }}</h2>
      <div class="gsx-tutorial-body">
        <section v-for="(section, index) in sections" :key="index" class="gsx-tutorial-section">
          <p v-if="section.text" class="gsx-tutorial-text" :class="{ 'gsx-tutorial-note': section.tag }">
            <span v-if="section.tag" class="gsx-tutorial-tag">{{ section.tag }}</span>
            <span v-else class="gsx-tutorial-index">{{ index + 1 }}</span>
            <span class="gsx-tutorial-copy">{{ section.text }}</span>
          </p>
          <figure v-if="section.image" class="gsx-tutorial-figure">
            <img :src="section.image" :alt="section.alt || ''" loading="lazy" />
          </figure>
        </section>
      </div>
      <div class="dialog-actions">
        <button class="button button-primary" type="button" @click="$emit('close')">知道了</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gsx-tutorial {
  position: relative;
  width: min(620px, 100%);
  max-height: min(78vh, 720px);
  display: flex; flex-direction: column;
  padding: 24px 24px 18px;
  border: 1px solid var(--border-strong); border-radius: 14px;
  background: rgba(26, 28, 24, 0.88); backdrop-filter: var(--glass-blur);
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.5);
}
.gsx-tutorial .eyebrow { margin: 0; color: var(--signal); }
.gsx-tutorial h2 { margin: 6px 0 0; font: 600 19px/1.25 "Bahnschrift", "Microsoft YaHei UI", sans-serif; }
.gsx-tutorial-body {
  margin-top: 14px; padding-right: 6px;
  overflow-y: auto; display: grid; gap: 14px;
}
.gsx-tutorial-section { display: grid; gap: 8px; }
.gsx-tutorial-text { display: flex; align-items: flex-start; gap: 9px; margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.7; }
.gsx-tutorial-index {
  flex: 0 0 auto; display: inline-grid; place-items: center;
  width: 18px; height: 18px; margin-top: 2px; border-radius: 50%;
  border: 1px solid rgba(98, 214, 163, 0.4); background: rgba(98, 214, 163, 0.08);
  color: var(--signal); font: 600 10px/1 ui-monospace, Consolas, monospace;
}
.gsx-tutorial-tag {
  flex: 0 0 auto; margin-top: 2px; padding: 1px 8px; border-radius: 999px;
  border: 1px solid rgba(98, 214, 163, 0.35); background: rgba(98, 214, 163, 0.08);
  color: var(--signal); font-size: 10.5px; white-space: nowrap;
}
.gsx-tutorial-copy { min-width: 0; }
.gsx-tutorial-copy :deep(b) { color: var(--text-primary, #e8eadf); }
.gsx-tutorial-note .gsx-tutorial-copy { color: var(--text-secondary); }
.gsx-tutorial-figure { margin: 0; border: 1px solid var(--glass-border); border-radius: 10px; overflow: hidden; background: #151613; }
.gsx-tutorial-figure img { display: block; width: 100%; height: auto; }
.gsx-tutorial .dialog-actions { margin-top: 16px; }
</style>
