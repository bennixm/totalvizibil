import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsSweepService } from './notifications-sweep.service';

/** Global like PlatformSettingsModule/StripeModule/MailModule — any feature
 *  injects `NotificationsService` directly, no explicit import needed.
 *  Imports AuthModule for AuthGuard (the controller) and SessionService
 *  (the gateway's own cookie-based auth), and AnalyticsModule for the
 *  sweep's feed-position check. */
@Global()
@Module({
  imports: [AuthModule, AnalyticsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, NotificationsSweepService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
