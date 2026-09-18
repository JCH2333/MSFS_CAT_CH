<script setup>
import { CloudDownload, PackageX, TriangleAlert } from '@lucide/vue'

// variant='older'：本机 GSX 低于补丁适配版本，引导去「GSX 更新」页；
// variant='newer'：本机 GSX 高于补丁适配版本。旧补丁会覆盖新版本的版本标记与
// 面板文件（2026-09 "幽灵 4.0.21" 事故），必须等待适配新版的补丁。
defineProps({
  localVersion: { type: String, required: true },
  addonVersion: { type: String, required: true },
  variant: { type: String, default: 'older' }
})

defineEmits(['goto', 'close'])
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="gsx-guard-dialog" role="dialog" aria-modal="true" aria-labelledby="gsx-guard-title">
      <div class="gsx-guard-icon"><TriangleAlert :size="28" /></div>
      <template v-if="variant === 'newer'">
        <p class="eyebrow">GSX VERSION TOO NEW</p>
        <h2 id="gsx-guard-title">补丁适配版本低于当前 GSX</h2>
        <p class="gsx-guard-detail">
          当前安装的 GSX 为 <code>v{{ localVersion }}</code>，高于补丁适配的
          <code>v{{ addonVersion }}</code>。直接安装会用旧版补丁文件覆盖新版本的版本标记与面板文件，
          导致版本显示错误或界面异常。
        </p>
        <p class="gsx-guard-detail">请等待发布适配当前 GSX 版本的新补丁；若您已出现版本显示异常，可先在补丁卡片上「还原文字与图片」恢复官方文件。</p>
        <div class="gsx-guard-actions">
          <button class="button button-secondary" type="button" @click="$emit('close')">
            <PackageX :size="15" />
            我知道了
          </button>
        </div>
      </template>
      <template v-else>
        <p class="eyebrow">GSX VERSION TOO OLD</p>
        <h2 id="gsx-guard-title">GSX 版本过低，无法安装补丁</h2>
        <p class="gsx-guard-detail">
          当前安装的 GSX 为 <code>v{{ localVersion }}</code>，低于补丁适配的
          <code>v{{ addonVersion }}</code>。旧版本上的文件结构与新版不一致，直接安装补丁会失败或显示异常。
        </p>
        <p class="gsx-guard-detail">请先在「GSX 更新」页把 GSX 更新到最新版本，再回来安装补丁。</p>
        <div class="gsx-guard-actions">
          <button class="button button-secondary" type="button" @click="$emit('close')">稍后再说</button>
          <button class="button button-primary" type="button" @click="$emit('goto')">
            <CloudDownload :size="15" />
            前往 GSX 更新
          </button>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.gsx-guard-dialog {
  width: min(440px, 100%);
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 30px 28px 24px;
  border: 1px solid var(--glass-border); border-radius: var(--radius);
  background: var(--surface); backdrop-filter: var(--glass-blur); box-shadow: var(--shadow-soft);
}
.gsx-guard-icon {
  width: 52px; height: 52px; display: grid; place-items: center; margin-bottom: 12px;
  border-radius: 14px; background: rgba(227, 178, 83, 0.12); color: var(--warning);
}
.gsx-guard-dialog h2 { margin: 6px 0 0; font: 600 20px/1.2 "Bahnschrift", "Microsoft YaHei UI", sans-serif; }
.gsx-guard-detail { margin: 13px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.7; }
.gsx-guard-detail code {
  padding: 1px 7px; border: 1px solid var(--glass-border); border-radius: 6px;
  font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: var(--warning);
}
.gsx-guard-actions { display: flex; gap: 10px; margin-top: 20px; width: 100%; }
.gsx-guard-actions .button { flex: 1; }
</style>
