import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../../../auth/auth.guard';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { AuthPrincipal } from '../../../auth/auth.types';
import { ProV2AgentService } from './pro-v2-agent.service';
import { ProV2Service } from './pro-v2.service';
import { ProV2MessageDto } from './dto/pro-v2-message.dto';
import { ProV2RepairDto } from './dto/pro-v2-repair.dto';
import { ProV2PublishDto } from './dto/pro-v2-publish.dto';
import { ProV2AssetDto } from './dto/pro-v2-asset.dto';

/**
 * The Website Builder — the AI chat that owns a real Vue/Vite project.
 * Requires company membership (owner/manager) AND the paid advanced-builder
 * unlock, re-checked on every call below.
 */
@UseGuards(AuthGuard)
@Controller('companies/:companyId/pro-v2')
export class ProV2Controller {
  constructor(
    private readonly pro: ProV2AgentService,
    private readonly projects: ProV2Service,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.pro.getView(companyId, user.id);
  }

  // The one-time paid gate (same fee/flag as the old builder's "advanced
  // unlock") — checked here for the pay screen, and re-checked server-side on
  // every project/message/publish call so direct navigation can't skip it.
  @Get('unlock')
  unlockStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.projects.getUnlockStatus(companyId, user.id);
  }

  @Post('unlock')
  unlock(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.projects.unlock(companyId, user.id);
  }

  /** Current request/day/month AI spend for the usage UI (item 11) — scoped
   *  to the calling user, not the company, since budgets are per-user. */
  @Get('usage')
  usage(@CurrentUser() user: AuthPrincipal) {
    return this.pro.usageSummary(user.id);
  }

  // A full agent turn can take a while (several sequential Claude calls) and
  // is comparatively expensive — throttled tighter than a single AI call.
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  @Post('message')
  sendMessage(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ProV2MessageDto,
  ) {
    return this.pro.sendMessage(user.id, companyId, dto.content);
  }

  // §5 self-correction — the frontend calls this automatically when its own
  // WebContainer sandbox detects a real install/build/runtime failure. Same
  // throttle bucket as a manual message: the frontend already bounds this to
  // 3 attempts per generation/edit, so no separate limit is needed here.
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  @Post('repair')
  repair(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ProV2RepairDto,
  ) {
    return this.pro.repairTurn(user.id, companyId, dto);
  }

  // Publishes a freshly-built `dist/` (from the browser's own WebContainer
  // `npm run build`) as the company's live static bundle — the one
  // production-hosting path for this project, since WebContainer itself is a
  // browser-only dev sandbox. Throttled like a normal write — publishing is a
  // deliberate, infrequent action, not part of the per-turn agent loop.
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('publish')
  publish(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ProV2PublishDto,
  ) {
    return this.projects.publishBundle(companyId, user.id, dto.files);
  }

  // An image attached in the chat composer (portfolio/product/team/logo/
  // etc.) — stored the same way the Advanced/Easy builders already store
  // uploaded images. The frontend weaves the returned URL into the user's
  // own chat message text; the agent isn't aware of "uploads" as a concept.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('assets')
  uploadAsset(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ProV2AssetDto,
  ) {
    return this.projects.uploadAsset(companyId, user.id, dto.dataUri);
  }
}
