import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PlatformRoles, PlatformRolesGuard } from '../auth/platform-roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { BillingService, isProfileComplete } from './billing.service';
import { generateInvoicePdf } from './invoice-pdf';
import { BillingProfileDto } from './dto/billing-profile.dto';

/**
 * Whether this principal may open ANY user's invoice, not just their own.
 * Invoices are the Contabil's (`finance`) core working document — gating this
 * on `admin` alone meant every invoice a finance staffer opened from the
 * Facturi table or the print view 404'd as `invoice_not_found`.
 */
export function canViewAnyInvoice(user: AuthPrincipal): boolean {
  return user.platformRoles.includes('admin') || user.platformRoles.includes('finance');
}

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
    // Admin AND finance staff can open any user's invoice from the admin panel
    // through this same route (and print view) — no separate staff-only page
    // needed. Everyone else is scoped to their own invoices.
    return this.billing.getInvoice(user.id, id, canViewAnyInvoice(user));
  }

  @HttpCode(200)
  @Post('invoices/backfill')
  backfill(@CurrentUser() user: AuthPrincipal) {
    return this.billing.backfillInvoices(user.id);
  }
}

/**
 * Staff-side invoice PDF download. Until now the only way back to an issued
 * invoice after the confirmation email was the browser print view, which is
 * not a file anyone can archive or forward — so there was no re-download at
 * all. Same renderer as the email attachment (`generateInvoicePdf`), so the
 * downloaded document is byte-for-byte the one the customer received.
 *
 * Deliberately a second controller rather than a route on the one above:
 * `/admin/invoices/*` can't be expressed under the `account/billing` prefix.
 */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin', 'finance')
@Controller('admin/invoices')
export class AdminInvoicePdfController {
  constructor(private readonly billing: BillingService) {}

  @Get(':id/pdf')
  async pdf(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    // `allowAny` is unconditional here — the role guard above is what gates
    // the route, and this endpoint is explicitly not scoped to the caller.
    const invoice = await this.billing.getInvoice(user.id, id, true);
    const buffer = await generateInvoicePdf(invoice);
    const safeNumber = invoice.number.replace(/[^A-Za-z0-9._-]+/g, '-');
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="factura-${safeNumber}.pdf"`,
    });
  }
}
