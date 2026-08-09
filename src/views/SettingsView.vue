<script setup>
import { computed } from 'vue'
import { CheckCircle2, Download, ExternalLink, FolderSearch, GitBranch, Heart, MapPin, RefreshCw, RotateCw, ScrollText, Undo2, UserRound } from '@lucide/vue'

const props = defineProps({
  appInfo: { type: Object, required: true },
  updateStatus: { type: Object, required: true },
  patches: { type: Array, required: true },
  targets: { type: Object, required: true },
  detectedTargets: { type: Object, required: true },
  installations: { type: Object, required: true }
})

defineEmits(['check-update', 'download-update', 'install-update', 'open-link', 'choose-target', 'clear-target', 'show-agreements', 'support'])

const updateLabel = computed(() => {
  const labels = {
    idle: '尚未检查',
    checking: '正在检查',
    'checking-direct': '系统代理响应较慢，正在直连 GitHub',
    current: '当前已是最新版本',
    available: `发现 v${props.updateStatus.info?.version || ''}`,
    downloading: `下载中 ${Math.round(props.updateStatus.progress?.percent || 0)}%`,
    downloaded: '更新已下载',
    unpublished: '当前版本尚未发布',
    development: '开发模式',
    error: props.updateStatus.message || '暂时无法检查软件更新，请稍后再试'
  }
  return labels[props.updateStatus.state] || props.updateStatus.state
})

function targetPath(patch) {
  return props.targets[patch.id] || props.installations[patch.id]?.targetPath || props.detectedTargets[patch.id]?.targetPath || ''
}

function targetSource(patch) {
  if (props.targets[patch.id]) return '手动选择'
  if (props.installations[patch.id]?.targetPath) return '已安装目录'
  return props.detectedTargets[patch.id]?.source || '未检测到'
}
</script>

<template>
  <section class="view-shell settings-view">
    <div class="view-header">
      <div>
        <p class="eyebrow">LOCAL SETTINGS</p>
        <h1>设置</h1>
      </div>
    </div>

    <div class="settings-band">
      <div class="settings-copy">
        <span class="settings-label">软件版本</span>
        <strong>v{{ appInfo.version }}</strong>
        <span class="settings-detail">{{ updateLabel }}</span>
      </div>
      <div class="settings-actions">
        <button v-if="updateStatus.state === 'available'" class="button button-primary" type="button" @click="$emit('download-update')">
          <Download :size="17" />
          下载更新
        </button>
        <button v-else-if="updateStatus.state === 'downloaded'" class="button button-primary" type="button" @click="$emit('install-update')">
          <RotateCw :size="17" />
          重启安装
        </button>
        <button v-else class="button button-secondary" type="button" :disabled="['checking', 'checking-direct', 'downloading'].includes(updateStatus.state)" @click="$emit('check-update')">
          <RefreshCw :size="17" :class="{ spinning: ['checking', 'checking-direct'].includes(updateStatus.state) }" />
          检查更新
        </button>
      </div>
    </div>

    <section class="target-settings" aria-labelledby="target-settings-title">
      <div class="settings-section-heading">
        <div>
          <p class="eyebrow">INSTALLATION TARGETS</p>
          <h2 id="target-settings-title">插件目录</h2>
        </div>
        <span>启动时自动检测</span>
      </div>
      <div class="target-settings-grid">
        <article v-for="patch in patches" :key="patch.id" class="target-settings-card">
          <div class="target-settings-title">
            <div>
              <strong>{{ patch.name }}</strong>
              <small>{{ patch.addonVersion ? `插件 v${patch.addonVersion}` : '插件版本未声明' }} · 补丁 v{{ patch.version }}</small>
            </div>
            <MapPin :size="17" />
          </div>
          <p class="target-settings-path" :title="targetPath(patch) || patch.targetHint">
            {{ targetPath(patch) || patch.targetHint }}
          </p>
          <div class="target-settings-actions">
            <span>{{ targetSource(patch) }}</span>
            <div>
              <button v-if="targets[patch.id]" class="icon-button" type="button" title="恢复自动检测" aria-label="恢复自动检测" @click="$emit('clear-target', patch.id)">
                <Undo2 :size="16" />
              </button>
              <button class="icon-button" type="button" title="选择插件目录" aria-label="选择插件目录" @click="$emit('choose-target', patch)">
                <FolderSearch :size="17" />
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <div class="settings-list">
      <button class="repository-row" type="button" @click="$emit('open-link', 'https://github.com/JCH2333/MSFS_CAT_CH')">
        <GitBranch :size="20" />
        <span><strong>软件仓库</strong><small>JCH2333/MSFS_CAT_CH</small></span>
        <ExternalLink :size="17" />
      </button>
      <button class="repository-row" type="button" @click="$emit('open-link', 'https://github.com/JCH2333/MSFS_CAT_CH_PATCHES')">
        <GitBranch :size="20" />
        <span><strong>补丁仓库</strong><small>JCH2333/MSFS_CAT_CH_PATCHES</small></span>
        <ExternalLink :size="17" />
      </button>
    </div>

    <section class="settings-legal">
      <div class="settings-section-heading"><div><p class="eyebrow">AUTHOR & TERMS</p><h2>作者与使用协议</h2></div><span>软件与补丁完全免费</span></div>
      <div class="author-panel">
        <UserRound :size="20" />
        <div><strong>B站 一只剑齿虎呀</strong><small>MSFS CAT CH 免费制作与维护</small></div>
        <button class="icon-button" type="button" title="打开作者 B站主页" @click="$emit('open-link', 'https://space.bilibili.com/472309803?spm_id_from=333.1007.0.0')"><ExternalLink :size="16" /></button>
      </div>
      <div class="legal-actions">
        <button class="button button-secondary" type="button" @click="$emit('show-agreements')"><ScrollText :size="16" />查看已同意的协议</button>
        <button class="button button-secondary" type="button" @click="$emit('support')"><Heart :size="16" />赞助支持</button>
      </div>
      <p class="agreement-status"><CheckCircle2 :size="16" />协议状态：已同意。撤销同意请在协议窗口选择“不同意并退出”。</p>
    </section>

    <div class="privacy-line">
      <CheckCircle2 :size="17" />
      <span>完全免费使用，不需要账号，不上传使用记录</span>
    </div>
  </section>
</template>
