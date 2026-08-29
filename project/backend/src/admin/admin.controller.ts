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
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserPasswordDto } from './dto/set-user-password.dto';

/** Platform admin panel. Requires the `admin` platform role. */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly users: AdminUsersService,
  ) {}

  @Get('stats')
  overview() {
    return this.stats.overview();
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
