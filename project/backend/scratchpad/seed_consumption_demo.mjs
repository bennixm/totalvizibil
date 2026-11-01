import { PrismaClient } from '@prisma/client'
import { randomUUID, createHash } from 'node:crypto'

const prisma = new PrismaClient()

const COMPANY_ID = 'dcaec9bd-ca19-4acb-b8ae-7de26979695c' // AutoDetail Expert Cluj
const CAT_SPALATORIE = '114c3fe8-b68c-40d1-a8e1-011f9cb72ada' // spalatorie-detailing-auto
const PARENT_AUTO = 'b07a6c11-dcae-4d78-97ec-7361e66dd45a'

function hash(s) {
  return createHash('sha256').update(s).digest('hex')
}

async function main() {
  // --- 1. Second category + second county on the test company, so the
  // byFeed breakdown has more than one row to actually demonstrate sorting. ---
  const serviceAuto = await prisma.category.findFirst({ where: { slug: 'service-auto' } })
  if (serviceAuto) {
    await prisma.companyCategory.upsert({
      where: { companyId_categoryId: { companyId: COMPANY_ID, categoryId: serviceAuto.id } },
      update: {},
      create: { companyId: COMPANY_ID, categoryId: serviceAuto.id, isPrimary: false },
    })
  }
  await prisma.companyLocation.upsert({
    where: { id: 'ffffffff-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'ffffffff-0000-0000-0000-000000000001',
      companyId: COMPANY_ID,
      city: 'Cluj-Napoca',
      county: 'Cluj',
      country: 'RO',
      lat: 46.7712,
      lng: 23.6236,
      isPrimary: false,
      nationwide: false,
    },
  })

  // --- 2. A couple of rival companies bidding in the same (Timiș, spălătorie)
  // Feed, so AutoDetail isn't a trivial #1 — a realistic "poziție" story. ---
  const ownerUserId = (await prisma.company.findUnique({ where: { id: COMPANY_ID } })).ownerUserId
  const rivalNames = ['Curat Auto Expres Timișoara', 'ShineCar Detailing Timiș']
  const rivalIds = []
  for (let i = 0; i < rivalNames.length; i++) {
    const slug = rivalNames[i].toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const existing = await prisma.company.findUnique({ where: { slug } })
    const rival = existing
      ? existing
      : await prisma.company.create({
          data: {
            displayName: rivalNames[i],
            slug,
            categoryId: CAT_SPALATORIE,
            status: 'active',
            ownerUserId,
            advancedUnlockedAt: new Date(),
          },
        })
    rivalIds.push(rival.id)
    await prisma.companyCategory.upsert({
      where: { companyId_categoryId: { companyId: rival.id, categoryId: CAT_SPALATORIE } },
      update: {},
      create: { companyId: rival.id, categoryId: CAT_SPALATORIE, isPrimary: true },
    })
    await prisma.companyLocation.upsert({
      where: { id: `ffffffff-0000-0000-0000-00000000000${i + 2}` },
      update: {},
      create: {
        id: `ffffffff-0000-0000-0000-00000000000${i + 2}`,
        companyId: rival.id,
        city: 'Timișoara',
        county: 'Timiș',
        country: 'RO',
        lat: 45.75,
        lng: 21.22,
        isPrimary: true,
        nationwide: false,
      },
    })
    await prisma.campaign.upsert({
      where: { companyId: rival.id },
      update: { status: 'active', dailyBudgetMinor: 4000, cpcMinor: 180 + i * 20, activatedAt: new Date(Date.now() - 20 * 86_400_000) },
      create: {
        companyId: rival.id,
        status: 'active',
        dailyBudgetMinor: 4000,
        cpcMinor: 180 + i * 20,
        activatedAt: new Date(Date.now() - 20 * 86_400_000),
        activeSecondsAccrued: 20 * 86_400,
      },
    })
  }

  // --- 3. AutoDetail's own campaign: active, 10 days of run time. ---
  const now = new Date()
  const activatedAt = new Date(now.getTime() - 12 * 86_400_000)
  await prisma.campaign.upsert({
    where: { companyId: COMPANY_ID },
    update: {
      status: 'active',
      dailyBudgetMinor: 3000,
      cpcMinor: 170,
      activatedAt,
      activeSecondsAccrued: 11 * 86_400,
      spentTodayMinor: 840,
      spendDay: new Date(now.toISOString().slice(0, 10)),
    },
    create: {
      companyId: COMPANY_ID,
      status: 'active',
      dailyBudgetMinor: 3000,
      cpcMinor: 170,
      activatedAt,
      activeSecondsAccrued: 11 * 86_400,
      spentTodayMinor: 840,
      spendDay: new Date(now.toISOString().slice(0, 10)),
    },
  })

  // --- 4. Wallet: top up the owner so runway numbers look healthy. ---
  const wallet = await prisma.wallet.findUnique({ where: { userId: ownerUserId } })
  if (wallet && wallet.balanceMinor < 30000) {
    await prisma.wallet.update({ where: { id: wallet.id }, data: { balanceMinor: 34500 } })
  }

  // --- 5. ad_clicks: 20 days, 3 feeds, a realistic mix of billed + filtered. ---
  // Clear any clicks we seeded on a previous run of this script first.
  await prisma.adClick.deleteMany({ where: { companyId: COMPANY_ID, visitorHash: { startsWith: 'seed:' } } })

  const feeds = [
    { county: 'Timiș', categoryId: CAT_SPALATORIE, dailyClicks: 6, cpc: 165 },
    { county: 'Cluj', categoryId: CAT_SPALATORIE, dailyClicks: 2, cpc: 190 },
  ]
  if (serviceAuto) feeds.push({ county: 'Timiș', categoryId: serviceAuto.id, dailyClicks: 3, cpc: 140 })

  const reasons = ['budget', 'bot', 'insufficient']
  let seq = 0
  const rows = []
  for (let dayAgo = 19; dayAgo >= 0; dayAgo--) {
    const dayStart = new Date(now.getTime() - dayAgo * 86_400_000)
    dayStart.setUTCHours(0, 0, 0, 0)
    for (const feed of feeds) {
      const n = Math.max(0, feed.dailyClicks + Math.round((Math.random() - 0.5) * 3))
      for (let i = 0; i < n; i++) {
        const t = new Date(dayStart.getTime() + Math.random() * 86_400_000)
        seq++
        rows.push({
          id: randomUUID(),
          companyId: COMPANY_ID,
          visitorHash: hash(`seed:${seq}:${t.toISOString()}`),
          billed: true,
          costMinor: feed.cpc + Math.round((Math.random() - 0.5) * 20),
          feedCounty: feed.county,
          feedCategoryId: feed.categoryId,
          createdAt: t,
        })
      }
      // A handful of filtered/unbilled clicks per day, concentrated on the
      // main feed, so the click-quality breakdown has real numbers.
      if (dayAgo % 3 === 0) {
        const reason = reasons[Math.floor(Math.random() * reasons.length)]
        const t = new Date(dayStart.getTime() + Math.random() * 86_400_000)
        seq++
        rows.push({
          id: randomUUID(),
          companyId: COMPANY_ID,
          visitorHash: hash(`seed:${seq}:${t.toISOString()}`),
          billed: false,
          costMinor: 0,
          reason,
          feedCounty: feed.county,
          feedCategoryId: feed.categoryId,
          createdAt: t,
        })
      }
    }
  }
  // A couple of budget-capped days near the end, to exercise the "capped" flag.
  for (let i = 0; i < 4; i++) {
    const t = new Date(now.getTime() - 2 * 86_400_000 + i * 3_600_000)
    seq++
    rows.push({
      id: randomUUID(),
      companyId: COMPANY_ID,
      visitorHash: hash(`seed:${seq}:${t.toISOString()}`),
      billed: false,
      costMinor: 0,
      reason: 'budget',
      feedCounty: 'Timiș',
      feedCategoryId: CAT_SPALATORIE,
      createdAt: t,
    })
  }

  await prisma.adClick.createMany({ data: rows, skipDuplicates: true })

  console.log(`Seeded ${rows.length} ad_click rows across ${feeds.length} feeds, 2 rival companies, campaign activated ${activatedAt.toISOString()}.`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
