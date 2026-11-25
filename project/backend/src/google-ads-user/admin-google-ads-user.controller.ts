import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { PlatformRoles, PlatformRolesGuard } from '../auth/platform-roles.guard';
import { AuditLogService } from '../admin/audit-log.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsOAuthService } from './google-ads-oauth.service';
import { DEFAULT_CHAT_PRICING } from './chat-pricing';
import { DEFAULT_PRICING } from './pricing';

class OauthDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientSecret?: string;
}

/**
 * Admin side of the customers' Google Ads optimizer: credit pricing,
 * the OAuth client used for customer consent, and usage/consumption
 * (every cycle with what was charged vs. what the AI really cost).
 */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin')
@Controller('admin/google-ads-optimizer')
export class AdminGoogleAdsUserController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly oauth: GoogleAdsOAuthService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('pricing')
  async pricing() {
    return { pricing: await this.settings.googleAdsOptimizerPricing(), defaults: DEFAULT_PRICING };
  }

  @Patch('pricing')
  async setPricing(@CurrentUser() caller: AuthPrincipal, @Body() body: unknown) {
    const before = await this.settings.googleAdsOptimizerPricing();
    const after = await this.settings.setGoogleAdsOptimizerPricing(body);
    await this.audit.log({
      actorId: caller.id,
      actorRoles: caller.platformRoles,
      action: 'google_ads_optimizer.pricing.update',
      targetType: 'platform_setting',
      targetId: null,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });
    return { pricing: after, defaults: DEFAULT_PRICING };
  }

  @Get('chat-pricing')
  async chatPricing() {
    return { pricing: await this.settings.googleAdsChatPricing(), defaults: DEFAULT_CHAT_PRICING };
  }

  @Patch('chat-pricing')
  async setChatPricing(@CurrentUser() caller: AuthPrincipal, @Body() body: unknown) {
    const before = await this.settings.googleAdsChatPricing();
    const after = await this.settings.setGoogleAdsChatPricing(body);
    await this.audit.log({
      actorId: caller.id,
      actorRoles: caller.platformRoles,
      action: 'google_ads_optimizer.chat_pricing.update',
      targetType: 'platform_setting',
      targetId: null,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });
    return { pricing: after, defaults: DEFAULT_CHAT_PRICING };
  }

  /** Never returns the secret, only whether one is set. */
  @Get('oauth')
  async oauthConfig() {
    const [clientId, secret] = await Promise.all([
      this.settings.googleAdsOauthClientId(),
      this.settings.googleAdsOauthClientSecret(),
    ]);
    return {
      clientId,
      clientSecretSet: !!secret || !!process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET?.trim(),
      clientIdFromEnv: !clientId && !!process.env.GOOGLE_ADS_OAUTH_CLIENT_ID?.trim(),
      tokenKeyConfigured: this.oauth.crypto.configured,
      redirectUri: this.oauth.redirectUri,
      missing: await this.oauth.missingConfig(),
    };
  }

  @Patch('oauth')
  async setOauth(@CurrentUser() caller: AuthPrincipal, @Body() dto: OauthDto) {
    await this.settings.setGoogleAdsOauthClient(dto);
    await this.audit.log({
      actorId: caller.id,
      actorRoles: caller.platformRoles,
      action: 'google_ads_optimizer.oauth.update',
      targetType: 'platform_setting',
      targetId: null,
      after: { clientId: dto.clientId, clientSecretChanged: dto.clientSecret !== undefined },
    });
    return this.oauthConfig();
  }

  /** Consumption: totals + latest cycles (charged credits vs real AI cost). */
  @Get('usage')
  async usage(@Query('from') from?: string, @Query('to') to?: string) {
    const range = {
      ...(from && !isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
      ...(to && !isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}),
    };
    const where = Object.keys(range).length ? { startedAt: range } : {};
    const chatWhere = Object.keys(range).length ? { createdAt: range } : {};
    const [agg, byLevel, cycles, campaigns, connected, chat, chatFailed] = await Promise.all([
      this.prisma.googleAdsOptimizationCycle.aggregate({
        where,
        _count: true,
        _sum: {
          chargedMinor: true,
          refundedMinor: true,
          quotedMinor: true,
          aiCostMinor: true,
          aiCallCount: true,
          tasksApplied: true,
          tasksProposed: true,
        },
      }),
      this.prisma.googleAdsOptimizationCycle.groupBy({
        by: ['complexityLevel'],
        where,
        _count: true,
        _sum: { chargedMinor: true },
      }),
      this.prisma.googleAdsOptimizationCycle.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: 100,
        include: {
          user: { select: { id: true, email: true, name: true } },
          userCampaign: { select: { name: true, customerName: true } },
        },
      }),
      this.prisma.googleAdsUserCampaign.count({ where: { status: { not: 'removed' } } }),
      this.prisma.googleAdsConnection.count({ where: { status: 'connected' } }),
      this.prisma.googleAdsChatTurn.aggregate({
        where: chatWhere,
        _count: true,
        _sum: { chargedMinor: true, aiCostUsd: true, aiCallCount: true },
      }),
      this.prisma.googleAdsChatTurn.count({ where: { ...chatWhere, status: 'failed' } }),
    ]);
    return {
      totals: {
        cycles: agg._count,
        chargedMinor: agg._sum.chargedMinor ?? 0,
        refundedMinor: agg._sum.refundedMinor ?? 0,
        quotedMinor: agg._sum.quotedMinor ?? 0,
        aiCostMinor: agg._sum.aiCostMinor ?? 0,
        aiCalls: agg._sum.aiCallCount ?? 0,
        tasksApplied: agg._sum.tasksApplied ?? 0,
        tasksProposed: agg._sum.tasksProposed ?? 0,
        campaigns,
        connectedAccounts: connected,
      },
      chat: {
        messages: chat._count,
        failed: chatFailed,
        chargedMinor: chat._sum.chargedMinor ?? 0,
        aiCostMinor: Math.round((chat._sum.aiCostUsd ?? 0) * 100),
        aiCalls: chat._sum.aiCallCount ?? 0,
      },
      byLevel: byLevel.map((l) => ({
        level: l.complexityLevel,
        cycles: l._count,
        chargedMinor: l._sum.chargedMinor ?? 0,
      })),
      cycles: cycles.map((c) => ({
        id: c.id,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
        status: c.status,
        trigger: c.trigger,
        user: c.user,
        campaign: c.userCampaign,
        complexityLevel: c.complexityLevel,
        complexityPoints: c.complexityPoints,
        quotedMinor: c.quotedMinor,
        chargedMinor: c.chargedMinor,
        refundedMinor: c.refundedMinor,
        aiCostMinor: c.aiCostMinor,
        aiCallCount: c.aiCallCount,
        tasksApplied: c.tasksApplied,
        tasksProposed: c.tasksProposed,
        elementsAnalyzed: c.elementsAnalyzed,
        scoreBefore: c.scoreBefore,
        scoreAfter: c.scoreAfter,
        errorMessage: c.errorMessage,
      })),
    };
  }
}
