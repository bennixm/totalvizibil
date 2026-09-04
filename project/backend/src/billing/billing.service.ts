import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { minorToCredits } from '../wallet/money';
import { BillingProfileDto } from './dto/billing-profile.dto';

const INVOICE_SERIES = 'TVZ';

/**
 * Decompose a VAT-inclusive total (what the client actually paid) into
 * subtotal + VAT at the given whole-percent rate. `rate === 0` is the common
 * "neplătitor de TVA" case — the whole amount is the subtotal, no VAT line.
 */
export function decomposeVat(
  totalMinor: number,
  ratePct: number,
): { subtotal: number; vat: number } {
  if (ratePct <= 0) return { subtotal: totalMinor, vat: 0 };
  const subtotal = Math.round(totalMinor / (1 + ratePct / 100));
  return { subtotal, vat: totalMinor - subtotal };
}

/**
 * The single rule for "can an invoice be issued to this user": shared name +
 * address fields for both kinds, plus CUI/Reg. Com. for a company. The wallet
 * purchase gate (`WalletService.confirmPurchase`) calls this before letting a
 * deposit go through, so an invoice-less deposit can never happen.
 */
export function isProfileComplete(
  p: Pick<
    BillingProfile,
    'kind' | 'name' | 'address' | 'city' | 'country' | 'taxId' | 'regCom'
  > | null,
): boolean {
  if (!p) return false;
  const base = !!p.name?.trim() && !!p.address?.trim() && !!p.city?.trim() && !!p.country?.trim();
  if (!base) return false;
  if (p.kind === 'company') return !!p.taxId?.trim() && !!p.regCom?.trim();
  return true;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  // --- profile ---------------------------------------------------------

  getProfile(userId: string): Promise<BillingProfile | null> {
    return this.prisma.billingProfile.findUnique({ where: { userId } });
  }

  async upsertProfile(
    userId: string,
    dto: BillingProfileDto,
  ): Promise<{ profile: BillingProfile; isComplete: boolean; invoicesIssued: number }> {
    const wasComplete = isProfileComplete(await this.getProfile(userId));
    const isCompany = dto.kind === 'company';
    const data = {
      kind: dto.kind,
      name: dto.name,
      taxId: isCompany ? (dto.taxId ?? null) : null,
      regCom: isCompany ? (dto.regCom ?? null) : null,
      vatPayer: dto.vatPayer ?? false,
      address: dto.address,
      city: dto.city,
      county: dto.county ?? null,
      postalCode: dto.postalCode ?? null,
      country: dto.country?.trim() || 'RO',
      billingEmail: dto.billingEmail ?? null,
      iban: dto.iban ?? null,
      bankName: dto.bankName ?? null,
    };
    const profile = await this.prisma.billingProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    const nowComplete = isProfileComplete(profile);
    const invoicesIssued =
      nowComplete && !wasComplete ? (await this.backfillInvoices(userId)).issued : 0;
    return { profile, isComplete: nowComplete, invoicesIssued };
  }

  // --- invoice numbering + issuing --------------------------------------

  /** Gapless per-series-per-year counter, bumped inside the caller's transaction. */
  private async nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const existing = await tx.invoiceCounter.findUnique({ where: { series: INVOICE_SERIES } });
    let seq: number;
    if (!existing || existing.year !== year) {
      await tx.invoiceCounter.upsert({
        where: { series: INVOICE_SERIES },
        create: { series: INVOICE_SERIES, year, nextSeq: 2 },
        update: { year, nextSeq: 2 },
      });
      seq = 1;
    } else {
      const updated = await tx.invoiceCounter.update({
        where: { series: INVOICE_SERIES },
        data: { nextSeq: { increment: 1 } },
      });
      seq = updated.nextSeq - 1;
    }
    return `${INVOICE_SERIES}-${year}-${String(seq).padStart(6, '0')}`;
  }

  /**
   * Issue one invoice for a completed `purchase` wallet transaction. The caller
   * (wallet confirm / backfill) is responsible for only calling this once the
   * profile is confirmed complete — this re-checks and throws otherwise, so it
   * can never be bypassed by a new call site.
   */
  async issueInvoice(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      walletTransactionId: string;
      ronBani: number;
      eurCents: number | null;
      fxRate: Prisma.Decimal | null;
      credits: number;
    },
  ): Promise<{ id: string; number: string }> {
    const profile = await tx.billingProfile.findUnique({ where: { userId: params.userId } });
    if (!profile || !isProfileComplete(profile)) {
      throw new BadRequestException('billing_profile_incomplete');
    }
    const [issuer, vatRatePct] = await Promise.all([
      this.settings.invoiceIssuer(),
      this.settings.invoiceVatRatePct(),
    ]);
    const total = params.ronBani;
    const { subtotal, vat } = decomposeVat(total, vatRatePct);
    const number = await this.nextInvoiceNumber(tx);

    return tx.invoice.create({
      data: {
        number,
        userId: params.userId,
        walletTransactionId: params.walletTransactionId,
        buyerKind: profile.kind,
        buyerName: profile.name,
        buyerTaxId: profile.taxId,
        buyerRegCom: profile.regCom,
        buyerVatPayer: profile.vatPayer,
        buyerAddress: profile.address,
        buyerCity: profile.city,
        buyerCounty: profile.county,
        buyerPostalCode: profile.postalCode,
        buyerCountry: profile.country,
        buyerEmail: profile.billingEmail,
        issuerName: issuer.name || 'Totalvizibil',
        issuerTaxId: issuer.taxId || null,
        issuerRegCom: issuer.regCom || null,
        issuerAddress: issuer.address,
        issuerIban: issuer.iban || null,
        issuerBank: issuer.bank || null,
        currency: 'RON',
        description: `${params.credits} credite Totalvizibil`,
        subtotalMinor: subtotal,
        vatRatePct,
        vatMinor: vat,
        totalMinor: total,
        eurCents: params.eurCents,
        fxRate: params.fxRate,
      },
      select: { id: true, number: true },
    });
  }

  // --- reads -------------------------------------------------------------

  listInvoices(userId: string) {
    return this.prisma.invoice.findMany({ where: { userId }, orderBy: { issuedAt: 'desc' } });
  }

  /** `allowAny` (an admin viewing someone else's invoice) skips the ownership check. */
  async getInvoice(userId: string, id: string, allowAny = false) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice || (!allowAny && invoice.userId !== userId)) {
      throw new NotFoundException('invoice_not_found');
    }
    return invoice;
  }

  /** Most recent invoices for one user (admin user-detail panel). */
  listForUser(userId: string, take = 20) {
    return this.prisma.invoice.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
      take,
    });
  }

  /** Completed deposits with no invoice yet — drives the Wallet/Account alert. */
  async unbilledPurchases(userId: string): Promise<{ count: number; oldestAt: Date | null }> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId }, select: { id: true } });
    if (!wallet) return { count: 0, oldestAt: null };
    const rows = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, type: 'purchase', status: 'completed', invoice: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return { count: rows.length, oldestAt: rows[0]?.createdAt ?? null };
  }

  /** Issue invoices for every unbilled completed deposit — only once the profile is complete. */
  async backfillInvoices(userId: string): Promise<{ issued: number }> {
    const profile = await this.getProfile(userId);
    if (!isProfileComplete(profile)) return { issued: 0 };
    const wallet = await this.prisma.wallet.findUnique({ where: { userId }, select: { id: true } });
    if (!wallet) return { issued: 0 };
    const rows = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, type: 'purchase', status: 'completed', invoice: null },
      orderBy: { createdAt: 'asc' },
    });

    let issued = 0;
    for (const txn of rows) {
      await this.prisma.$transaction((tx) =>
        this.issueInvoice(tx, {
          userId,
          walletTransactionId: txn.id,
          ronBani: txn.ronBani ?? txn.amountMinor,
          eurCents: txn.eurCents,
          fxRate: txn.fxRate,
          credits: minorToCredits(txn.amountMinor),
        }),
      );
      issued++;
    }
    return { issued };
  }

  // --- admin: browse + void ------------------------------------------

  /** All invoices platform-wide, paginated — the admin `/admin/invoices` page. */
  async adminList(query: {
    search?: string;
    status?: 'issued' | 'void';
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();

    const where: Prisma.InvoiceWhereInput = {
      ...(query.status === 'void' ? { voidedAt: { not: null } } : {}),
      ...(query.status === 'issued' ? { voidedAt: null } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { buyerName: { contains: search, mode: 'insensitive' } },
              { buyerEmail: { contains: search, mode: 'insensitive' } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items: rows, page, pageSize, total };
  }

  async adminGetInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!invoice) throw new NotFoundException('invoice_not_found');
    return invoice;
  }

  async voidInvoice(id: string, reason: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('invoice_not_found');
    if (invoice.voidedAt) return this.adminGetInvoice(id);
    await this.prisma.invoice.update({
      where: { id },
      data: { voidedAt: new Date(), voidReason: reason.trim().slice(0, 300) },
    });
    return this.adminGetInvoice(id);
  }

  async unvoidInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('invoice_not_found');
    await this.prisma.invoice.update({
      where: { id },
      data: { voidedAt: null, voidReason: null },
    });
    return this.adminGetInvoice(id);
  }
}
