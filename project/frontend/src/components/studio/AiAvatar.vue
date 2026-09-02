<script setup lang="ts">
/**
 * The "Site Simplu" studio guide — a friendly male cartoon character (head +
 * shoulders, call-centre headset) rendered as inline SVG. He is always in
 * gentle motion (bob, head sway, blink, eyes darting); while `speaking` his
 * mouth animates, brows lift and the aura brightens. Frozen under
 * prefers-reduced-motion.
 */
withDefaults(
  defineProps<{
    speaking?: boolean
    thinking?: boolean
    size?: number
  }>(),
  { speaking: false, thinking: false, size: 96 },
)
</script>

<template>
  <div
    class="av"
    :class="{ 'av--talk': speaking, 'av--think': thinking }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <span class="av__glow" />
    <svg class="av__svg" viewBox="0 0 200 200">
      <defs>
        <linearGradient id="av-shirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4763e6" />
          <stop offset="100%" stop-color="#2f43c9" />
        </linearGradient>
        <linearGradient id="av-hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3b2f27" />
          <stop offset="100%" stop-color="#2a211b" />
        </linearGradient>
        <radialGradient id="av-skin" cx="42%" cy="38%" r="75%">
          <stop offset="0%" stop-color="#f2c3a1" />
          <stop offset="100%" stop-color="#e0a17d" />
        </radialGradient>
      </defs>

      <!-- shoulders -->
      <g class="av__body">
        <path
          d="M34 200c0-34 27-52 66-52s66 18 66 52z"
          fill="url(#av-shirt)"
        />
        <path d="M86 150l14 16 14-16-6-8h-16z" fill="#2536a8" />
      </g>

      <!-- neck -->
      <path d="M88 128h24v24c0 8-24 8-24 0z" fill="#e0a17d" />

      <g class="av__head">
        <!-- head + jaw -->
        <path
          d="M58 92c0-27 18-46 42-46s42 19 42 46c0 30-19 50-42 50S58 122 58 92z"
          fill="url(#av-skin)"
        />
        <!-- stubble hint -->
        <path
          d="M66 108c6 18 19 30 34 30s28-12 34-30c-8 12-20 18-34 18s-26-6-34-18z"
          fill="#c98a63"
          opacity="0.35"
        />
        <!-- ears -->
        <circle cx="58" cy="98" r="9" fill="#e0a17d" />
        <circle cx="142" cy="98" r="9" fill="#e0a17d" />
        <!-- hair -->
        <path
          d="M60 84c-2-30 20-44 40-44s42 14 40 44c-4-12-10-18-10-18s-4 10-12 10c-10 0-14-8-18-8s-8 8-18 8c-8 0-12-10-12-10s-6 6-10 18z"
          fill="url(#av-hair)"
        />
        <!-- brows -->
        <g class="av__brows" fill="#3b2f27">
          <rect x="72" y="86" width="20" height="6" rx="3" />
          <rect x="108" y="86" width="20" height="6" rx="3" />
        </g>
        <!-- eyes -->
        <g class="av__eyes">
          <ellipse cx="83" cy="99" rx="9" ry="7" fill="#fff" />
          <ellipse cx="117" cy="99" rx="9" ry="7" fill="#fff" />
          <g class="av__pupils" fill="#2b2b33">
            <circle cx="84" cy="100" r="4" />
            <circle cx="116" cy="100" r="4" />
          </g>
        </g>
        <!-- nose -->
        <path d="M100 104c-4 6-6 9-3 12 2 2 4 2 6 0" fill="none" stroke="#c98a63" stroke-width="3" stroke-linecap="round" />
        <!-- mouth: smile (idle) + talking ellipse -->
        <path class="av__smile" d="M86 121q14 12 28 0" fill="none" stroke="#a5563f" stroke-width="5" stroke-linecap="round" />
        <ellipse class="av__talk" cx="100" cy="122" rx="10" ry="6" fill="#7a3b34" />
      </g>

      <!-- headset -->
      <path class="av__band" d="M55 98C55 44 145 44 145 98" fill="none" stroke="#1f2740" stroke-width="7" stroke-linecap="round" />
      <circle cx="55" cy="102" r="12" fill="#1f2740" />
      <circle cx="55" cy="102" r="5" fill="#63e6e6" class="av__led" />
      <path class="av__boom" d="M55 112C56 144 60 150 86 128" fill="none" stroke="#1f2740" stroke-width="5" stroke-linecap="round" />
      <circle cx="86" cy="128" r="5" fill="#1f2740" />
    </svg>
  </div>
