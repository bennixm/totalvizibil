import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { PlatformRoles, PlatformRolesGuard } from '../auth/platform-roles.guard';
import { AuditLogService } from './audit-log.service';
import { AdminGoogleAdsService, GoogleAdsAgentRunKindParam } from './admin-google-ads.service';
import { ListGoogleAdsAgentActionsQuery } from './dto/list-google-ads-agent-actions.query';
import { UpdateGoogleAdsCredentialsDto } from './dto/update-google-ads-credentials.dto';
import { GOOGLE_ADS_RECOMMENDATION_CATALOG } from '../google-ads/google-ads-recommendation-catalog';

enum RunKind {
  structural = 'structural',
  content = 'content',
  intelligence = 'intelligence',
}

/**
 * Admin "Google Ads Agent" page (docs/ai/GOOGLE-ADS-AGENT-PLAN.md, Faza 4).
 * A dedicated controller rather than more handlers on the already-658-line
 * `AdminController` — this is a self-contained domain, same reasoning as
 * `PlatformController` being split out. Budget/CPC decisions here are an
 * `admin`-only surface (not widened to `finance`, unlike money settings
 * elsewhere in the panel) since this is traffic-acquisition strategy, not
 * accounting.
 */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin')
@Controller('admin/google-ads-agent')
export class AdminGoogleAdsController {
  constructor(
    private readonly service: AdminGoogleAdsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Get('credentials')
  credentials() {
    return this.service.googleAdsCredentials();
  }

  /** Never audits the raw key value — only that it was changed. */
  @Patch('credentials')
  async updateCredentials(
    @CurrentUser() caller: AuthPrincipal,
    @Body() dto: UpdateGoogleAdsCredentialsDto,
  ) {
    const result = await this.service.setGoogleAdsCredentials(dto);
    await this.audit.log({
      actorId: caller.id,
      actorRoles: caller.platformRoles,
      action: 'google_ads_agent.credentials.update',
      targetType: 'google_ads_credentials',
      after: {
        customerId: dto.customerId,
        loginCustomerId: dto.loginCustomerId,
        campaignId: dto.campaignId,
        serviceAccountKeyChanged: dto.serviceAccountKeyBase64 !== undefined,
      },
    });
    return result;
  }

  /** Static, human-readable catalog backing the "Recomandări Google Ads"
   *  toggle list in the Settings tab — see the catalog's own doc comment.
   *  Never requires a live Google Ads call; the frontend renders real
   *  Romanian labels from this instead of a free-text field where an
   *  admin had to type raw enum strings like
   *  `RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH`. */
  @Get('recommendation-types')
  recommendationTypes() {
    return GOOGLE_ADS_RECOMMENDATION_CATALOG;
  }

  @Get('proposals')
  listProposals() {
    return this.service.listProposals();
  }

  @Post('proposals/:id/approve')
  async approveProposal(@CurrentUser() caller: AuthPrincipal, @Param('id') id: string) {
    await this.service.approveProposal(id, caller.id);
    await this.audit.log({
      actorId: caller.id,
      actorRoles: caller.platformRoles,
      action: 'google_ads_agent.proposal.approve',
      targetType: 'google_ads_agent_action',
      targetId: id,
    });
    return { ok: true };
  }

  @Post('proposals/:id/reject')
  async rejectProposal(@CurrentUser() caller: AuthPrincipal, @Param('id') id: string) {
    await this.service.rejectProposal(id, caller.id);
    await this.audit.log({
      actorId: caller.id,
      actorRoles: caller.platformRoles,
      action: 'google_ads_agent.proposal.reject',
      targetType: 'google_ads_agent_action',
      targetId: id,
    });
    return { ok: true };
  }

  @Get('campaigns')
  listCampaigns() {
    return this.service.listCampaigns();
  }

  @Get('actions')
  listActions(@Query() query: ListGoogleAdsAgentActionsQuery) {
    return this.service.listActions({
      categoryId: query.categoryId,
      action: query.action,
      status: query.status,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  /** Returns as soon as the run is KICKED OFF, not once it finishes — see
   *  `AdminGoogleAdsService.runNow()`'s doc comment for why. */
  @Post('run/:kind')
  async runNow(
    @CurrentUser() caller: AuthPrincipal,
    @Param('kind', new ParseEnumPipe(RunKind)) kind: GoogleAdsAgentRunKindParam,
  ) {
    this.service.runNow(kind);
    await this.audit.log({
      actorId: caller.id,
      actorRoles: caller.platformRoles,
      action: 'google_ads_agent.run_now',
      targetType: 'google_ads_agent_run',
      targetId: kind,
    });
    return { started: true };
  }
}
