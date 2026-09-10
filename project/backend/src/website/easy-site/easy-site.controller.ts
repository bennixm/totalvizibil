import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthPrincipal } from '../../auth/auth.types';
import { EasySiteService } from './easy-site.service';
import { PatchEasyDto } from '../drafts/dto/patch-easy.dto';
import { AddAssetDto } from '../drafts/dto/add-asset.dto';
import { RegenerateServicesDto } from '../drafts/dto/regenerate-services.dto';

/**
 * Post-account editor for an easy-plan ("Site Simplu") website. The owner keeps
 * editing the same guided config they built in setup — same sections, same
 * widgets — and every change re-composes and re-persists the live site.
 */
@UseGuards(AuthGuard)
@Controller('companies/:companyId/easy-site')
export class EasySiteController {
  constructor(private readonly easy: EasySiteService) {}

  @Get()
  get(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentUser() user: AuthPrincipal) {
    return this.easy.get(companyId, user.id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Patch()
  patch(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PatchEasyDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.easy.patch(companyId, user.id, dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  @Post('services')
  regenerateServices(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: RegenerateServicesDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.easy.regenerateServices(companyId, user.id, dto.names);
  }

  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post('assets')
  addAsset(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: AddAssetDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.easy.addAsset(companyId, user.id, dto.dataUri, dto.kind);
  }
}