</template>

<style scoped>
.av {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  animation: av-bob 4.2s ease-in-out infinite;
}
.av__glow {
  position: absolute;
  inset: -12%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 42%,
    rgba(99, 230, 230, 0.32),
    rgba(71, 99, 230, 0.2) 48%,
    transparent 72%
  );
  filter: blur(5px);
  animation: av-glow 3s ease-in-out infinite;
}
.av__svg {
  position: relative;
  width: 92%;
  height: 92%;
  overflow: visible;
  filter: drop-shadow(0 8px 16px rgba(47, 67, 201, 0.32));
}

.av__body {
  transform-origin: 100px 200px;
  animation: av-breathe 3.6s ease-in-out infinite;
}
.av__head {
  transform-origin: 100px 138px;
  animation: av-sway 5s ease-in-out infinite;
}
.av__eyes {
  transform-origin: 100px 99px;
  animation: av-blink 5.4s ease-in-out infinite;
}
.av__pupils {
  animation: av-look 7s ease-in-out infinite;
}
.av__brows {
  transition: transform 0.2s ease;
}
.av__talk {
  opacity: 0;
  transform-origin: 100px 122px;
}
.av__led {
  animation: av-led 2s ease-in-out infinite;
}

/* speaking */
.av--talk .av__glow {
  animation-duration: 1.8s;
  background: radial-gradient(
    circle at 50% 42%,
    rgba(99, 230, 230, 0.5),
    rgba(71, 99, 230, 0.28) 48%,
    transparent 72%
  );
}
.av--talk .av__head {
  animation: av-nod 0.5s ease-in-out infinite;
}
.av--talk .av__brows {
  transform: translateY(-2px);
}
.av--talk .av__smile {
  opacity: 0;
}
.av--talk .av__talk {
  opacity: 1;
  animation: av-speak 0.28s ease-in-out infinite;
}

.av--think .av__pupils {
  transform: translateY(-2px);
  animation-duration: 3s;
}

@keyframes av-bob {
  50% {
    transform: translateY(-5px);
  }
}
@keyframes av-glow {
  50% {
    opacity: 0.65;
  }
}
@keyframes av-breathe {
  50% {
    transform: scaleY(1.03);
  }
}
@keyframes av-sway {
  0%,
  100% {
    transform: rotate(-1.6deg);
  }
  50% {
    transform: rotate(1.6deg);
  }
}
@keyframes av-nod {
  0%,
  100% {
    transform: rotate(0deg);
  }
  50% {
    transform: rotate(2deg);
  }
}
@keyframes av-blink {
  0%,
  93%,
  100% {
    transform: scaleY(1);
  }
  96% {
    transform: scaleY(0.08);
  }
}
@keyframes av-look {
  0%,
  40%,
  100% {
    transform: translateX(0);
  }
  50%,
  60% {
    transform: translateX(-2.5px);
  }
  75%,
  85% {
    transform: translateX(2.5px);
  }
}
@keyframes av-speak {
  0%,
  100% {
    transform: scaleY(0.25);
  }
  50% {
    transform: scaleY(1);
  }
}
@keyframes av-led {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .av,
  .av__glow,
  .av__body,
  .av__head,
  .av__eyes,
  .av__pupils,
  .av__talk,
  .av__led {
    animation: none !important;
  }
  .av--talk .av__talk {
    opacity: 0;
  }
  .av--talk .av__smile {
    opacity: 1;
  }
}
</style>
