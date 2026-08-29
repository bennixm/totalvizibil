import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { SessionCookieService } from './session-cookie.service';
import { AuthGuard } from './auth.guard';
import { PlatformRolesGuard } from './platform-roles.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    SessionCookieService,
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
