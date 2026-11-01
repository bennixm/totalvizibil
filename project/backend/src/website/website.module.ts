import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { CampaignModule } from '../campaigns/campaign.module';
import { WebsiteDraftController } from './drafts/website-draft.controller';
import { WebsiteDraftService } from './drafts/website-draft.service';
import { WebsiteAssetController } from './assets/website-asset.controller';
import { WebsiteAssetService } from './assets/website-asset.service';
import { ASSET_STORAGE } from './assets/asset-storage';
import { PostgresAssetStorageProvider } from './assets/postgres-asset-storage.provider';
import { EasySiteController } from './easy-site/easy-site.controller';
import { EasySiteService } from './easy-site/easy-site.service';
import { ProV2Controller } from './builder/pro-v2/pro-v2.controller';
import { ProV2AgentService } from './builder/pro-v2/pro-v2-agent.service';
import { ProV2Service } from './builder/pro-v2/pro-v2.service';
import { ModelRouter } from './builder/pro-v2/model-router';
import { AiUsageService } from './builder/pro-v2/ai-usage.service';
import { PexelsSearchTool } from './builder/pro-v2/pexels-search-tool';

@Module({
  imports: [AuthModule, WalletModule, CampaignModule],
  controllers: [
    WebsiteDraftController,
    WebsiteAssetController,
    EasySiteController,
    ProV2Controller,
  ],
  providers: [
    WebsiteDraftService,
    WebsiteAssetService,
    // The bytes-storage backend behind WebsiteAssetService — bind this to a
    // different class (and nothing else) to move uploads to a dedicated
    // image cloud/CDN later. See asset-storage.ts.
    { provide: ASSET_STORAGE, useClass: PostgresAssetStorageProvider },
    EasySiteService,
    ProV2Service,
    ProV2AgentService,
    ModelRouter,
    AiUsageService,
    PexelsSearchTool,
  ],
  exports: [WebsiteDraftService, ProV2Service],
})
export class WebsiteModule {}
