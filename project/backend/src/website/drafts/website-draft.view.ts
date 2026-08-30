import { WebsiteDraft } from '@prisma/client';
import { FREE_MAX_TURNS, TranscriptTurn } from './website-draft.script';

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
    categorySlug: d.categorySlug ?? null,
    location:
      d.locationCity && d.locationLat != null && d.locationLng != null
        ? {
            city: d.locationCity,
            region: d.locationRegion,
            country: d.locationCountry ?? 'RO',
            lat: d.locationLat,
            lng: d.locationLng,
            radiusKm: d.locationRadiusKm ?? null,
          }
        : null,
    updatedAt: d.updatedAt,
  };
}

export type WebsiteDraftView = ReturnType<typeof toDraftView>;
