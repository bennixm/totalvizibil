import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { PlatformRolesGuard } from './platform-roles.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, AuthGuard, PlatformRolesGuard],
  exports: [AuthGuard, PlatformRolesGuard, SessionService, PasswordService],
})
export class AuthModule {}
