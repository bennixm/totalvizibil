import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthPrincipal, AuthUserView } from './auth.types';
import { AccountService } from './account.service';
import { ChangePasswordDto, TotpCodeDto, UpdateProfileDto } from './dto/account.dto';

/** Authenticated account & security settings (the panel). */
@UseGuards(AuthGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('security')
  security(@CurrentUser() user: AuthPrincipal) {
    return this.account.security(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthUserView> {
    return this.account.updateProfile(user.id, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password')
  changePassword(@CurrentUser() user: AuthPrincipal, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(user, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('totp/setup')
  totpSetup(@CurrentUser() user: AuthPrincipal) {
    return this.account.totpSetup(user.id);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @HttpCode(200)
  @Post('totp/enable')
  totpEnable(@CurrentUser() user: AuthPrincipal, @Body() dto: TotpCodeDto) {
    return this.account.totpEnable(user.id, dto.code);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @HttpCode(200)
  @Post('totp/disable')
  totpDisable(@CurrentUser() user: AuthPrincipal, @Body() dto: TotpCodeDto) {
    return this.account.totpDisable(user.id, dto.code);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthPrincipal) {
    return this.account.listSessions(user);
  }

  @HttpCode(200)
  @Delete('sessions/others')
  revokeOthers(@CurrentUser() user: AuthPrincipal) {
    return this.account.revokeOtherSessions(user);
  }
}
