import 'reflect-metadata';
import { FeedController } from 'src/feed/feed.controller';

// `@nestjs/throttler` doesn't re-export these from its entrypoint, so they're
// inlined rather than deep-imported from its `dist/`. See
// throttler.constants.ts — the suffix is the named throttler config.
const THROTTLER_TTL = 'THROTTLER:TTL';
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_SKIP = 'THROTTLER:SKIP';

/**
 * Regression guard for a real vulnerability: the controller used to carry a
 * class-level `@SkipThrottle()` next to a per-method `@Throttle()` on the
 * billable `click` handler. Those two decorators write to DIFFERENT metadata
 * keys (`THROTTLER:SKIP` vs `THROTTLER:TTL` / `THROTTLER:LIMIT`) and
 * `ThrottlerGuard` consults the skip flag first and independently — so the
 * class-level skip won and `POST /feed/click`, which spends an advertiser's
 * money, was effectively unlimited.
 *
 * These are metadata-reflection assertions on purpose: they're what actually
 * broke (the decorator combination, not the guard), and they fail loudly if
 * anyone reintroduces a class-level skip or drops a handler's own limit.
 */
describe('FeedController throttling', () => {
  const ttl = (fn: unknown) => Reflect.getMetadata(`${THROTTLER_TTL}default`, fn as object);
  const limit = (fn: unknown) => Reflect.getMetadata(`${THROTTLER_LIMIT}default`, fn as object);

  it('has no class-level (or handler-level) throttle skip anywhere', () => {
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, FeedController)).toBeUndefined();
    for (const fn of [
      FeedController.prototype.list,
      FeedController.prototype.facets,
      FeedController.prototype.click,
    ]) {
      expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, fn)).toBeUndefined();
    }
  });

  it('rate-limits the billable click endpoint at 40/min', () => {
    expect(ttl(FeedController.prototype.click)).toBe(60_000);
    expect(limit(FeedController.prototype.click)).toBe(40);
  });

  it('gives the public browsing reads a generous but finite 300/min', () => {
    expect(ttl(FeedController.prototype.list)).toBe(60_000);
    expect(limit(FeedController.prototype.list)).toBe(300);
    expect(ttl(FeedController.prototype.facets)).toBe(60_000);
    expect(limit(FeedController.prototype.facets)).toBe(300);
  });

  it('leaves no handler without an explicit per-method limit', () => {
    const handlers = Object.getOwnPropertyNames(FeedController.prototype).filter(
      (k) => k !== 'constructor',
    );
    expect(handlers.sort()).toEqual(['click', 'facets', 'list']);
    for (const name of handlers) {
      const fn = (FeedController.prototype as unknown as Record<string, unknown>)[name];
      expect(typeof limit(fn)).toBe('number');
      expect(typeof ttl(fn)).toBe('number');
    }
  });
});
