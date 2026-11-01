import { Global, Module } from '@nestjs/common';
import { BusinessActionLogService } from './business-action-log.service';

/**
 * Global like AuditLogModule — written from services that live in several
 * feature modules (campaigns, companies, website builder), some of which are
 * already imported by AdminModule. A global provider is the only wiring that
 * reaches all of them without an import cycle.
 */
@Global()
@Module({
  providers: [BusinessActionLogService],
  exports: [BusinessActionLogService],
})
export class BusinessActionLogModule {}
