import { createHash } from 'node:crypto';

/**
 * The platform is RO-only, but appointments are the first feature where a
 * real human types and reads a specific wall-clock hour (an owner sets
 * "09:00", a visitor picks "09:00" off a list) — unlike the rest of the
 * codebase's "no timezone, everything is UTC-labeled-as-local" convention
 * (Campaign.spendDay, lead-dedupe windows), which only ever matters for
 * internal bookkeeping nobody reads as a clock time. Romania observes DST
 * (EET UTC+2 winter / EEST UTC+3 summer), so a fixed offset would be wrong
 * for half the year — this uses Node's built-in ICU timezone database via
 * `Intl`, no external dependency.
 */
const TIMEZONE = 'Europe/Bucharest';

/** The real UTC offset (in minutes, positive = ahead of UTC) Bucharest is at
 *  a given instant — asks the ICU tz database directly, so it's correct on
 *  both sides of a DST transition. */
function bucharestOffsetMinutes(utcInstant: Date): number {
  const parts = bucharestParts(utcInstant);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asIfUtc - utcInstant.getTime()) / 60_000);
}

function bucharestParts(utcInstant: Date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const raw = Object.fromEntries(dtf.formatToParts(utcInstant).map((p) => [p.type, p.value]));
  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    hour: Number(raw.hour),
    minute: Number(raw.minute),
    second: Number(raw.second),
  };
}

/**
 * A Bucharest wall-clock instant — calendar date `dateISO` (`YYYY-MM-DD`) at
 * `minuteOfDay` minutes past that date's local midnight — converted to the
 * real UTC `Date` it actually is. Two-pass: a naive guess (treating the wall
 * clock as if it were UTC) gives an instant close enough to look up the real
 * Bucharest/UTC offset for that day, then that offset corrects the guess.
 * (Exactly at a DST transition's skipped/repeated hour — twice a year, a
 * ~1h window, an unusual time for business hours anyway — this can be off
 * by the DST delta; not worth a heavier correction for that edge case.)
 */
export function bucharestWallClockToUtc(dateISO: string, minuteOfDay: number): Date {
  const naiveMs = new Date(`${dateISO}T00:00:00.000Z`).getTime() + minuteOfDay * 60_000;
  const offsetMinutes = bucharestOffsetMinutes(new Date(naiveMs));
  return new Date(naiveMs - offsetMinutes * 60_000);
}

/** The Bucharest calendar date (`YYYY-MM-DD`) a real UTC instant falls on —
 *  the inverse lookup needed when validating a booking's `startsAt` against
 *  the correct day's availability template (a UTC calendar-date slice would
 *  be wrong for anything within the DST offset of local midnight). */
export function utcToBucharestDateISO(utcInstant: Date): string {
  const p = bucharestParts(utcInstant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Which weekday (0=Sun..6=Sat) a Bucharest calendar date falls on. Doesn't
 *  need timezone conversion — a calendar date's weekday is the same
 *  regardless of what time zone you're asking from. */
export function bucharestDateWeekday(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00.000Z`).getUTCDay();
}

export interface AvailabilityWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface BookedRange {
  startsAt: Date;
  durationMinutes: number;
}

export interface SlotWindow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Every open slot for one company on one Bucharest calendar date: the
 * weekly availability template for that date's weekday, chopped into
 * `slotMinutes` chunks (each converted from Bucharest wall-clock to a real
 * UTC instant), minus anything already booked (any status but canceled) and
 * minus anything already in the past. Pure and synchronous — the caller
 * fetches `availability`/`booked` from the DB, this just does the
 * arithmetic, so it's cheap to unit test without a database.
 */
export function computeAvailableSlots(params: {
  dateISO: string;
  availability: AvailabilityWindow[];
  slotMinutes: number;
  booked: BookedRange[];
  now?: Date;
}): SlotWindow[] {
  const { dateISO, availability, slotMinutes, booked, now = new Date() } = params;
  if (slotMinutes <= 0) return [];

  const weekday = bucharestDateWeekday(dateISO);
  const windows = availability.filter((a) => a.weekday === weekday);
  if (!windows.length) return [];

  const bookedRanges = booked.map((b) => ({
    start: b.startsAt.getTime(),
    end: b.startsAt.getTime() + b.durationMinutes * 60_000,
  }));

  const slots: SlotWindow[] = [];
  for (const w of windows) {
    for (let m = w.startMinute; m + slotMinutes <= w.endMinute; m += slotMinutes) {
      const startsAt = bucharestWallClockToUtc(dateISO, m);
      const endsAt = bucharestWallClockToUtc(dateISO, m + slotMinutes);
      if (startsAt.getTime() < now.getTime()) continue;
      const overlapsBooked = bookedRanges.some(
        (r) => startsAt.getTime() < r.end && endsAt.getTime() > r.start,
      );
      if (overlapsBooked) continue;
      slots.push({ startsAt, endsAt });
    }
  }
  return slots;
}

/** Privacy-safe visitor id for abuse analysis — same construction as
 *  leads/lead.util.ts's leadFingerprint, but keyed per-day (not per-window):
 *  a booking isn't deduped by this (a visitor may legitimately book more
 *  than once), it's purely a diagnostic trail. */
export function appointmentFingerprint(
  ip: string | undefined | null,
  userAgent: string | undefined | null,
  companyId: string,
  now: Date = new Date(),
): string {
  const parts = [
    (ip ?? '').trim(),
    (userAgent ?? '').trim().slice(0, 400),
    companyId,
    now.toISOString().slice(0, 10),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
