<script setup>
import { Minus, Square, X } from '@lucide/vue'

const bridge = window.gsxTool
</script>

<template>
  <header class="title-bar">
    <div class="title-drag-area">
      <img src="/logo.png" alt="" class="title-logo" />
      <span>MSFS_CAT_CH</span>
    </div>
    <div class="window-actions">
      <button class="window-button" type="button" title="最小化" aria-label="最小化" @click="bridge?.app.minimize()">
        <Minus :size="15" />
      </button>
      <button class="window-button" type="button" title="最大化或还原" aria-label="最大化或还原" @click="bridge?.app.toggleMaximize()">
        <Square :size="13" />
      </button>
      <button class="window-button window-button-close" type="button" title="关闭" aria-label="关闭" @click="bridge?.app.close()">
        <X :size="16" />
      </button>
    </div>
  </header>
</template>
