/**
 * Phase 3 — opt-in visual QA.
 *
 * Runs ONLY when `VISUAL_QA=on`, a `SCREENSHOT_URL` service is configured and a
 * public `siteUrl` for the rendered result is reachable. Otherwise every entry
 * point returns `null` and the pipeline is unchanged (a pure no-op).
 *
 *   siteUrl → screenshot(PNG) → Claude vision → VisualReview → TargetedFix[]
 *
 * The screenshot is the site's OWN render only — no third-party image is ever
 * sent to the model.
 */
import type { StudioLocale } from '../section-catalog';
import type { GeneratorAi, VisualQaConfig, VisualReview } from './types';

export interface Screenshot {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
}

const SHOT_TIMEOUT_MS = 15_000;

/**
 * Fetch a PNG of `siteUrl` from the dev screenshot service. The service contract
 * is intentionally tiny: `GET <serviceUrl>?url=<encoded siteUrl>` → image bytes.
 * Any failure ⇒ `null`.
 */
export async function screenshot(siteUrl: string, serviceUrl: string): Promise<Screenshot | null> {
  if (!siteUrl || !serviceUrl) return null;
  try {
    const u = new URL(serviceUrl);
    u.searchParams.set('url', siteUrl);
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(SHOT_TIMEOUT_MS) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    const mediaType: Screenshot['mediaType'] = ct.includes('jpeg')
      ? 'image/jpeg'
      : ct.includes('webp')
        ? 'image/webp'
        : 'image/png';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 5_000_000) return null;
    return { base64: buf.toString('base64'), mediaType };
  } catch {
    return null;
  }
}

export interface VisualReviewInput {
  ai: GeneratorAi;
  cfg: VisualQaConfig;
  brief: string;
  digest: string;
  locale: StudioLocale;
  /** Injectable for tests. Defaults to the real `screenshot`. */
  shoot?: (siteUrl: string, serviceUrl: string) => Promise<Screenshot | null>;
}

/** `null` unless visual QA is fully enabled AND a screenshot + verdict come back. */
export async function runVisualReview(input: VisualReviewInput): Promise<VisualReview | null> {
  const { ai, cfg, brief, digest, locale } = input;
  if (!cfg.enabled || !cfg.screenshotUrl || !cfg.siteUrl) return null;
  if (!ai.configured) return null;

  const shoot = input.shoot ?? screenshot;
  const shot = await shoot(cfg.siteUrl, cfg.screenshotUrl);
  if (!shot) return null;

  const review = await ai
    .visualReview({
      imageBase64: shot.base64,
      mediaType: shot.mediaType,
      brief,
      digest,
      locale,
    })
    .catch(() => null);
  return review ?? null;
}
