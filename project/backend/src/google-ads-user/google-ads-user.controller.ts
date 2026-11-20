import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { GoogleAdsUserService } from './google-ads-user.service';
import { GoogleAdsUserAgentService } from './google-ads-user-agent.service';

/** Header carrying the builder's draft token (before an account exists). */
const DRAFT_HEADER = 'x-ads-draft';

class StartDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  draftToken?: string;
}

class SelectItemDto {
  @Matches(/^[\d-]{6,20}$/)
  customerId!: string;
  @IsOptional()
  @Matches(/^[\d-]{6,20}$/)
  loginCustomerId?: string | null;
  @Matches(/^\d{1,20}$/)
  campaignId!: string;
}

/** Several campaigns (`items`), or one with the legacy flat fields. */
class SelectDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SelectItemDto)
  items?: SelectItemDto[];
  @IsOptional()
  @Matches(/^[\d-]{6,20}$/)
  customerId?: string;
  @IsOptional()
  @Matches(/^[\d-]{6,20}$/)
  loginCustomerId?: string | null;
  @IsOptional()
  @Matches(/^\d{1,20}$/)
  campaignId?: string;
}

function selectionItems(dto: SelectDto): SelectItemDto[] {
  if (dto.items?.length) return dto.items;
  return dto.customerId && dto.campaignId
    ? [
        {
          customerId: dto.customerId,
          loginCustomerId: dto.loginCustomerId ?? null,
          campaignId: dto.campaignId,
        },
      ]
    : [];
}

class StartCycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedQuoteMinor?: number;
}

/**
 * Google Ads optimization builder for customers' own accounts.
 * Builder steps are public (draft token header) and free; campaign
 * management needs the signed-in owner.
 */
@Controller('google-ads-user')
export class GoogleAdsUserController {
  constructor(
    private readonly service: GoogleAdsUserService,
    private readonly agent: GoogleAdsUserAgentService,
  ) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  // ------------------------------------------------------------- builder

  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  @Post('builder/start')
  start(@Body() dto: StartDto) {
    return this.service.start(dto.draftToken, null);
  }

  @Get('builder/state')
  async state(@Headers(DRAFT_HEADER) draft?: string) {
    return this.service.connectionView(await this.service.draft(draft));
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('builder/connect-url')
  connectUrl(@Headers(DRAFT_HEADER) draft?: string) {
    return this.service.connectUrl(draft);
  }

  /** Google's redirect target after consent (registered in Google Cloud). */
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    res.redirect(302, await this.service.oauthCallback({ code, state, error }));
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('builder/accounts')
  accounts(@Headers(DRAFT_HEADER) draft?: string) {
    return this.service.accounts(draft);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('builder/campaigns')
  campaigns(
    @Headers(DRAFT_HEADER) draft: string | undefined,
    @Query('customerId') customerId: string,
    @Query('loginCustomerId') loginCustomerId?: string,
  ) {
    return this.service.campaigns(draft, customerId ?? '', loginCustomerId || null);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('builder/disconnect')
  disconnectDraft(@Headers(DRAFT_HEADER) draft?: string) {
    return this.service.disconnectDraft(draft);
  }

  @Post('builder/select')
  select(@Headers(DRAFT_HEADER) draft: string | undefined, @Body() dto: SelectDto) {
    return this.service.select(draft, selectionItems(dto));
  }

  @UseGuards(AuthGuard)
  @Post('builder/claim')
  claim(@Headers(DRAFT_HEADER) draft: string | undefined, @CurrentUser() user: AuthPrincipal) {
    return this.service.claim(draft, user.id);
  }

  // ------------------------------------------- connected Google accounts

  @UseGuards(AuthGuard)
  @Get('connections')
  connections(@CurrentUser() user: AuthPrincipal) {
    return this.service.connections(user.id);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('connections/:id/accounts')
  connectionAccounts(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.connectionAccounts(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('connections/:id/campaigns')
  connectionCampaigns(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('customerId') customerId: string,
    @Query('loginCustomerId') loginCustomerId?: string,
  ) {
    return this.service.connectionCampaigns(user.id, id, customerId ?? '', loginCustomerId || null);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('connections/:id/campaigns')
  addCampaigns(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelectDto,
  ) {
    return this.service.addCampaigns(user.id, id, selectionItems(dto));
  }

  @UseGuards(AuthGuard)
  @Post('connections/:id/disconnect')
  disconnectConnection(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.disconnectConnection(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Post('connections/:id/reconnect-url')
  reconnectConnection(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reconnectConnectionUrl(user.id, id);
  }

  // ------------------------------------------------------------ campaigns

  @UseGuards(AuthGuard)
  @Get('campaigns')
  list(@CurrentUser() user: AuthPrincipal) {
    return this.service.list(user.id);
  }

  @UseGuards(AuthGuard)
  @Get('campaigns/:id')
  detail(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('campaigns/:id/sync')
  sync(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.agent.sync(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('campaigns/:id/quote')
  quote(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.agent.quote(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('campaigns/:id/cycles')
  startCycle(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartCycleDto,
  ) {
    return this.agent.startCycle(user.id, id, {
      trigger: 'manual',
      idempotencyKey: dto.idempotencyKey ? `${user.id}:${dto.idempotencyKey}` : undefined,
      expectedQuoteMinor: dto.expectedQuoteMinor,
    });
  }

  @UseGuards(AuthGuard)
  @Get('campaigns/:id/actions')
  actions(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.actions(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Get('campaigns/:id/activity')
  activity(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('after') after?: string,
  ) {
    const d = after ? new Date(after) : undefined;
    return this.service.activity(user.id, id, d && !isNaN(d.getTime()) ? d : undefined);
  }

  @UseGuards(AuthGuard)
  @Patch('campaigns/:id/settings')
  settings(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.updateSettings(user.id, id, body ?? {});
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/pause')
  pause(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setPaused(user.id, id, true);
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/resume')
  resume(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setPaused(user.id, id, false);
  }

  @UseGuards(AuthGuard)
  @Delete('campaigns/:id')
  remove(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/disconnect')
  disconnect(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.disconnectCampaign(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/reconnect-url')
  reconnect(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reconnectUrl(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('campaigns/:id/actions/:actionId/approve')
  approve(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    return this.agent.approveAction(user.id, id, actionId);
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/actions/:actionId/reject')
  reject(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    return this.agent.rejectAction(user.id, id, actionId);
  }

  @Get('pricing')
  pricing() {
    return this.service.pricingPreview();
  }
}
