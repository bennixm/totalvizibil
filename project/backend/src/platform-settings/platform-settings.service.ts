import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditActor, AuditLogService } from '../admin/audit-log.service';
import { AppConfig } from '../config/env';

export const SETTING_KEYS = {
  eurRonRate: 'eur_ron_rate',
  advancedBuilderPriceCredits: 'advanced_builder_price_credits',
  advancedBuilderUnlockBonusCredits: 'advanced_builder_unlock_bonus_credits',
  additionalBusinessPriceCredits: 'additional_business_price_credits',
  invoiceVatRatePct: 'invoice_vat_rate_pct',
  invoiceIssuerName: 'invoice_issuer_name',
  invoiceIssuerTaxId: 'invoice_issuer_tax_id',
  invoiceIssuerRegCom: 'invoice_issuer_reg_com',
  invoiceIssuerAddress: 'invoice_issuer_address',
  invoiceIssuerIban: 'invoice_issuer_iban',
  invoiceIssuerBank: 'invoice_issuer_bank',
  affiliateEnabled: 'affiliate_enabled',
  affiliateRewardCredits: 'affiliate_reward_credits',
  affiliateMinDepositCredits: 'affiliate_min_deposit_credits',
  refundFeePct: 'refund_fee_pct',
  creditsDiscountEnabled: 'credits_discount_enabled',
  creditsDiscountPct: 'credits_discount_pct',
  feedCostPromovareCredits: 'feed_cost_promovare_credits',
  feedMarjaProfitCredits: 'feed_marja_profit_credits',
  feedMarjaPozitionareCredits: 'feed_marja_pozitionare_credits',
  domainPurchaseFeeCredits: 'domain_purchase_fee_credits',
  googleAdsAvgCpcData: 'google_ads_avg_cpc_data',
  googleAdsCpcBufferPct: 'google_ads_cpc_buffer_pct',
  googleAdsMaxCpcCredits: 'google_ads_max_cpc_credits',
  googleAdsAgentEnabled: 'google_ads_agent_enabled',
  googleAdsAgentDefaultDailyBudgetCredits: 'google_ads_agent_default_daily_budget_credits',
  googleAdsAgentDefaultMaxCpcCredits: 'google_ads_agent_default_max_cpc_credits',
  googleAdsAgentMaxDailyBudgetCapCredits: 'google_ads_agent_max_daily_budget_cap_credits',
  googleAdsAgentMaxCpcCapCredits: 'google_ads_agent_max_cpc_cap_credits',
  googleAdsCustomerId: 'google_ads_customer_id',
  googleAdsLoginCustomerId: 'google_ads_login_customer_id',
  googleAdsCampaignId: 'google_ads_campaign_id',
  googleAdsServiceAccountKeyBase64: 'google_ads_service_account_key_base64',
  googleAdsAgentStructuralIntervalMinutes: 'google_ads_agent_structural_interval_minutes',
  googleAdsAgentContentIntervalMinutes: 'google_ads_agent_content_interval_minutes',
  googleAdsAgentIntelligenceIntervalMinutes: 'google_ads_agent_intelligence_interval_minutes',
} as const;

/** Fallback EUR->RON rate when the setting row is absent. Kept sane, not exact. */
const DEFAULT_EUR_RON = 5.05;
const MIN_EUR_RON = 1;
const MAX_EUR_RON = 50;

/** Fallback price (credits) for the one-time advanced website builder unlock. */
const DEFAULT_ADVANCED_PRICE = 49;
/** Fallback price (credits) for creating an additional business beyond the first. */
const DEFAULT_ADDITIONAL_BUSINESS_PRICE = 20;
/** Fallback platform fee (credits) charged on top of the registrar's own
 *  price when a business buys a custom domain. */
const DEFAULT_DOMAIN_PURCHASE_FEE = 15;
const MIN_PRICE = 1;
const MAX_PRICE = 100_000;

/** Credits granted to the owner's wallet once, right after they unlock the
 *  Website Builder — a starting balance so they can actually use the AI
 *  builder they just paid for. 0 = no bonus (unlike a price, this is
 *  allowed to be zero). */
const DEFAULT_UNLOCK_BONUS_CREDITS = 10;
const MIN_UNLOCK_BONUS_CREDITS = 0;
const MAX_UNLOCK_BONUS_CREDITS = 100_000;

/** VAT rate applied to invoices, as a whole percent (0 = "neplătitor de TVA"). */
const DEFAULT_VAT_RATE_PCT = 0;
const MIN_VAT_RATE_PCT = 0;
const MAX_VAT_RATE_PCT = 30;

/** Affiliate program: off by default; reward (credits) per qualified referral. */
const DEFAULT_AFFILIATE_REWARD = 20;
const MIN_AFFILIATE_REWARD = 1;
const MAX_AFFILIATE_REWARD = 10_000;

/**
 * Minimum total credits a referred user must deposit before the reward is paid
 * to their referrer. 0 = no deposit threshold (any funded campaign qualifies).
 */
const DEFAULT_AFFILIATE_MIN_DEPOSIT = 50;
const MIN_AFFILIATE_MIN_DEPOSIT = 0;
const MAX_AFFILIATE_MIN_DEPOSIT = 100_000;

/** Processing fee withheld from a wallet-purchase refund, as a whole percent. */
const DEFAULT_REFUND_FEE_PCT = 5;
const MIN_REFUND_FEE_PCT = 0;
const MAX_REFUND_FEE_PCT = 100;

