import { AuditLogService } from 'src/admin/audit-log.service';

function fakePrisma() {
  return {
    adminAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'a1',
        ...data,
      })),
    },
  };
}

function makeService(prisma = fakePrisma()) {
  return { svc: new AuditLogService(prisma as any), prisma };
}

describe('AuditLogService', () => {
  it('writes one row with every field of the entry', async () => {
    const { svc, prisma } = makeService();

    await svc.log({
      actorId: 'staff1',
      actorRoles: ['finance', 'support'],
      action: 'wallet.adjust',
      targetType: 'wallet',
      targetId: 'u1',
      before: { balanceMinor: 0 },
      after: { balanceMinor: 2_500 },
      reason: 'goodwill',
    });

    expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'staff1',
        actorRoles: ['finance', 'support'],
        action: 'wallet.adjust',
        targetType: 'wallet',
        targetId: 'u1',
        before: { balanceMinor: 0 },
        after: { balanceMinor: 2_500 },
        reason: 'goodwill',
      },
    });
  });

  it('normalises the optional fields to null/undefined Prisma accepts', async () => {
    const { svc, prisma } = makeService();

    await svc.log({
      actorId: 'staff1',
      actorRoles: [],
      action: 'settings.update',
      targetType: 'platform_settings',
    });

    const data = (prisma.adminAuditLog.create as jest.Mock).mock.calls[0][0].data;
    // Nullable columns get an explicit null...
    expect(data.targetId).toBeNull();
    expect(data.reason).toBeNull();
    // ...but a Json column must get `undefined` (Prisma rejects a literal
    // `undefined` VALUE inside Json, and `null` there means JsonNull).
    expect(data.before).toBeUndefined();
    expect(data.after).toBeUndefined();
  });

  it('maps an explicitly-null before/after to undefined rather than a JSON null', async () => {
    const { svc, prisma } = makeService();

    await svc.log({
      actorId: 'staff1',
      actorRoles: ['finance'],
      action: 'billing_profile.update',
      targetType: 'billing_profile',
      targetId: 'u1',
      before: null, // no profile existed yet
      after: { name: 'ACME SRL' },
    });

    const data = (prisma.adminAuditLog.create as jest.Mock).mock.calls[0][0].data;
    expect(data.before).toBeUndefined();
    expect(data.after).toEqual({ name: 'ACME SRL' });
  });

  it('NEVER throws — the audited action has already committed, so a failed audit write must not fail the request', async () => {
    const prisma = fakePrisma();
    (prisma.adminAuditLog.create as jest.Mock).mockRejectedValue(new Error('db down'));
    const { svc } = makeService(prisma);

    await expect(
      svc.log({
        actorId: 'staff1',
        actorRoles: ['finance'],
        action: 'invoice.void',
        targetType: 'invoice',
        targetId: 'inv1',
      }),
    ).resolves.toBeUndefined();
  });
});
