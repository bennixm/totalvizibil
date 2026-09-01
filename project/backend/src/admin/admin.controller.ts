import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PlatformRoles, PlatformRolesGuard } from '../auth/platform-roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { AdminCompaniesService } from './admin-companies.service';
import { AdminCategoriesService } from './admin-categories.service';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserPasswordDto } from './dto/set-user-password.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { BlockWalletDto } from './dto/block-wallet.dto';
import { CampaignActionDto } from './dto/campaign-action.dto';
import { SetCompanyStatusDto } from './dto/set-company-status.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { LeadsQueryDto } from './dto/leads-query.dto';
import { ListCompaniesQuery } from './dto/list-companies.query';
import { SaveCampaignDto } from '../campaigns/dto/save-campaign.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/** Platform admin panel. Requires the `admin` platform role. */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly users: AdminUsersService,
    private readonly companies: AdminCompaniesService,
    private readonly categories: AdminCategoriesService,
    private readonly settings: PlatformSettingsService,
  ) {}

  @Get('stats')
  overview() {
    return this.stats.overview();
  }

  @Get('settings')
  async getSettings() {
    const [eurRonRate, advancedBuilderPriceCredits, additionalBusinessPriceCredits] =
      await Promise.all([
        this.settings.eurRonRate(),
        this.settings.advancedBuilderPriceCredits(),
        this.settings.additionalBusinessPriceCredits(),
      ]);
    return { eurRonRate, advancedBuilderPriceCredits, additionalBusinessPriceCredits };
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    if (dto.eurRonRate !== undefined) await this.settings.setEurRonRate(dto.eurRonRate);
    if (dto.advancedBuilderPriceCredits !== undefined) {
      await this.settings.setAdvancedBuilderPriceCredits(dto.advancedBuilderPriceCredits);
    }
    if (dto.additionalBusinessPriceCredits !== undefined) {
      await this.settings.setAdditionalBusinessPriceCredits(dto.additionalBusinessPriceCredits);
    }
    return this.getSettings();
  }

  // --- users --------------------------------------------------------

  @Get('users')
  listUsers(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.detail(id);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() caller: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(caller.id, id, dto);
  }

  @Post('users/:id/password')
  setUserPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserPasswordDto) {
    return this.users.setPassword(id, dto.newPassword);
  }

  @Post('users/:id/wallet/block')
  blockWallet(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockWalletDto) {
    return this.users.blockWallet(id, dto);
  }

  @Post('users/:id/wallet/adjust')
  adjustWallet(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustWalletDto) {
    return this.users.adjustWallet(id, dto);
  }

  // --- businesses --------------------------------------------------

  @Get('companies')
  listCompanies(@Query() query: ListCompaniesQuery) {
    return this.companies.list(query);
  }

  @Get('companies/:id')
  companyDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.detail(id);
  }

  @Get('companies/:id/leads')
  companyLeads(@Param('id', ParseUUIDPipe) id: string, @Query() query: LeadsQueryDto) {
    return this.companies.leadsPage(id, query);
  }

  @Patch('companies/:id')
  updateCompany(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.updateCompany(id, dto);
  }

  @Patch('companies/:id/status')
  setCompanyStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCompanyStatusDto) {
    return this.companies.setStatus(id, dto);
  }

  @Put('companies/:id/campaign')
  saveCampaign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveCampaignDto) {
    return this.companies.saveCampaign(id, dto);
  }

  @Post('companies/:id/campaign')
  campaignAction(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CampaignActionDto) {
    return this.companies.campaignAction(id, dto);
  }

  // --- categories -------------------------------------------------

  @Get('categories')
  listCategories() {
    return this.categories.tree();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(id);
  }
}
