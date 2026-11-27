import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { PlatformRoles, PlatformRolesGuard } from '../auth/platform-roles.guard';
import { InfluencersService } from './influencers.service';
import {
  AttachInfluencerCodeDto,
  CreateInfluencerDto,
  UpdateInfluencerDto,
} from './dto/influencer.dto';

/**
 * The influencer's own panel. GET only, on purpose: an influencer can never
 * change their code, the discount or the commission, and only ever sees
 * their own data (resolved from the session, never from a parameter).
 */
@UseGuards(AuthGuard)
@Controller('influencer')
export class InfluencerController {
  constructor(private readonly influencers: InfluencersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return this.influencers.dashboard(user.id);
  }
}

/** Admin › Influenceri. Managing is admin-only; finance may read. */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin')
@Controller('admin/influencers')
export class AdminInfluencersController {
  constructor(private readonly influencers: InfluencersService) {}

  @PlatformRoles('admin', 'finance')
  @Get()
  list() {
    return this.influencers.adminList();
  }

  @PlatformRoles('admin', 'finance')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.influencers.adminDetail(id);
  }

  @Post()
  create(@CurrentUser() caller: AuthPrincipal, @Body() dto: CreateInfluencerDto) {
    return this.influencers.adminCreate(dto, { id: caller.id, roles: caller.platformRoles });
  }

  @Patch(':id')
  update(
    @CurrentUser() caller: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInfluencerDto,
  ) {
    return this.influencers.adminUpdate(id, dto, { id: caller.id, roles: caller.platformRoles });
  }

  @Post(':id/resend-invite')
  resendInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.influencers.adminResendInvite(id);
  }
}

/** Admin › Utilizatori › one user: attach / detach the code they joined with. */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin')
@Controller('admin/users/:id/referral')
export class AdminUserReferralController {
  constructor(private readonly influencers: InfluencersService) {}

  @Post()
  attach(
    @CurrentUser() caller: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachInfluencerCodeDto,
  ) {
    return this.influencers.adminAttachCode(id, dto.code, {
      id: caller.id,
      roles: caller.platformRoles,
    });
  }

  @Delete()
  detach(@CurrentUser() caller: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.influencers.adminDetachReferral(id, { id: caller.id, roles: caller.platformRoles });
  }
}
