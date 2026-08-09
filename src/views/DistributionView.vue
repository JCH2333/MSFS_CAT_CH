<script setup>
import { CheckCircle2, Download, ExternalLink, FileArchive, Network, ShieldCheck } from '@lucide/vue'

defineEmits(['open-link'])

const baiduShareUrl = 'https://pan.baidu.com/s/1jrz3nSFc8gFhBDUFFjYaAg?pwd=qibx'
</script>

<template>
  <section class="view-shell distribution-view">
    <div class="view-header">
      <div>
        <p class="eyebrow">ADD-ON DISTRIBUTION</p>
        <h1>分流包</h1>
      </div>
      <div class="source-status" data-offline="true">
        <Network :size="15" />
        <span>GSX 本体更新</span>
      </div>
    </div>

    <section class="distribution-band">
      <div class="distribution-band-icon"><ShieldCheck :size="22" /></div>
      <div>
        <strong>分流包仅提供 GSX 官方安装程序</strong>
        <p>用于网络无法稳定访问官方更新时更新 GSX Pro 4.0.15。本页不包含汉化补丁、个人配置、日志或缓存。</p>
      </div>
    </section>

    <section class="distribution-section">
      <div class="settings-section-heading">
        <div>
          <p class="eyebrow">GSX INSTALLER</p>
          <h2>GSX 4.0.15 分流</h2>
        </div>
        <span>官方安装程序</span>
      </div>
      <article class="distribution-installer-card">
        <FileArchive :size="21" />
        <div>
          <strong>Addon_Manager_v4.0.15.exe</strong>
          <small>GSX Pro 本体更新包 · 百度网盘</small>
        </div>
        <button class="icon-button" type="button" title="打开百度网盘下载页" aria-label="打开 GSX 4.0.15 百度网盘下载页" @click="$emit('open-link', baiduShareUrl)">
          <ExternalLink :size="16" />
        </button>
      </article>
      <div class="distribution-share-line">
        <Download :size="16" />
        <span>提取码：<strong>qibx</strong></span>
        <a :href="baiduShareUrl" @click.prevent="$emit('open-link', baiduShareUrl)">打开百度网盘</a>
      </div>
    </section>

    <section class="distribution-section">
      <div class="settings-section-heading">
        <div>
          <p class="eyebrow">MORE SOURCES</p>
          <h2>后续分发</h2>
        </div>
      </div>
      <div class="distribution-source-grid">
        <article class="distribution-source-card">
          <Network :size="19" />
          <div><strong>QQ群分流</strong><small>暂未开放，后续将在官方群提供。</small></div>
          <span>筹备中</span>
        </article>
      </div>
    </section>

    <section class="distribution-section distribution-steps">
      <div class="settings-section-heading">
        <div>
          <p class="eyebrow">INSTALLATION</p>
          <h2>安装与使用</h2>
        </div>
      </div>
      <ol>
        <li><span>1</span><div><strong>下载 GSX 分流包</strong><small>从百度网盘下载 <code>Addon_Manager_v4.0.15.exe</code>。</small></div></li>
        <li><span>2</span><div><strong>双击 EXE 安装</strong><small>关闭 Microsoft Flight Simulator 后，双击安装程序并按官方安装向导完成更新。</small></div></li>
        <li><span>3</span><div><strong>重新检查汉化补丁</strong><small>更新 GSX 后回到“汉化补丁”，确认 GSX Pro 简体中文状态；需要时重新安装对应汉化补丁。</small></div></li>
      </ol>
      <div class="distribution-note"><CheckCircle2 :size="17" /> 只使用本页列出的来源，避免运行来源不明的可执行文件。</div>
    </section>
  </section>
</template>
