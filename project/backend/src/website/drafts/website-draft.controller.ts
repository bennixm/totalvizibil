import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WebsiteDraftService } from './website-draft.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SetLocationDto } from './dto/set-location.dto';
import { PatchEasyDto } from './dto/patch-easy.dto';
import { AddAssetDto } from './dto/add-asset.dto';
import { RegenerateServicesDto } from './dto/regenerate-services.dto';
import { ProofreadDto } from './dto/proofread.dto';

/**
 * Anonymous website-draft studio (free "Site Simplu" one-pager). No auth: a
 * draft is held by an opaque token the client stores locally and passes back as
 * `X-Draft-Token`. It is claimed into a real Website when the visitor creates an
 * account.
 */
@Controller('website-drafts')
export class WebsiteDraftController {
  constructor(private readonly drafts: WebsiteDraftService) {}

  // Each fresh draft resets its own `aiCalls` allowance (see `AI_CALL_CAP` in
  // the service) — a loose limit here would let someone bypass that cap for
  // real by just restarting the whole guided process over and over. A
  // genuine visitor never needs more than a handful of tries per hour.
  @Throttle({ default: { ttl: 3_600_000, limit: 6 } })
  @Post()
  create(@Body() dto: CreateDraftDto) {
    return this.drafts.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Headers('x-draft-token') token?: string) {
    return this.drafts.get(id, token ?? '');
  }

  /** Guided chat turn (text steps: name / landing title / services / contact). */
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post(':id/messages')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @Headers('x-draft-token') token?: string,
  ) {
    return this.drafts.sendMessage(id, token ?? '', dto.text);
  }

  /** Advance a widget step (colour / portfolio) from the studio's "Continue". */
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post(':id/advance')
  advance(@Param('id', ParseUUIDPipe) id: string, @Headers('x-draft-token') token?: string) {
    return this.drafts.advanceStep(id, token ?? '');
  }

  /** Live config edits from the studio widgets — colour, images, contact, order. */
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Patch(':id/easy')
  patchEasy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchEasyDto,
    @Headers('x-draft-token') token?: string,
  ) {
    return this.drafts.patchEasy(id, token ?? '', dto);
  }

  /** Fix spelling / grammar in a manual prose string (grammar toggle). */
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post(':id/proofread')
  proofread(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProofreadDto,
    @Headers('x-draft-token') token?: string,
  ) {
    return this.drafts.proofread(id, token ?? '', dto.text);
  }

  /** Re-run the one AI call for a new/edited list of service names. */
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  @Post(':id/services')
  regenerateServices(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegenerateServicesDto,
    @Headers('x-draft-token') token?: string,
  ) {
    return this.drafts.regenerateServices(id, token ?? '', dto.names);
  }

  /** Upload a landing / portfolio image (base64 data-URI) — returns its URL. */
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post(':id/assets')
  addAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddAssetDto,
    @Headers('x-draft-token') token?: string,
  ) {
    return this.drafts.addAsset(id, token ?? '', dto.dataUri, dto.kind);
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
