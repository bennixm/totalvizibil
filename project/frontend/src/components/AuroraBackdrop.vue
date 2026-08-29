<script setup lang="ts">
/**
 * Decorative aurora / glow field for hero-style sections.
 * Place inside a `position: relative` container; it fills the container and
 * sits behind the content. Purely presentational (aria-hidden).
 *
 * Kept intentionally cheap: two blurred blobs, transform-only animation, and
 * `content-visibility` so off-screen instances stop painting.
 */
withDefaults(defineProps<{ intensity?: 'subtle' | 'bold' }>(), { intensity: 'bold' })
</script>

<template>
  <div class="aurora" :class="`aurora--${intensity}`" aria-hidden="true">
    <span class="aurora__blob aurora__blob--1" />
    <span class="aurora__blob aurora__blob--2" />
  </div>
</template>

<style scoped>
.aurora {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  border-radius: inherit;
  content-visibility: auto;
  -webkit-mask-image: radial-gradient(120% 120% at 50% 0%, #000 40%, transparent 100%);
  mask-image: radial-gradient(120% 120% at 50% 0%, #000 40%, transparent 100%);
}

.aurora__blob {
  position: absolute;
  width: 30rem;
  height: 30rem;
  border-radius: 50%;
  filter: blur(44px);
  opacity: 0.5;
}

.aurora--subtle .aurora__blob {
  opacity: 0.28;
  filter: blur(56px);
}

.aurora__blob--1 {
  top: -14rem;
  left: -8rem;
  background: radial-gradient(circle, var(--tvz-brand-1), transparent 70%);
  animation: aurora-float-1 24s var(--tvz-ease-out) infinite alternate;
}

.aurora__blob--2 {
  top: -10rem;
  right: -10rem;
  background: radial-gradient(circle, var(--tvz-brand-2), transparent 70%);
  animation: aurora-float-2 30s var(--tvz-ease-out) infinite alternate;
}

@keyframes aurora-float-1 {
  to {
    transform: translate3d(5rem, 3rem, 0) scale(1.12);
  }
}
@keyframes aurora-float-2 {
  to {
    transform: translate3d(-4rem, 5rem, 0) scale(1.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .aurora__blob {
    animation: none;
  }
}
</style>
