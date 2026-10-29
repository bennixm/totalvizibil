import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { WebsiteDraftService } from 'src/website/drafts/website-draft.service';

const TOKEN = 'draft-token-abc';
const DRAFT_ID = 'draft-1';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A WebsiteDraft row in the shape `toDraftView` reads. */
function draftRow(overrides: Record<string, any> = {}) {
  return {
    id: DRAFT_ID,
    tokenHash: hash(TOKEN),
    mode: 'easy',
    plan: 'free',
    status: 'ready',
    step: 'template',
    turnsUsed: 0,
    answers: { locale: 'ro', companyName: 'Acme' },
    transcript: [],
    theme: { accent: '#000' },
    content: { sections: [] },
    generator: 'easy-v1',
    categorySlugs: ['instalatii-sanitare'],
    locationCounties: [],
    locationCity: null,
    locationCountry: 'RO',
    locationLat: null,
    locationLng: null,
    locationNationwide: false,
    claimedCompanyId: null,
    expiresAt: new Date(Date.now() + 60_000),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakePrisma(row: any) {
  return {
    websiteDraft: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...row, ...data })),
    },
    websiteAsset: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'asset-1' }),
    },
    category: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'cat-1',
        slug: 'instalatii-sanitare',
        isActive: true,
        parentId: 'g1',
      }),
      findMany: jest.fn().mockResolvedValue([{ id: 'cat-1', parentId: 'g1' }]),
    },
  };
}

function fakeAi() {
  return {
    serviceCopy: jest.fn().mockResolvedValue(null),
    reviewCopy: jest.fn().mockResolvedValue(null),
  };
}

function makeService(row: any = draftRow()) {
  const prisma = fakePrisma(row);
  const ai = fakeAi();
  const svc = new WebsiteDraftService(prisma as any, ai as any);
  return { svc, prisma, ai };
}

/** A tiny valid 1x1 PNG data-URI, in the exact form `addAsset` accepts. */
const PNG_DATA_URI =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** Every endpoint that resolves a draft from the anonymous token alone. These
 *  all funnel through the private `load()`, which is where the claimed-draft
 *  rejection lives — so one check has to cover all of them. */
const TOKEN_ENTRY_POINTS: [string, (svc: WebsiteDraftService) => Promise<unknown>][] = [
  ['get', (s) => s.get(DRAFT_ID, TOKEN)],
  ['sendMessage', (s) => s.sendMessage(DRAFT_ID, TOKEN, 'hello there')],
  ['advanceStep', (s) => s.advanceStep(DRAFT_ID, TOKEN)],
  ['patchEasy', (s) => s.patchEasy(DRAFT_ID, TOKEN, { landingTitle: 'Hi' })],
  ['regenerateServices', (s) => s.regenerateServices(DRAFT_ID, TOKEN, ['montaj'])],
  ['reviewDraft', (s) => s.reviewDraft(DRAFT_ID, TOKEN)],
  ['addAsset', (s) => s.addAsset(DRAFT_ID, TOKEN, PNG_DATA_URI, 'logo')],
  [
    'setLocation',
    (s) => s.setLocation(DRAFT_ID, TOKEN, { categorySlugs: ['instalatii-sanitare'] }),
  ],
];

