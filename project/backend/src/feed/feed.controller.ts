import { Body, Controller, Get, Headers, Ip, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CampaignService } from '../campaigns/campaign.service';
import { FeedService } from './feed.service';
import { FeedQueryDto } from './feed.query';
import { AdClickDto } from './dto/ad-click.dto';

/** Public — the main discovery experience (PRD §6). No auth. */
@Controller('feed')
export class FeedController {
  constructor(
    private readonly feed: FeedService,
    private readonly campaigns: CampaignService,
  ) {}

  @Get()
  list(@Query() query: FeedQueryDto) {
    return this.feed.list(query);
  }

  @Get('facets')
  facets() {
    return this.feed.facets();
  }

  /**
   * A visitor opened a listing from the feed. Bills the campaign's CPC once per
   * person per day (spam-protected). Fire-and-forget from the client; the body
   * is `{ billed }` for anyone who wants it.
   */
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post('click')
  click(@Body() dto: AdClickDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.campaigns.registerClick(dto.companyId, ip, userAgent);
  }
}
