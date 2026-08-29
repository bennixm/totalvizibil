import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AccountController } from './account.controller';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { PasswordService } from './password.service';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';
import { SessionCookieService } from './session-cookie.service';
import { TotpService } from './totp.service';
import { AuthGuard } from './auth.guard';
import { PlatformRolesGuard } from './platform-roles.guard';

@Module({
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    AccountService,
    PasswordService,
    PasswordResetService,
    SessionService,
    SessionCookieService,
    TotpService,
    AuthGuard,
    PlatformRolesGuard,
  ],
  exports: [
    AuthGuard,
    PlatformRolesGuard,
    SessionService,
    SessionCookieService,
    PasswordService,
    AuthService,
  ],
})
export class AuthModule {}
