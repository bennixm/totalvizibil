import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminStatsService, AdminUsersService],
})
export class AdminModule {}
