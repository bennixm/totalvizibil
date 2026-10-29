import {
  IP_CLICK_WINDOW_LIMIT,
  IP_CLICK_WINDOW_MS,
  ipScopeHash,
  isLikelyBot,
  utcDay,
  visitorFingerprint,
} from 'src/campaigns/ad-click';

describe('isLikelyBot', () => {
  it('flags obvious crawlers and tooling', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'curl/8.4.0',
      'python-requests/2.31.0',
      'facebookexternalhit/1.1',
      'HeadlessChrome/120.0.0.0',
    ]) {
      expect(isLikelyBot(ua)).toBe(true);
    }
  });

  it('treats empty / stub user-agents as bots', () => {
    expect(isLikelyBot('')).toBe(true);
    expect(isLikelyBot(undefined)).toBe(true);
    expect(isLikelyBot('  ')).toBe(true);
  });

  it('passes a normal browser UA', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
    expect(isLikelyBot(ua)).toBe(false);
  });
});

describe('visitorFingerprint', () => {
  const ip = '203.0.113.7';
  const ua = 'Mozilla/5.0 Chrome/120';
  const co = '11111111-1111-1111-1111-111111111111';

  it('is stable for the same visitor + company + day', () => {
    expect(visitorFingerprint(ip, ua, co, '2026-08-30')).toBe(
      visitorFingerprint(ip, ua, co, '2026-08-30'),
    );
  });

  it('differs by day, ip, ua and company', () => {
    const base = visitorFingerprint(ip, ua, co, '2026-08-30');
    expect(visitorFingerprint(ip, ua, co, '2026-08-31')).not.toBe(base);
    expect(visitorFingerprint('203.0.113.8', ua, co, '2026-08-30')).not.toBe(base);
    expect(visitorFingerprint(ip, 'other', co, '2026-08-30')).not.toBe(base);
    expect(visitorFingerprint(ip, ua, 'other-company', '2026-08-30')).not.toBe(base);
  });

  it('returns a 64-char hex digest and never the raw inputs', () => {
    const fp = visitorFingerprint(ip, ua, co);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).not.toContain(ip);
  });
});

describe('ipScopeHash', () => {
  const co = '11111111-1111-1111-1111-111111111111';

  it('is the prefix of every fingerprint from that ip + company + day, whatever the UA', () => {
    const scope = ipScopeHash('203.0.113.7', co, '2026-08-30');
    for (const ua of ['Mozilla/5.0 Chrome/120', 'Mozilla/5.0 Firefox/130', 'x'.repeat(900)]) {
      expect(visitorFingerprint('203.0.113.7', ua, co, '2026-08-30').startsWith(scope)).toBe(true);
    }
  });

  it('differs by ip, company and day — and leaks neither the ip nor the UA', () => {
    const base = ipScopeHash('203.0.113.7', co, '2026-08-30');
    expect(ipScopeHash('203.0.113.8', co, '2026-08-30')).not.toBe(base);
    expect(ipScopeHash('203.0.113.7', 'other-company', '2026-08-30')).not.toBe(base);
    expect(ipScopeHash('203.0.113.7', co, '2026-08-31')).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(base).not.toContain('203.0.113.7');
  });

  it('exposes a sane window / cap pair for the secondary click rate limit', () => {
    expect(IP_CLICK_WINDOW_MS).toBe(3_600_000);
    expect(IP_CLICK_WINDOW_LIMIT).toBeGreaterThan(1);
    expect(IP_CLICK_WINDOW_LIMIT).toBeLessThan(20);
  });
});

describe('utcDay', () => {
  it('formats yyyy-mm-dd in UTC', () => {
    expect(utcDay(new Date('2026-08-30T23:30:00.000Z'))).toBe('2026-08-30');
  });
});
