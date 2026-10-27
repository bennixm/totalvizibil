import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlatformSettingsService } from '../src/platform-settings/platform-settings.service';
import { AnalyticsService } from '../src/analytics/analytics.service';

async function main() {
  const companyId = process.argv[2];
  if (!companyId) throw new Error('usage: debug-feedrank.ts <companyId>');

  const prisma = new PrismaService();
  await prisma.$connect();
  const notifications = {
    notify: async () => {},
    notifyAll: async () => 0,
  } as never;
  const config = { get: () => 'http://localhost:5173' } as never;
  const settings = new PlatformSettingsService(prisma, notifications, config);
  const analytics = new AnalyticsService(prisma, settings);

  const cfg = await analytics.marginConfig();
  console.log('marginConfig:', cfg);

  const ctx = await analytics.feedContextFor(companyId);
  console.log('feedContextFor:', JSON.stringify(ctx, null, 2));

  const rank = await analytics.feedRankFor(companyId);
  console.log('feedRankFor:', JSON.stringify(rank));

  const ranks = await analytics.feedRanksFor(companyId);
  console.log('feedRanksFor (plural, all Feeds):', JSON.stringify(ranks, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
