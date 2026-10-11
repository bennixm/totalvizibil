import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaService } from 'src/prisma/prisma.service';

const ALL_TABLES = [
  'ad_clicks', 'leads', 'appointments', 'appointment_availabilities', 'appointment_settings',
  'support_messages', 'support_tickets', 'wallet_transactions', 'invoices', 'billing_profiles',
  'invoice_counters', 'referrals', 'campaigns', 'company_users', 'company_locations',
  'company_contacts', 'company_services', 'company_categories', 'website_bundle_files',
  'website_assets', 'websites', 'website_drafts', 'pro_v2_files', 'pro_v2_messages',
  'pro_v2_projects', 'ai_usage_records', 'pexels_cache', 'notifications', 'sessions',
  'email_verification_codes', 'password_reset_tokens', 'platform_roles', 'wallets',
  'companies', 'users', 'categories', 'platform_settings',
].map((t) => `"${t}"`).join(', ');

export async function resetDb(prisma: PrismaService, app?: INestApplication): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${ALL_TABLES} RESTART IDENTITY CASCADE`,
  );
  if (app) resetThrottler(app);
}

/** Clear the in-memory throttler counters so per-IP limits don't accumulate across tests. */
export function resetThrottler(app: INestApplication): void {
  const storage = app.get<any>(ThrottlerStorage);
  storage.storage.clear();
}
