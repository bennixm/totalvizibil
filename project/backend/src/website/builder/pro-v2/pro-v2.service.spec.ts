import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProV2Service } from './pro-v2.service';
import { STARTER_FILES } from './starter-project';

/** A minimal in-memory double for just the Prisma models PRO V2 touches —
 *  enough to exercise the REAL ProV2Service logic (path safety, upsert vs.
 *  create, unique-occurrence edits, file caps) without a real database. */
function fakePrisma(
  role: 'owner' | 'manager' | 'editor' | 'billing' | null = 'owner',
  unlocked = true,
) {
  type FileRow = { id: string; projectId: string; path: string; content: string };
  const files: FileRow[] = [];
  const messages: Record<string, unknown>[] = [];
  let project: { id: string; companyId: string } | null = null;
  let seq = 0;
  const nid = () => `id_${++seq}`;
  const company = {
    id: 'c1',
    ownerUserId: 'owner1',
    advancedUnlockedAt: unlocked ? new Date('2026-01-01') : null,
  };

  return {
    companyUser: {
      findUnique: jest.fn(async () => (role ? { status: 'active', role } : null)),
    },
    platformRoleAssignment: {
      findFirst: jest.fn(async () => null),
    },
    company: {
      findUnique: jest.fn(async () => company),
      findUniqueOrThrow: jest.fn(async () => company),
      update: jest.fn(async ({ data }: { data: { advancedUnlockedAt?: Date } }) => {
        if (data.advancedUnlockedAt) company.advancedUnlockedAt = data.advancedUnlockedAt;
        return company;
      }),
    },
    website: {
      updateMany: jest.fn(async () => ({ count: 1 })),
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
          for (const f of data.files.create) {
            files.push({ id: nid(), projectId: project.id, path: f.path, content: f.content });
          }
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
    __files: files,
    __messages: messages,
  };
}

function fakeWallet(balanceCredits = 1000) {
  return {
    getSummary: jest.fn(async () => ({ balance: { credits: balanceCredits } })),
    spend: jest.fn(async () => {}),
  };
}
function fakeSettings(priceCredits = 50) {
  return { advancedBuilderPriceCredits: jest.fn(async () => priceCredits) };
}
function fakeAssets() {
  return {
    addCompanyAsset: jest.fn(async () => ({ id: 'asset1', url: '/api/v1/website-assets/asset1' })),
  };
}

describe('ProV2Service', () => {
  it('rejects a non-member (not found, not a security-revealing 403)', async () => {
    const prisma = fakePrisma(null);
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    await expect(svc.getOrCreateProject('c1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('rejects an editor-role member (can view the company, not edit code)', async () => {
    const prisma = fakePrisma('editor');
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    await expect(svc.getOrCreateProject('c1', 'u1')).rejects.toThrow(ForbiddenException);
  });

  it('blocks project access when the advanced builder has not been unlocked yet', async () => {
    const prisma = fakePrisma('owner', false);
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    await expect(svc.getOrCreateProject('c1', 'u1')).rejects.toThrow(ForbiddenException);
  });

  it('a platform admin opening an un-unlocked company heals the flag for free instead of being blocked', async () => {
    const prisma = fakePrisma(null, false);
    prisma.platformRoleAssignment.findFirst = jest.fn(async () => ({ role: 'admin' })) as never;
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    await expect(svc.getOrCreateProject('c1', 'admin1')).resolves.toBeDefined();
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { advancedUnlockedAt: expect.any(Date) } }),
    );
  });

  it('getUnlockStatus reports price/balance without requiring unlock first', async () => {
    const prisma = fakePrisma('owner', false);
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet(30) as never,
      fakeSettings(50) as never,
      fakeAssets() as never,
    );
    const status = await svc.getUnlockStatus('c1', 'u1');
    expect(status).toEqual({
      unlocked: false,
      priceCredits: 50,
      wallet: { balance: { credits: 30 } },
    });
  });

  it('unlock charges the wallet once and then allows project access', async () => {
    const prisma = fakePrisma('owner', false);
    const wallet = fakeWallet(100);
    const svc = new ProV2Service(
      prisma as never,
      wallet as never,
      fakeSettings(50) as never,
      fakeAssets() as never,
    );
    await svc.unlock('c1', 'u1');
    expect(wallet.spend).toHaveBeenCalledTimes(1);
    await expect(svc.getOrCreateProject('c1', 'u1')).resolves.toBeDefined();
    // Calling unlock again on an already-unlocked company must not charge twice.
    await svc.unlock('c1', 'u1');
    expect(wallet.spend).toHaveBeenCalledTimes(1);
  });

  it('uploadAsset delegates to WebsiteAssetService as kind "custom", after ownership + unlock checks', async () => {
    const prisma = fakePrisma('owner', true);
    const assets = fakeAssets();
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      assets as never,
    );
    const result = await svc.uploadAsset('c1', 'u1', 'data:image/png;base64,abc123');
    expect(assets.addCompanyAsset).toHaveBeenCalledWith(
      'c1',
      'data:image/png;base64,abc123',
      'custom',
    );
    expect(result).toEqual({ id: 'asset1', url: '/api/v1/website-assets/asset1' });
  });

  it('uploadAsset is blocked before unlock, same as project access', async () => {
    const prisma = fakePrisma('owner', false);
    const assets = fakeAssets();
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      assets as never,
    );
    await expect(svc.uploadAsset('c1', 'u1', 'data:image/png;base64,abc123')).rejects.toThrow(
      ForbiddenException,
    );
    expect(assets.addCompanyAsset).not.toHaveBeenCalled();
  });

  it('seeds a brand-new project with the starter Vue/Vite scaffold, once', async () => {
    const prisma = fakePrisma();
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    const p1 = await svc.getOrCreateProject('c1', 'u1');
    const p2 = await svc.getOrCreateProject('c1', 'u1');
    expect(p1.id).toBe(p2.id); // idempotent — no double-seeding
    expect(prisma.__files).toHaveLength(Object.keys(STARTER_FILES).length);
    expect(prisma.__files.some((f) => f.path === 'src/App.vue')).toBe(true);
  });

  it('write_file creates a new file and overwrites an existing one', async () => {
    const prisma = fakePrisma();
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    const project = await svc.getOrCreateProject('c1', 'u1');
    await svc.writeFile(project.id, 'src/components/Hero.vue', '<template>v1</template>');
    const read1 = await svc.readFile(project.id, 'src/components/Hero.vue');
    expect(read1.content).toBe('<template>v1</template>');
    await svc.writeFile(project.id, 'src/components/Hero.vue', '<template>v2</template>');
    const read2 = await svc.readFile(project.id, 'src/components/Hero.vue');
    expect(read2.content).toBe('<template>v2</template>');
  });

  it('enforces the max-files-per-project cap on genuinely new files', async () => {
    const prisma = fakePrisma();
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    const project = await svc.getOrCreateProject('c1', 'u1');
    // Fill up to the cap with new files (starter files already count toward it).
    const starterCount = Object.keys(STARTER_FILES).length;
    for (let i = 0; i < 60 - starterCount; i++) {
      await svc.writeFile(project.id, `src/generated/File${i}.vue`, 'x');
    }
    await expect(svc.writeFile(project.id, 'src/generated/OneTooMany.vue', 'x')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('edit_file requires exactly one match — errors on zero or multiple', async () => {
    const prisma = fakePrisma();
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    const project = await svc.getOrCreateProject('c1', 'u1');
    await svc.writeFile(project.id, 'src/App.vue', 'const a = 1;\nconst a = 1;\n');

    await expect(svc.editFile(project.id, 'src/App.vue', 'does-not-exist', 'x')).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      svc.editFile(project.id, 'src/App.vue', 'const a = 1;', 'const a = 2;'),
    ).rejects.toThrow(BadRequestException);

    await svc.writeFile(project.id, 'src/App.vue', 'unique-token here');
    await svc.editFile(project.id, 'src/App.vue', 'unique-token', 'replaced-token');
    const read = await svc.readFile(project.id, 'src/App.vue');
    expect(read.content).toBe('replaced-token here');
  });

  it('cannot delete the last remaining file', async () => {
    const prisma = fakePrisma();
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    const project = await svc.getOrCreateProject('c1', 'u1');
    // Delete every file but one first.
    const files = await svc.listFiles(project.id);
    for (const f of files.slice(1)) {
      await svc.deleteFile(project.id, f.path);
    }
    await expect(svc.deleteFile(project.id, files[0].path)).rejects.toThrow(BadRequestException);
  });

  it('searchFiles finds a text match across files with path/line/snippet', async () => {
    const prisma = fakePrisma();
    const svc = new ProV2Service(
      prisma as never,
      fakeWallet() as never,
      fakeSettings() as never,
      fakeAssets() as never,
    );
    const project = await svc.getOrCreateProject('c1', 'u1');
    await svc.writeFile(
      project.id,
      'src/components/Pricing.vue',
      'line one\nStarter plan here\nline three',
    );
    const matches = await svc.searchFiles(project.id, 'starter plan');
    expect(matches).toEqual([
      expect.objectContaining({ path: 'src/components/Pricing.vue', line: 2 }),
    ]);
  });
});
