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
import { BillingService } from '../billing/billing.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { AdminCompaniesService } from './admin-companies.service';
import { AdminCategoriesService } from './admin-categories.service';
import { ListUsersQuery } from './dto/list-users.query';
import { ListInvoicesQuery } from './dto/list-invoices.query';
import { ListReferralsQuery } from './dto/list-referrals.query';
import { VoidInvoiceDto } from './dto/void-invoice.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserPasswordDto } from './dto/set-user-password.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { BlockWalletDto } from './dto/block-wallet.dto';
import { RequestRefundDto } from '../wallet/dto/request-refund.dto';
import { CampaignActionDto } from './dto/campaign-action.dto';
import { SetCompanyStatusDto } from './dto/set-company-status.dto';
import { SetLeadStatusDto } from './dto/set-lead-status.dto';
import { SetCompanyLocationDto } from './dto/set-company-location.dto';
import { SetWebsitePublishedDto } from './dto/set-website-published.dto';
import { UpgradeAdvancedDto } from './dto/upgrade-advanced.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { LeadsQueryDto } from './dto/leads-query.dto';
import { ListCompaniesQuery } from './dto/list-companies.query';
import { SaveCampaignDto } from '../campaigns/dto/save-campaign.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { BroadcastMaintenanceDto } from './dto/broadcast-maintenance.dto';
import { NotificationsService } from '../notifications/notifications.service';

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
    private readonly billing: BillingService,
    private readonly affiliate: AffiliateService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('stats')
  overview() {
    return this.stats.overview();
  }

  @Get('settings')
  async getSettings() {
    const [
      eurRonRate,
      advancedBuilderPriceCredits,
      advancedBuilderUnlockBonusCredits,
      additionalBusinessPriceCredits,
      invoiceVatRatePct,
      invoiceIssuer,
      affiliateEnabled,
      affiliateRewardCredits,
      affiliateMinDepositCredits,
      refundFeePct,
      creditsDiscountEnabled,
      creditsDiscountPct,
    ] = await Promise.all([
      this.settings.eurRonRate(),
      this.settings.advancedBuilderPriceCredits(),
      this.settings.advancedBuilderUnlockBonusCredits(),
      this.settings.additionalBusinessPriceCredits(),
      this.settings.invoiceVatRatePct(),
      this.settings.invoiceIssuer(),
      this.settings.affiliateEnabled(),
      this.settings.affiliateRewardCredits(),
      this.settings.affiliateMinDepositCredits(),
      this.settings.refundFeePct(),
      this.settings.creditsDiscountEnabled(),
      this.settings.creditsDiscountPct(),
    ]);
    return {
      eurRonRate,
      advancedBuilderPriceCredits,
      advancedBuilderUnlockBonusCredits,
      additionalBusinessPriceCredits,
      invoiceVatRatePct,
      affiliateEnabled,
      affiliateRewardCredits,
      affiliateMinDepositCredits,
      refundFeePct,
      creditsDiscountEnabled,
      creditsDiscountPct,
      invoiceIssuerName: invoiceIssuer.name,
      invoiceIssuerTaxId: invoiceIssuer.taxId,
      invoiceIssuerRegCom: invoiceIssuer.regCom,
      invoiceIssuerAddress: invoiceIssuer.address,
      invoiceIssuerIban: invoiceIssuer.iban,
      invoiceIssuerBank: invoiceIssuer.bank,
    };
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    if (dto.eurRonRate !== undefined) await this.settings.setEurRonRate(dto.eurRonRate);
    if (dto.advancedBuilderPriceCredits !== undefined) {
      await this.settings.setAdvancedBuilderPriceCredits(dto.advancedBuilderPriceCredits);
    }
    if (dto.advancedBuilderUnlockBonusCredits !== undefined) {
      await this.settings.setAdvancedBuilderUnlockBonusCredits(
        dto.advancedBuilderUnlockBonusCredits,
      );
    }
    if (dto.additionalBusinessPriceCredits !== undefined) {
      await this.settings.setAdditionalBusinessPriceCredits(dto.additionalBusinessPriceCredits);
    }
    if (dto.invoiceVatRatePct !== undefined) {
      await this.settings.setInvoiceVatRatePct(dto.invoiceVatRatePct);
    }
    if (dto.affiliateEnabled !== undefined) {
      await this.settings.setAffiliateEnabled(dto.affiliateEnabled);
    }
    if (dto.affiliateRewardCredits !== undefined) {
      await this.settings.setAffiliateRewardCredits(dto.affiliateRewardCredits);
    }
    if (dto.affiliateMinDepositCredits !== undefined) {
      await this.settings.setAffiliateMinDepositCredits(dto.affiliateMinDepositCredits);
    }
    if (dto.refundFeePct !== undefined) {
      await this.settings.setRefundFeePct(dto.refundFeePct);
    }
    if (dto.creditsDiscountEnabled !== undefined || dto.creditsDiscountPct !== undefined) {
      await this.settings.setCreditsDiscount({
        enabled: dto.creditsDiscountEnabled,
        pct: dto.creditsDiscountPct,
      });
    }
    const {
      invoiceIssuerName: name,
      invoiceIssuerTaxId: taxId,
      invoiceIssuerRegCom: regCom,
      invoiceIssuerAddress: address,
      invoiceIssuerIban: iban,
      invoiceIssuerBank: bank,
    } = dto;
    if ([name, taxId, regCom, address, iban, bank].some((v) => v !== undefined)) {
      await this.settings.setInvoiceIssuer({ name, taxId, regCom, address, iban, bank });
    }
    return this.getSettings();
  }

  /** Broadcast a maintenance/update notice to every active user (email + panel). */
  @Post('maintenance/broadcast')
  async broadcastMaintenance(@Body() dto: BroadcastMaintenanceDto) {
    const notified = await this.notifications.notifyAll({
      type: 'maintenance',
      title: dto.title,
      body: dto.message,
      channels: { panel: true, email: true },
    });
    return { notified };
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

  @Post('users/:id/wallet/refund')
  refundBalance(
    @CurrentUser() caller: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestRefundDto,
  ) {
    return this.users.refundBalance(id, dto.credits, caller.id);
  }

  @Post('users/:id/wallet/refunds/:refundId/cancel')
  cancelWalletRefund(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('refundId', ParseUUIDPipe) refundId: string,
  ) {
    return this.users.cancelRefund(id, refundId);
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

  @Patch('companies/:id/location')
  setCompanyLocation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCompanyLocationDto) {
    return this.companies.setLocation(id, dto);
  }

  @Patch('companies/:id/website')
  setWebsitePublished(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetWebsitePublishedDto) {
    return this.companies.setWebsitePublished(id, dto.published);
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

  /** Grant the advanced website builder to this business (free, or charged to
   *  the owner's wallet when `charge: true`). */
  @Post('companies/:id/website/upgrade-advanced')
  upgradeAdvanced(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpgradeAdvancedDto) {
    return this.companies.upgradeToAdvanced(id, dto.charge ?? false);
  }

  @Patch('companies/:id/leads/:leadId')
  setLeadStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: SetLeadStatusDto,
  ) {
    return this.companies.setLeadStatus(id, leadId, dto.status);
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

  // --- invoices -----------------------------------------------------

  @Get('invoices')
  listInvoices(@Query() query: ListInvoicesQuery) {
    return this.billing.adminList(query);
  }

  @Get('invoices/:id')
  invoiceDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.adminGetInvoice(id);
  }

  @Post('invoices/:id/void')
  voidInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidInvoiceDto) {
    return this.billing.voidInvoice(id, dto.reason);
  }

  @Post('invoices/:id/unvoid')
  unvoidInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.unvoidInvoice(id);
  }

  // --- affiliate program -----------------------------------------------

  @Get('referrals')
  listReferrals(@Query() query: ListReferralsQuery) {
    return this.affiliate.adminList({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    });
  }
}
