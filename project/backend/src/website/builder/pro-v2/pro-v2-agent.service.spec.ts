import { BadRequestException } from '@nestjs/common';
import { ProV2AgentService } from './pro-v2-agent.service';
import { ProV2Service } from './pro-v2.service';
import { ModelRouter } from './model-router';
import { AiUsageService } from './ai-usage.service';
import type { AgentCallParams, AgentCallResult, AiProvider } from '../../../ai/provider.types';

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
    website: { findUnique: jest.fn(async () => null) },
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
      aggregate: jest.fn(
        async ({
          where,
        }: {
          where: { requestId?: string; userId?: string; createdAt?: unknown };
        }) => {
          const matching = usageRecords.filter((r) =>
            where.requestId
              ? r.requestId === where.requestId
              : where.userId
                ? r.userId === where.userId
                : true,
          );
          const sum = matching.reduce((s, r) => s + ((r.estimatedCostUsd as number) ?? 0), 0);
          return { _sum: { estimatedCostUsd: matching.length ? sum : null } };
        },
      ),
      groupBy: jest.fn(async () => []),
    },
    __files: files,
    __messages: messages,
    __usageRecords: usageRecords,
  };
}

function usage(input = 100, output = 50) {
  return { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0 };
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
    usage: usage(),
  };
}

function endTurnResult(text: string): AgentCallResult {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: usage() };
}

function fakeClaudeProvider(script: AgentCallResult[]): AiProvider & { agentMessage: jest.Mock } {
  let i = 0;
  return {
    name: 'claude',
    configured: true,
    agentMessage: jest.fn(
      async (_params: AgentCallParams) => script[Math.min(i++, script.length - 1)] ?? null,
    ),
  };
}

function fakeClaudeRepeatingSameFailure(): AiProvider & { agentMessage: jest.Mock } {
  return {
    name: 'claude',
    configured: true,
    agentMessage: jest.fn(async (_params: AgentCallParams) =>
      toolUseResult([
        { id: `t${Math.random()}`, name: 'read_file', input: { path: 'src/Missing.vue' } },
      ]),
    ),
  };
}

const fakeDeepSeekUnconfigured: AiProvider = {
  name: 'deepseek',
  configured: false,
  agentMessage: jest.fn(async () => null),
};

function fakeConfig(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    anthropicModel: 'claude-sonnet-5',
    deepseekModelFlash: 'deepseek-chat',
    deepseekModelPro: 'deepseek-reasoner',
    ...overrides,
  };
  return { get: (key: string) => defaults[key] };
}

const fakePexels = { configured: false, search: jest.fn(async () => []) };

/** Real `ModelRouter` + real `AiUsageService`, both backed by fakes — since
 *  DeepSeek is never configured here (matching this environment's real
 *  state), every route resolves to the given claude fake, exactly
 *  preserving this suite's original all-Claude behavior. */
function setup(claudeScript: AiProvider) {
  const prisma = fakePrisma();
  const projects = new ProV2Service(prisma as never, {} as never, {} as never);
  const router = new ModelRouter(
    claudeScript as never,
    fakeDeepSeekUnconfigured as never,
    fakeConfig() as never,
  );
  const usageSvc = new AiUsageService(prisma as never);
  const svc = new ProV2AgentService(
    projects,
    claudeScript as never,
    router,
    usageSvc,
    fakePexels as never,
  );
  return { prisma, projects, svc };
}

