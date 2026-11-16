import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { WebsiteDraftService } from 'src/website/drafts/website-draft.service';
import { WebsiteAssetService } from 'src/website/assets/website-asset.service';
import { PostgresAssetStorageProvider } from 'src/website/assets/postgres-asset-storage.provider';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/** Mirror the service's private hash so tests can cross-check stored values. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Minimal object satisfying the fields that toDraftView reads from WebsiteDraft. */
function makeDraft(overrides: Record<string, any> = {}): any {
  return {
    id: 'd1',
    tokenHash: hashToken('valid-token'),
    mode: 'easy',
    plan: 'free',
    status: 'ready',
    step: 'intro',
    turnsUsed: 0,
    answers: { locale: 'ro' },
    transcript: [{ role: 'assistant', key: 'opening', at: new Date().toISOString() }],
    theme: null,
    content: { pages: [] },
    generator: null,
    categorySlugs: [],
    locationNationwide: false,
    locationCounties: [],
    locationCity: null,
    locationCountry: null,
    locationLat: null,
    locationLng: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakePrisma() {
  const drafts = new Map<string, ReturnType<typeof makeDraft>>();

  return {
    websiteDraft: {
      create: jest.fn(async ({ data }: any) => {
        // The service passes `data` with tokenHash, mode, plan, step, etc.
        // Overlay on makeDraft defaults to get a fully-shaped row back.
        const d = makeDraft({ ...data });
        drafts.set(d.id, d);
        return d;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.tokenHash) {
          for (const d of drafts.values()) {
            if (d.tokenHash === where.tokenHash) return d;
          }
          return null;
        }
        return drafts.get(where.id) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const d = drafts.get(where.id);
        if (!d) return null;
        Object.assign(d, data);
        return d;
      }),
    },
    websiteAsset: {
      create: jest.fn(async ({ data }: any) => ({ id: 'a1', ...data })),
      count: jest.fn(async () => 0),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    category: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    /** Seed a draft row directly into the in-memory store. */
    __seedDraft: (overrides: Record<string, any> = {}) => {
      const d = makeDraft(overrides);
      drafts.set(d.id, d);
      return d;
    },
  };
}

function fakeAi() {
  return {
    serviceCopy: jest.fn().mockResolvedValue(null),
    reviewCopy: jest.fn().mockResolvedValue(null),
    suggestSubcategories: jest.fn().mockResolvedValue(null),
    generateEasySite: jest.fn().mockResolvedValue(null),
    interpretEasyEdit: jest.fn().mockResolvedValue(null),
    parseIntro: jest.fn().mockResolvedValue(null),
  };
}

/** Build a fresh service + collaborators for each test. */
function makeService() {
  const prisma = fakePrisma();
  const ai = fakeAi();
  const assets = new WebsiteAssetService(
    prisma as any,
    new PostgresAssetStorageProvider(prisma as any),
  );
  const svc = new WebsiteDraftService(prisma as any, ai as any, assets);
  return { svc, prisma, ai };
}

// =========================================================================
describe('WebsiteDraftService', () => {
  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('returns a one-time token, a draft id, and a draft view', async () => {
      const { svc } = makeService();
      const result = await svc.create({ locale: 'ro' });
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(0);
      expect(result.id).toBeDefined();
      expect(result.draft).toBeDefined();
    });

    it('stores a SHA-256 hash of the token — never the raw token', async () => {
      const { svc, prisma } = makeService();
      const result = await svc.create();
      const createArg = prisma.websiteDraft.create.mock.calls[0][0];
      // Hash of the returned token must match what was stored
      expect(createArg.data.tokenHash).toBe(hashToken(result.token));
      // The stored value must not equal the raw token
      expect(createArg.data.tokenHash).not.toBe(result.token);
      // SHA-256 is 64 hex chars
      expect(createArg.data.tokenHash).toHaveLength(64);
    });

    it('defaults to easy mode and free plan', async () => {
      const { svc, prisma } = makeService();
      await svc.create();
      const call = prisma.websiteDraft.create.mock.calls[0][0];
      expect(call.data.mode).toBe('easy');
      expect(call.data.plan).toBe('free');
    });

    it('creates an advanced mode draft when mode is "advanced"', async () => {
      const { svc, prisma } = makeService();
      await svc.create({ mode: 'advanced' });
      const call = prisma.websiteDraft.create.mock.calls[0][0];
      expect(call.data.mode).toBe('advanced');
      expect(call.data.plan).toBe('advanced');
    });

    it('pre-fills companyName in answers when seed.businessName is provided', async () => {
      const { svc, prisma } = makeService();
      await svc.create({ seed: { businessName: 'AquaFix SRL' } });
      const call = prisma.websiteDraft.create.mock.calls[0][0];
      const answers = call.data.answers as any;
      expect(answers.companyName).toBe('AquaFix SRL');
    });

    it('propagates a P2002 Prisma error on tokenHash collision', async () => {
      const { svc, prisma } = makeService();
      prisma.websiteDraft.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`token_hash`)',
          { code: 'P2002', clientVersion: '5' },
        ),
      );
      await expect(svc.create()).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  // -----------------------------------------------------------------------
  // get — access-control checks
  // -----------------------------------------------------------------------
  describe('get', () => {
    it('returns the draft view for a matching id + token pair', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({ id: 'd1', tokenHash: hashToken('tok1') });
      const view = await svc.get('d1', 'tok1');
      expect(view.id).toBe('d1');
    });

    it('throws NotFoundException when token is not found', async () => {
      const { svc } = makeService();
      await expect(svc.get('d1', 'unknown-token')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the draft id does not match the token', async () => {
      const { svc, prisma } = makeService();
      // Token belongs to draft d1 but caller asks for d2
      prisma.__seedDraft({ id: 'd1', tokenHash: hashToken('tok1') });
      await expect(svc.get('d2', 'tok1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for an expired draft', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        expiresAt: new Date(Date.now() - 1_000),
      });
      await expect(svc.get('d1', 'tok1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -----------------------------------------------------------------------
  // advanceStep — widget steps that require no AI
  // -----------------------------------------------------------------------
  describe('advanceStep', () => {
    it('advances the photos step to contact without calling ai.serviceCopy', async () => {
      const { svc, prisma, ai } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'photos',
        mode: 'easy',
      });
      const view = await svc.advanceStep('d1', 'tok1');
      expect(view.step).toBe('contact');
      expect(ai.serviceCopy).not.toHaveBeenCalled();
    });

    it('advances the services step (no text) to photos without calling ai.serviceCopy', async () => {
      const { svc, prisma, ai } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'services',
        mode: 'easy',
      });
      const view = await svc.advanceStep('d1', 'tok1');
      expect(view.step).toBe('photos');
      expect(ai.serviceCopy).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the draft is not in "easy" mode', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'photos',
        mode: 'advanced',
      });
      await expect(svc.advanceStep('d1', 'tok1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for an unrecognised token', async () => {
      const { svc } = makeService();
      await expect(svc.advanceStep('d1', 'ghost-token')).rejects.toBeInstanceOf(NotFoundException);
    });

    // Advancing by a widget (skip/continue/upload) is still answering the
    // question on screen — a `note` must leave a real `user`-role turn, same
    // as a typed message does, so the chat never looks one-sided.
    it('pushes a user transcript turn when a note is given', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'photos',
        mode: 'easy',
      });
      const view = await svc.advanceStep('d1', 'tok1', 'Sar peste poze deocamdată.');
      expect(view.transcript).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', text: 'Sar peste poze deocamdată.' }),
        ]),
      );
    });

    it('leaves the transcript untouched (no empty user turn) when no note is given', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'photos',
        mode: 'easy',
        transcript: [],
      });
      const view = await svc.advanceStep('d1', 'tok1');
      expect(view.transcript.some((t) => t.role === 'user')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // sendMessage — access & business-rule checks
  // -----------------------------------------------------------------------
  describe('sendMessage', () => {
    it('throws ForbiddenException when the free turn limit is exhausted', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'intro',
        mode: 'easy',
        turnsUsed: 40, // FREE_MAX_TURNS = 40
      });
      await expect(svc.sendMessage('d1', 'tok1', 'AquaFix')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws BadRequestException for a blank message', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'intro',
        mode: 'easy',
      });
      await expect(svc.sendMessage('d1', 'tok1', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('advances the step and persists the turn on a valid message', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'intro',
        mode: 'easy',
        answers: { locale: 'ro' },
      });
      const view = await svc.sendMessage('d1', 'tok1', 'AquaFix, instalatii');
      expect(view.step).toBe('services');
      expect(prisma.websiteDraft.update).toHaveBeenCalled();
      const updateArg = prisma.websiteDraft.update.mock.calls[0][0];
      expect(updateArg.data.turnsUsed).toBe(1);
    });

    // The very first message must never leave the raw sentence sitting in the
    // preview — `parseIntro` is called immediately and its result overrides
    // the synchronous `quickNameGuess` placeholder before the first compose.
    it('runs AiService.parseIntro on the first message and adopts its result', async () => {
      const { svc, prisma, ai } = makeService();
      ai.parseIntro.mockResolvedValue({
        companyName: 'AquaFix SRL',
        businessType: 'instalații sanitare',
        city: 'Cluj-Napoca',
        landingTitle: 'Instalatori de încredere în Cluj',
        tone: 'professional',
      });
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'intro',
        mode: 'easy',
        answers: { locale: 'ro' },
      });
      const view = await svc.sendMessage(
        'd1',
        'tok1',
        'sunt aquafix, facem instalatii sanitare in cluj',
      );
      expect(ai.parseIntro).toHaveBeenCalledTimes(1);
      expect(view.easy?.companyName).toBe('AquaFix SRL');
      expect(view.easy?.businessType).toBe('instalații sanitare');
      expect(view.easy?.city).toBe('Cluj-Napoca');
      expect(view.easy?.landingTitle).toBe('Instalatori de încredere în Cluj');
    });

    // No raw sentence ever reaches the preview, even when the AI call fails —
    // the deterministic `quickNameGuess` fallback is a short head-of-sentence
    // guess, never the untouched full message.
    it('falls back to the deterministic guess (never the raw sentence) when parseIntro fails', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'intro',
        mode: 'easy',
        answers: { locale: 'ro' },
      });
      const raw = 'salut, eu sunt Andrei si fac gradinarit in zona Brasov';
      const view = await svc.sendMessage('d1', 'tok1', raw);
      expect(view.easy?.companyName).not.toBe(raw);
      expect(view.easy?.companyName).toBe('salut');
    });

    // Auto-picks a template right away (tone-aware) instead of every draft
    // defaulting to `classic` — but stays stable across repeated composes.
    it('auto-picks a template on the first message and keeps it stable afterwards', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'intro',
        mode: 'easy',
        answers: { locale: 'ro' },
      });
      const view = await svc.sendMessage('d1', 'tok1', 'AquaFix, instalatii sanitare');
      expect(view.easy?.template).toEqual(expect.any(String));
      const first = view.easy?.template;

      // A later patch (e.g. a colour change) recomposes but must not re-pick.
      const again = await svc.patchEasy('d1', 'tok1', { accentColor: '#112233' });
      expect(again.easy?.template).toBe(first);
    });

    it('runs the one-shot full-site generation when the contact step finishes', async () => {
      const { svc, prisma, ai } = makeService();
      ai.generateEasySite.mockResolvedValue({
        landingTitle: 'AquaFix — instalatori de încredere',
        about: 'Text generat.',
      });
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'contact',
        mode: 'easy',
        answers: { locale: 'ro', companyName: 'AquaFix', rawIntro: 'AquaFix, instalatii' },
      });
      const view = await svc.sendMessage('d1', 'tok1', '0722 123 456');
      expect(view.step).toBe('done');
      expect(ai.generateEasySite).toHaveBeenCalledTimes(1);
      expect(view.easy?.landingTitle).toBe('AquaFix — instalatori de încredere');
      expect(view.easy?.about).toBe('Text generat.');
    });

    it('runs the AI text review automatically on generation — no manual trigger in this flow', async () => {
      const { svc, prisma, ai } = makeService();
      ai.generateEasySite.mockResolvedValue({ about: 'Un text cu o gresala.' });
      ai.reviewCopy.mockResolvedValue([
        { key: 'about', kind: 'meaning', message: 'Propoziția nu are sens clar.' },
      ]);
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'contact',
        mode: 'easy',
        answers: { locale: 'ro', companyName: 'AquaFix' },
      });
      const view = await svc.sendMessage('d1', 'tok1', '0722 123 456');
      expect(ai.reviewCopy).toHaveBeenCalledTimes(1);
      expect(view.reviewIssues).toEqual([
        expect.objectContaining({ key: 'about', kind: 'meaning' }),
      ]);
    });

    it('does not re-run generation or review on a replayed contact->done transition', async () => {
      const { svc, prisma, ai } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'contact',
        mode: 'easy',
        answers: { locale: 'ro', companyName: 'AquaFix', generatedAt: new Date().toISOString() },
      });
      const view = await svc.sendMessage('d1', 'tok1', '0722 123 456');
      expect(view.step).toBe('done');
      expect(ai.generateEasySite).not.toHaveBeenCalled();
      expect(view.reviewIssues).toBeUndefined();
    });

    it('a chat message at the done step is treated as a free-form edit, not a guided-step answer', async () => {
      const { svc, prisma, ai } = makeService();
      ai.interpretEasyEdit.mockResolvedValue({
        patch: { ctaHeadline: 'Sunăm noi pe tine!' },
        reply: 'Am schimbat titlul îndemnului.',
      });
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'done',
        mode: 'easy',
        answers: { locale: 'ro', companyName: 'AquaFix', generatedAt: new Date().toISOString() },
      });
      const view = await svc.sendMessage('d1', 'tok1', 'schimbă titlul îndemnului');
      expect(view.step).toBe('done');
      expect(ai.interpretEasyEdit).toHaveBeenCalledTimes(1);
      expect(view.easy?.ctaHeadline).toBe('Sunăm noi pe tine!');
      expect(view.transcript.at(-1)).toMatchObject({
        role: 'assistant',
        text: 'Am schimbat titlul îndemnului.',
      });
    });

    it('a failed edit interpretation leaves the site untouched and tells the visitor', async () => {
      const { svc, prisma, ai } = makeService();
      ai.interpretEasyEdit.mockResolvedValue(null);
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'done',
        mode: 'easy',
        answers: { locale: 'ro', ctaHeadline: 'Original' },
      });
      const view = await svc.sendMessage('d1', 'tok1', 'ceva neclar');
      expect(view.easy?.ctaHeadline).toBe('Original');
      expect(view.transcript.at(-1)).toMatchObject({ role: 'assistant', key: 'editFailed' });
    });

    it('stops spending AI calls past EDIT_CALL_CAP (15) but still accepts the turn', async () => {
      const { svc, prisma, ai } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'done',
        mode: 'easy',
        answers: { locale: 'ro', editCalls: 15 },
      });
      const view = await svc.sendMessage('d1', 'tok1', 'mai schimbă ceva');
      expect(ai.interpretEasyEdit).not.toHaveBeenCalled();
      expect(view.transcript.at(-1)).toMatchObject({ role: 'assistant', key: 'editCapped' });
    });

    it('throws BadRequestException for a chat-edit attempt on an advanced draft', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'done',
        mode: 'advanced',
        answers: { locale: 'ro' },
      });
      await expect(svc.sendMessage('d1', 'tok1', 'schimbă ceva')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
