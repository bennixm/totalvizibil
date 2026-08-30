import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { WebsiteDraftController } from './drafts/website-draft.controller';
import { WebsiteDraftService } from './drafts/website-draft.service';
import { WebsiteBuilderController } from './builder/website-builder.controller';
import { WebsiteBuilderService } from './builder/website-builder.service';
import { RuleBasedWebsiteGenerator } from './website-generator';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [WebsiteDraftController, WebsiteBuilderController],
  providers: [WebsiteDraftService, WebsiteBuilderService, RuleBasedWebsiteGenerator],
  exports: [RuleBasedWebsiteGenerator, WebsiteDraftService],
})
export class WebsiteModule {}