describe('ProV2AgentService', () => {
  it('rejects immediately when Claude is not configured — never calls the model', async () => {
    const ai = { name: 'claude' as const, configured: false, agentMessage: jest.fn() };
    const { svc } = setup(ai);
    await expect(svc.sendMessage('u1', 'c1', 'Build me a landing page')).rejects.toThrow(
      BadRequestException,
    );
    expect(ai.agentMessage).not.toHaveBeenCalled();
  });

  it('seeds the starter project on first use and exposes it via getView', async () => {
    const ai = { name: 'claude' as const, configured: true, agentMessage: jest.fn() };
    const { svc } = setup(ai);
    const view = await svc.getView('c1', 'u1');
    expect(view.files.some((f) => f.path === 'src/App.vue')).toBe(true);
    expect(view.messages).toEqual([]);
  });

  it('executes a real write_file tool call, persists it, and returns the updated file tree', async () => {
    const ai = fakeClaudeProvider([
      toolUseResult([
        {
          id: 't1',
          name: 'write_file',
          input: { path: 'src/components/Hero.vue', content: '<template><h1>Nova</h1></template>' },
        },
      ]),
      endTurnResult('Added a Hero component.'),
    ]);
    const { svc } = setup(ai);

    const result = await svc.sendMessage('u1', 'c1', 'Add a hero section');

    expect(result.reply).toBe('Added a Hero component.');
    expect(result.steps).toEqual([
      { tool: 'write_file', summary: expect.stringContaining('Hero.vue') },
    ]);
    expect(result.changedPaths).toEqual(['src/components/Hero.vue']);
    expect(result.usage.iterations).toBe(2);
    expect(result.usage.toolCalls).toBe(1);
    expect(result.usage.provider).toBe('claude');
    const hero = result.files.find((f) => f.path === 'src/components/Hero.vue');
    expect(hero?.content).toContain('Nova');
  });

  it('edit_file performs a targeted patch without touching other files', async () => {
    const ai = fakeClaudeProvider([
      toolUseResult([
        {
          id: 't1',
          name: 'edit_file',
          input: { path: 'src/App.vue', oldString: 'Old title', newString: 'New title' },
        },
      ]),
      endTurnResult('Updated the title.'),
    ]);
    const { svc, projects } = setup(ai);
    const project = await projects.getOrCreateProject('c1', 'u1');
    await projects.writeFile(project.id, 'src/App.vue', '<template><h1>Old title</h1></template>');

    const result = await svc.sendMessage('u1', 'c1', 'Change the title');
    const app = result.files.find((f) => f.path === 'src/App.vue');
    expect(app?.content).toContain('New title');
    expect(app?.content).not.toContain('Old title');
  });

  it('a tool error (missing file) is reported back to Claude, not thrown — the turn still finishes', async () => {
    const ai = fakeClaudeProvider([
      toolUseResult([{ id: 't1', name: 'read_file', input: { path: 'src/DoesNotExist.vue' } }]),
      endTurnResult("That file doesn't exist — could you clarify what you'd like?"),
    ]);
    const { svc } = setup(ai);

    const result = await svc.sendMessage('u1', 'c1', 'Edit the missing file');
    expect(result.steps[0].tool).toBe('read_file');
    expect(result.steps[0].summary).toMatch(/failed/i);
    expect(result.reply).toMatch(/doesn't exist/i);
  });

  it('injects an escalating note after the same failure repeats, instead of failing silently', async () => {
    const ai = fakeClaudeRepeatingSameFailure();
    const { svc } = setup(ai);

    await svc.sendMessage('u1', 'c1', 'Keep trying the same broken thing');

    const calls = ai.agentMessage.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const thirdCallMessages = calls[2][0].messages;
    const lastToolResultBlock = [...thirdCallMessages].reverse().find((m) => m.role === 'user');
    const content = JSON.stringify(lastToolResultBlock);
    expect(content).toMatch(/exact operation/i);
  });

  it('stops after MAX_AGENT_ITERATIONS even if Claude never emits end_turn (no runaway loop)', async () => {
    const ai = fakeClaudeRepeatingSameFailure();
    const { svc } = setup(ai);

    const result = await svc.sendMessage('u1', 'c1', 'Never stop');
    expect(result.reply).toMatch(/step budget|keep going/i);
    expect(ai.agentMessage.mock.calls.length).toBeLessThanOrEqual(24);
  });

  describe('repairTurn (§5 self-correction)', () => {
    it('sends a clearly labeled automatic error report — reuses the same provider, no second client', async () => {
      const ai = fakeClaudeProvider([
        toolUseResult([
          { id: 't1', name: 'read_file', input: { path: 'src/components/Hero.vue' } },
        ]),
        toolUseResult([
          {
            id: 't2',
            name: 'edit_file',
            input: { path: 'src/components/Hero.vue', oldString: 'undefinedFn()', newString: '' },
          },
        ]),
        endTurnResult('Removed a call to a function that did not exist.'),
      ]);
      const { svc, projects } = setup(ai);
      const project = await projects.getOrCreateProject('c1', 'u1');
      await projects.writeFile(
        project.id,
        'src/components/Hero.vue',
        '<script setup>undefinedFn()</script>',
      );

      const result = await svc.repairTurn('u1', 'c1', {
        kind: 'runtime',
        summary: 'Uncaught exception: undefinedFn is not defined',
        path: 'src/components/Hero.vue',
      });

      // The seed user message is always at index 0 of the FIRST call's
      // messages array (mutated in place across iterations afterward).
      const firstCallArgs = ai.agentMessage.mock.calls[0][0] as {
        messages: { role: string; content: unknown }[];
      };
      const seedMessage = JSON.stringify(firstCallArgs.messages[0]);
      expect(seedMessage).toMatch(/automatic/i);
      expect(seedMessage).toContain('src/components/Hero.vue');
      expect(seedMessage).toContain('undefinedFn is not defined');

      expect(result.reply).toMatch(/removed/i);
      const hero = result.files.find((f) => f.path === 'src/components/Hero.vue');
      expect(hero?.content).not.toContain('undefinedFn()');
    });

    it('never claims success when the repair attempt could not actually fix anything', async () => {
      const ai = fakeClaudeProvider([
        endTurnResult("I couldn't identify the cause of this error from the files I can see."),
      ]);
      const { svc } = setup(ai);

      const result = await svc.repairTurn('u1', 'c1', {
        kind: 'build',
        summary: 'Internal server error: something obscure',
      });

      expect(result.reply).not.toMatch(/fixed|resolved|working now/i);
      expect(result.steps).toEqual([]);
    });
  });

  describe('cost routing + usage recording', () => {
    it('records a usage row for the turn with the resolved provider/model/category', async () => {
      const ai = fakeClaudeProvider([endTurnResult('Done.')]);
      const { svc, prisma } = setup(ai);

      await svc.sendMessage('u1', 'c1', 'Create a landing page from scratch');

      expect(prisma.__usageRecords).toHaveLength(1);
      expect(prisma.__usageRecords[0]).toMatchObject({
        userId: 'u1',
        provider: 'claude',
        taskCategory: 'initial_generation',
        succeeded: true,
      });
    });

    it('classifies a repair turn as "repair" and threads the attempt number to the router', async () => {
      const ai = fakeClaudeProvider([endTurnResult('Fixed.')]);
      const { svc, prisma } = setup(ai);

      await svc.repairTurn('u1', 'c1', { kind: 'install', summary: 'npm error', attempt: 2 });

      expect(prisma.__usageRecords[0]).toMatchObject({ taskCategory: 'repair', repairAttempt: 2 });
    });

    it('rejects a new turn once the user is already over their daily budget', async () => {
      const ai = fakeClaudeProvider([endTurnResult('Done.')]);
      const { svc, prisma } = setup(ai);
      prisma.__usageRecords.push({
        userId: 'u1',
        estimatedCostUsd: 999,
        createdAt: new Date(),
      });

      await expect(svc.sendMessage('u1', 'c1', 'Add a section')).rejects.toThrow(
        BadRequestException,
      );
      expect(ai.agentMessage).not.toHaveBeenCalled();
    });
  });
});
