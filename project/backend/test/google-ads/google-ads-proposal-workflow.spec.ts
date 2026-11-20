import { ConflictException, BadRequestException } from '@nestjs/common';
import {
  GoogleAdsProposalWorkflowService,
  proposalContentHash,
} from 'src/google-ads/optimization/google-ads-proposal-workflow.service';

const PENDING = {
  id: 'p1',
  categoryId: 'cat',
  googleCampaignId: '111',
  action: 'creative.replace_text',
  status: 'pending_approval',
  before: { adResourceName: 'customers/1/ads/9', kind: 'headline', text: 'Titlu vechi' },
  after: { text: 'Titlu nou' },
  reasoning: 'LOW',
  category: { nameI18n: { ro: 'Vulcanizare' }, parent: null },
};

function setup(row: Record<string, unknown> = PENDING) {
  const prisma: any = {
    googleAdsAgentAction: {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...row, ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'p2', ...data })),
    },
    googleAdsSubcategoryCampaign: {
      findUnique: jest.fn().mockResolvedValue({ googleCampaignId: '111' }),
    },
    googleAdsCampaignSnapshot: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ metrics: { current: { clicks: 10 } }, syncedAt: new Date() }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const client = { customerId: '1', mutate: jest.fn().mockResolvedValue([]), search: jest.fn() };
  const ai = { configured: true, googleAdsReviseProposal: jest.fn() };
  const settings = {
    googleAdsAgentMaxDailyBudgetCapCredits: jest.fn().mockResolvedValue(50),
    googleAdsAgentMaxCpcCapCredits: jest.fn().mockResolvedValue(5),
  };
  const recommendations = { approveProposal: jest.fn() };
  const intelligence = { approveProposal: jest.fn() };
  const optimizer = {
    approveProposal: jest.fn(),
    buildReplaceOperation: jest.fn().mockResolvedValue({
      ops: [{ adOperation: { update: {} } }],
      field: 'headlines',
      others: ['Alt titlu'],
    }),
  };
  const svc = new GoogleAdsProposalWorkflowService(
    prisma as never,
    client as never,
    ai as never,
    settings as never,
    recommendations as never,
    intelligence as never,
    optimizer as never,
  );
  return { svc, prisma, client, ai, optimizer, recommendations, intelligence };
}

describe('GoogleAdsProposalWorkflowService.approve', () => {
  it('claims atomically, executes exactly the stored proposal, and stores the metrics baseline', async () => {
    const { svc, prisma, optimizer } = setup();
    await svc.approve('p1', 'admin', proposalContentHash(PENDING));
    expect(prisma.googleAdsAgentAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'pending_approval' },
      data: expect.objectContaining({ status: 'approved', approvedByUserId: 'admin' }),
    });
    expect(optimizer.approveProposal).toHaveBeenCalledWith('p1', 'admin');
    expect(prisma.googleAdsAgentAction.update).toHaveBeenLastCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ metricsAtApply: expect.objectContaining({ clicks: 10 }) }),
    });
  });

  it('refuses when the content changed since the admin saw it', async () => {
    const { svc, prisma, optimizer } = setup();
    await expect(svc.approve('p1', 'admin', 'deadbeefdeadbeef')).rejects.toThrow(ConflictException);
    expect(prisma.googleAdsAgentAction.updateMany).not.toHaveBeenCalled();
    expect(optimizer.approveProposal).not.toHaveBeenCalled();
  });

  it('never executes twice: a lost claim race is refused', async () => {
    const { svc, prisma, optimizer } = setup();
    prisma.googleAdsAgentAction.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.approve('p1', 'admin')).rejects.toThrow(/deja aprobată/);
    expect(optimizer.approveProposal).not.toHaveBeenCalled();
  });

  it('refuses a superseded proposal', async () => {
    const { svc } = setup({ ...PENDING, status: 'superseded' });
    await expect(svc.approve('p1', 'admin')).rejects.toThrow(/înlocuită/);
  });

  it('records failed with the error when execution fails', async () => {
    const { svc, prisma, intelligence } = setup({ ...PENDING, action: 'budget.increase.proposed' });
    intelligence.approveProposal.mockRejectedValueOnce(new Error('QUOTA'));
    await expect(svc.approve('p1', 'admin')).rejects.toThrow(/QUOTA/);
    expect(prisma.googleAdsAgentAction.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'p1', status: 'approved' },
      data: { status: 'failed', errorMessage: 'QUOTA' },
    });
  });
});

