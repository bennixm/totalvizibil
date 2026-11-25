import { EmailTone } from '../mail/templates/layout';

/**
 * How a notification type presents in email: the small category label above
 * the heading, and the tone that colours it (and the card's top accent).
 * Purely presentational. Decided once here from the notification `type`, so
 * every call site gets a consistent category without repeating it, and a new
 * type falls back to a neutral brand look instead of breaking.
 */
export interface EmailPresentation {
  eyebrow: string;
  tone: EmailTone;
}

const CATEGORY_RULES: { test: RegExp; eyebrow: string }[] = [
  {
    test: /^(email_changed|password_changed|totp_|new_session|account_(suspended|reactivated))/,
    eyebrow: 'Securitate cont',
  },
  { test: /^(payment_|purchase_|invoice_|refund_)/, eyebrow: 'Plăți și facturare' },
  { test: /^wallet_/, eyebrow: 'Portofel' },
  { test: /^discount_/, eyebrow: 'Ofertă' },
  { test: /^referral_/, eyebrow: 'Program de afiliere' },
  { test: /^domain_/, eyebrow: 'Domeniu' },
  { test: /^google_ads_/, eyebrow: 'Google Ads' },
  { test: /^campaign_/, eyebrow: 'Campanie' },
  { test: /^(business_|company_)/, eyebrow: 'Afacerea ta' },
  { test: /^(lead_|leads_)/, eyebrow: 'Cereri de la clienți' },
  { test: /^appointment_/, eyebrow: 'Programări' },
  { test: /^(support_|ticket_)/, eyebrow: 'Suport' },
  { test: /^(pro_|advanced_)/, eyebrow: 'Site' },
  { test: /^maintenance$/, eyebrow: 'Anunț' },
];

const DANGER = new Set([
  'account_suspended',
  'wallet_blocked',
  'business_suspended',
  'business_deleted',
  'business_deletion_reminder',
  'campaign_deleted_by_admin',
  'invoice_voided',
  'refund_failed',
  'pro_build_failed',
  'google_ads_connection_lost',
]);

const WARNING = new Set([
  'new_session',
  'totp_disabled',
  'campaign_paused_by_admin',
  'campaign_paused_website_not_ready',
  'campaign_cpc_below_minimum',
  'campaign_depleted',
  'wallet_low_balance',
  'google_ads_cycle_failed',
  'google_ads_cycle_skipped',
  'leads_stale',
  'purchase_pending_manual_review',
  'business_deletion_scheduled',
  'ticket_reopened',
  'ticket_unanswered_escalation',
  'maintenance',
]);

const SUCCESS = new Set([
  'payment_succeeded',
  'google_ads_cycle_done',
  'refund_completed',
  'referral_rewarded',
  'account_reactivated',
  'wallet_unblocked',
  'business_created',
  'business_reactivated',
  'business_deletion_canceled',
  'campaign_activated_by_admin',
  'totp_enabled',
  'domain_purchased',
  'discount_updated',
  'advanced_unlock_granted_by_admin',
  'advanced_unlock_charged_by_admin',
]);

export function emailPresentationFor(type: string): EmailPresentation {
  const eyebrow = CATEGORY_RULES.find((r) => r.test.test(type))?.eyebrow ?? 'Notificare';
  const tone: EmailTone = DANGER.has(type)
    ? 'danger'
    : WARNING.has(type)
      ? 'warning'
      : SUCCESS.has(type)
        ? 'success'
        : 'brand';
  return { eyebrow, tone };
}
