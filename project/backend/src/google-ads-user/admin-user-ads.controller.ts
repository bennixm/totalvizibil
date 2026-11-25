import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlatformRoles, PlatformRolesGuard } from '../auth/platform-roles.guard';
import { ADMIN_CHANGE_KINDS, AdminChangeKind, AdminUserAdsService } from './admin-user-ads.service';
import { GoogleAdsUserAgentService } from './google-ads-user-agent.service';
import { GoogleAdsUserService } from './google-ads-user.service';

class ChangeDto {
  @IsIn(ADMIN_CHANGE_KINDS)
  kind!: AdminChangeKind;
  @IsObject()
  input!: Record<string, unknown>;
  @IsString()
  @Length(3, 300)
  reason!: string;
}

class StaffCycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
  @IsOptional()
  @IsBoolean()
  ignoreMissingInfo?: boolean;
}

const actorOf = (u: AuthPrincipal) => ({ id: u.id, roles: u.platformRoles });

/** One customer's Google Ads campaigns, administered from the admin panel.
 *  Every route checks that the campaign belongs to `:userId`. */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin')
@Controller('admin/users/:userId/google-ads')
export class AdminUserAdsController {
  constructor(
    private readonly admin: AdminUserAdsService,
    private readonly ads: GoogleAdsUserService,
    private readonly agent: GoogleAdsUserAgentService,
  ) {}

  @Get('campaigns')
  list(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.admin.list(userId);
  }

  @Get('campaigns/:id')
  detail(@Param('userId', ParseUUIDPipe) userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ads.detail(userId, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('campaigns/:id/editor')
  editor(@Param('userId', ParseUUIDPipe) userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.editor(userId, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('campaigns/:id/changes')
  change(
    @CurrentUser() caller: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeDto,
  ) {
    return this.admin.change(actorOf(caller), userId, id, dto.kind, dto.input, dto.reason.trim());
  }

  @Get('campaigns/:id/actions')
  actions(@Param('userId', ParseUUIDPipe) userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ads.actions(userId, id);
  }

  @Get('campaigns/:id/activity')
  activity(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('after') after?: string,
  ) {
    const d = after ? new Date(after) : undefined;
    return this.ads.activity(userId, id, d && !isNaN(d.getTime()) ? d : undefined);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('campaigns/:id/sync')
  sync(@Param('userId', ParseUUIDPipe) userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.agent.sync(userId, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('campaigns/:id/quote')
  quote(@Param('userId', ParseUUIDPipe) userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.agent.quote(userId, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('campaigns/:id/cycles')
  startCycle(
    @CurrentUser() caller: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffCycleDto,
  ) {
    return this.admin.startCycle(actorOf(caller), userId, id, dto);
  }

  @Patch('campaigns/:id/settings')
  settings(
    @CurrentUser() caller: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.admin.updateSettings(actorOf(caller), userId, id, body ?? {});
  }

  @Post('campaigns/:id/pause')
  pause(
    @CurrentUser() caller: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.setPaused(actorOf(caller), userId, id, true);
  }

  @Post('campaigns/:id/resume')
  resume(
    @CurrentUser() caller: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.setPaused(actorOf(caller), userId, id, false);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('campaigns/:id/actions/:actionId/approve')
  approve(
    @CurrentUser() caller: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    return this.admin.decide(actorOf(caller), userId, id, actionId, true);
  }

  @Post('campaigns/:id/actions/:actionId/reject')
  reject(
    @CurrentUser() caller: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    return this.admin.decide(actorOf(caller), userId, id, actionId, false);
  }
}
