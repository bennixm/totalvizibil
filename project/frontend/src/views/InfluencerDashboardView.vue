<script setup lang="ts">
/**
 * The influencer's own panel. Read-only by design: the code, the discount
 * and the commission rate are shown, never editable (only an admin can
 * change them); everything else is statistics about their own code.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import InfluencerStats from '@/components/influencer/InfluencerStats.vue'
import { fetchMyInfluencerDashboard, type InfluencerDashboard } from '@/services/influencers'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toasts = useToastStore()

const data = ref<InfluencerDashboard | null>(null)
const loading = ref(true)
const failed = ref(false)

const shareLink = computed(() =>
  data.value ? `${window.location.origin}/?ref=${encodeURIComponent(data.value.influencer.code)}` : '',
)

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toasts.success(t('influencer.copied'))
  } catch {
    toasts.error(t('influencer.copyFailed'))
  }
}

onMounted(async () => {
  try {
    data.value = await fetchMyInfluencerDashboard()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <v-container class="infl">
    <AdminPageHeader :eyebrow="t('influencer.eyebrow')" :title="t('influencer.title')" :sub="t('influencer.sub')" />

    <div v-if="loading" class="infl__center"><v-progress-circular indeterminate color="primary" /></div>
    <AdminEmptyState v-else-if="failed || !data" icon="mdi-alert-circle-outline" :text="t('influencer.loadError')" />

    <template v-else>
      <!-- The code: shown and shareable, never editable here. -->
      <section class="infl__code" :class="{ 'is-off': !data.influencer.active }">
        <div class="infl__codeMain">
          <span class="infl__codeLabel">{{ t('influencer.yourCode') }}</span>
          <div class="infl__codeRow">
            <strong class="infl__codeValue">{{ data.influencer.code }}</strong>
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-content-copy"
              @click="copy(data.influencer.code)"
            >
              {{ t('influencer.copyCode') }}
            </v-btn>
          </div>
          <button type="button" class="infl__link" @click="copy(shareLink)">
            <v-icon icon="mdi-link-variant" size="14" /> {{ shareLink }}
          </button>
        </div>
        <dl class="infl__terms">
          <div>
            <dt>{{ t('influencer.discountLabel') }}</dt>
            <dd>{{ data.influencer.discountPct }}%</dd>
          </div>
          <div>
            <dt>{{ t('influencer.commissionLabel') }}</dt>
            <dd>{{ data.influencer.commissionPct }}%</dd>
          </div>
          <div>
            <dt>{{ t('influencer.statusLabel') }}</dt>
            <dd>
              <span class="infl__status" :class="data.influencer.active ? 'is-on' : 'is-off'">
                {{ data.influencer.active ? t('influencer.active') : t('influencer.inactive') }}
              </span>
            </dd>
          </div>
        </dl>
        <p class="infl__rules">
          <v-icon icon="mdi-information-outline" size="14" />
          {{ t('influencer.rules', { discount: data.influencer.discountPct, commission: data.influencer.commissionPct }) }}
        </p>
      </section>

      <InfluencerStats :stats="data" />
    </template>
  </v-container>
</template>

<style scoped>
.infl__center {
  display: grid;
  place-items: center;
  min-height: 220px;
}
.infl__code {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 1rem 1.5rem;
  padding: 1.2rem 1.4rem;
  margin-bottom: 1.3rem;
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-primary), 0.06);
}
.infl__code.is-off {
  border-color: var(--tvz-glass-border);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.infl__codeLabel {
  font-size: var(--tvz-fs-micro);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.infl__codeRow {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
  margin: 0.2rem 0 0.35rem;
}
.infl__codeValue {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.9rem;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-primary));
}
.infl__link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 100%;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.infl__link:hover {
  color: rgb(var(--v-theme-primary));
}
.infl__terms {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
  margin: 0;
  align-self: center;
}
.infl__terms dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.infl__terms dd {
  margin: 0.1rem 0 0;
  font-weight: 700;
  font-size: 1.15rem;
}
.infl__status {
  font-size: var(--tvz-fs-small);
}
.infl__status.is-on {
  color: rgb(var(--v-theme-success));
}
.infl__status.is-off {
  color: rgb(var(--v-theme-warning));
}
.infl__rules {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.35rem;
  align-items: flex-start;
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
@media (max-width: 760px) {
  .infl__code {
    grid-template-columns: 1fr;
  }
}
</style>
