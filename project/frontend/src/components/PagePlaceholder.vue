<script setup lang="ts">
import AuroraBackdrop from '@/components/AuroraBackdrop.vue'

defineProps<{
  icon: string
  title: string
  text?: string
  chip?: string
}>()
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="tvz-card placeholder pa-8 pa-md-12">
        <AuroraBackdrop intensity="subtle" />
        <div class="placeholder__body d-flex flex-column align-start ga-4">
          <span class="placeholder__icon">
            <v-icon :icon="icon" size="28" />
          </span>

          <div class="d-flex align-center ga-3 flex-wrap">
            <h1 class="text-h4 font-weight-bold">{{ title }}</h1>
            <v-chip v-if="chip" size="small" color="primary" variant="tonal">{{ chip }}</v-chip>
          </div>

          <p v-if="text" class="text-body-1 text-medium-emphasis" style="max-width: 60ch">
            {{ text }}
          </p>

          <slot />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.placeholder {
  position: relative;
  overflow: hidden;
}
.placeholder__body {
  position: relative;
  z-index: 1;
}
.placeholder__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: var(--tvz-radius-md);
  color: #fff;
  background: var(--tvz-gradient-brand);
  box-shadow: var(--tvz-glow-primary);
}
</style>
