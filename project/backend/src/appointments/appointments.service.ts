import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Appointment, AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppConfig } from '../config/env';
import { isLikelyBot } from '../campaigns/ad-click';
import { SubmitAppointmentDto } from './dto/submit-appointment.dto';
import { SetAvailabilityDto } from './dto/set-availability.dto';
import { SetAppointmentSettingsDto } from './dto/set-appointment-settings.dto';
import {
  appointmentFingerprint,
  bucharestWallClockToUtc,
  computeAvailableSlots,
  utcToBucharestDateISO,
} from './appointment.util';

const PAGE_MAX = 50;
/** How many days ahead the public widget may ever query — keeps a single
 *  request cheap and matches a realistic booking horizon. */
const MAX_LOOKAHEAD_DAYS = 60;

type AppointmentRow = Prisma.AppointmentGetPayload<Record<string, never>>;

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger('Appointments');
  private readonly frontendOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  // --- membership -------------------------------------------------------

  private async assertMember(companyId: string, userId: string): Promise<void> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') throw new NotFoundException('Company not found');
  }

  // --- owner: settings + schedule ----------------------------------------

  async getSettings(userId: string, companyId: string) {
    await this.assertMember(companyId, userId);
    return this.getSettingsFor(companyId);
  }

  async getSettingsFor(companyId: string) {
    const [settings, windows] = await Promise.all([
      this.prisma.appointmentSettings.findUnique({ where: { companyId } }),
      this.prisma.appointmentAvailability.findMany({
        where: { companyId },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
    ]);
    return {
      enabled: settings?.enabled ?? false,
      slotMinutes: settings?.slotMinutes ?? 30,
      windows: windows.map((w) => ({
        id: w.id,
        weekday: w.weekday,
        startMinute: w.startMinute,
        endMinute: w.endMinute,
      })),
    };
  }

  async setSettings(userId: string, companyId: string, dto: SetAppointmentSettingsDto) {
    await this.assertMember(companyId, userId);
    await this.prisma.appointmentSettings.upsert({
      where: { companyId },
      create: {
        companyId,
        enabled: dto.enabled ?? false,
        slotMinutes: dto.slotMinutes ?? 30,
      },
      update: {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.slotMinutes !== undefined ? { slotMinutes: dto.slotMinutes } : {}),
      },
    });
    return this.getSettingsFor(companyId);
  }

  /** Replaces the whole weekly template — simpler and safer for a schedule
   *  editor UI than diffing individual windows, and small enough (≤50 rows)
   *  that a delete-then-recreate in one transaction is the clearest option. */
  async setAvailability(userId: string, companyId: string, dto: SetAvailabilityDto) {
    await this.assertMember(companyId, userId);
    for (const w of dto.windows) {
      if (w.endMinute <= w.startMinute) {
        throw new BadRequestException('window_end_before_start');
      }
    }
    await this.prisma.$transaction([
      this.prisma.appointmentAvailability.deleteMany({ where: { companyId } }),
      this.prisma.appointmentAvailability.createMany({
        data: dto.windows.map((w) => ({
          companyId,
          weekday: w.weekday,
          startMinute: w.startMinute,
          endMinute: w.endMinute,
        })),
      }),
    ]);
    return this.getSettingsFor(companyId);
  }

  // --- owner: appointments list / manage ---------------------------------

  async list(
    userId: string,
    companyId: string,
    opts: { status?: string; upcomingOnly?: boolean; cursor?: string; limit?: number } = {},
  ) {
    await this.assertMember(companyId, userId);
    const take = Math.min(Math.max(opts.limit ?? 20, 1), PAGE_MAX);

    const where: Prisma.AppointmentWhereInput = { companyId };
    if (opts.status && ['pending', 'confirmed', 'canceled', 'completed'].includes(opts.status)) {
      where.status = opts.status as AppointmentStatus;
    }
    if (opts.upcomingOnly) {
      where.startsAt = { gte: new Date() };
    }

    const rows = await this.prisma.appointment.findMany({
      where,
      orderBy: { startsAt: opts.upcomingOnly ? 'asc' : 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = (hasMore ? rows.slice(0, take) : rows).map((a) => this.view(a));
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async summary(userId: string, companyId: string) {
    await this.assertMember(companyId, userId);
    const [byStatus, upcoming] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.appointment.count({
        where: {
          companyId,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { gte: new Date() },
        },
      }),
    ]);
    const count = (s: AppointmentStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    return {
      total: byStatus.reduce((a, r) => a + r._count._all, 0),
      pending: count('pending'),
      confirmed: count('confirmed'),
      canceled: count('canceled'),
      completed: count('completed'),
      upcoming,
    };
  }

  async updateStatus(userId: string, companyId: string, appointmentId: string, status: string) {
    await this.assertMember(companyId, userId);
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, companyId },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    const updated = await this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: status as AppointmentStatus },
    });
    return this.view(updated);
  }

  async remove(userId: string, companyId: string, appointmentId: string): Promise<void> {
    await this.assertMember(companyId, userId);
    const { count } = await this.prisma.appointment.deleteMany({
      where: { id: appointmentId, companyId },
    });
    if (count === 0) throw new NotFoundException('Appointment not found');
  }

  // --- public: availability + booking ------------------------------------

  /** Live-computed, never cached — the same "compute on read" spirit as the
   *  Feed's own ranking, so the widget always reflects the true current
   *  state (a booking made a second ago is already excluded). */
  async availableSlotsFor(slug: string, dateISO: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
      throw new BadRequestException('invalid_date');
    }
    const requested = new Date(`${dateISO}T00:00:00.000Z`);
    const maxDate = new Date(Date.now() + MAX_LOOKAHEAD_DAYS * 86_400_000);
    if (requested.getTime() > maxDate.getTime()) {
      return { enabled: true, slots: [] };
    }

    const company = await this.prisma.company.findFirst({
      where: { slug, status: 'active' },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const settings = await this.prisma.appointmentSettings.findUnique({
      where: { companyId: company.id },
    });
    if (!settings?.enabled) return { enabled: false, slots: [] };

    // The Bucharest calendar day's real UTC bounds — NOT UTC midnight, which
    // would be off by the DST offset (see appointment.util.ts's doc comment).
    const dayStart = bucharestWallClockToUtc(dateISO, 0);
    const dayEnd = bucharestWallClockToUtc(dateISO, 24 * 60);
    const [windows, booked] = await Promise.all([
      this.prisma.appointmentAvailability.findMany({ where: { companyId: company.id } }),
      this.prisma.appointment.findMany({
        where: {
          companyId: company.id,
          status: { not: 'canceled' },
          startsAt: { gte: dayStart, lt: dayEnd },
        },
        select: { startsAt: true, durationMinutes: true },
      }),
    ]);

    const slots = computeAvailableSlots({
      dateISO,
      availability: windows,
      slotMinutes: settings.slotMinutes,
      booked,
    });
    return {
      enabled: true,
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    };
  }

  /**
   * A visitor booked a slot from a company's site. The slot's availability was
   * already shown to them by `availableSlotsFor`, but that's just a hint —
   * this re-validates for real against the DB, and the partial unique index
   * on (companyId, startsAt) (see the appointments_slot_unique_index
   * migration) is what actually prevents two concurrent bookings of the same
   * slot, not this pre-check (same "DB constraint, not a read-then-write
   * race" lesson as the Feed's own click de-dupe).
   */
  async submitPublic(
    slug: string,
    dto: SubmitAppointmentDto,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (isLikelyBot(userAgent)) return { ok: true };

    const company = await this.prisma.company.findFirst({
      where: { slug, status: 'active' },
      select: { id: true, displayName: true, owner: { select: { id: true, email: true } } },
    });
    if (!company) throw new NotFoundException('Company not found');

    const settings = await this.prisma.appointmentSettings.findUnique({
      where: { companyId: company.id },
    });
    if (!settings?.enabled) return { ok: false, error: 'appointments_disabled' };

    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now()) {
      return { ok: false, error: 'invalid_slot' };
    }
    // Must land exactly on a real slot boundary for that weekday's template —
    // otherwise a crafted request could book an arbitrary/overlapping time.
    // The Bucharest calendar date, not a UTC slice — near local midnight
    // those can disagree by a day (see appointment.util.ts).
    const dateISO = utcToBucharestDateISO(startsAt);
    const { slots } = await this.availableSlotsFor(slug, dateISO);
    const stillOpen = slots.some((s) => s.startsAt === startsAt.toISOString());
    if (!stillOpen) return { ok: false, error: 'slot_taken' };

    const visitorHash = appointmentFingerprint(ip, userAgent, company.id);

    let appt: AppointmentRow;
    try {
      appt = await this.prisma.appointment.create({
        data: {
          companyId: company.id,
          startsAt,
          durationMinutes: settings.slotMinutes,
          name: dto.name.trim().slice(0, 160),
          email: dto.email?.trim().slice(0, 200) || null,
          phone: dto.phone?.trim().slice(0, 60) || null,
          notes: dto.notes?.trim().slice(0, 2000) || null,
          visitorHash,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: false, error: 'slot_taken' }; // lost the race — someone else just took it
      }
      throw e;
    }

    void this.notifyOwner(company.owner.id, company.displayName, company.id, appt).catch((err) =>
      this.logger.error('Appointment notification failed', err instanceof Error ? err.stack : err),
    );
    return { ok: true };
  }

  private async notifyOwner(
    ownerId: string,
    companyName: string,
    companyId: string,
    appt: AppointmentRow,
  ): Promise<void> {
    const link = `${this.frontendOrigin}/appointments?c=${companyId}`;
    // Explicit timeZone — this runs on the server, whose own system
    // timezone (production VPS, CI, a dev machine) is not guaranteed to be
    // Bucharest, unlike a browser rendering this for the owner themselves.
    const when = appt.startsAt.toLocaleString('ro-RO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Bucharest',
    });
    await this.notifications
      .notify({
        userId: ownerId,
        type: 'appointment_received',
        title: 'Ai o programare nouă',
        body: `${appt.name} a rezervat o programare pentru ${companyName} pe ${when}.`,
        channels: { panel: true, email: true },
        data: { companyId },
        email: {
          text: `${appt.name} a rezervat o programare pentru ${companyName} pe ${when}.`,
          details: [
            { label: 'Data și ora', value: when },
            { label: 'Nume', value: appt.name },
            { label: 'Email', value: appt.email ?? '—' },
            { label: 'Telefon', value: appt.phone ?? '—' },
          ],
          cta: { label: 'Vezi programările', url: link },
        },
      })
      .catch((err) =>
        this.logger.error(
          'Appointment-received notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
  }

  // --- view ---------------------------------------------------------------

  private view(a: Appointment) {
    return {
      id: a.id,
      status: a.status,
      startsAt: a.startsAt,
      durationMinutes: a.durationMinutes,
      name: a.name,
      email: a.email,
      phone: a.phone,
      notes: a.notes,
      createdAt: a.createdAt,
    };
  }
}
