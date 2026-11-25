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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BusinessActionLogService } from '../admin/business-action-log.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { readSettings, UserAgentSettings } from './agent-settings';
import { GoogleAdsChatService } from './google-ads-chat.service';
import { GoogleAdsUserService, OAUTH_COOKIE, OAUTH_STATE_TTL_MS } from './google-ads-user.service';
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
  /** The owner was told information is missing and chose to run anyway. */
  @IsOptional()
  @IsBoolean()
  ignoreMissingInfo?: boolean;
}

class ChatMessageDto {
  @IsString()
  @MaxLength(2000)
  text!: string;
  @Matches(/^[\w.-]{8,100}$/)
  idempotencyKey!: string;
  @IsOptional()
  @IsIn(['ro', 'en', 'de'])
  locale?: string;
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
    private readonly chat: GoogleAdsChatService,
    private readonly ownerLog: BusinessActionLogService,
  ) {}

  /** What the OWNER did (staff have their own routes and log). Never throws. */
  private log(
    user: AuthPrincipal,
    action: string,
    targetId: string,
    extra: { before?: unknown; after?: unknown; connection?: boolean } = {},
  ): Promise<void> {
    return this.ownerLog.log({
      actorId: user.id,
      action: `ads.${action}`,
      targetType: extra.connection ? 'google_ads_connection' : 'google_ads_user_campaign',
      targetId,
      before: extra.before,
      after: extra.after,
    });
  }

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
  async connectUrl(
    @Headers(DRAFT_HEADER) draft: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.beginConsent(res, await this.service.connectUrl(draft));
  }

  /** Ties the consent to THIS browser (see GoogleAdsUserService.oauthCallback). */
  private beginConsent(res: Response, start: { url: string; state: string }) {
    res.cookie(OAUTH_COOKIE, start.state, {
      ...this.service.oauthCookie,
      maxAge: OAUTH_STATE_TTL_MS,
    });
    return { url: start.url };
  }

  /** Google's redirect target after consent (registered in Google Cloud). */
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const browserState = (req.cookies as Record<string, string> | undefined)?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, this.service.oauthCookie);
    res.redirect(302, await this.service.oauthCallback({ code, state, error, browserState }));
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
  async claim(
    @Headers(DRAFT_HEADER) draft: string | undefined,
    @CurrentUser() user: AuthPrincipal,
  ) {
    const res = await this.service.claim(draft, user.id);
    for (const id of res.campaignIds) await this.log(user, 'add', id);
    return res;
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
  async addCampaigns(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelectDto,
  ) {
    const res = await this.service.addCampaigns(user.id, id, selectionItems(dto));
    for (const c of res.campaignIds) await this.log(user, 'add', c);
    return res;
  }

  @UseGuards(AuthGuard)
  @Post('connections/:id/disconnect')
  async disconnectConnection(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const res = await this.service.disconnectConnection(user.id, id);
    await this.log(user, 'disconnect', id, { connection: true });
    return res;
  }

  @UseGuards(AuthGuard)
  @Post('connections/:id/reconnect-url')
  async reconnectConnection(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.beginConsent(res, await this.service.reconnectConnectionUrl(user.id, id));
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
  async startCycle(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartCycleDto,
  ) {
    const res = await this.agent.startCycle(user.id, id, {
      trigger: 'manual',
      idempotencyKey: dto.idempotencyKey ? `${user.id}:${dto.idempotencyKey}` : undefined,
      expectedQuoteMinor: dto.expectedQuoteMinor,
      ignoreMissingInfo: dto.ignoreMissingInfo,
    });
    await this.log(user, 'cycle.start', id, {
      after: { cycleId: res.cycleId, heldMinor: res.chargedMinor },
    });
    return res;
  }

  // ----------------------------------------------------------- agent chat

  @UseGuards(AuthGuard)
  @Get('campaigns/:id/chat')
  conversation(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.conversation(user.id, id);
  }

  /** One billed message; the answer is prepared in the background. */
  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @Post('campaigns/:id/chat')
  sendMessage(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChatMessageDto,
  ) {
    return this.chat.send(user.id, id, {
      text: dto.text,
      idempotencyKey: dto.idempotencyKey,
      locale: dto.locale ?? 'ro',
    });
  }

  @UseGuards(AuthGuard)
  @Patch('campaigns/:id/brief')
  async updateBrief(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const res = await this.chat.updateBrief(user.id, id, body ?? {});
    await this.log(user, 'brief', id, { after: { fields: Object.keys(body ?? {}) } });
    return res;
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
  async settings(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const before = readSettings((await this.agent.ownedCampaign(user.id, id)).settings);
    const after = await this.service.updateSettings(user.id, id, body ?? {});
    const keys = (Object.keys(after) as (keyof UserAgentSettings)[]).filter(
      (k) => after[k] !== before[k],
    );
    if (keys.length) {
      const pick = (s: UserAgentSettings) => Object.fromEntries(keys.map((k) => [k, s[k]]));
      await this.log(user, 'settings', id, { before: pick(before), after: pick(after) });
    }
    return after;
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/pause')
  async pause(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.service.setPaused(user.id, id, true);
    await this.log(user, 'pause', id);
    return res;
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/resume')
  async resume(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.service.setPaused(user.id, id, false);
    await this.log(user, 'resume', id);
    return res;
  }

  @UseGuards(AuthGuard)
  @Delete('campaigns/:id')
  async remove(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.service.remove(user.id, id);
    await this.log(user, 'remove', id);
    return res;
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/disconnect')
  async disconnect(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.service.disconnectCampaign(user.id, id);
    await this.log(user, 'disconnect', id);
    return res;
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/reconnect-url')
  async reconnect(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.beginConsent(res, await this.service.reconnectUrl(user.id, id));
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('campaigns/:id/actions/:actionId/approve')
  async approve(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    const res = await this.agent.approveAction(user.id, id, actionId);
    await this.log(user, 'proposal.approve', id, {
      after: { actionId, action: res?.action, status: res?.status },
    });
    return res;
  }

  @UseGuards(AuthGuard)
  @Post('campaigns/:id/actions/:actionId/reject')
  async reject(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    const res = await this.agent.rejectAction(user.id, id, actionId);
    await this.log(user, 'proposal.reject', id, { after: { actionId } });
    return res;
  }

  @Get('pricing')
  pricing() {
    return this.service.pricingPreview();
  }
}
