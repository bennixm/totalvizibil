import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const SETTING_KEYS = {
  eurRonRate: 'eur_ron_rate',
  advancedBuilderPriceCredits: 'advanced_builder_price_credits',
  additionalBusinessPriceCredits: 'additional_business_price_credits',
} as const;

/** Fallback EUR->RON rate when the setting row is absent. Kept sane, not exact. */
const DEFAULT_EUR_RON = 5.05;
const MIN_EUR_RON = 1;
const MAX_EUR_RON = 50;

/** Fallback price (credits) for the one-time advanced website builder unlock. */
const DEFAULT_ADVANCED_PRICE = 49;
/** Fallback price (credits) for creating an additional business beyond the first. */
const DEFAULT_ADDITIONAL_BUSINESS_PRICE = 20;
const MIN_PRICE = 1;
const MAX_PRICE = 100_000;

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

  constructor(private readonly prisma: PrismaService) {}

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
}
