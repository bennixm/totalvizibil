import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { WebsiteDraftController } from './drafts/website-draft.controller';
import { WebsiteDraftService } from './drafts/website-draft.service';
import { WebsiteBuilderController } from './builder/website-builder.controller';
import { WebsiteBuilderService } from './builder/website-builder.service';
import { WebsiteAssetController } from './assets/website-asset.controller';
import { WebsiteAssetService } from './assets/website-asset.service';
import { RuleBasedWebsiteGenerator } from './website-generator';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [WebsiteDraftController, WebsiteBuilderController, WebsiteAssetController],
  providers: [
    WebsiteDraftService,
    WebsiteBuilderService,
    WebsiteAssetService,
    RuleBasedWebsiteGenerator,
  ],
  exports: [RuleBasedWebsiteGenerator, WebsiteDraftService],
})
export class WebsiteModule {}
