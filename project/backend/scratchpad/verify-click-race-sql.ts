/**
 * One-off: verify the atomic budget-reserve raw SQL added to
 * CampaignService.registerClick against the real Postgres schema (column
 * names, @db.Uuid/@db.Date casts) — not just that it typechecks. Creates a
 * throwaway user/wallet/company/campaign, exercises the exact query, then
 * deletes everything it created.
 *
 * Run: npx ts-node --transpile-only scratchpad/verify-click-race-sql.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = `verify-click-race-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: { email, passwordHash: 'x', name: 'Verify Click Race' },
  });
  const wallet = await prisma.wallet.create({
    data: { userId: user.id, balanceMinor: 100_000 },
  });
  const company = await prisma.company.create({
    data: {
      ownerUserId: user.id,
      displayName: 'Verify Click Race Co',
      slug: `verify-click-race-${Date.now()}`,
      status: 'active',
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      companyId: company.id,
      status: 'active',
      dailyBudgetMinor: 250,
      cpcMinor: 100,
    },
  });

  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const cpc = campaign.cpcMinor;

  async function reserve() {
    return prisma.$queryRaw<{ spentTodayMinor: number }[]>`
      UPDATE campaigns
      SET spent_today_minor = CASE WHEN spend_day = ${today}::date
            THEN spent_today_minor + ${cpc}
            ELSE ${cpc}
          END,
          spend_day = ${today}::date
      WHERE id = ${campaign.id}::uuid
        AND (CASE WHEN spend_day = ${today}::date THEN spent_today_minor ELSE 0 END) + ${cpc}
            <= daily_budget_minor
      RETURNING spent_today_minor AS "spentTodayMinor"
    `;
  }

  const r1 = await reserve();
  console.log('click 1 (0 -> 100, budget 250):', r1);
  if (r1.length !== 1 || r1[0].spentTodayMinor !== 100) throw new Error('click 1 FAILED');

  const r2 = await reserve();
  console.log('click 2 (100 -> 200, budget 250):', r2);
  if (r2.length !== 1 || r2[0].spentTodayMinor !== 200) throw new Error('click 2 FAILED');

  const r3 = await reserve();
  console.log('click 3 (200 + 100 = 300 > 250, should be rejected):', r3);
  if (r3.length !== 0) throw new Error('click 3 should have been rejected but was not — FAILED');

  const after = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
  console.log('final spentTodayMinor (must stay 200, not overshoot):', after.spentTodayMinor);
  if (after.spentTodayMinor !== 200) throw new Error('final state FAILED');

  // Concurrency check: fire 5 reservations in parallel against a budget that
  // only fits 2 more (cpc=100, budget currently spent 200/250 -> room for 0
  // more actually; reset spent to 0 first for a clean concurrent-room test).
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { spentTodayMinor: 0 },
  });
  const results = await Promise.all(Array.from({ length: 5 }, () => reserve()));
  const wins = results.filter((r) => r.length === 1);
  console.log(
    `concurrent: ${wins.length}/5 succeeded (budget 250, cpc 100 -> exactly 2 should win)`,
  );
  if (wins.length !== 2) throw new Error(`concurrency FAILED — expected 2 wins, got ${wins.length}`);
  const finalAfterConcurrency = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaign.id },
  });
  if (finalAfterConcurrency.spentTodayMinor !== 200) {
    throw new Error(
      `concurrency FAILED — spentTodayMinor should be exactly 200, got ${finalAfterConcurrency.spentTodayMinor}`,
    );
  }

  console.log('ALL CHECKS PASSED');
}

main()
  .catch((err) => {
    console.error('VERIFICATION FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // No adClick rows are created by this script (only the raw campaigns
    // UPDATE is exercised, not the full registerClick path) — nothing to
    // clean up there.
    const companies = await prisma.company.findMany({
      where: { slug: { startsWith: 'verify-click-race-' } },
      select: { id: true },
    });
    for (const c of companies) {
      await prisma.campaign.deleteMany({ where: { companyId: c.id } });
    }
    await prisma.company.deleteMany({ where: { slug: { startsWith: 'verify-click-race-' } } });
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'verify-click-race-' } },
      select: { id: true },
    });
    for (const u of users) {
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
    }
    await prisma.user.deleteMany({ where: { email: { startsWith: 'verify-click-race-' } } });
    await prisma.$disconnect();
  });
