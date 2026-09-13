import type { GeneratorAi, VisualQaConfig, VisualReview } from './types';
import { runVisualReview, screenshot, type Screenshot } from './visual-qa';

const AI_OK: GeneratorAi = {
  configured: true,
  analyzeBusiness: async () => null,
  planArchitecture: async () => null,
  writePageCopy: async () => null,
  enrichImageIntents: async () => null,
  reviewSite: async () => [],
  fixSections: async () => null,
  visualReview: async (): Promise<VisualReview> => ({
    score: 64,
    criticalIssues: ['hero image is low contrast'],
    warnings: [],
    strengths: ['clear hierarchy'],
    recommendedFixes: [{ target: 'hero.image', instruction: 'stronger hero photo' }],
  }),
  refineBrief: async () => null,
  clarifyBrief: async () => null,
};
const AI_OFF: GeneratorAi = { ...AI_OK, configured: false };

const shot: Screenshot = { base64: 'AAAA', mediaType: 'image/png' };
const shootOk = async (): Promise<Screenshot> => shot;
const shootNull = async (): Promise<Screenshot | null> => null;

const cfg = (over: Partial<VisualQaConfig> = {}): VisualQaConfig => ({
  enabled: true,
  screenshotUrl: 'http://localhost:9999/shot',
  siteUrl: 'http://localhost:5173/s/acme',
  ...over,
});

describe('screenshot()', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null with an empty service or site url', async () => {
    expect(await screenshot('', 'http://x')).toBeNull();
    expect(await screenshot('http://site', '')).toBeNull();
  });

  it('returns base64 + media type on a PNG response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as Response);
    const s = await screenshot('http://site', 'http://shooter');
    expect(s?.mediaType).toBe('image/png');
    expect(s?.base64).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
  });

  it('returns null on a non-ok response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, headers: new Headers() } as Response);
    expect(await screenshot('http://site', 'http://shooter')).toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));
    expect(await screenshot('http://site', 'http://shooter')).toBeNull();
  });
});

describe('runVisualReview()', () => {
  const base = {
    ai: AI_OK,
    brief: 'b',
    digest: '## Home\n- [id] hero/split: hi',
    locale: 'ro' as const,
  };

  it('null when disabled', async () => {
    expect(
      await runVisualReview({ ...base, cfg: cfg({ enabled: false }), shoot: shootOk }),
    ).toBeNull();
  });
  it('null with no screenshot service', async () => {
    expect(
      await runVisualReview({ ...base, cfg: cfg({ screenshotUrl: '' }), shoot: shootOk }),
    ).toBeNull();
  });
  it('null with no site url', async () => {
    expect(
      await runVisualReview({ ...base, cfg: cfg({ siteUrl: '' }), shoot: shootOk }),
    ).toBeNull();
  });
  it('null when the AI has no key', async () => {
    expect(await runVisualReview({ ...base, ai: AI_OFF, cfg: cfg(), shoot: shootOk })).toBeNull();
  });
  it('null when the screenshot cannot be taken', async () => {
    expect(await runVisualReview({ ...base, cfg: cfg(), shoot: shootNull })).toBeNull();
  });
  it('returns the verdict when everything is in place', async () => {
    const r = await runVisualReview({ ...base, cfg: cfg(), shoot: shootOk });
    expect(r?.score).toBe(64);
    expect(r?.recommendedFixes[0].target).toBe('hero.image');
  });
});
