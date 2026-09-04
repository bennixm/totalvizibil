import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { BillingService, isProfileComplete } from './billing.service';
import { BillingProfileDto } from './dto/billing-profile.dto';

/** Billing identity (Account → Facturare) + the invoices issued from it. */
@UseGuards(AuthGuard)
@Controller('account/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('profile')
  async profile(@CurrentUser() user: AuthPrincipal) {
    const profile = await this.billing.getProfile(user.id);
    const unbilled = await this.billing.unbilledPurchases(user.id);
    return { profile, isComplete: isProfileComplete(profile), unbilled };
  }

  @Put('profile')
  updateProfile(@CurrentUser() user: AuthPrincipal, @Body() dto: BillingProfileDto) {
    return this.billing.upsertProfile(user.id, dto);
  }

  @Get('invoices')
  invoices(@CurrentUser() user: AuthPrincipal) {
    return this.billing.listInvoices(user.id);
  }

  @Get('invoices/:id')
  invoice(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    // An admin can open any user's invoice from the admin panel through this
    // same route (and print view) — no separate admin-only page needed.
    return this.billing.getInvoice(user.id, id, user.platformRoles.includes('admin'));
  }

  @HttpCode(200)
  @Post('invoices/backfill')
  backfill(@CurrentUser() user: AuthPrincipal) {
    return this.billing.backfillInvoices(user.id);
  }
}
