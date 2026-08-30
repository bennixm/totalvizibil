import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeadsController } from './leads.controller';
import { PublicLeadController } from './public-lead.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [AuthModule],
  controllers: [LeadsController, PublicLeadController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
