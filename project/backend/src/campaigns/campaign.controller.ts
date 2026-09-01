import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { CampaignService } from './campaign.service';
import { SaveCampaignDto } from './dto/save-campaign.dto';

@UseGuards(AuthGuard)
@Controller('companies/:companyId/campaign')
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get()
  get(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.campaigns.get(user.id, companyId);
  }

  @Get('optimization')
  optimization(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.campaigns.optimization(user.id, companyId);
  }

  @Get('spend')
  spend(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.campaigns.spendReport(user.id, companyId);
  }

  @Put()
  save(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SaveCampaignDto,
  ) {
    return this.campaigns.save(user.id, companyId, dto);
  }

  @Post('activate')
  activate(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.campaigns.activate(user.id, companyId);
  }

  @Post('pause')
  pause(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.campaigns.pause(user.id, companyId);
  }

  /** Delete the campaign immediately (it leaves the feed first). */
  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.campaigns.remove(user.id, companyId);
  }
}
