/** Today's Bucharest calendar date, `YYYY-MM-DD` — the same convention the
 *  backend's own day-boundary filtering uses for appointments (see
 *  `bucharestWallClockToUtc` in appointments.service.ts). */
export function bucharestToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date())
}
