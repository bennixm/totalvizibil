<script setup lang="ts">
/**
 * Shows the exact change a Google Ads agent action makes: which sitelinks
 * (texts + URL), which callouts/headlines/descriptions, which keyword, which
 * budget or bid values. The content comes pre-built from the backend
 * (`preview` on each action row), so this only renders the four section
 * kinds and has no per-recommendation-type logic of its own.
 */
import type { GoogleAdsProposalPreview } from '@/stores/admin'

defineProps<{ preview: GoogleAdsProposalPreview; compact?: boolean }>()

function hostPath(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return url
  }
}
</script>

<template>
  <div v-if="preview.sections.length" class="gpp" :class="{ 'gpp--compact': compact }">
    <section v-for="(s, i) in preview.sections" :key="i" class="gpp__section">
      <template v-if="s.kind === 'note'">
        <p class="gpp__note" :class="`gpp__note--${s.tone}`">
          <v-icon :icon="s.tone === 'warning' ? 'mdi-alert-outline' : 'mdi-information-outline'" size="16" />
          <span>{{ s.text }}</span>
        </p>
      </template>

      <template v-else>
        <h4 class="gpp__title">{{ s.title }}</h4>

        <!-- Sitelinks and other structured items -->
        <ul v-if="s.kind === 'items'" class="gpp__items">
          <li v-for="(it, j) in s.items" :key="j" class="gpp__item">
            <span class="gpp__itemTitle">{{ it.title }}</span>
            <span v-for="(l, k) in it.lines" :key="k" class="gpp__itemLine">{{ l }}</span>
            <a v-if="it.url" :href="it.url" target="_blank" rel="noopener noreferrer" class="gpp__itemUrl">
              <v-icon icon="mdi-link-variant" size="13" />{{ hostPath(it.url) }}
            </a>
          </li>
        </ul>

        <!-- Callouts, headlines, descriptions, keywords -->
        <ul v-else-if="s.kind === 'texts'" class="gpp__texts">
          <li
            v-for="(it, j) in s.items"
            :key="j"
            class="gpp__text"
            :class="`gpp__text--${it.status}`"
          >
            <v-icon v-if="it.status === 'added'" icon="mdi-plus" size="13" />
            {{ it.text }}
          </li>
        </ul>

        <!-- Value changes -->
        <dl v-else-if="s.kind === 'diff'" class="gpp__diff">
          <template v-for="(r, j) in s.rows" :key="j">
            <dt>{{ r.label }}</dt>
            <dd>
              <template v-if="r.before !== null">
                <span class="gpp__before">{{ r.before }}</span>
                <v-icon icon="mdi-arrow-right" size="14" class="gpp__arrow" />
              </template>
              <b>{{ r.after }}</b>
            </dd>
          </template>
        </dl>
      </template>
    </section>
  </div>
</template>

<style scoped>
.gpp {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.6rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-sm);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.gpp--compact {
  padding: 0.55rem 0.7rem;
  gap: 0.55rem;
}
.gpp__title {
  margin: 0 0 0.4rem;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* sitelinks: a grid of small cards, roughly how they appear under an ad */
.gpp__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 0.5rem;
}
.gpp__item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-xs);
  background: rgb(var(--v-theme-surface));
  min-width: 0;
}
.gpp__itemTitle {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  font-size: var(--tvz-fs-small);
}
.gpp__itemLine {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.gpp__itemUrl {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.15rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.gpp__itemUrl:hover {
  text-decoration: underline;
}

/* texts: chips, new ones highlighted, kept ones muted */
.gpp__texts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.gpp__text {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.2rem 0.55rem;
  border-radius: var(--tvz-radius-xs);
  font-size: var(--tvz-fs-small);
  line-height: 1.4;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.gpp__text--added {
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-theme-success), 0.35);
}
.gpp__text--existing {
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.6);
  border: 1px solid var(--tvz-hairline);
}

/* diffs */
.gpp__diff {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.3rem 1rem;
  margin: 0;
  font-size: var(--tvz-fs-small);
}
.gpp__diff dt {
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gpp__diff dd {
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.gpp__before {
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-decoration: line-through;
}
.gpp__arrow {
  opacity: 0.5;
}

.gpp__note {
  display: flex;
  gap: 0.4rem;
  align-items: flex-start;
  margin: 0;
  font-size: var(--tvz-fs-small);
  padding: 0.45rem 0.6rem;
  border-radius: var(--tvz-radius-xs);
}
.gpp__note--info {
  background: rgba(var(--v-theme-info), 0.08);
}
.gpp__note--warning {
  background: rgba(var(--v-theme-warning), 0.12);
}

@media (max-width: 600px) {
  .gpp__diff {
    grid-template-columns: 1fr;
    gap: 0.1rem;
  }
  .gpp__diff dd {
    margin-bottom: 0.35rem;
  }
}
</style>
