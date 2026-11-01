import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const COMPANY_ID = 'dcaec9bd-ca19-4acb-b8ae-7de26979695c'

async function main() {
  const company = await prisma.company.findUnique({ where: { id: COMPANY_ID } })
  const wallet = await prisma.wallet.upsert({
    where: { userId: company.ownerUserId },
    update: {},
    create: { userId: company.ownerUserId },
  })

  const billed = await prisma.adClick.findMany({
    where: { companyId: COMPANY_ID, billed: true },
    select: { costMinor: true, createdAt: true },
  })

  const byDay = new Map()
  for (const c of billed) {
    const day = new Date(c.createdAt)
    day.setUTCHours(0, 0, 0, 0)
    const key = day.toISOString()
    const agg = byDay.get(key) ?? { amount: 0, count: 0, day }
    agg.amount += c.costMinor
    agg.count += 1
    byDay.set(key, agg)
  }

  let total = 0
  for (const { amount, count, day } of byDay.values()) {
    total += amount
    await prisma.walletTransaction.upsert({
      where: {
        walletId_companyId_provider_spendDay: {
          walletId: wallet.id,
          companyId: COMPANY_ID,
          provider: 'cpc',
          spendDay: day,
        },
      },
      create: {
        walletId: wallet.id,
        companyId: COMPANY_ID,
        type: 'spend',
        status: 'completed',
        provider: 'cpc',
        spendDay: day,
        clickCount: count,
        amountMinor: -amount,
        balanceAfterMinor: null,
        description: 'Ad clicks',
        createdAt: day,
      },
      update: {
        amountMinor: -amount,
        clickCount: count,
      },
    })
  }
  console.log(`Rolled up ${byDay.size} days, total ${total} minor units (${(total / 100).toFixed(2)} credits).`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
