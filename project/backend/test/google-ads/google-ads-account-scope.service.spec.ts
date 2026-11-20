import { GoogleAdsAccountScopeService } from '../../src/google-ads/google-ads-account-scope.service';

type Mapping = {
  id: string;
  categoryId: string;
  googleCampaignId: string | null;
  status: string;
  createdAt: Date;
};
type Archive = {
  id: string;
  categoryId: string;
  googleCampaignId: string;
  archivedOnCustomerId: string;
  data: unknown;
  archivedAt: Date;
};

function setup(opts: {
  inAccount: string[];
  mappings: Mapping[];
  archive?: Archive[];
  searchFails?: boolean;
  customerId?: string;
}) {
  const state = {
    mappings: [...opts.mappings],
    archive: [...(opts.archive ?? [])],
    customerId: opts.customerId ?? '111',
  };
  const client = {
    configured: true,
    get customerId() {
      return state.customerId;
    },
    search: jest.fn(async () => {
      if (opts.searchFails) throw new Error('boom');
      return opts.inAccount.map((id) => ({ campaign: { id } }));
    }),
  };
  let seq = 0;
  const prisma = {
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    category: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id }) },
    googleAdsSubcategoryCampaign: {
      findMany: async () => state.mappings.filter((m) => m.googleCampaignId !== null),
      findUnique: async ({ where }: { where: { categoryId: string } }) =>
        state.mappings.find((m) => m.categoryId === where.categoryId) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        state.mappings = state.mappings.filter((m) => m.id !== where.id);
      },
      create: async ({ data }: { data: Mapping }) => {
        state.mappings.push(data);
      },
    },
    googleAdsSubcategoryCampaignArchive: {
      upsert: async ({ create }: { create: Omit<Archive, 'id' | 'archivedAt'> }) => {
        state.archive.push({ ...create, id: `a${++seq}`, archivedAt: new Date() });
      },
      findMany: async ({ where }: { where: { googleCampaignId: { in: string[] } } }) =>
        state.archive.filter((a) => where.googleCampaignId.in.includes(a.googleCampaignId)),
      delete: async ({ where }: { where: { id: string } }) => {
        state.archive = state.archive.filter((a) => a.id !== where.id);
      },
    },
  };
  const svc = new GoogleAdsAccountScopeService(client as any, prisma as any);
  return { svc, state, client };
}

const m = (id: string, categoryId: string, googleCampaignId: string | null): Mapping => ({
  id,
  categoryId,
  googleCampaignId,
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

describe('GoogleAdsAccountScopeService', () => {
  it('archives mappings whose campaign is not in the current account, keeps the rest', async () => {
    const { svc, state } = setup({
      inAccount: ['10'],
      mappings: [m('m1', 'c1', '10'), m('m2', 'c2', '20'), m('m3', 'c3', null)],
    });
    const res = await svc.ensure();
    expect(res).toEqual({ archived: 1, restored: 0 });
    expect(state.mappings.map((x) => x.id).sort()).toEqual(['m1', 'm3']);
    expect(state.archive).toHaveLength(1);
    expect(state.archive[0]).toMatchObject({
      categoryId: 'c2',
      googleCampaignId: '20',
      archivedOnCustomerId: '111',
    });
  });

  it('restores archived mappings when their account is back, with dates revived', async () => {
    const { svc, state } = setup({
      inAccount: ['20'],
      mappings: [],
      archive: [
        {
          id: 'a1',
          categoryId: 'c2',
          googleCampaignId: '20',
          archivedOnCustomerId: '999',
          data: { ...m('m2', 'c2', '20'), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: 'x' },
          archivedAt: new Date(),
        },
      ],
    });
    const res = await svc.ensure();
    expect(res).toEqual({ archived: 0, restored: 1 });
    expect(state.archive).toHaveLength(0);
    expect(state.mappings[0]).toMatchObject({ id: 'm2', googleCampaignId: '20' });
    expect(state.mappings[0].createdAt).toBeInstanceOf(Date);
    expect(state.mappings[0]).not.toHaveProperty('updatedAt');
  });

  it('never restores over a subcategory that already has a live campaign (keeps the archive row)', async () => {
    const { svc, state } = setup({
      inAccount: ['20', '30'],
      mappings: [m('m9', 'c2', '30')],
      archive: [
        {
          id: 'a1',
          categoryId: 'c2',
          googleCampaignId: '20',
          archivedOnCustomerId: '999',
          data: m('m2', 'c2', '20'),
          archivedAt: new Date(),
        },
      ],
    });
    expect(await svc.ensure()).toEqual({ archived: 0, restored: 0 });
    expect(state.mappings.map((x) => x.id)).toEqual(['m9']);
    expect(state.archive).toHaveLength(1);
  });

  it('changes nothing when the account cannot be read', async () => {
    const { svc, state } = setup({
      inAccount: [],
      mappings: [m('m1', 'c1', '10')],
      searchFails: true,
    });
    expect(await svc.ensure()).toBeNull();
    expect(state.mappings).toHaveLength(1);
    expect(state.archive).toHaveLength(0);
  });

  it('checks once per account unless forced, and again after a switch', async () => {
    const { svc, state, client } = setup({ inAccount: ['10'], mappings: [m('m1', 'c1', '10')] });
    await svc.ensure();
    await svc.ensure();
    expect(client.search).toHaveBeenCalledTimes(1);
    await svc.ensure({ force: true });
    expect(client.search).toHaveBeenCalledTimes(2);
    state.customerId = '222';
    await svc.ensure();
    expect(client.search).toHaveBeenCalledTimes(3);
  });
});
