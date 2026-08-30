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
import { AuthGuard } from '../auth/auth.guard';
import { PlatformRoles, PlatformRolesGuard } from '../auth/platform-roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserPasswordDto } from './dto/set-user-password.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Platform admin panel. Requires the `admin` platform role. */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly users: AdminUsersService,
    private readonly settings: PlatformSettingsService,
  ) {}

  @Get('stats')
  overview() {
    return this.stats.overview();
  }

  @Get('settings')
  async getSettings() {
    const [eurRonRate, advancedBuilderPriceCredits, additionalBusinessPriceCredits] =
      await Promise.all([
        this.settings.eurRonRate(),
        this.settings.advancedBuilderPriceCredits(),
        this.settings.additionalBusinessPriceCredits(),
      ]);
    return { eurRonRate, advancedBuilderPriceCredits, additionalBusinessPriceCredits };
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    if (dto.eurRonRate !== undefined) await this.settings.setEurRonRate(dto.eurRonRate);
    if (dto.advancedBuilderPriceCredits !== undefined) {
      await this.settings.setAdvancedBuilderPriceCredits(dto.advancedBuilderPriceCredits);
    }
    if (dto.additionalBusinessPriceCredits !== undefined) {
      await this.settings.setAdditionalBusinessPriceCredits(dto.additionalBusinessPriceCredits);
    }
    return this.getSettings();
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.detail(id);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() caller: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(caller.id, id, dto);
  }

  @Post('users/:id/password')
  setUserPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserPasswordDto) {
    return this.users.setPassword(id, dto.newPassword);
  }
}
