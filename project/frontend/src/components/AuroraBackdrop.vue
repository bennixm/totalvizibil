<script setup lang="ts">
/**
 * Decorative aurora / glow field for hero-style sections.
 * Place inside a `position: relative` container; it fills the container and
 * sits behind the content. Purely presentational (aria-hidden).
 */
withDefaults(defineProps<{ intensity?: 'subtle' | 'bold' }>(), { intensity: 'bold' })
</script>

<template>
  <div class="aurora" :class="`aurora--${intensity}`" aria-hidden="true">
    <span class="aurora__blob aurora__blob--1" />
    <span class="aurora__blob aurora__blob--2" />
    <span class="aurora__blob aurora__blob--3" />
    <span class="aurora__beam" />
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
  -webkit-mask-image: radial-gradient(120% 120% at 50% 0%, #000 40%, transparent 100%);
  mask-image: radial-gradient(120% 120% at 50% 0%, #000 40%, transparent 100%);
}

.aurora__blob {
  position: absolute;
  width: 42rem;
  height: 42rem;
  border-radius: 50%;
  filter: blur(64px);
  opacity: 0.55;
  will-change: transform;
}

.aurora--subtle .aurora__blob {
  opacity: 0.3;
  filter: blur(80px);
}

.aurora__blob--1 {
  top: -16rem;
  left: -10rem;
  background: radial-gradient(circle, var(--tvz-brand-1), transparent 70%);
  animation: aurora-float-1 18s var(--tvz-ease-out) infinite alternate;
}

.aurora__blob--2 {
  top: -12rem;
  right: -12rem;
  background: radial-gradient(circle, var(--tvz-brand-2), transparent 70%);
  animation: aurora-float-2 22s var(--tvz-ease-out) infinite alternate;
}

.aurora__blob--3 {
  bottom: -22rem;
  left: 40%;
  background: radial-gradient(circle, var(--tvz-brand-3), transparent 70%);
  animation: aurora-float-3 26s var(--tvz-ease-out) infinite alternate;
}

/* Slow rotating conic sweep for a "scanning" feel. */
.aurora__beam {
  position: absolute;
  inset: -40% -10%;
  background: conic-gradient(
    from 180deg at 50% 50%,
    transparent 0deg,
    rgba(255, 255, 255, 0.06) 60deg,
    transparent 140deg,
    rgba(255, 255, 255, 0.05) 220deg,
    transparent 320deg
  );
  animation: aurora-spin 40s linear infinite;
}

@keyframes aurora-float-1 {
  to {
    transform: translate3d(6rem, 4rem, 0) scale(1.15);
  }
}
@keyframes aurora-float-2 {
  to {
    transform: translate3d(-5rem, 6rem, 0) scale(1.1);
  }
}
@keyframes aurora-float-3 {
  to {
    transform: translate3d(-8rem, -3rem, 0) scale(1.2);
  }
}
@keyframes aurora-spin {
  to {
    transform: rotate(1turn);
  }
}
</style>
