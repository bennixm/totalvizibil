import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { CustomDomain } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { creditsToMinor, minorToCredits, money } from '../wallet/money';
import { DomainRegistrarProvider, StubDomainRegistrarProvider } from './domain-registrar';

/**
 * Custom domain purchase — availability check, then a single wallet charge
 * (platform fee + the registrar's own price) that registers the domain and
 * attaches it to the company. The site keeps serving on the platform's own
 * subdomain either way; a purchased domain is additive, not a replacement.
 *
 * `registrar` is a dev stub until a real provider account + API key is
 * configured (see domain-registrar.ts) — purchases "succeed" but no DNS is
 * actually touched, which is why a fresh purchase is recorded `pending`
 * rather than `active`.
 */
@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);
  private readonly registrar: DomainRegistrarProvider = new StubDomainRegistrarProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertOwner(companyId: string, userId: string): Promise<void> {
    const ownerId = await this.wallet.ownerIdForCompany(companyId);
    if (ownerId !== userId) throw new ForbiddenException('not_your_company');
  }

  private toView(row: CustomDomain) {
    return {
      id: row.id,
      domain: row.domain,
      status: row.status,
      feeCredits: money(row.feeCreditsMinor),
      domainPriceCredits: money(row.domainPriceCreditsMinor),
      registrarProvider: row.registrarProvider,
      dnsConfigured: !!row.dnsConfiguredAt,
      createdAt: row.createdAt,
    };
  }

  async checkAvailability(userId: string, companyId: string, domainRaw: string) {
    await this.assertOwner(companyId, userId);
    const domain = domainRaw.trim().toLowerCase();
    const [avail, feeCredits, existing] = await Promise.all([
      this.registrar.checkAvailability(domain),
      this.settings.domainPurchaseFeeCredits(),
      this.prisma.customDomain.findUnique({ where: { domain }, select: { id: true } }),
    ]);
    const feeCreditsMinor = creditsToMinor(feeCredits);
    const available = avail.available && !existing;
    return {
      domain: avail.domain,
      available,
      domainPrice: money(avail.priceCreditsMinor),
      platformFee: money(feeCreditsMinor),
      total: money(avail.priceCreditsMinor + feeCreditsMinor),
      registrarConfigured: this.registrar.configured,
    };
  }

  async purchase(userId: string, companyId: string, domainRaw: string) {
    await this.assertOwner(companyId, userId);
    const domain = domainRaw.trim().toLowerCase();

    const existing = await this.prisma.customDomain.findUnique({ where: { domain } });
    if (existing) throw new BadRequestException('domain_already_registered');

    const [avail, feeCredits] = await Promise.all([
      this.registrar.checkAvailability(domain),
      this.settings.domainPurchaseFeeCredits(),
    ]);
    if (!avail.available) throw new BadRequestException('domain_not_available');
    const feeCreditsMinor = creditsToMinor(feeCredits);
    const totalMinor = avail.priceCreditsMinor + feeCreditsMinor;

    // Charge first — the registrar call below can't realistically fail
    // against the dev stub, but a real provider integration must refund this
    // charge if its purchase call comes back an error instead of recording
    // the row below.
    await this.wallet.spend(userId, totalMinor, {
      description: `Custom domain: ${domain}`,
      companyId,
    });

    const result = await this.registrar.purchase(domain);

    const row = await this.prisma.customDomain.create({
      data: {
        companyId,
        domain,
        // Not `active` — the stub never actually configures DNS. Flips to
        // `active` once a real registrar integration confirms it did.
        status: 'pending',
        feeCreditsMinor,
        domainPriceCreditsMinor: avail.priceCreditsMinor,
        registrarProvider: this.registrar.name,
        registrarRef: result.ref,
      },
    });

    // Already committed (the charge + the row) — a notification hiccup must
    // never mask that. There's no "activated"/"failed" event to notify on
    // yet: the registrar is a dev stub (see this class's doc comment) that
    // never really configures DNS, so this purchase receipt is the only
    // confirmation a real integration would need to add a second one
    // alongside, once that lands.
    void this.notifications
      .notify({
        userId,
        type: 'domain_purchased',
        title: `Domeniul ${domain} a fost achiziționat`,
        body: `Achiziția pentru ${domain} a fost înregistrată și este în curs de configurare.`,
        channels: { panel: true, email: true },
        data: { companyId },
        email: {
          greet: true,
          text: `Achiziția domeniului ${domain} a fost înregistrată. Configurarea DNS este în curs — te anunțăm aici de îndată ce domeniul devine activ.`,
          details: [
            { label: 'Domeniu', value: domain },
            { label: 'Preț domeniu', value: `${minorToCredits(avail.priceCreditsMinor)} credite` },
            { label: 'Taxă platformă', value: `${minorToCredits(feeCreditsMinor)} credite` },
            { label: 'Total plătit', value: `${minorToCredits(totalMinor)} credite` },
          ],
        },
      })
      .catch((err) =>
        this.logger.error(
          'Domain-purchase notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return this.toView(row);
  }

  async listForCompany(userId: string, companyId: string) {
    await this.assertOwner(companyId, userId);
    const rows = await this.prisma.customDomain.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }
}
