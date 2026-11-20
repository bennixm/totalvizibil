import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsApiClient } from './google-ads-api-client.service';

/** Fields of a GoogleAdsSubcategoryCampaign row stored as ISO strings in the archive. */
const DATE_FIELDS = ['lastStructuralCheckAt', 'lastIntelligenceRunAt', 'createdAt'] as const;

export interface AccountScopeResult {
  archived: number;
  restored: number;
}

/**
 * Keeps the agent's subcategory → campaign mappings in step with the Google
 * Ads account it is CURRENTLY connected to. The account can be switched from
 * /admin/google-ads-agent (e.g. to a test account and back); the mappings
 * live in our DB, so without this the agent would keep "seeing" the old
 * account's campaigns and never create any in the new one.
 *
 * On every check:
 *  - mappings whose campaign does not exist (or is REMOVED) in the current
 *    account are moved to GoogleAdsSubcategoryCampaignArchive, so the
 *    structural pass creates fresh campaigns for them here;
 *  - archived mappings whose campaign DOES exist in the current account (the
 *    old account is back) are restored, so nothing is ever duplicated.
 *
 * Fails closed: if the account's campaign list cannot be read, nothing is
 * touched. Mappings that never got a Google campaign (`googleCampaignId`
 * null) are left alone.
 */
@Injectable()
export class GoogleAdsAccountScopeService {
  private readonly logger = new Logger(GoogleAdsAccountScopeService.name);
  /** Customer id the mappings were last reconciled against (this process). */
  private scopedFor: string | null = null;

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Reconciles if the account changed since the last check in this process
   * (or always, with `force`). Never throws: a failure only logs, and the
   * caller's pass goes on as before.
   */
  async ensure(opts: { force?: boolean } = {}): Promise<AccountScopeResult | null> {
    if (!this.client.configured) return null;
    const customerId = this.client.customerId;
    if (!customerId) return null;
    if (!opts.force && this.scopedFor === customerId) return null;
    try {
      const result = await this.reconcile(customerId);
      this.scopedFor = customerId;
      return result;
    } catch (err) {
      this.logger.warn(
        `Could not check the agent's campaigns against account ${customerId}; mappings left unchanged.`,
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  private async reconcile(customerId: string): Promise<AccountScopeResult> {
    const rows = await this.client.search(
      "SELECT campaign.id FROM campaign WHERE campaign.status != 'REMOVED'",
    );
    const inAccount = new Set(
      rows
        .map((r) => String((r as { campaign?: { id?: string | number } }).campaign?.id ?? ''))
        .filter(Boolean),
    );

    const mappings = await this.prisma.googleAdsSubcategoryCampaign.findMany({
      where: { googleCampaignId: { not: null } },
    });
    const foreign = mappings.filter((m) => !inAccount.has(m.googleCampaignId!));

    let archived = 0;
    for (const m of foreign) {
      await this.prisma.$transaction([
        this.prisma.googleAdsSubcategoryCampaignArchive.upsert({
          where: { googleCampaignId: m.googleCampaignId! },
          create: {
            categoryId: m.categoryId,
            googleCampaignId: m.googleCampaignId!,
            archivedOnCustomerId: customerId,
            data: m as unknown as Prisma.InputJsonValue,
          },
          update: { archivedOnCustomerId: customerId, data: m as unknown as Prisma.InputJsonValue },
        }),
        this.prisma.googleAdsSubcategoryCampaign.delete({ where: { id: m.id } }),
      ]);
      archived++;
    }

    let restored = 0;
    const candidates = await this.prisma.googleAdsSubcategoryCampaignArchive.findMany({
      where: { googleCampaignId: { in: [...inAccount] } },
      orderBy: { archivedAt: 'desc' },
    });
    for (const a of candidates) {
      const taken = await this.prisma.googleAdsSubcategoryCampaign.findUnique({
        where: { categoryId: a.categoryId },
      });
      // The subcategory already has a campaign in this account (created
      // while the archived one was away): keep the live one, keep the
      // archive row too so nothing is lost.
      if (taken) continue;
      const category = await this.prisma.category.findUnique({ where: { id: a.categoryId } });
      if (!category) {
        await this.prisma.googleAdsSubcategoryCampaignArchive.delete({ where: { id: a.id } });
        continue;
      }
      await this.prisma.$transaction([
        this.prisma.googleAdsSubcategoryCampaign.create({ data: this.rowFromArchive(a.data) }),
        this.prisma.googleAdsSubcategoryCampaignArchive.delete({ where: { id: a.id } }),
      ]);
      restored++;
    }

    if (archived || restored) {
      this.logger.log(
        `Account ${customerId}: ${archived} mapping(s) archived (campaign not in this account), ` +
          `${restored} restored (campaign found again).`,
      );
    }
    return { archived, restored };
  }

  private rowFromArchive(
    data: Prisma.JsonValue,
  ): Prisma.GoogleAdsSubcategoryCampaignUncheckedCreateInput {
    const d = { ...(data as Record<string, unknown>) };
    delete d.updatedAt;
    for (const f of DATE_FIELDS) {
      if (typeof d[f] === 'string') d[f] = new Date(d[f] as string);
    }
    return d as unknown as Prisma.GoogleAdsSubcategoryCampaignUncheckedCreateInput;
  }
}
