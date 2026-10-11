/**
 * Pluggable domain-registrar provider — availability check + purchase. Only a
 * dev stub ships here; wiring a real registrar (Namecheap, Porkbun, Dynadot,
 * …) means implementing this interface against their API and swapping it in
 * via DomainsModule, the same shape StripeService uses for payments (see its
 * own "not configured in this environment" stub path).
 */
import { creditsToMinor } from '../wallet/money';

export interface DomainAvailability {
  domain: string;
  available: boolean;
  /** The registrar's own price for a first-year registration, in credit minor units. */
  priceCreditsMinor: number;
}

export interface DomainPurchaseResult {
  /** The provider's own order/domain id — needed for later renewal/DNS calls. */
  ref: string;
}

export interface DomainRegistrarProvider {
  readonly name: string;
  readonly configured: boolean;
  checkAvailability(domain: string): Promise<DomainAvailability>;
  purchase(domain: string): Promise<DomainPurchaseResult>;
}

/** 1 credit = 1 EUR (see wallet/money.ts) — flat per-TLD placeholder pricing,
 *  close to real registrar list prices, until a real provider is wired in. */
const TLD_PRICE_CREDITS: Record<string, number> = {
  ro: 12,
  com: 14,
  net: 16,
  org: 15,
  eu: 10,
  io: 42,
};
const DEFAULT_TLD_PRICE_CREDITS = 18;

function tld(domain: string): string {
  const parts = domain.split('.');
  return parts[parts.length - 1]?.toLowerCase() ?? '';
}

/** Deterministic dev-mode stand-in: a domain is "taken" only if it obviously
 *  reads that way, so the happy path is exercisable without a real registrar
 *  account. Never actually registers anything. */
export class StubDomainRegistrarProvider implements DomainRegistrarProvider {
  readonly name = 'stub-dev';
  readonly configured = false;

  async checkAvailability(domain: string): Promise<DomainAvailability> {
    const taken = /^(google|facebook|totalvizibil|taken|test)\./i.test(domain);
    const priceCredits = TLD_PRICE_CREDITS[tld(domain)] ?? DEFAULT_TLD_PRICE_CREDITS;
    return {
      domain,
      available: !taken,
      priceCreditsMinor: creditsToMinor(priceCredits),
    };
  }

  async purchase(domain: string): Promise<DomainPurchaseResult> {
    return { ref: `stub-${Date.now()}-${domain}` };
  }
}