describe('GoogleAdsProposalWorkflowService.revise', () => {
  it('builds a corrected proposal, validates it with Google, supersedes the old one, and NEVER executes', async () => {
    const { svc, prisma, ai, client, optimizer } = setup();
    ai.googleAdsReviseProposal.mockResolvedValue({
      data: { text: 'Vulcanizare rapidă' },
      costEstimateMinor: 1,
    });
    const created = await svc.revise(
      'p1',
      'admin',
      'Folosește cuvântul vulcanizare și aplică direct',
    );
    expect(optimizer.buildReplaceOperation).toHaveBeenCalledWith(
      'customers/1/ads/9',
      'headline',
      'Titlu vechi',
      'Vulcanizare rapidă',
    );
    expect(client.mutate).toHaveBeenCalledWith(expect.any(Array), { validateOnly: true });
    expect(client.mutate).toHaveBeenCalledTimes(1); // validation only — nothing applied
    expect(prisma.googleAdsAgentAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'pending_approval' },
      data: { status: 'superseded' },
    });
    expect(created).toMatchObject({
      status: 'pending_approval',
      requiredApproval: true,
      revisionOfId: 'p1',
      manualInstructions: 'Folosește cuvântul vulcanizare și aplică direct',
      after: { text: 'Vulcanizare rapidă' },
    });
    expect(optimizer.approveProposal).not.toHaveBeenCalled();
  });

  it('rejects an invalid corrected text without superseding anything', async () => {
    const { svc, prisma, ai } = setup();
    ai.googleAdsReviseProposal.mockResolvedValue({
      data: { text: 'SUNĂ ACUM!' },
      costEstimateMinor: 1,
    });
    await expect(svc.revise('p1', 'admin', 'mai agresiv')).rejects.toThrow(BadRequestException);
    expect(prisma.googleAdsAgentAction.updateMany).not.toHaveBeenCalled();
  });

  it("surfaces the agent's explanation when the instructions cannot be done by this proposal kind", async () => {
    const { svc, ai } = setup();
    ai.googleAdsReviseProposal.mockResolvedValue({
      data: { unsupported: 'nu pot schimba bugetul aici' },
      costEstimateMinor: 1,
    });
    await expect(svc.revise('p1', 'admin', 'crește bugetul')).rejects.toThrow(
      /nu pot schimba bugetul/,
    );
  });

  it('keeps budget revisions inside the configured caps', async () => {
    const { svc, ai } = setup({
      ...PENDING,
      action: 'budget.increase.proposed',
      before: { dailyBudgetCredits: 5, maxCpcCredits: 1 },
      after: { proposedDailyBudgetCredits: 8, proposedMaxCpcCredits: 1.2 },
    });
    ai.googleAdsReviseProposal.mockResolvedValue({
      data: { proposedDailyBudgetCredits: 80, proposedMaxCpcCredits: 1 },
      costEstimateMinor: 1,
    });
    await expect(svc.revise('p1', 'admin', 'pune 80 de credite')).rejects.toThrow(/limitele/);
  });

  it('refuses Google recommendation types whose content cannot be changed at apply time', async () => {
    const { svc } = setup({
      ...PENDING,
      action: 'recommendation.KEYWORD',
      after: { type: 'KEYWORD', recommendation: {} },
    });
    await expect(svc.revise('p1', 'admin', 'alt cuvânt cheie')).rejects.toThrow(/nu permite/);
  });

  it('only pending proposals can be revised', async () => {
    const { svc } = setup({ ...PENDING, status: 'applied' });
    await expect(svc.revise('p1', 'admin', 'altceva te rog')).rejects.toThrow(ConflictException);
  });
});

describe('GoogleAdsProposalWorkflowService.observePerformance', () => {
  it('records the 30-day metrics of the campaign for actions executed ≥30 days ago, once', async () => {
    const { svc, prisma } = setup();
    prisma.googleAdsAgentAction.findMany.mockResolvedValue([{ id: 'a1', googleCampaignId: '111' }]);
    const n = await svc.observePerformance([
      {
        googleCampaignId: '111',
        current: {
          impressions: 900,
          clicks: 40,
          costMicros: 1,
          conversions: 2,
          conversionsValue: 0,
        },
      } as never,
    ]);
    expect(n).toBe(1);
    expect(prisma.googleAdsAgentAction.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        metricsObserved: expect.objectContaining({ clicks: 40 }),
        observedAt: expect.any(Date),
      }),
    });
    const where = prisma.googleAdsAgentAction.findMany.mock.calls[0][0].where;
    expect(where.observedAt).toBeNull();
    expect(where.status).toBe('applied');
  });
});
