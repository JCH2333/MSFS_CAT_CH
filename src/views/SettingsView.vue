<script setup>
import { computed } from 'vue'
import { CheckCircle2, ExternalLink, FolderSearch, GitBranch, Heart, MapPin, MessageSquareText, RefreshCw, ScrollText, Undo2, UserRound } from '@lucide/vue'

const props = defineProps({
  appInfo: { type: Object, required: true },
  updateStatus: { type: Object, required: true },
  patches: { type: Array, required: true },
  targets: { type: Object, required: true },
  detectedTargets: { type: Object, required: true },
  installations: { type: Object, required: true }
})

defineEmits(['check-update', 'open-link', 'choose-target', 'clear-target', 'show-agreements', 'support', 'feedback'])

const updateLabel = computed(() => {
  const labels = {
    idle: '尚未检查',
    checking: '正在检查更新',
    current: '当前已是最新版本',
    available: `发现 v${props.updateStatus.info?.version || ''}`,
    downloading: `下载中 ${Math.round(props.updateStatus.progress?.percent || 0)}%`,
    downloaded: '更新已下载',
    installing: '正在重启并安装更新',
    development: '开发模式',
    error: props.updateStatus.message || '暂时无法检查软件更新，请稍后再试'
  }
  return labels[props.updateStatus.state] || props.updateStatus.state
})

function targetPath(patch) {
  return props.targets[patch.id] || props.installations[patch.id]?.targetPath || props.detectedTargets[patch.id]?.targetPath || ''
}

function patchVersionLabel(patch) {
  if (patch.id === 'gsx-pro-zh-cn-voice') return `补丁 v${patch.version}`
  return `${patch.addonVersion ? `插件 v${patch.addonVersion}` : '插件版本未声明'} · 补丁 v${patch.version}`
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
        <button class="button button-secondary" type="button" :disabled="['checking', 'downloading', 'installing'].includes(updateStatus.state)" @click="$emit('check-update')">
          <RefreshCw :size="17" :class="{ spinning: updateStatus.state === 'checking' }" />
          重新检查
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
              <small>{{ patchVersionLabel(patch) }}</small>
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
      <button class="repository-row" type="button" @click="$emit('open-link', 'https://gitee.com/ljd123456/MSFS_CAT_CH')">
        <GitBranch :size="20" />
        <span><strong>软件仓库（Gitee）</strong><small>ljd123456/MSFS_CAT_CH</small></span>
        <ExternalLink :size="17" />
      </button>
      <button class="repository-row" type="button" @click="$emit('open-link', 'https://gitee.com/ljd123456/MSFS_CAT_CH_PATCHES')">
        <GitBranch :size="20" />
        <span><strong>补丁仓库（Gitee）</strong><small>ljd123456/MSFS_CAT_CH_PATCHES</small></span>
        <ExternalLink :size="17" />
      </button>
      <button class="repository-row" type="button" @click="$emit('open-link', 'https://github.com/JCH2333/MSFS_CAT_CH')">
        <GitBranch :size="20" />
        <span><strong>软件仓库（GitHub）</strong><small>JCH2333/MSFS_CAT_CH</small></span>
        <ExternalLink :size="17" />
      </button>
      <button class="repository-row" type="button" @click="$emit('open-link', 'https://github.com/JCH2333/MSFS_CAT_CH_PATCHES')">
        <GitBranch :size="20" />
        <span><strong>补丁仓库（GitHub）</strong><small>JCH2333/MSFS_CAT_CH_PATCHES</small></span>
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
        <button class="button button-secondary" type="button" @click="$emit('feedback')"><MessageSquareText :size="16" />问题反馈</button>
        <button class="button button-secondary" type="button" @click="$emit('support')"><Heart :size="16" />赞助支持</button>
      </div>
      <p class="agreement-status"><CheckCircle2 :size="16" />协议状态：已同意。撤销同意请在协议窗口选择“不同意并退出”。</p>
    </section>

    <div class="privacy-line">
      <CheckCircle2 :size="17" />
      <span>完全免费使用，不需要账号，不上传使用记录；反馈匿名提交，仅包含填写的内容和截图</span>
    </div>
  </section>
</template>
