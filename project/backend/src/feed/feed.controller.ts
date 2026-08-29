import { Controller, Get, Query } from '@nestjs/common';
import { FeedService } from './feed.service';
import { FeedQueryDto } from './feed.query';

/** Public — the main discovery experience (PRD §6). No auth. */
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  list(@Query() query: FeedQueryDto) {
    return this.feed.list(query);
  }

  @Get('facets')
  facets() {
    return this.feed.facets();
  }
}
