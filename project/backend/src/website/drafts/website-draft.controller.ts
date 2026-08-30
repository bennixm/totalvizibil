import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WebsiteDraftService } from './website-draft.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SetLocationDto } from './dto/set-location.dto';

/**
 * Anonymous website-draft studio (free one-pager). No auth: a draft is held by
 * an opaque token the client stores locally and passes back as `X-Draft-Token`.
 * The draft is claimed into a real Website when the visitor creates an account
 * (later milestone).
 */
@Controller('website-drafts')
export class WebsiteDraftController {
  constructor(private readonly drafts: WebsiteDraftService) {}

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post()
  create(@Body() dto: CreateDraftDto) {
    return this.drafts.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Headers('x-draft-token') token?: string) {
    return this.drafts.get(id, token ?? '');
  }

  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post(':id/messages')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @Headers('x-draft-token') token?: string,
  ) {
    return this.drafts.sendMessage(id, token ?? '', dto.text);
  }

  @Patch(':id/location')
  setLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetLocationDto,
    @Headers('x-draft-token') token?: string,
  ) {
    return this.drafts.setLocation(id, token ?? '', dto);
  }
}
