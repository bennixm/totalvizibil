import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignStatus, CompanyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { creditsToMinor, money } from '../wallet/money';
import { CampaignTier, suggestCampaign } from './campaign-advisor';
import { isLikelyBot, utcDay, visitorFingerprint } from './ad-click';
import { SaveCampaignDto } from './dto/save-campaign.dto';

const CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager, CompanyRole.billing];

/** Midnight UTC of the given day — matches the `spend_day` DATE column. */
function startOfUtcDay(now = new Date()): Date {
  return new Date(`${utcDay(now)}T00:00:00.000Z`);
}

export type ClickResult = { billed: boolean; reason?: string };

@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  // --- membership -------------------------------------------------------

  private async memberRole(companyId: string, userId: string): Promise<CompanyRole> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') throw new NotFoundException('Company not found');
    return member.role;
  }

  private async assertCanEdit(companyId: string, userId: string): Promise<void> {
    const role = await this.memberRole(companyId, userId);
    if (!CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot manage the campaign');
    }
  }

  /** The company owner whose single wallet funds this campaign. */
  private async walletOwner(companyId: string): Promise<string> {
    return this.wallet.ownerIdForCompany(companyId);
  }

  // --- lifecycle -------------------------------------------------------

  /**
   * Flip campaign + company + website together. `active` publishes the company
   * into the feed; any other status pulls it back out. (There is no "sponsored"
   * tier — a funded, active campaign simply appears; an unfunded one does not.)
   */
  private async setLive(companyId: string, campaign: Campaign, status: CampaignStatus) {
    const live = status === CampaignStatus.active;
    const [updated] = await this.prisma.$transaction([
      this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status,
          activatedAt: live ? (campaign.activatedAt ?? new Date()) : campaign.activatedAt,
          pausedAt: live ? null : new Date(),
        },
      }),
      this.prisma.company.update({
        where: { id: companyId },
        data: {
          status: live ? 'active' : 'draft',
          featured: live,
          claimedAt: live ? new Date() : undefined,
        },
      }),
      this.prisma.website.updateMany({
        where: { companyId },
        data: { status: live ? 'published' : 'unpublished' },
      }),
    ]);
    return updated;
  }

  /** Pull a campaign out of the feed mid-serve (budget hit / wallet empty). */
  private async setDepletedWithin(
    tx: Prisma.TransactionClient,
    companyId: string,
    campaign: Campaign,
  ): Promise<void> {
    if (campaign.status === CampaignStatus.depleted) return;
    await tx.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.depleted, pausedAt: new Date() },
    });
    await tx.company.update({
      where: { id: companyId },
      data: { status: 'draft', featured: false },
    });
    await tx.website.updateMany({ where: { companyId }, data: { status: 'unpublished' } });
  }

  /**
   * Reconcile the campaign against the wallet balance + today's spend: an
   * `active` campaign that the wallet can no longer fund, or that has spent its
   * daily budget, becomes `depleted` (and leaves the feed); a `depleted`
   * campaign that is funded again and under budget auto-revives. `spentTodayMinor`
   * resets lazily when the UTC day rolls over.
   */
  private async reconcile(companyId: string): Promise<Campaign | null> {
    const campaign = await this.prisma.campaign.findUnique({ where: { companyId } });
    if (!campaign) return null;
    const owner = await this.walletOwner(companyId);
    const funded = await this.wallet.canAfford(owner, campaign.dailyBudgetMinor);

    const today = startOfUtcDay();
    const dayRolled =
      !campaign.spendDay || campaign.spendDay.getTime() !== today.getTime();
    const spentToday = dayRolled ? 0 : campaign.spentTodayMinor;
    if (dayRolled && campaign.spentTodayMinor !== 0) {
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: { spentTodayMinor: 0, spendDay: today },
      });
    }
    const budgetLeft = campaign.dailyBudgetMinor - spentToday >= campaign.cpcMinor;

    if (campaign.status === CampaignStatus.active && (!funded || !budgetLeft)) {
      const d = await this.setLive(companyId, campaign, CampaignStatus.depleted);
      return { ...d, spentTodayMinor: spentToday };
    }
    if (campaign.status === CampaignStatus.depleted && funded && budgetLeft) {
      const d = await this.setLive(companyId, campaign, CampaignStatus.active);
      return { ...d, spentTodayMinor: spentToday };
    }
    return { ...campaign, spentTodayMinor: spentToday };
  }

  /**
   * A visitor accessed the listing. Bills one `cpcMinor` from the owner's wallet
   * — at most once per (visitor, listing, UTC day) — while the campaign is
   * `active`. Everything is one transaction: the click row, the wallet debit and
   * the daily counter move together. Obvious bots and repeat visitors are
   * recorded but never charged; hitting the daily budget or an empty wallet
   * depletes the campaign (out of the feed) until it recovers.
   */
  async registerClick(
    companyId: string,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<ClickResult> {
    const day = utcDay();
    const visitorHash = visitorFingerprint(ip, userAgent, companyId, day);

    return this.prisma.$transaction(async (tx): Promise<ClickResult> => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { ownerUserId: true },
      });
      if (!company) return { billed: false, reason: 'no_campaign' };

      // First touch this day → create the row; a repeat collides on the unique
      // (company, visitor_hash) and is silently free.
      let clickId: string;
      try {
        const row = await tx.adClick.create({ data: { companyId, visitorHash } });
        clickId = row.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { billed: false, reason: 'repeat' };
        }
        throw e;
      }

      const free = async (reason: string): Promise<ClickResult> => {
        await tx.adClick.update({ where: { id: clickId }, data: { reason } });
        return { billed: false, reason };
      };

      if (isLikelyBot(userAgent)) return free('bot');

      const campaign = await tx.campaign.findUnique({ where: { companyId } });
      if (!campaign || campaign.status !== CampaignStatus.active) {
        return free('no_campaign');
      }

      const today = startOfUtcDay();
      const dayRolled =
        !campaign.spendDay || campaign.spendDay.getTime() !== today.getTime();
      const spentToday = dayRolled ? 0 : campaign.spentTodayMinor;

      if (spentToday + campaign.cpcMinor > campaign.dailyBudgetMinor) {
        await this.setDepletedWithin(tx, companyId, campaign);
        return free('budget');
      }

      const paid = await this.wallet.chargeClickWithin(
        tx,
        company.ownerUserId,
        campaign.cpcMinor,
        companyId,
        today,
      );
      if (!paid) {
        await this.setDepletedWithin(tx, companyId, campaign);
        return free('insufficient');
      }

      const newSpent = spentToday + campaign.cpcMinor;
      await tx.campaign.update({
        where: { id: campaign.id },
        data: { spentTodayMinor: newSpent, spendDay: today },
      });
      await tx.adClick.update({
        where: { id: clickId },
        data: { billed: true, costMinor: campaign.cpcMinor },
      });

      // This click may have used up the budget or the wallet — drop out now.
      if (
        newSpent + campaign.cpcMinor > campaign.dailyBudgetMinor ||
        paid.balanceMinor < campaign.cpcMinor
      ) {
        await this.setDepletedWithin(tx, companyId, campaign);
      }
      return { billed: true };
    });
  }

  /** Lifetime billed-click count for a listing. */
  private clickCount(companyId: string): Promise<number> {
    return this.prisma.adClick.count({ where: { companyId, billed: true } });
  }

  // --- API -----------------------------------------------------------

  async get(userId: string, companyId: string) {
    await this.memberRole(companyId, userId);
    const campaign = await this.reconcile(companyId);
    const owner = await this.walletOwner(companyId);

    const [walletSummary, location, consumedMinor, clicks] = await Promise.all([
      this.wallet.getSummary(owner),
      this.prisma.companyLocation.findFirst({
        where: { companyId, isPrimary: true },
        select: { serviceRadiusKm: true },
      }),
      this.wallet.consumedByCompany(companyId),
      this.clickCount(companyId),
    ]);

    const s = suggestCampaign({ radiusKm: location?.serviceRadiusKm ?? null });
    const neededMinor = campaign?.dailyBudgetMinor ?? s.standard.dailyBudgetMinor;

    return {
      campaign: campaign
        ? { ...this.view(campaign), consumed: money(consumedMinor), clicks }
        : null,
      suggestions: {
        standard: this.tierView(s.standard),
        appearFirst: this.tierView(s.appearFirst),
      },
      // The wallet is shared across every business the user owns.
      wallet: { balance: walletSummary.balance },
      consumed: money(consumedMinor),
      required: money(neededMinor),
      canActivate: !!campaign && walletSummary.balance.minor >= campaign.dailyBudgetMinor,
      runnable: campaign?.status === CampaignStatus.active,
    };
  }

  async save(userId: string, companyId: string, dto: SaveCampaignDto) {
    await this.assertCanEdit(companyId, userId);

    const dailyBudgetMinor = creditsToMinor(dto.dailyBudget);
    const cpcMinor = creditsToMinor(dto.cpc);
    if (cpcMinor < 1) throw new BadRequestException('cpc must be at least 0.01 credits');
    if (cpcMinor > dailyBudgetMinor) {
      throw new BadRequestException('cpc cannot exceed the daily budget');
    }

    const existing = await this.prisma.campaign.findUnique({ where: { companyId } });
    const saved = await this.prisma.campaign.upsert({
      where: { companyId },
      create: {
        companyId,
        dailyBudgetMinor,
        cpcMinor,
        appearFirst: dto.appearFirst ?? false,
        status: CampaignStatus.draft,
      },
      update: {
        dailyBudgetMinor,
        cpcMinor,
        appearFirst: dto.appearFirst ?? existing?.appearFirst ?? false,
      },
    });

    // Any edit to an already-configured campaign takes it out of the feed until
    // the owner explicitly re-activates it with the new numbers.
    if (existing && existing.status !== CampaignStatus.draft) {
      await this.setLive(companyId, saved, CampaignStatus.paused);
    }

    return this.get(userId, companyId);
  }

  async activate(userId: string, companyId: string) {
    await this.assertCanEdit(companyId, userId);

    const [campaign, company] = await Promise.all([
      this.prisma.campaign.findUnique({ where: { companyId } }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { status: true } }),
    ]);
    if (!campaign) throw new BadRequestException('set_budget_first');
    if (company?.status === 'suspended') throw new ForbiddenException('Company is suspended');
    const owner = await this.walletOwner(companyId);
    if (!(await this.wallet.canAfford(owner, campaign.dailyBudgetMinor))) {
      throw new BadRequestException('insufficient_credits');
    }

    await this.setLive(companyId, campaign, CampaignStatus.active);
    return this.get(userId, companyId);
  }

  async pause(userId: string, companyId: string) {
    await this.assertCanEdit(companyId, userId);
    const campaign = await this.prisma.campaign.findUnique({ where: { companyId } });
    if (!campaign) throw new NotFoundException('No campaign');
    if (campaign.status === CampaignStatus.active || campaign.status === CampaignStatus.depleted) {
      await this.setLive(companyId, campaign, CampaignStatus.paused);
    }
    return this.get(userId, companyId);
  }

  /** Dashboard summary — caller has already checked membership. */
  async summaryFor(companyId: string) {
    const campaign = await this.reconcile(companyId);
    if (!campaign) return null;
    const [consumedMinor, clicks] = await Promise.all([
      this.wallet.consumedByCompany(companyId),
      this.clickCount(companyId),
    ]);
    return { ...this.view(campaign), consumed: money(consumedMinor), clicks };
  }

  // --- views --------------------------------------------------------

  private view(c: Campaign) {
    return {
      status: c.status,
      dailyBudget: money(c.dailyBudgetMinor),
      cpc: money(c.cpcMinor),
      appearFirst: c.appearFirst,
      spentToday: money(c.spentTodayMinor),
      activatedAt: c.activatedAt,
    };
  }

  private tierView(t: CampaignTier) {
    return { cpc: money(t.cpcMinor), dailyBudget: money(t.dailyBudgetMinor) };
  }
}
