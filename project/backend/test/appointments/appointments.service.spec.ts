import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppointmentsService } from 'src/appointments/appointments.service';

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = { frontendOrigin: 'http://localhost:5173' };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides })[k]) };
}

function fakeMail() {
  return { send: jest.fn().mockResolvedValue({ dispatched: true }) };
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function makeAppt(overrides = {}) {
  return {
    id: 'a1',
    companyId: 'co1',
    status: 'pending',
    startsAt: new Date(Date.now() + 86400000),
    durationMinutes: 30,
    name: 'Ion',
    email: 'ion@example.com',
    phone: null,
    notes: null,
    visitorHash: 'hash',
    createdAt: new Date(),
    ...overrides,
  };
}

function fakePrisma() {
  const members = new Map<string, any>();
  const companies = new Map<string, any>();
  const settings = new Map<string, any>();
  const windows: any[] = [];
  const appts = new Map<string, any>();

  return {
    companyUser: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          members.get(`${where.companyId_userId.companyId}:${where.companyId_userId.userId}`) ??
          null,
      ),
    },
    company: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const c of companies.values()) {
          if (c.slug === where.slug && c.status === where.status) return c;
        }
        return null;
      }),
    },
    appointmentSettings: {
      findUnique: jest.fn(async ({ where }: any) => settings.get(where.companyId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = settings.get(where.companyId);
        const row = existing
          ? { ...existing, ...update }
          : { companyId: where.companyId, ...create };
        settings.set(where.companyId, row);
        return row;
      }),
    },
    appointmentAvailability: {
      findMany: jest.fn(async () => [...windows]),
      deleteMany: jest.fn(async () => ({ count: windows.length })),
      createMany: jest.fn(async ({ data }: any) => {
        data.forEach((w: any) => windows.push({ id: `w${windows.length}`, ...w }));
        return { count: data.length };
      }),
    },
    appointment: {
      findMany: jest.fn(async () => [...appts.values()]),
      findFirst: jest.fn(async ({ where }: any) => appts.get(where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const a = makeAppt({ id: 'a1', ...data });
        appts.set(a.id, a);
        return a;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const a = appts.get(where.id);
        if (a) Object.assign(a, data);
        return a ?? makeAppt({ id: where.id, ...data });
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const exists = appts.has(where.id);
        if (exists) appts.delete(where.id);
        return { count: exists ? 1 : 0 };
      }),
      groupBy: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    __seedMember: (companyId: string, userId: string) => {
      members.set(`${companyId}:${userId}`, { companyId, userId, status: 'active' });
    },
    __seedCompany: (data = {}) => {
      const c = {
        id: 'co1',
        slug: 'acme',
        status: 'active',
        displayName: 'Acme',
        owner: { id: 'owner1', email: 'owner@acme.com' },
        ...data,
      };
      companies.set(c.id, c);
      return c;
    },
    __seedSettings: (companyId: string, data = {}) => {
      const s = { companyId, enabled: true, slotMinutes: 30, ...data };
      settings.set(companyId, s);
      return s;
    },
    __seedAppt: (data = {}) => {
      const a = makeAppt(data);
      appts.set(a.id, a);
      return a;
    },
  };
}

function makeService() {
  const prisma = fakePrisma();
  const notifications = fakeNotifications();
  const mail = fakeMail();
  const config = fakeConfig();
  const svc = new AppointmentsService(
    prisma as any,
    notifications as any,
    mail as any,
    config as any,
  );
  return { svc, prisma, notifications, mail };
}

