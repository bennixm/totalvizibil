import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { GoogleAdsAgentContentService } from './google-ads-agent-content.service';
import { GoogleAdsAgentIntelligenceService } from './google-ads-agent-intelligence.service';
import { GoogleAdsAgentRecommendationsService } from './google-ads-agent-recommendations.service';
import { GoogleAdsAgentStructuralService } from './google-ads-agent-structural.service';
import { GoogleAdsApiClient } from './google-ads-api-client.service';
import { GoogleAdsCpcSyncService } from './google-ads-cpc-sync.service';
import { GoogleAdsReferenceDataService } from './google-ads-reference-data.service';

/** `PlatformSettingsService`, `AiService` and `ConfigService` are all
 *  global — nothing to wire up for those. `AnalyticsModule` is imported for
 *  `AnalyticsService.marginConfig()` (the Feed CPC floor signal the
 *  budget-intelligence pass feeds Claude). (The one-time OAuth consent
 *  controller this module used to expose is gone: auth is now a service
 *  account, which never needs a human consent round-trip.)
 *  `GoogleAdsApiClient`/`GoogleAdsReferenceDataService`/
 *  `GoogleAdsAgentIntelligenceService` are exported so a later Faza (4, see
 *  docs/ai/GOOGLE-ADS-AGENT-PLAN.md — the admin approval endpoints) can
 *  call into them instead of standing up a second instance. */
@Module({
  imports: [AnalyticsModule],
  providers: [
    GoogleAdsApiClient,
    GoogleAdsReferenceDataService,
    GoogleAdsCpcSyncService,
    GoogleAdsAgentRecommendationsService,
    GoogleAdsAgentStructuralService,
    GoogleAdsAgentContentService,
    GoogleAdsAgentIntelligenceService,
  ],
  exports: [
    GoogleAdsApiClient,
    GoogleAdsReferenceDataService,
    GoogleAdsAgentRecommendationsService,
    GoogleAdsAgentStructuralService,
    GoogleAdsAgentContentService,
    GoogleAdsAgentIntelligenceService,
  ],
})
export class GoogleAdsModule {}
