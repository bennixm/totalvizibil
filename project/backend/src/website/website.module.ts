import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { WebsiteDraftController } from './drafts/website-draft.controller';
import { WebsiteDraftService } from './drafts/website-draft.service';
import { WebsiteAssetController } from './assets/website-asset.controller';
import { WebsiteAssetService } from './assets/website-asset.service';
import { EasySiteController } from './easy-site/easy-site.controller';
import { EasySiteService } from './easy-site/easy-site.service';
import { RuleBasedWebsiteGenerator } from './website-generator';
import { ProV2Controller } from './builder/pro-v2/pro-v2.controller';
import { ProV2AgentService } from './builder/pro-v2/pro-v2-agent.service';
import { ProV2Service } from './builder/pro-v2/pro-v2.service';
import { ModelRouter } from './builder/pro-v2/model-router';
import { AiUsageService } from './builder/pro-v2/ai-usage.service';
import { PexelsSearchTool } from './builder/pro-v2/pexels-search-tool';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [
    WebsiteDraftController,
    WebsiteAssetController,
    EasySiteController,
    ProV2Controller,
  ],
  providers: [
    WebsiteDraftService,
    WebsiteAssetService,
    EasySiteService,
    RuleBasedWebsiteGenerator,
    ProV2Service,
    ProV2AgentService,
    ModelRouter,
    AiUsageService,
    PexelsSearchTool,
  ],
  exports: [RuleBasedWebsiteGenerator, WebsiteDraftService, ProV2Service],
})
export class WebsiteModule {}