/** Site-wide discount on credit purchases: off by default, whole percent off. */
const DEFAULT_DISCOUNT_PCT = 10;
const MIN_DISCOUNT_PCT = 1;
const MAX_DISCOUNT_PCT = 90;

/**
 * Feed CPC-local pricing (credits, may be fractional — stored with 2-decimal
 * precision, the same granularity as minor units). `costPromovare` is the one
 * value meant to eventually come from an external cost API instead of this
 * static setting — swapping that in only means rewriting
 * `feedCostPromovareCredits()` below, every caller stays the same.
 */
const DEFAULT_FEED_COST_PROMOVARE_CREDITS = 1;
const DEFAULT_FEED_MARJA_PROFIT_CREDITS = 0.1;
const DEFAULT_FEED_MARJA_POZITIONARE_CREDITS = 0.1;
const MIN_FEED_COST_PROMOVARE_CREDITS = 0.01;
const MAX_FEED_COST_PROMOVARE_CREDITS = 1000;
const MIN_FEED_MARGIN_CREDITS = 0;
const MAX_FEED_MARGIN_CREDITS = 1000;

/**
 * Google Ads rolling-average CPC — safety parameters around the dynamic
 * `costPromovare` used for Google-Ads-attributed clicks (see
 * GoogleAdsCpcSyncService / AnalyticsService.marginConfig). The average
 * itself is never admin-edited (it's machine-written, every sync cycle);
 * these two ARE admin-edited, because they're judgment calls, not data:
 * `bufferPct` pads the average to absorb the gap between syncs, and
 * `maxCpcCredits` is the ceiling used whenever the cached average is
 * missing or stale (should mirror the real Max CPC bid set in Google Ads —
 * Google itself never charges more than that bid, so using it as a
 * fallback can never cause a loss).
 */
const DEFAULT_GOOGLE_ADS_CPC_BUFFER_PCT = 25;
const MIN_GOOGLE_ADS_CPC_BUFFER_PCT = 0;
const MAX_GOOGLE_ADS_CPC_BUFFER_PCT = 200;
const DEFAULT_GOOGLE_ADS_MAX_CPC_CREDITS = 2;
const MIN_GOOGLE_ADS_MAX_CPC_CREDITS = 0.01;
const MAX_GOOGLE_ADS_MAX_CPC_CREDITS = 1000;
/** Older than this, the cached average is treated as stale and the fallback
 *  ceiling is used instead — keeps a dead/misconfigured sync job from
 *  quietly pricing clicks off a number from hours or days ago. */
export const GOOGLE_ADS_CPC_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Google Ads agent (per-subcategory campaigns, docs/ai/GOOGLE-ADS-AGENT-PLAN.md).
 * Off by default — staff must explicitly flip this on from the admin panel
 * once they've reviewed the defaults below, so the agent never starts
 * creating/mutating real campaigns on its own in a freshly-deployed env.
 */
const DEFAULT_GOOGLE_ADS_AGENT_DAILY_BUDGET_CREDITS = 5;
const MIN_GOOGLE_ADS_AGENT_DAILY_BUDGET_CREDITS = 0.5;
const MAX_GOOGLE_ADS_AGENT_DAILY_BUDGET_CREDITS = 10_000;
const DEFAULT_GOOGLE_ADS_AGENT_MAX_CPC_CREDITS = 1;
const MIN_GOOGLE_ADS_AGENT_MAX_CPC_CREDITS = 0.01;
const MAX_GOOGLE_ADS_AGENT_MAX_CPC_CREDITS = 1000;
/** Hard ceilings the daily budget-intelligence pass (Faza 3) can never
 *  propose past, no matter what Claude returns — enforced server-side,
 *  not just asked of the model. */
const DEFAULT_GOOGLE_ADS_AGENT_MAX_DAILY_BUDGET_CAP_CREDITS = 50;
const MIN_GOOGLE_ADS_AGENT_MAX_DAILY_BUDGET_CAP_CREDITS = 0.5;
const MAX_GOOGLE_ADS_AGENT_MAX_DAILY_BUDGET_CAP_CREDITS = 100_000;
const DEFAULT_GOOGLE_ADS_AGENT_MAX_CPC_CAP_CREDITS = 5;
const MIN_GOOGLE_ADS_AGENT_MAX_CPC_CAP_CREDITS = 0.01;
const MAX_GOOGLE_ADS_AGENT_MAX_CPC_CAP_CREDITS = 1000;

/** How often each Google Ads agent pass is allowed to run, in minutes since
 *  its own last run — read live on every poll tick (see the 3
 *  GoogleAdsAgent*Service classes), not baked into a fixed `setInterval`
 *  period, so an admin change here takes effect without a restart. */
const DEFAULT_STRUCTURAL_INTERVAL_MINUTES = 360; // 6h
const DEFAULT_CONTENT_INTERVAL_MINUTES = 360; // 6h
const DEFAULT_INTELLIGENCE_INTERVAL_MINUTES = 1440; // 24h
const MIN_AGENT_INTERVAL_MINUTES = 15;
const MAX_AGENT_INTERVAL_MINUTES = 10_080; // 7 days

export interface GoogleAdsAvgCpc {
  credits: number;
  updatedAt: string;
}

export interface InvoiceIssuer {
  name: string;
  taxId: string;
  regCom: string;
  address: string;
  iban: string;
  bank: string;
}

