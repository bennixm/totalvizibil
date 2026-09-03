import { WebsiteDraft } from '@prisma/client';
import { FREE_MAX_TURNS, TranscriptTurn } from './website-draft.script';
import { EasyAnswers, effectiveToggles, templateKey } from './easy-compose';

/** The subset of the guided answers the studio widgets prefill from. */
function easyBlock(d: WebsiteDraft) {
  if (d.mode !== 'easy') return null;
  const a = ((d.answers as unknown as EasyAnswers) ?? {}) as EasyAnswers;
  const tog = effectiveToggles(a);
  return {
    companyName: a.companyName ?? '',
    businessType: a.businessType ?? '',
    landingTitle: a.landingTitle ?? '',
    landingSubtitle: a.landingSubtitle ?? '',
    accentColor: a.accentColor ?? null,
    landingImage: a.landingImage ?? null,
    serviceNames: a.serviceNames ?? [],
    services: a.services ?? [],
    portfolio: a.portfolio ?? [],
    phone: a.phone ?? '',
    email: a.email ?? '',
    city: a.city ?? '',
    about: a.about ?? '',
    showAbout: tog.showAbout,
    stats: a.stats ?? [],
    showStats: tog.showStats,
    whyUs: a.whyUs ?? [],
    showWhyUs: tog.showWhyUs,
    process: a.process ?? [],
    showProcess: tog.showProcess,
    testimonials: a.testimonials ?? [],
    faq: a.faq ?? [],
    ctaHeadline: a.ctaHeadline ?? '',
    ctaButton: a.ctaButton ?? '',
    showCta: tog.showCta,
    hours: a.hours ?? '',
    template: templateKey(a.template),
    autoGrammar: a.autoGrammar === true,
    locale: a.locale ?? 'ro',
    aiCalls: a.aiCalls ?? 0,
  };
}

/** API-facing shape for a website draft. The token is never included here. */
export function toDraftView(d: WebsiteDraft) {
  const turnsLeft = Math.max(0, FREE_MAX_TURNS - d.turnsUsed);
  return {
    id: d.id,
    mode: d.mode,
    plan: d.plan,
    status: d.status,
    step: d.step,
    turnsUsed: d.turnsUsed,
    maxTurns: FREE_MAX_TURNS,
    turnsLeft,
    capReached: turnsLeft === 0 && d.step !== 'done',
    complete: d.step === 'done',
    transcript: (d.transcript as unknown as TranscriptTurn[]) ?? [],
    theme: (d.theme as unknown) ?? null,
    content: (d.content as unknown) ?? null,
    generator: d.generator ?? null,
    ready: d.content != null,
    easy: easyBlock(d),
    categorySlug: d.categorySlug ?? null,
    location:
      d.locationNationwide || (d.locationCity && d.locationLat != null && d.locationLng != null)
        ? {
            city: d.locationCity,
            region: d.locationRegion,
            country: d.locationCountry ?? 'RO',
            lat: d.locationLat,
            lng: d.locationLng,
            radiusKm: d.locationRadiusKm ?? null,
            nationwide: d.locationNationwide,
          }
        : null,
    updatedAt: d.updatedAt,
  };
}

export type WebsiteDraftView = ReturnType<typeof toDraftView>;
