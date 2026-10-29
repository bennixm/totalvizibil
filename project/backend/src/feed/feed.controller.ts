import { Body, Controller, Get, Headers, Ip, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CampaignService } from '../campaigns/campaign.service';
import { FeedService } from './feed.service';
import { FeedQueryDto } from './feed.query';
import { AdClickDto } from './dto/ad-click.dto';

/**
 * Public — the main discovery experience (PRD §6). No auth.
 *
 * Every handler carries its OWN `@Throttle`. This used to be a class-level
 * `@SkipThrottle()` plus a per-method `@Throttle` on `click`, which doesn't
 * work: `@SkipThrottle` and `@Throttle` write to different metadata keys
 * (`THROTTLER:SKIP` vs `THROTTLER:TTL`/`THROTTLER:LIMIT`) and the guard checks
 * the skip flag first and independently — so the class skip won and the
 * billable click endpoint had no rate limit at all. Never reintroduce a
 * class-level skip here.
 */
@Controller('feed')
export class FeedController {
  constructor(
    private readonly feed: FeedService,
    private readonly campaigns: CampaignService,
  ) {}

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

  /**
   * A visitor opened a listing from the feed. Bills the campaign's CPC once per
   * person per day (spam-protected). Fire-and-forget from the client; the body
   * is `{ billed }` for anyone who wants it.
   *
   * This limit now actually applies (see the class comment). It only bounds
   * requests per IP; the per-(company, IP) click cap in
   * `CampaignService.registerClick` is what bounds a victim's budget drain.
   */
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post('click')
  click(@Body() dto: AdClickDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.campaigns.registerClick(dto.companyId, ip, userAgent, {
      categorySlug: dto.category,
      county: dto.county,
    });
  }
}
