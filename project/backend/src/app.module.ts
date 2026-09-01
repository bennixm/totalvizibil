import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadConfig } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { CategoriesModule } from './categories/categories.module';
import { FeedModule } from './feed/feed.module';
import { WebsiteModule } from './website/website.module';
import { GeoModule } from './geo/geo.module';
import { WalletModule } from './wallet/wallet.module';
import { CampaignModule } from './campaigns/campaign.module';
import { LeadsModule } from './leads/leads.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { SupportModule } from './support/support.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: [loadConfig] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    PlatformSettingsModule,
    MailModule,
    AuthModule,
    CompaniesModule,
    CategoriesModule,
    FeedModule,
    WebsiteModule,
    GeoModule,
    WalletModule,
    CampaignModule,
    LeadsModule,
    AnalyticsModule,
    AdminModule,
    SupportModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
