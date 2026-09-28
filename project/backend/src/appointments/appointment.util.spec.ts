import {
  bucharestDateWeekday,
  bucharestWallClockToUtc,
  computeAvailableSlots,
  utcToBucharestDateISO,
} from './appointment.util';

// 2026-09-28 is a Monday, and — confirmed against Node's ICU tz database —
// Romania is in EEST (UTC+3, summer time) that day; DST doesn't end until
// the last Sunday of October. 2026-01-15 is EET (UTC+2, winter time).

describe('bucharestDateWeekday', () => {
  it('reads the weekday directly off the calendar date (timezone-independent)', () => {
    expect(bucharestDateWeekday('2026-09-28')).toBe(1); // Monday
    expect(bucharestDateWeekday('2026-10-04')).toBe(0); // Sunday
  });
});

describe('bucharestWallClockToUtc', () => {
  it('converts a summer (EEST, UTC+3) wall-clock time correctly', () => {
    expect(bucharestWallClockToUtc('2026-09-28', 9 * 60).toISOString()).toBe(
      '2026-09-28T06:00:00.000Z',
    );
  });

  it('converts a winter (EET, UTC+2) wall-clock time correctly', () => {
    expect(bucharestWallClockToUtc('2026-01-15', 9 * 60).toISOString()).toBe(
      '2026-01-15T07:00:00.000Z',
    );
  });

  it('midnight (minute 0) lands on the correct UTC instant', () => {
    expect(bucharestWallClockToUtc('2026-09-28', 0).toISOString()).toBe('2026-09-27T21:00:00.000Z');
  });
});

describe('utcToBucharestDateISO', () => {
  it('recovers the correct Bucharest calendar date for a normal-hours instant', () => {
    expect(utcToBucharestDateISO(new Date('2026-09-28T06:00:00.000Z'))).toBe('2026-09-28');
  });

  it('recovers the PREVIOUS Bucharest date for an instant just after UTC midnight in summer', () => {
    // 2026-09-29T00:30 UTC is already 2026-09-29T03:30 in Bucharest (EEST) —
    // same date. But 2026-09-28T21:30 UTC is 2026-09-29T00:30 Bucharest —
    // the NEXT date relative to its UTC slice. This is exactly the
    // off-by-one a naive `.toISOString().slice(0,10)` would get wrong.
    expect(utcToBucharestDateISO(new Date('2026-09-28T21:30:00.000Z'))).toBe('2026-09-29');
  });
});

describe('computeAvailableSlots', () => {
  const MON = 1;
  // Well before 09:00 Bucharest time (06:00 UTC) on 2026-09-28 — nothing "past" yet.
  const now = new Date('2026-09-28T00:00:00.000Z');

  it('chops a weekday window into slots at the correct real UTC instants', () => {
    const slots = computeAvailableSlots({
      dateISO: '2026-09-28',
      availability: [{ weekday: MON, startMinute: 9 * 60, endMinute: 11 * 60 }], // 09:00-11:00 Bucharest
      slotMinutes: 30,
      booked: [],
      now,
    });
    expect(slots).toHaveLength(4);
    // 09:00 Bucharest (EEST, +3) = 06:00 UTC.
    expect(slots[0].startsAt.toISOString()).toBe('2026-09-28T06:00:00.000Z');
    expect(slots[3].startsAt.toISOString()).toBe('2026-09-28T07:30:00.000Z');
    expect(slots[3].endsAt.toISOString()).toBe('2026-09-28T08:00:00.000Z');
  });

  it('returns nothing for a date whose weekday has no availability window', () => {
    const slots = computeAvailableSlots({
      dateISO: '2026-09-28', // Monday
      availability: [{ weekday: 2, startMinute: 0, endMinute: 24 * 60 }], // Tuesday only
      slotMinutes: 30,
      booked: [],
      now,
    });
    expect(slots).toHaveLength(0);
  });

  it('excludes a slot that overlaps an already-booked appointment', () => {
    const slots = computeAvailableSlots({
      dateISO: '2026-09-28',
      availability: [{ weekday: MON, startMinute: 9 * 60, endMinute: 10 * 60 }], // 09:00-10:00 Bucharest
      slotMinutes: 30,
      booked: [{ startsAt: new Date('2026-09-28T06:00:00.000Z'), durationMinutes: 30 }], // 09:00 Bucharest
      now,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].startsAt.toISOString()).toBe('2026-09-28T06:30:00.000Z'); // 09:30 Bucharest
  });

  it('excludes a slot that has already passed', () => {
    const slots = computeAvailableSlots({
      dateISO: '2026-09-28',
      availability: [{ weekday: MON, startMinute: 9 * 60, endMinute: 11 * 60 }],
      slotMinutes: 30,
      booked: [],
      now: new Date('2026-09-28T07:00:00.000Z'), // already 10:00 Bucharest
    });
    // Only the 10:00 and 10:30 Bucharest slots are still in the future.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-09-28T07:00:00.000Z',
      '2026-09-28T07:30:00.000Z',
    ]);
  });

  it('a booking that only partially overlaps a slot still blocks it', () => {
    const slots = computeAvailableSlots({
      dateISO: '2026-09-28',
      availability: [{ weekday: MON, startMinute: 9 * 60, endMinute: 10 * 60 }],
      slotMinutes: 30,
      // A 45-minute booking starting mid-slot (09:15 Bucharest) overlaps both candidates.
      booked: [{ startsAt: new Date('2026-09-28T06:15:00.000Z'), durationMinutes: 45 }],
      now,
    });
    expect(slots).toHaveLength(0);
  });

  it('supports more than one window on the same day', () => {
    const slots = computeAvailableSlots({
      dateISO: '2026-09-28',
      availability: [
        { weekday: MON, startMinute: 9 * 60, endMinute: 9 * 60 + 30 }, // 09:00-09:30
        { weekday: MON, startMinute: 14 * 60, endMinute: 14 * 60 + 30 }, // 14:00-14:30
      ],
      slotMinutes: 30,
      booked: [],
      now,
    });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-09-28T06:00:00.000Z', // 09:00 Bucharest
      '2026-09-28T11:00:00.000Z', // 14:00 Bucharest
    ]);
  });

  it('returns nothing when slotMinutes is not positive', () => {
    const slots = computeAvailableSlots({
      dateISO: '2026-09-28',
      availability: [{ weekday: MON, startMinute: 0, endMinute: 60 }],
      slotMinutes: 0,
      booked: [],
      now,
    });
    expect(slots).toHaveLength(0);
  });

  it('uses the winter (EET, UTC+2) offset for a January date', () => {
    const slots = computeAvailableSlots({
      dateISO: '2026-01-15', // Thursday
      availability: [{ weekday: 4, startMinute: 9 * 60, endMinute: 9 * 60 + 30 }],
      slotMinutes: 30,
      booked: [],
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(slots[0].startsAt.toISOString()).toBe('2026-01-15T07:00:00.000Z'); // 09:00 EET
  });
});