describe('AppointmentsService', () => {
  describe('setAvailability', () => {
    it('throws BadRequestException when endMinute <= startMinute', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      await expect(
        svc.setAvailability('u1', 'co1', {
          windows: [{ weekday: 1, startMinute: 540, endMinute: 480 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when >6 windows on same weekday', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      const windows = Array.from({ length: 7 }, (_, i) => ({
        weekday: 1,
        startMinute: i * 60,
        endMinute: i * 60 + 30,
      }));
      await expect(svc.setAvailability('u1', 'co1', { windows })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('happy path deletes and recreates windows in transaction', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      await svc.setAvailability('u1', 'co1', {
        windows: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('availableSlotsFor', () => {
    it('throws BadRequestException for invalid date format', async () => {
      const { svc } = makeService();
      await expect(svc.availableSlotsFor('acme', 'not-a-date')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns { enabled: true, slots: [] } for date beyond lookahead', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany();
      prisma.__seedSettings('co1');
      const farFuture = new Date(Date.now() + 65 * 86400000);
      const dateISO = farFuture.toISOString().slice(0, 10);
      const result = await svc.availableSlotsFor('acme', dateISO);
      expect(result).toEqual({ enabled: true, slots: [] });
    });

    it('returns { enabled: false, slots: [] } when appointments disabled', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany();
      prisma.__seedSettings('co1', { enabled: false });
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const result = await svc.availableSlotsFor('acme', tomorrow);
      expect(result).toEqual({ enabled: false, slots: [] });
    });

    it('throws NotFoundException for unknown company slug', async () => {
      const { svc } = makeService();
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await expect(svc.availableSlotsFor('unknown', tomorrow)).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitPublic', () => {
    it('returns { ok: true } for bot user-agent without DB access', async () => {
      const { svc, prisma } = makeService();
      const result = await svc.submitPublic(
        'acme',
        { startsAt: new Date().toISOString(), name: 'Bot' },
        '1.2.3.4',
        'Googlebot/2.1',
      );
      expect(result).toEqual({ ok: true });
      expect(prisma.company.findFirst).not.toHaveBeenCalled();
    });

    it('returns { ok: false, error: "appointments_disabled" } when disabled', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany();
      prisma.__seedSettings('co1', { enabled: false });
      const future = new Date(Date.now() + 86400000).toISOString();
      const result = await svc.submitPublic(
        'acme',
        { startsAt: future, name: 'Ion' },
        '1.2.3.4',
        'Mozilla/5.0',
      );
      expect(result).toEqual({ ok: false, error: 'appointments_disabled' });
    });

    it('returns { ok: false, error: "invalid_slot" } for past startsAt', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany();
      prisma.__seedSettings('co1');
      const past = new Date(Date.now() - 86400000).toISOString();
      const result = await svc.submitPublic(
        'acme',
        { startsAt: past, name: 'Ion' },
        '1.2.3.4',
        'Mozilla/5.0',
      );
      expect(result).toEqual({ ok: false, error: 'invalid_slot' });
    });

    it('returns { ok: false, error: "slot_taken" } on P2002', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany();
      prisma.__seedSettings('co1');
      const future = new Date(Date.now() + 86400000);
      jest.spyOn(svc as any, 'availableSlotsFor').mockResolvedValue({
        enabled: true,
        slots: [
          {
            startsAt: future.toISOString(),
            endsAt: new Date(future.getTime() + 1800000).toISOString(),
          },
        ],
      });
      prisma.appointment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5',
        }),
      );
      const result = await svc.submitPublic(
        'acme',
        { startsAt: future.toISOString(), name: 'Ion' },
        '1.2.3.4',
        'Mozilla/5.0',
      );
      expect(result).toEqual({ ok: false, error: 'slot_taken' });
    });

    it('happy path creates appointment and fires notifications', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedCompany();
      prisma.__seedSettings('co1');
      const future = new Date(Date.now() + 86400000);
      jest.spyOn(svc as any, 'availableSlotsFor').mockResolvedValue({
        enabled: true,
        slots: [
          {
            startsAt: future.toISOString(),
            endsAt: new Date(future.getTime() + 1800000).toISOString(),
          },
        ],
      });
      const result = await svc.submitPublic(
        'acme',
        { startsAt: future.toISOString(), name: 'Ion', email: 'ion@example.com' },
        '1.2.3.4',
        'Mozilla/5.0',
      );
      expect(result).toEqual({ ok: true });
      expect(prisma.appointment.create).toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 10));
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'appointment_received' }),
      );
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundException for unknown appointment', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      await expect(svc.updateStatus('u1', 'co1', 'missing', 'confirmed')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sends mail when status changes to confirmed', async () => {
      const { svc, prisma, mail } = makeService();
      prisma.__seedMember('co1', 'u1');
      const appt = prisma.__seedAppt({ id: 'a1', companyId: 'co1', email: 'ion@example.com' });
      prisma.appointment.findFirst.mockResolvedValue({ ...appt, company: { displayName: 'Acme' } });
      await svc.updateStatus('u1', 'co1', 'a1', 'confirmed');
      await new Promise((r) => setTimeout(r, 10));
      expect(mail.send).toHaveBeenCalled();
    });
  });
});
