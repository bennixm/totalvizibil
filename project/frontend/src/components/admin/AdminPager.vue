<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  page: number
  pageSize: number
  total: number
}>()
const emit = defineEmits<{ 'update:page': [page: number] }>()

const { t, n } = useI18n()

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const to = computed(() => Math.min(props.total, props.page * props.pageSize))

function go(p: number) {
  if (p >= 1 && p <= pages.value && p !== props.page) emit('update:page', p)
}
</script>

<template>
  <div v-if="total > pageSize" class="apg">
    <span class="apg__range">
      {{ t('admin.showingRange', { from: n(from), to: n(to), total: n(total) }) }}
    </span>
    <div class="apg__ctrl">
      <button type="button" :disabled="page <= 1" class="apg__btn" @click="go(page - 1)">
        <v-icon icon="mdi-chevron-left" size="18" />
      </button>
      <span class="apg__page">{{ page }} / {{ pages }}</span>
      <button type="button" :disabled="page >= pages" class="apg__btn" @click="go(page + 1)">
        <v-icon icon="mdi-chevron-right" size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.apg {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 1rem;
  padding: 0.4rem 0.2rem;
}
.apg__range {
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.apg__ctrl {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.apg__page {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-on-surface) / 0.7);
  min-width: 3.5rem;
  text-align: center;
}
.apg__btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--tvz-hairline);
  color: rgb(var(--v-theme-on-surface) / 0.75);
  transition: background 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.apg__btn:hover:not(:disabled) {
  background: rgb(var(--v-theme-on-surface) / 0.06);
}
.apg__btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
