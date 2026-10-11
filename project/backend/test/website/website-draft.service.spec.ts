import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { WebsiteDraftService } from 'src/website/drafts/website-draft.service';

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
    step: 'template',
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
  };
}

/** Build a fresh service + collaborators for each test. */
function makeService() {
  const prisma = fakePrisma();
  const ai = fakeAi();
  const svc = new WebsiteDraftService(prisma as any, ai as any);
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
      await expect(svc.create()).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
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
      await expect(svc.get('d1', 'unknown-token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
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
    it('advances the portfolio step to contact without calling ai.serviceCopy', async () => {
      const { svc, prisma, ai } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'portfolio',
        mode: 'easy',
      });
      const view = await svc.advanceStep('d1', 'tok1');
      expect(view.step).toBe('contact');
      expect(ai.serviceCopy).not.toHaveBeenCalled();
    });

    it('advances the color step to landing without calling ai.serviceCopy', async () => {
      const { svc, prisma, ai } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'color',
        mode: 'easy',
      });
      const view = await svc.advanceStep('d1', 'tok1');
      expect(view.step).toBe('landing');
      expect(ai.serviceCopy).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the draft is not in "easy" mode', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'portfolio',
        mode: 'advanced',
      });
      await expect(svc.advanceStep('d1', 'tok1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException for an unrecognised token', async () => {
      const { svc } = makeService();
      await expect(svc.advanceStep('d1', 'ghost-token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
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
        step: 'name',
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
        step: 'name',
        mode: 'easy',
      });
      await expect(svc.sendMessage('d1', 'tok1', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException on a widget-only step (template)', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'template',
        mode: 'easy',
      });
      await expect(svc.sendMessage('d1', 'tok1', 'hello')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('advances the step and persists the turn on a valid message', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedDraft({
        id: 'd1',
        tokenHash: hashToken('tok1'),
        step: 'name',
        mode: 'easy',
        answers: { locale: 'ro' },
      });
      const view = await svc.sendMessage('d1', 'tok1', 'AquaFix');
      expect(view.step).toBe('field');
      expect(prisma.websiteDraft.update).toHaveBeenCalled();
      const updateArg = prisma.websiteDraft.update.mock.calls[0][0];
      expect(updateArg.data.turnsUsed).toBe(1);
    });
  });
});
