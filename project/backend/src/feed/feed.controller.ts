import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FeedService } from './feed.service';
import { FeedQueryDto } from './feed.query';

/**
 * Public — the main discovery experience (PRD §6). No auth.
 *
 * Every handler carries its OWN `@Throttle`. This used to be a class-level
 * `@SkipThrottle()` plus a per-method `@Throttle` on a billable `click`
 * endpoint, which doesn't work: `@SkipThrottle` and `@Throttle` write to
 * different metadata keys (`THROTTLER:SKIP` vs `THROTTLER:TTL`/
 * `THROTTLER:LIMIT`) and the guard checks the skip flag first and
 * independently — so the class skip won and that endpoint had no rate limit
 * at all. The billable endpoint has since moved to
 * `PublicCompanyController.bySlug` (`click=1` on the company page's own data
 * load — see its doc comment), but the lesson stands: never reintroduce a
 * class-level skip here.
 */
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  /** The public site's core browsing traffic — a real visitor paging and
   *  re-filtering generates a lot of these, so the limit is deliberately
   *  generous (well above the global 120/min default) but still finite: a
   *  pathological client can't hammer this unbounded. */
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Get()
  list(@Query() query: FeedQueryDto) {
    return this.feed.list(query);
  }

  /** Same browsing traffic as `list` — the filter sidebar refetches these
   *  alongside most searches. */
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Get('facets')
  facets() {
    return this.feed.facets();
  }
}
