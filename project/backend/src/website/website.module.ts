import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { WebsiteDraftController } from './drafts/website-draft.controller';
import { WebsiteDraftService } from './drafts/website-draft.service';
import { WebsiteBuilderController } from './builder/website-builder.controller';
import { WebsiteBuilderService } from './builder/website-builder.service';
import { WebsiteAssetController } from './assets/website-asset.controller';
import { WebsiteAssetService } from './assets/website-asset.service';
import { EasySiteController } from './easy-site/easy-site.controller';
import { EasySiteService } from './easy-site/easy-site.service';
import { RuleBasedWebsiteGenerator } from './website-generator';
import { ImageSearchService } from './builder/generator/image-provider/image-search.service';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [
    WebsiteDraftController,
    WebsiteBuilderController,
    WebsiteAssetController,
    EasySiteController,
  ],
  providers: [
    WebsiteDraftService,
    WebsiteBuilderService,
    WebsiteAssetService,
    EasySiteService,
    RuleBasedWebsiteGenerator,
    ImageSearchService,
  ],
  exports: [RuleBasedWebsiteGenerator, WebsiteDraftService, WebsiteBuilderService],
})
export class WebsiteModule {}
