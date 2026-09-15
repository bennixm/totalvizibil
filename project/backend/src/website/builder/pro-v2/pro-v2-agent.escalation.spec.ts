import { ProV2AgentService } from './pro-v2-agent.service';
import { ProV2Service } from './pro-v2.service';
import { ModelRouter } from './model-router';
import { AiUsageService } from './ai-usage.service';
import type { AgentCallParams, AgentCallResult, AiProvider } from '../../../ai/provider.types';

/** See pro-v2-agent.service.spec.ts's fakeWallet — same rationale: these
 *  tests exercise escalation routing, not billing. */
function fakeWallet() {
  return {
    canAfford: jest.fn(async () => true),
    chargeAiUsage: jest.fn(async () => {}),
  };
}

/** Minimal fake Prisma — same shape as the main spec file's, trimmed to what
 *  these tests touch (project/file CRUD + usage recording). */
function fakePrisma() {
  type FileRow = { id: string; projectId: string; path: string; content: string };
  const files: FileRow[] = [];
  const messages: Record<string, unknown>[] = [];
  const usageRecords: Record<string, unknown>[] = [];
  let project: { id: string; companyId: string } | null = null;
  let seq = 0;
  const nid = () => `id_${++seq}`;

  return {
    companyUser: { findUnique: jest.fn(async () => ({ status: 'active', role: 'owner' })) },
    platformRoleAssignment: { findFirst: jest.fn(async () => null) },
    company: {
      findUnique: jest.fn(async () => ({
        advancedUnlockedAt: new Date('2026-01-01'),
        displayName: 'Test Co',
        description: null,
        category: null,
        locations: [],
        contacts: [],
        services: [],
      })),
    },
    proV2Project: {
      findUnique: jest.fn(async () => project),
      create: jest.fn(
        async ({
          data,
        }: {
          data: { companyId: string; files: { create: { path: string; content: string }[] } };
        }) => {
          project = { id: nid(), companyId: data.companyId };
          for (const f of data.files.create)
            files.push({ id: nid(), projectId: project.id, path: f.path, content: f.content });
          return project;
        },
      ),
    },
    proV2File: {
      findMany: jest.fn(async ({ where }: { where: { projectId: string } }) =>
        files
          .filter((f) => f.projectId === where.projectId)
          .sort((a, b) => a.path.localeCompare(b.path)),
      ),
      findUnique: jest.fn(
        async ({
          where,
          select,
        }: {
          where: { projectId_path?: { projectId: string; path: string } };
          select?: { id: boolean };
        }) => {
          const key = where.projectId_path;
          const row = key
            ? files.find((f) => f.projectId === key.projectId && f.path === key.path)
            : undefined;
          if (!row) return null;
          return select ? { id: row.id } : row;
        },
      ),
      count: jest.fn(
        async ({ where }: { where: { projectId: string } }) =>
          files.filter((f) => f.projectId === where.projectId).length,
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { projectId_path: { projectId: string; path: string } };
          create: { projectId: string; path: string; content: string };
          update: { content: string };
        }) => {
          const existing = files.find(
            (f) =>
              f.projectId === where.projectId_path.projectId &&
              f.path === where.projectId_path.path,
          );
          if (existing) {
            existing.content = update.content;
            return existing;
          }
          const row = { id: nid(), ...create };
          files.push(row);
          return row;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: { content: string } }) => {
          const row = files.find((f) => f.id === where.id)!;
          row.content = data.content;
          return row;
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const i = files.findIndex((f) => f.id === where.id);
        const [row] = files.splice(i, 1);
        return row;
      }),
    },
    proV2Message: {
      findMany: jest.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: { projectId: string };
          orderBy?: { createdAt: 'asc' | 'desc' };
          take?: number;
        }) => {
          let list = messages
            .filter((m) => m.projectId === where.projectId)
            .sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
          if (orderBy?.createdAt === 'desc') list = [...list].reverse();
          if (take) list = list.slice(0, take);
          return list;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nid(), createdAt: new Date(Date.now() + messages.length), ...data };
        messages.push(row);
        return row;
      }),
    },
    aiUsageRecord: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nid(), createdAt: new Date(), ...data };
        usageRecords.push(row);
        return row;
      }),
      aggregate: jest.fn(async ({ where }: { where: { requestId?: string; userId?: string } }) => {
        const matching = usageRecords.filter((r) =>
          where.requestId
            ? r.requestId === where.requestId
            : where.userId
              ? r.userId === where.userId
              : true,
        );
        const sum = matching.reduce((s, r) => s + ((r.estimatedCostUsd as number) ?? 0), 0);
        return { _sum: { estimatedCostUsd: matching.length ? sum : null } };
      }),
      groupBy: jest.fn(async () => []),
    },
    __usageRecords: usageRecords,
  };
}