/**
 * Small key/value config store. Values the platform can change without a deploy
 * (currently just the EUR/RON rate used when charging in lei). Cached in-process
 * for a short TTL — this is read on every wallet view.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger('PlatformSettings');
  private cache = new Map<string, { value: string; at: number }>();
  private readonly ttlMs = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Audit one admin settings PATCH. Called by the controller AFTER it has
   * applied the individual setters, with the full settings payload as it
   * looked before and after.
   *
   * Only the fields that actually CHANGED are recorded. Snapshotting the
   * whole blob would bury a VAT-rate change among 20 untouched values, and
   * these are the settings that re-price the platform for everyone (VAT,
   * refund fee, the live discount, the FX rate, the invoice issuer identity
   * stamped onto every future invoice) — the diff IS the finding. A PATCH
   * that changed nothing writes no row at all.
   */
  async auditUpdate(
    actor: AuditActor,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    for (const key of Object.keys(after)) {
      if (before[key] !== after[key]) {
        changedBefore[key] = before[key] ?? null;
        changedAfter[key] = after[key] ?? null;
      }
    }
    if (!Object.keys(changedAfter).length) return;

    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.roles,
      action: 'settings.update',
      targetType: 'platform_settings',
      targetId: null,
      before: changedBefore,
      after: changedAfter,
    });
  }

  async get(key: string): Promise<string | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (row) this.cache.set(key, { value: row.value, at: Date.now() });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    this.cache.set(key, { value, at: Date.now() });
  }

  /** EUR->RON rate. Falls back to a default if unset or invalid. */
  async eurRonRate(): Promise<number> {
    const raw = await this.get(SETTING_KEYS.eurRonRate);
    const parsed = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < MIN_EUR_RON || parsed > MAX_EUR_RON) {
      if (raw != null) this.logger.warn(`Ignoring invalid ${SETTING_KEYS.eurRonRate}=${raw}`);
      return DEFAULT_EUR_RON;
    }
    return parsed;
  }

  /** Validate + persist a new EUR->RON rate. Returns the stored number. */
  async setEurRonRate(rate: number): Promise<number> {
    if (!Number.isFinite(rate) || rate < MIN_EUR_RON || rate > MAX_EUR_RON) {
      throw new BadRequestException('eur_ron_rate out of range');
    }
    const rounded = Math.round(rate * 10_000) / 10_000;
    await this.set(SETTING_KEYS.eurRonRate, String(rounded));
    return rounded;
  }

  /** Read an integer credit-price setting with a sane fallback. */
  private async priceSetting(key: string, fallback: number): Promise<number> {
    const raw = await this.get(key);
    const parsed = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < MIN_PRICE || parsed > MAX_PRICE) {
      if (raw != null) this.logger.warn(`Ignoring invalid ${key}=${raw}`);
      return fallback;
    }
    return Math.round(parsed);
  }

  private async setPriceSetting(key: string, credits: number): Promise<number> {
    if (!Number.isFinite(credits) || credits < MIN_PRICE || credits > MAX_PRICE) {
      throw new BadRequestException(`${key} out of range`);
    }
    const rounded = Math.round(credits);
    await this.set(key, String(rounded));
    return rounded;
  }

  /** One-time advanced website builder price, in credits. */
  advancedBuilderPriceCredits(): Promise<number> {
    return this.priceSetting(SETTING_KEYS.advancedBuilderPriceCredits, DEFAULT_ADVANCED_PRICE);
  }
  setAdvancedBuilderPriceCredits(credits: number): Promise<number> {
    return this.setPriceSetting(SETTING_KEYS.advancedBuilderPriceCredits, credits);
  }

  /** One-time bonus (credits) granted to the owner right after they unlock
   *  the Website Builder. */
  async advancedBuilderUnlockBonusCredits(): Promise<number> {
    const raw = await this.get(SETTING_KEYS.advancedBuilderUnlockBonusCredits);
    const parsed = raw != null ? Number(raw) : NaN;
    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_UNLOCK_BONUS_CREDITS ||
      parsed > MAX_UNLOCK_BONUS_CREDITS
    ) {
      if (raw != null) {
        this.logger.warn(
          `Ignoring invalid ${SETTING_KEYS.advancedBuilderUnlockBonusCredits}=${raw}`,
        );
      }
      return DEFAULT_UNLOCK_BONUS_CREDITS;
    }
    return Math.round(parsed);
  }
  async setAdvancedBuilderUnlockBonusCredits(credits: number): Promise<number> {
    if (
      !Number.isFinite(credits) ||
      credits < MIN_UNLOCK_BONUS_CREDITS ||
      credits > MAX_UNLOCK_BONUS_CREDITS
    ) {
      throw new BadRequestException('advanced_builder_unlock_bonus_credits out of range');
    }
    const rounded = Math.round(credits);
    await this.set(SETTING_KEYS.advancedBuilderUnlockBonusCredits, String(rounded));
    return rounded;
  }

  /** Price (credits) to create a business beyond the first. */
  additionalBusinessPriceCredits(): Promise<number> {
    return this.priceSetting(
      SETTING_KEYS.additionalBusinessPriceCredits,
      DEFAULT_ADDITIONAL_BUSINESS_PRICE,
    );
  }
  setAdditionalBusinessPriceCredits(credits: number): Promise<number> {
    return this.setPriceSetting(SETTING_KEYS.additionalBusinessPriceCredits, credits);
  }

  /** Platform fee (credits), on top of the registrar's own price, charged
   *  when a business buys a custom domain. */
  domainPurchaseFeeCredits(): Promise<number> {
    return this.priceSetting(SETTING_KEYS.domainPurchaseFeeCredits, DEFAULT_DOMAIN_PURCHASE_FEE);
  }
  setDomainPurchaseFeeCredits(credits: number): Promise<number> {
    return this.setPriceSetting(SETTING_KEYS.domainPurchaseFeeCredits, credits);
  }

  /** VAT rate (whole percent) applied to every invoice issued from now on. */
  async invoiceVatRatePct(): Promise<number> {
    const raw = await this.get(SETTING_KEYS.invoiceVatRatePct);
    const parsed = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < MIN_VAT_RATE_PCT || parsed > MAX_VAT_RATE_PCT) {
      if (raw != null)
        this.logger.warn(`Ignoring invalid ${SETTING_KEYS.invoiceVatRatePct}=${raw}`);
      return DEFAULT_VAT_RATE_PCT;
    }
    return Math.round(parsed);
  }
  async setInvoiceVatRatePct(pct: number): Promise<number> {
    if (!Number.isFinite(pct) || pct < MIN_VAT_RATE_PCT || pct > MAX_VAT_RATE_PCT) {
      throw new BadRequestException('invoice_vat_rate_pct out of range');
    }
    const rounded = Math.round(pct);
    await this.set(SETTING_KEYS.invoiceVatRatePct, String(rounded));
    return rounded;
  }

  // --- affiliate program -------------------------------------------------

  /** Whether the affiliate/referral program is currently running. */
  async affiliateEnabled(): Promise<boolean> {
    return (await this.get(SETTING_KEYS.affiliateEnabled)) === 'true';
  }
  async setAffiliateEnabled(on: boolean): Promise<boolean> {
    await this.set(SETTING_KEYS.affiliateEnabled, on ? 'true' : 'false');
    return on;
  }

  /** Credits awarded to the referrer for each qualified referral. */
  async affiliateRewardCredits(): Promise<number> {
    const raw = await this.get(SETTING_KEYS.affiliateRewardCredits);
    const parsed = raw != null ? Number(raw) : NaN;
    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_AFFILIATE_REWARD ||
      parsed > MAX_AFFILIATE_REWARD
    ) {
      if (raw != null)
        this.logger.warn(`Ignoring invalid ${SETTING_KEYS.affiliateRewardCredits}=${raw}`);
      return DEFAULT_AFFILIATE_REWARD;
    }
    return Math.round(parsed);
  }
  async setAffiliateRewardCredits(credits: number): Promise<number> {
    if (
      !Number.isFinite(credits) ||
      credits < MIN_AFFILIATE_REWARD ||
      credits > MAX_AFFILIATE_REWARD
    ) {
      throw new BadRequestException('affiliate_reward_credits out of range');
    }
    const rounded = Math.round(credits);
    await this.set(SETTING_KEYS.affiliateRewardCredits, String(rounded));
    return rounded;
  }

  /** Minimum total deposit (credits) a referred user must reach to trigger the reward. */
  async affiliateMinDepositCredits(): Promise<number> {
    const raw = await this.get(SETTING_KEYS.affiliateMinDepositCredits);
    const parsed = raw != null ? Number(raw) : NaN;
    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_AFFILIATE_MIN_DEPOSIT ||
      parsed > MAX_AFFILIATE_MIN_DEPOSIT
    ) {
      if (raw != null)
        this.logger.warn(`Ignoring invalid ${SETTING_KEYS.affiliateMinDepositCredits}=${raw}`);
      return DEFAULT_AFFILIATE_MIN_DEPOSIT;
    }
    return Math.round(parsed);
  }
  async setAffiliateMinDepositCredits(credits: number): Promise<number> {
    if (
      !Number.isFinite(credits) ||
      credits < MIN_AFFILIATE_MIN_DEPOSIT ||
      credits > MAX_AFFILIATE_MIN_DEPOSIT
    ) {
      throw new BadRequestException('affiliate_min_deposit_credits out of range');
    }
    const rounded = Math.round(credits);
    await this.set(SETTING_KEYS.affiliateMinDepositCredits, String(rounded));
    return rounded;
  }

  // --- refunds -------------------------------------------------------

  /** Processing fee withheld from a wallet-purchase refund (whole percent). */
  async refundFeePct(): Promise<number> {
    const raw = await this.get(SETTING_KEYS.refundFeePct);
    const parsed = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < MIN_REFUND_FEE_PCT || parsed > MAX_REFUND_FEE_PCT) {
      if (raw != null) this.logger.warn(`Ignoring invalid ${SETTING_KEYS.refundFeePct}=${raw}`);
      return DEFAULT_REFUND_FEE_PCT;
    }
    return Math.round(parsed);
  }
  async setRefundFeePct(pct: number): Promise<number> {
    if (!Number.isFinite(pct) || pct < MIN_REFUND_FEE_PCT || pct > MAX_REFUND_FEE_PCT) {
      throw new BadRequestException('refund_fee_pct out of range');
    }
    const rounded = Math.round(pct);
    await this.set(SETTING_KEYS.refundFeePct, String(rounded));
    return rounded;
  }

  // --- credits discount ------------------------------------------------

  /** Whether a site-wide discount on credit purchases is currently running. */
  async creditsDiscountEnabled(): Promise<boolean> {
    return (await this.get(SETTING_KEYS.creditsDiscountEnabled)) === 'true';
  }

  /** Discount percent off credit purchases, whole percent. Only meaningful
   *  while `creditsDiscountEnabled()` is true. */
  async creditsDiscountPct(): Promise<number> {
    const raw = await this.get(SETTING_KEYS.creditsDiscountPct);
    const parsed = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < MIN_DISCOUNT_PCT || parsed > MAX_DISCOUNT_PCT) {
      if (raw != null)
        this.logger.warn(`Ignoring invalid ${SETTING_KEYS.creditsDiscountPct}=${raw}`);
      return DEFAULT_DISCOUNT_PCT;
    }
    return Math.round(parsed);
  }

  /**
   * Applies both fields atomically (an admin form submits them together) and
   * fires exactly one `notifyAll` broadcast when the effective, user-visible
   * state actually changes — not on every save of an unchanged value.
   */
  async setCreditsDiscount(input: {
    enabled?: boolean;
    pct?: number;
  }): Promise<{ enabled: boolean; pct: number }> {
    const before = {
      enabled: await this.creditsDiscountEnabled(),
      pct: await this.creditsDiscountPct(),
    };

    if (input.pct !== undefined) {
      if (
        !Number.isFinite(input.pct) ||
        input.pct < MIN_DISCOUNT_PCT ||
        input.pct > MAX_DISCOUNT_PCT
      ) {
        throw new BadRequestException('credits_discount_pct out of range');
      }
      await this.set(SETTING_KEYS.creditsDiscountPct, String(Math.round(input.pct)));
    }
    if (input.enabled !== undefined) {
      await this.set(SETTING_KEYS.creditsDiscountEnabled, input.enabled ? 'true' : 'false');
    }

    const after = {
      enabled: await this.creditsDiscountEnabled(),
      pct: await this.creditsDiscountPct(),
    };

    // The setting is already saved by this point — broadcasting to every
    // user is a slow, best-effort side effect (sequential emails, see
    // NotificationsService.notifyAll) that must never block the admin's
    // response nor turn an already-successful settings change into an error.
    const frontendOrigin = this.config.get('frontendOrigin', { infer: true });
    if (after.enabled && (!before.enabled || after.pct !== before.pct)) {
      void this.notifications
        .notifyAll({
          type: 'discount_updated',
          title: `Reducere de ${after.pct}% la achiziția de credite`,
          body: `Cumperi credite cu ${after.pct}% mai ieftin cât timp reducerea este activă.`,
          channels: { panel: true, email: true },
          email: {
            preheader: 'Reducerea se aplică automat în coș.',
            text: `Reducerea de ${after.pct}% se aplică automat la orice achiziție de credite, fără cod. Creditele nu expiră, deci poți cumpăra acum și le folosești când ai nevoie.`,
            cta: { label: 'Cumpără credite', url: `${frontendOrigin}/wallet` },
            footerNote:
              'Primești acest email pentru că ai un cont Totalvizibil. Îți poți gestiona preferințele de notificare din contul tău.',
          },
        })
        .catch((err) =>
          this.logger.error(
            'Discount-updated broadcast failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    } else if (!after.enabled && before.enabled) {
      void this.notifications
        .notifyAll({
          type: 'discount_ended',
          title: 'Reducerea la achiziția de credite s-a încheiat',
          body: 'Reducerea la achiziția de credite nu mai este activă — prețul standard se aplică din nou.',
          channels: { panel: true, email: true },
          email: {
            cta: { label: 'Vezi portofelul', url: `${frontendOrigin}/wallet` },
            footerNote:
              'Primești acest email pentru că ai un cont Totalvizibil. Îți poți gestiona preferințele de notificare din contul tău.',
          },
        })
        .catch((err) =>
          this.logger.error(
            'Discount-updated broadcast failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    }

    return after;
  }

  // --- feed CPC-local pricing -------------------------------------------

  /** Read a fractional-credit setting (2-decimal precision) with a sane fallback. */
  private async decimalCreditSetting(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): Promise<number> {
    const raw = await this.get(key);
    const parsed = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      if (raw != null) this.logger.warn(`Ignoring invalid ${key}=${raw}`);
      return fallback;
    }
    return parsed;
  }
  private async setDecimalCreditSetting(
    key: string,
    credits: number,
    min: number,
    max: number,
  ): Promise<number> {
    if (!Number.isFinite(credits) || credits < min || credits > max) {
      throw new BadRequestException(`${key} out of range`);
    }
    const rounded = Math.round(credits * 100) / 100;
    await this.set(key, String(rounded));
    return rounded;
  }

  /**
   * Cost promovare — the floor cost of one Feed position, in credits. The one
   * value meant to be swapped for a live external cost API later; every
   * caller of this method is unaffected by that future change.
   */
  feedCostPromovareCredits(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.feedCostPromovareCredits,
      DEFAULT_FEED_COST_PROMOVARE_CREDITS,
      MIN_FEED_COST_PROMOVARE_CREDITS,
      MAX_FEED_COST_PROMOVARE_CREDITS,
    );
  }
  setFeedCostPromovareCredits(credits: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.feedCostPromovareCredits,
      credits,
      MIN_FEED_COST_PROMOVARE_CREDITS,
      MAX_FEED_COST_PROMOVARE_CREDITS,
    );
  }

  /** Marjă profit — added on top of `costPromovare` to form CPC minim per Feed. */
  feedMarjaProfitCredits(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.feedMarjaProfitCredits,
      DEFAULT_FEED_MARJA_PROFIT_CREDITS,
      MIN_FEED_MARGIN_CREDITS,
      MAX_FEED_MARGIN_CREDITS,
    );
  }
  setFeedMarjaProfitCredits(credits: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.feedMarjaProfitCredits,
      credits,
      MIN_FEED_MARGIN_CREDITS,
      MAX_FEED_MARGIN_CREDITS,
    );
  }

  /** Marjă poziționare — per-position step in `CPC local = CPC minim + (N-poziție)×marjă`. */
  feedMarjaPozitionareCredits(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.feedMarjaPozitionareCredits,
      DEFAULT_FEED_MARJA_POZITIONARE_CREDITS,
      MIN_FEED_MARGIN_CREDITS,
      MAX_FEED_MARGIN_CREDITS,
    );
  }
  setFeedMarjaPozitionareCredits(credits: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.feedMarjaPozitionareCredits,
      credits,
      MIN_FEED_MARGIN_CREDITS,
      MAX_FEED_MARGIN_CREDITS,
    );
  }

  // --- Google Ads rolling-average CPC -------------------------------------

  /** Current cached average, or `null` if the sync job has never written one
   *  (not configured yet, or hasn't completed a first cycle). Freshness is
   *  the CALLER's job to check against `updatedAt` — this just reads what's
   *  there, stale or not (see `GOOGLE_ADS_CPC_STALE_AFTER_MS`). */
  async googleAdsAvgCpc(): Promise<GoogleAdsAvgCpc | null> {
    const raw = await this.get(SETTING_KEYS.googleAdsAvgCpcData);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as GoogleAdsAvgCpc).credits === 'number' &&
        typeof (parsed as GoogleAdsAvgCpc).updatedAt === 'string'
      ) {
        return parsed as GoogleAdsAvgCpc;
      }
    } catch {
      /* fall through to null below */
    }
    this.logger.warn(`Ignoring malformed ${SETTING_KEYS.googleAdsAvgCpcData}=${raw}`);
    return null;
  }
  /** Written only by `GoogleAdsCpcSyncService` — never exposed through the
   *  admin settings PATCH (see `UpdateSettingsDto`). */
  async setGoogleAdsAvgCpc(credits: number): Promise<void> {
    await this.set(
      SETTING_KEYS.googleAdsAvgCpcData,
      JSON.stringify({ credits, updatedAt: new Date().toISOString() } satisfies GoogleAdsAvgCpc),
    );
  }

  /** Safety margin (%) added on top of the raw average before it's charged. */
  googleAdsCpcBufferPct(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.googleAdsCpcBufferPct,
      DEFAULT_GOOGLE_ADS_CPC_BUFFER_PCT,
      MIN_GOOGLE_ADS_CPC_BUFFER_PCT,
      MAX_GOOGLE_ADS_CPC_BUFFER_PCT,
    );
  }
  setGoogleAdsCpcBufferPct(pct: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.googleAdsCpcBufferPct,
      pct,
      MIN_GOOGLE_ADS_CPC_BUFFER_PCT,
      MAX_GOOGLE_ADS_CPC_BUFFER_PCT,
    );
  }

  /** Fallback ceiling (credits) used whenever the cached average is missing
   *  or stale — should mirror the real Max CPC bid set in the Google Ads
   *  campaign itself. */
  googleAdsMaxCpcCredits(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.googleAdsMaxCpcCredits,
      DEFAULT_GOOGLE_ADS_MAX_CPC_CREDITS,
      MIN_GOOGLE_ADS_MAX_CPC_CREDITS,
      MAX_GOOGLE_ADS_MAX_CPC_CREDITS,
    );
  }
  setGoogleAdsMaxCpcCredits(credits: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.googleAdsMaxCpcCredits,
      credits,
      MIN_GOOGLE_ADS_MAX_CPC_CREDITS,
      MAX_GOOGLE_ADS_MAX_CPC_CREDITS,
    );
  }

  // --- Google Ads agent (per-subcategory campaigns) ----------------------

  /** Global on/off switch for the Google Ads agent. Off (unset) = fully idle:
   *  neither the structural pass nor the budget-intelligence pass does
   *  anything, even if the Google Ads API client is configured. */
  async googleAdsAgentEnabled(): Promise<boolean> {
    return (await this.get(SETTING_KEYS.googleAdsAgentEnabled)) === 'true';
  }
  async setGoogleAdsAgentEnabled(on: boolean): Promise<boolean> {
    await this.set(SETTING_KEYS.googleAdsAgentEnabled, on ? 'true' : 'false');
    return on;
  }

  /** Daily budget (credits) given to a brand-new per-subcategory campaign
   *  skeleton. Safe to apply without approval: the campaign is created
   *  PAUSED and carries no ads/keywords yet (added in a later pass), so
   *  this budget can never actually be spent until a human-reviewed step
   *  turns the campaign on. */
  googleAdsAgentDefaultDailyBudgetCredits(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.googleAdsAgentDefaultDailyBudgetCredits,
      DEFAULT_GOOGLE_ADS_AGENT_DAILY_BUDGET_CREDITS,
      MIN_GOOGLE_ADS_AGENT_DAILY_BUDGET_CREDITS,
      MAX_GOOGLE_ADS_AGENT_DAILY_BUDGET_CREDITS,
    );
  }
  setGoogleAdsAgentDefaultDailyBudgetCredits(credits: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.googleAdsAgentDefaultDailyBudgetCredits,
      credits,
      MIN_GOOGLE_ADS_AGENT_DAILY_BUDGET_CREDITS,
      MAX_GOOGLE_ADS_AGENT_DAILY_BUDGET_CREDITS,
    );
  }

  /** Max CPC (credits) given to a brand-new per-subcategory campaign skeleton. */
  googleAdsAgentDefaultMaxCpcCredits(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.googleAdsAgentDefaultMaxCpcCredits,
      DEFAULT_GOOGLE_ADS_AGENT_MAX_CPC_CREDITS,
      MIN_GOOGLE_ADS_AGENT_MAX_CPC_CREDITS,
      MAX_GOOGLE_ADS_AGENT_MAX_CPC_CREDITS,
    );
  }
  setGoogleAdsAgentDefaultMaxCpcCredits(credits: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.googleAdsAgentDefaultMaxCpcCredits,
      credits,
      MIN_GOOGLE_ADS_AGENT_MAX_CPC_CREDITS,
      MAX_GOOGLE_ADS_AGENT_MAX_CPC_CREDITS,
    );
  }

  /** Hard ceiling (credits) the daily budget-intelligence pass can propose
   *  for a single subcategory's daily budget — enforced server-side even if
   *  Claude's own proposal ignores it. */
  googleAdsAgentMaxDailyBudgetCapCredits(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.googleAdsAgentMaxDailyBudgetCapCredits,
      DEFAULT_GOOGLE_ADS_AGENT_MAX_DAILY_BUDGET_CAP_CREDITS,
      MIN_GOOGLE_ADS_AGENT_MAX_DAILY_BUDGET_CAP_CREDITS,
      MAX_GOOGLE_ADS_AGENT_MAX_DAILY_BUDGET_CAP_CREDITS,
    );
  }
  setGoogleAdsAgentMaxDailyBudgetCapCredits(credits: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.googleAdsAgentMaxDailyBudgetCapCredits,
      credits,
      MIN_GOOGLE_ADS_AGENT_MAX_DAILY_BUDGET_CAP_CREDITS,
      MAX_GOOGLE_ADS_AGENT_MAX_DAILY_BUDGET_CAP_CREDITS,
    );
  }

  /** Hard ceiling (credits) the daily budget-intelligence pass can propose
   *  for a single subcategory's max CPC — enforced server-side. */
  googleAdsAgentMaxCpcCapCredits(): Promise<number> {
    return this.decimalCreditSetting(
      SETTING_KEYS.googleAdsAgentMaxCpcCapCredits,
      DEFAULT_GOOGLE_ADS_AGENT_MAX_CPC_CAP_CREDITS,
      MIN_GOOGLE_ADS_AGENT_MAX_CPC_CAP_CREDITS,
      MAX_GOOGLE_ADS_AGENT_MAX_CPC_CAP_CREDITS,
    );
  }
  setGoogleAdsAgentMaxCpcCapCredits(credits: number): Promise<number> {
    return this.setDecimalCreditSetting(
      SETTING_KEYS.googleAdsAgentMaxCpcCapCredits,
      credits,
      MIN_GOOGLE_ADS_AGENT_MAX_CPC_CAP_CREDITS,
      MAX_GOOGLE_ADS_AGENT_MAX_CPC_CAP_CREDITS,
    );
  }

  // --- Google Ads account (credentials the agent + the legacy CPC sync both
  // use) — admin-settable, DB value wins over the GOOGLE_ADS_* env vars when
  // set (see GoogleAdsApiClient, which reads both and prefers the DB one).
  // Only `googleAdsServiceAccountKeyBase64` is a secret; callers that expose
  // these to an HTTP response MUST mask that one field (never echo it back
  // raw) — see AdminGoogleAdsService.googleAdsCredentials().

  async googleAdsCustomerId(): Promise<string> {
    return (await this.get(SETTING_KEYS.googleAdsCustomerId))?.trim() ?? '';
  }
  async setGoogleAdsCustomerId(value: string): Promise<string> {
    const trimmed = value.trim();
    if (trimmed && !/^\d{1,20}$/.test(trimmed)) {
      throw new BadRequestException('google_ads_customer_id must be digits only (no dashes)');
    }
    await this.set(SETTING_KEYS.googleAdsCustomerId, trimmed);
    return trimmed;
  }

  async googleAdsLoginCustomerId(): Promise<string> {
    return (await this.get(SETTING_KEYS.googleAdsLoginCustomerId))?.trim() ?? '';
  }
  async setGoogleAdsLoginCustomerId(value: string): Promise<string> {
    const trimmed = value.trim();
    if (trimmed && !/^\d{1,20}$/.test(trimmed)) {
      throw new BadRequestException('google_ads_login_customer_id must be digits only (no dashes)');
    }
    await this.set(SETTING_KEYS.googleAdsLoginCustomerId, trimmed);
    return trimmed;
  }

  /** Legacy single-campaign id the CPC-average sync job scopes to — see
   *  GoogleAdsCpcSyncService. Unrelated to the per-subcategory agent. */
  async googleAdsCampaignId(): Promise<string> {
    return (await this.get(SETTING_KEYS.googleAdsCampaignId))?.trim() ?? '';
  }
  async setGoogleAdsCampaignId(value: string): Promise<string> {
    const trimmed = value.trim();
    if (trimmed && !/^\d{1,20}$/.test(trimmed)) {
      throw new BadRequestException('google_ads_campaign_id must be digits only');
    }
    await this.set(SETTING_KEYS.googleAdsCampaignId, trimmed);
    return trimmed;
  }

  /** Raw base64-encoded service-account JSON key. Empty string when unset. */
  async googleAdsServiceAccountKeyBase64(): Promise<string> {
    return (await this.get(SETTING_KEYS.googleAdsServiceAccountKeyBase64)) ?? '';
  }
  /** Validates the key decodes to JSON with `client_email`/`private_key`
   *  BEFORE storing it — an admin pasting a wrong value gets an immediate
   *  error instead of silently discovering it later from "stays idle" logs. */
  async setGoogleAdsServiceAccountKeyBase64(value: string): Promise<void> {
    const trimmed = value.trim();
    if (trimmed) {
      let parsed: { client_email?: unknown; private_key?: unknown };
      try {
        parsed = JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
      } catch {
        throw new BadRequestException(
          'google_ads_service_account_key_base64 is not valid base64-encoded JSON',
        );
      }
      if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
        throw new BadRequestException(
          "Service account key JSON is missing 'client_email'/'private_key'",
        );
      }
    }
    await this.set(SETTING_KEYS.googleAdsServiceAccountKeyBase64, trimmed);
  }

  // --- Google Ads agent cadence (minutes since the last run of that kind,
  // re-read live on every poll tick — see the 3 GoogleAdsAgent*Service
  // classes — so a change here takes effect without a restart). ---

  googleAdsAgentStructuralIntervalMinutes(): Promise<number> {
    return this.intSetting(
      SETTING_KEYS.googleAdsAgentStructuralIntervalMinutes,
      DEFAULT_STRUCTURAL_INTERVAL_MINUTES,
      MIN_AGENT_INTERVAL_MINUTES,
      MAX_AGENT_INTERVAL_MINUTES,
    );
  }
  setGoogleAdsAgentStructuralIntervalMinutes(minutes: number): Promise<number> {
    return this.setIntSetting(
      SETTING_KEYS.googleAdsAgentStructuralIntervalMinutes,
      minutes,
      MIN_AGENT_INTERVAL_MINUTES,
      MAX_AGENT_INTERVAL_MINUTES,
    );
  }

  googleAdsAgentContentIntervalMinutes(): Promise<number> {
    return this.intSetting(
      SETTING_KEYS.googleAdsAgentContentIntervalMinutes,
      DEFAULT_CONTENT_INTERVAL_MINUTES,
      MIN_AGENT_INTERVAL_MINUTES,
      MAX_AGENT_INTERVAL_MINUTES,
    );
  }
  setGoogleAdsAgentContentIntervalMinutes(minutes: number): Promise<number> {
    return this.setIntSetting(
      SETTING_KEYS.googleAdsAgentContentIntervalMinutes,
      minutes,
      MIN_AGENT_INTERVAL_MINUTES,
      MAX_AGENT_INTERVAL_MINUTES,
    );
  }

  googleAdsAgentIntelligenceIntervalMinutes(): Promise<number> {
    return this.intSetting(
      SETTING_KEYS.googleAdsAgentIntelligenceIntervalMinutes,
      DEFAULT_INTELLIGENCE_INTERVAL_MINUTES,
      MIN_AGENT_INTERVAL_MINUTES,
      MAX_AGENT_INTERVAL_MINUTES,
    );
  }
  setGoogleAdsAgentIntelligenceIntervalMinutes(minutes: number): Promise<number> {
    return this.setIntSetting(
      SETTING_KEYS.googleAdsAgentIntelligenceIntervalMinutes,
      minutes,
      MIN_AGENT_INTERVAL_MINUTES,
      MAX_AGENT_INTERVAL_MINUTES,
    );
  }

  /** Read a whole-number setting with a sane fallback. */
  private async intSetting(key: string, fallback: number, min: number, max: number): Promise<number> {
    const raw = await this.get(key);
    const parsed = raw != null ? Number(raw) : NaN;
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      if (raw != null) this.logger.warn(`Ignoring invalid ${key}=${raw}`);
      return fallback;
    }
    return parsed;
  }
  private async setIntSetting(key: string, value: number, min: number, max: number): Promise<number> {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(`${key} out of range`);
    }
    await this.set(key, String(value));
    return value;
  }

  /** The platform's own billing identity, snapshotted onto every invoice issued. */
  async invoiceIssuer(): Promise<InvoiceIssuer> {
    const [name, taxId, regCom, address, iban, bank] = await Promise.all([
      this.get(SETTING_KEYS.invoiceIssuerName),
      this.get(SETTING_KEYS.invoiceIssuerTaxId),
      this.get(SETTING_KEYS.invoiceIssuerRegCom),
      this.get(SETTING_KEYS.invoiceIssuerAddress),
      this.get(SETTING_KEYS.invoiceIssuerIban),
      this.get(SETTING_KEYS.invoiceIssuerBank),
    ]);
    return {
      name: name ?? '',
      taxId: taxId ?? '',
      regCom: regCom ?? '',
      address: address ?? '',
      iban: iban ?? '',
      bank: bank ?? '',
    };
  }
  async setInvoiceIssuer(input: Partial<InvoiceIssuer>): Promise<InvoiceIssuer> {
    const map: Record<keyof InvoiceIssuer, string> = {
      name: SETTING_KEYS.invoiceIssuerName,
      taxId: SETTING_KEYS.invoiceIssuerTaxId,
      regCom: SETTING_KEYS.invoiceIssuerRegCom,
      address: SETTING_KEYS.invoiceIssuerAddress,
      iban: SETTING_KEYS.invoiceIssuerIban,
      bank: SETTING_KEYS.invoiceIssuerBank,
    };
    for (const [field, key] of Object.entries(map) as [keyof InvoiceIssuer, string][]) {
      if (input[field] !== undefined) await this.set(key, input[field]!.trim().slice(0, 300));
    }
    return this.invoiceIssuer();
  }
}
