import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * Global like PlatformSettingsModule/NotificationsModule/StripeModule — the
 * audit log is written from services that live in four different feature
 * modules (wallet, billing, platform-settings, admin), and some of those are
 * already imported BY AdminModule. A global provider is the only wiring that
 * reaches all four without an import cycle.
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
