<script setup>
import { Bell, BellOff, RefreshCw, TriangleAlert } from '@lucide/vue'
import { announcementCategoryKind, announcementCategoryLabel, formatAnnouncementTime } from '../lib/announcement-format.mjs'

defineProps({
  announcements: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
})

defineEmits(['reload'])
</script>

<template>
  <section class="view-shell announcements-view">
    <div class="view-header">
      <div>
        <p class="eyebrow">ANNOUNCEMENTS</p>
        <h1>公告</h1>
      </div>
      <Bell :size="24" class="view-header-glyph" />
    </div>

    <div class="announcements-panel">
      <div v-if="loading && announcements.length === 0" class="announcements-state" aria-live="polite">
        <RefreshCw :size="22" class="spinning" />
        <span>正在获取公告…</span>
      </div>

      <div v-else-if="error && announcements.length === 0" class="announcements-state" role="alert">
        <TriangleAlert :size="22" />
        <span>{{ error }}</span>
        <button class="button button-secondary" type="button" @click="$emit('reload')">
          <RefreshCw :size="15" />
          重新加载
        </button>
      </div>

      <div v-else-if="announcements.length === 0" class="announcements-state">
        <BellOff :size="22" />
        <span>暂无公告</span>
      </div>

      <template v-else>
        <article
          v-for="announcement in announcements"
          :key="announcement.id"
          class="announcement-card"
          :data-pinned="announcement.pinned"
        >
          <div class="announcement-heading">
            <div class="announcement-tags">
              <span class="announcement-tag" :data-category="announcementCategoryKind(announcement.category)">
                {{ announcementCategoryLabel(announcement.category) }}
              </span>
              <span v-if="announcement.pinned" class="announcement-tag announcement-tag-pinned">置顶</span>
            </div>
            <time class="announcement-time">{{ formatAnnouncementTime(announcement.createdAt) }}</time>
          </div>
          <h2>{{ announcement.title }}</h2>
          <p>{{ announcement.content }}</p>
        </article>
      </template>
    </div>
  </section>
</template>
