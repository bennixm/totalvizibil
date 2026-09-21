<script setup lang="ts">
// The sidebar itself now lives once in App.vue (shared with the user panel,
// content swapped reactively by route) — this is just the content padding
// wrapper admin pages were built assuming existed around them.
</script>

<template>
  <div class="admin__content">
    <router-view />
  </div>
</template>

<style scoped>
.admin__content {
  padding: clamp(1.2rem, 3vw, 2.2rem);
  min-width: 0;
}
</style>