function endTurnResult(text: string): AgentCallResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}
function toolUseResult(calls: { id: string; name: string; input: unknown }[]): AgentCallResult {
  return {
    content: calls.map((c) => ({
      type: 'tool_use' as const,
      id: c.id,
      name: c.name,
      input: c.input,
    })),
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function fakeConfig() {
  const values: Record<string, unknown> = {
    anthropicModel: 'claude-sonnet-5',
    deepseekModelFlash: 'deepseek-chat',
    deepseekModelPro: 'deepseek-reasoner',
  };
  return { get: (key: string) => values[key] } as never;
}

describe('ProV2AgentService — cross-provider escalation (DeepSeek configured)', () => {
  it('escalates flash -> claude when DeepSeek hard-fails (provider returns null)', async () => {
    const prisma = fakePrisma();
    const projects = new ProV2Service(prisma as never, {} as never, {} as never, {} as never);

    const deepseek: AiProvider = {
      name: 'deepseek',
      configured: true,
      agentMessage: jest.fn(async (_p: AgentCallParams) => null), // simulates a network/API failure
    };
    const claude: AiProvider = {
      name: 'claude',
      configured: true,
      agentMessage: jest.fn(async (_p: AgentCallParams) => endTurnResult('Renamed the button.')),
    };

    const router = new ModelRouter(claude as never, deepseek as never, fakeConfig());
    const usage = new AiUsageService(prisma as never, fakeWallet() as never);
    const svc = new ProV2AgentService(projects, claude as never, router, usage, {
      configured: false,
      search: jest.fn(async () => []),
    } as never);

    // Seed a "second message" scenario (not the first message, since first
    // message = initial_generation, which always starts on Claude and would
    // never touch DeepSeek at all).
    await projects.getOrCreateProject('c1', 'u1');
    await projects.appendMessage(
      (await projects.getOrCreateProject('c1', 'u1')).id,
      'assistant',
      'Hi there.',
    );

    const result = await svc.sendMessage('u1', 'c1', 'Rename the button to Start now');

    // Both DeepSeek tiers (flash, then pro) route through this same fake
    // provider instance and both hard-fail, so the full ladder is
    // deepseek(flash) -> deepseek(pro) -> claude: 2 DeepSeek calls, 1 Claude call.
    expect(deepseek.agentMessage).toHaveBeenCalledTimes(2);
    expect(claude.agentMessage).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe('Renamed the button.');
    expect(result.usage.provider).toBe('claude');
    expect(result.usage.escalations).toBe(2);

    // Three usage rows: the two failed DeepSeek hops + the successful Claude hop.
    expect(prisma.__usageRecords).toHaveLength(3);
    expect(prisma.__usageRecords[0]).toMatchObject({ provider: 'deepseek', succeeded: false });
    expect(prisma.__usageRecords[1]).toMatchObject({ provider: 'deepseek', succeeded: false });
    expect(prisma.__usageRecords[2]).toMatchObject({
      provider: 'claude',
      escalatedFrom: 'deepseek-pro:deepseek-reasoner',
    });
  });

  it('escalates when DeepSeek "succeeds" but the static quality gate fails (a no-op edit — real content unchanged)', async () => {
    const prisma = fakePrisma();
    const projects = new ProV2Service(prisma as never, {} as never, {} as never, {} as never);
    const project = await projects.getOrCreateProject('c1', 'u1');
    await projects.writeFile(
      project.id,
      'src/App.vue',
      '<template><button>Old</button></template>',
    );
    await projects.appendMessage(project.id, 'assistant', 'Hi there.');

    // A realistic cheap-model failure: it "edits" a file by replacing text
    // with the SAME text (tool succeeds, nothing actually changed), then
    // WRONGLY declares success. Every hop (flash AND pro both resolve to
    // this same fake) repeats the identical mistake, so it only reaches
    // claude once the ladder is exhausted.
    let deepseekCallCount = 0;
    const deepseek: AiProvider = {
      name: 'deepseek',
      configured: true,
      agentMessage: jest.fn(async (_p: AgentCallParams) => {
        deepseekCallCount++;
        return deepseekCallCount % 2 === 1
          ? toolUseResult([
              {
                id: `t${deepseekCallCount}`,
                name: 'edit_file',
                input: { path: 'src/App.vue', oldString: 'Old', newString: 'Old' },
              },
            ])
          : endTurnResult('Renamed the button.');
      }),
    };
    const claude: AiProvider = {
      name: 'claude',
      configured: true,
      agentMessage: jest.fn(async (_p: AgentCallParams) =>
        endTurnResult('Renamed the button correctly this time.'),
      ),
    };

    const router = new ModelRouter(claude as never, deepseek as never, fakeConfig());
    const usage = new AiUsageService(prisma as never, fakeWallet() as never);
    const svc = new ProV2AgentService(projects, claude as never, router, usage, {
      configured: false,
      search: jest.fn(async () => []),
    } as never);

    const result = await svc.sendMessage('u1', 'c1', 'Rename the button to Start now');

    expect(claude.agentMessage).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe('Renamed the button correctly this time.');
    expect(result.usage.provider).toBe('claude');
    expect(result.usage.escalations).toBe(2); // flash (no-op) -> pro (no-op) -> claude

    const gateRejections = prisma.__usageRecords.filter((r) => r.provider === 'deepseek');
    expect(gateRejections).toHaveLength(2);
  });
});