describe('WebsiteDraftService — draft-token resolution', () => {
  describe('loadByToken', () => {
    it('throws NotFoundException for an empty token without querying', async () => {
      const { svc, prisma } = makeService();

      await expect(svc.loadByToken('')).rejects.toThrow(NotFoundException);
      expect(prisma.websiteDraft.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the token matches no draft', async () => {
      const { svc } = makeService(null);

      await expect(svc.loadByToken(TOKEN)).rejects.toThrow('Draft not found');
    });

    it('throws when the draft has expired', async () => {
      const { svc } = makeService(draftRow({ expiresAt: new Date(Date.now() - 1_000) }));

      await expect(svc.loadByToken(TOKEN)).rejects.toThrow(NotFoundException);
    });

    it('looks the draft up by the token HASH, never the raw token', async () => {
      const { svc, prisma } = makeService();

      await svc.loadByToken(TOKEN);

      expect(prisma.websiteDraft.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hash(TOKEN) },
      });
    });

    // The claim step is the ONE caller allowed to see a claimed row: its
    // idempotent-retry branch keys off `status === 'claimed'`, so hiding the
    // row here would dead-end a retried create-from-draft.
    it('still returns a claimed draft, for the account-claim step', async () => {
      const { svc } = makeService(draftRow({ status: 'claimed', claimedCompanyId: 'co-1' }));

      await expect(svc.loadByToken(TOKEN)).resolves.toMatchObject({ status: 'claimed' });
    });
  });

  // ---------------------------------------------------------------------------
  // A claimed draft's token must stop working. It is an anonymous pre-signup
  // bearer credential with a 7-day TTL; once a real company exists, a token
  // that leaked during the anonymous phase would otherwise keep full read AND
  // write on the row — most concretely `addAsset`, which mints draft-scoped
  // WebsiteAsset rows that the per-company 60-asset cap never counts while
  // they stay publicly servable.
  // ---------------------------------------------------------------------------
  describe('claimed drafts', () => {
    it('loads normally while the draft is unclaimed and unexpired', async () => {
      const { svc } = makeService();

      const view = await svc.get(DRAFT_ID, TOKEN);

      expect(view.id).toBe(DRAFT_ID);
      expect(view.status).toBe('ready');
    });

    it('rejects a claimed draft with the SAME error as a nonexistent token', async () => {
      // No distinct "already claimed" message: a different response would
      // confirm to a token holder that their token was once valid.
      const missing = makeService(null);
      const claimed = makeService(draftRow({ status: 'claimed', claimedCompanyId: 'co-1' }));

      const missingErr = await missing.svc.get(DRAFT_ID, TOKEN).catch((e) => e);
      const claimedErr = await claimed.svc.get(DRAFT_ID, TOKEN).catch((e) => e);

      expect(claimedErr).toBeInstanceOf(NotFoundException);
      expect(claimedErr.message).toBe(missingErr.message);
      expect(claimedErr.getStatus()).toBe(missingErr.getStatus());
    });

    it.each(TOKEN_ENTRY_POINTS)('blocks %s on a claimed draft', async (_name, call) => {
      const { svc } = makeService(draftRow({ status: 'claimed', claimedCompanyId: 'co-1' }));

      await expect(call(svc)).rejects.toThrow(NotFoundException);
    });

    it('blocks a draft carrying claimedCompanyId even if its status lags', async () => {
      const { svc } = makeService(draftRow({ status: 'ready', claimedCompanyId: 'co-1' }));

      await expect(svc.get(DRAFT_ID, TOKEN)).rejects.toThrow('Draft not found');
    });

    it('never writes to the draft or its assets once claimed', async () => {
      const { svc, prisma } = makeService(
        draftRow({ status: 'claimed', claimedCompanyId: 'co-1' }),
      );

      await expect(svc.addAsset(DRAFT_ID, TOKEN, PNG_DATA_URI, 'portfolio')).rejects.toThrow(
        NotFoundException,
      );
      await expect(svc.patchEasy(DRAFT_ID, TOKEN, { landingTitle: 'Hi' })).rejects.toThrow(
        NotFoundException,
      );

      // The asset-cap bypass is closed: no new row, and no update either.
      expect(prisma.websiteAsset.create).not.toHaveBeenCalled();
      expect(prisma.websiteDraft.update).not.toHaveBeenCalled();
    });

    it('still accepts an asset upload on an unclaimed draft', async () => {
      const { svc, prisma } = makeService();

      const out = await svc.addAsset(DRAFT_ID, TOKEN, PNG_DATA_URI, 'logo');

      expect(out).toEqual({ id: 'asset-1', url: '/api/v1/website-assets/asset-1' });
      expect(prisma.websiteAsset.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a token whose draft id does not match the path id', async () => {
      const { svc } = makeService();

      await expect(svc.get('some-other-id', TOKEN)).rejects.toThrow('Draft not found');
    });
  });
});
