<script setup>
import { Megaphone } from '@lucide/vue'
import { announcementCategoryKind, announcementCategoryLabel, formatAnnouncementTime } from '../lib/announcement-format.mjs'

defineProps({
  announcement: { type: Object, required: true }
})

const emit = defineEmits(['close'])
</script>

<template>
  <div class="modal-backdrop" role="presentation">
    <section class="announcement-popup-dialog" role="dialog" aria-modal="true" aria-labelledby="announcement-popup-title">
      <div class="announcement-popup-icon"><Megaphone :size="26" /></div>
      <div class="announcement-tags">
        <span class="announcement-tag" :data-category="announcementCategoryKind(announcement.category)">
          {{ announcementCategoryLabel(announcement.category) }}
        </span>
        <span v-if="announcement.pinned" class="announcement-tag announcement-tag-pinned">置顶</span>
      </div>
      <h2 id="announcement-popup-title">{{ announcement.title }}</h2>
      <time class="announcement-popup-time">{{ formatAnnouncementTime(announcement.createdAt) }}</time>
      <div class="announcement-popup-content">{{ announcement.content }}</div>
      <button class="button button-primary announcement-popup-confirm" type="button" @click="emit('close')">
        我知道了
      </button>
    </section>
  </div>
</template>
