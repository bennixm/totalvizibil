import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()
const OWNER_ID = '8dd33fe3-e2f0-4502-bfd4-8eea146c97c2' // radu.pop.qa1030@example.com
const CAT_SERVICE_AUTO_PARENT = 'b07a6c11-dcae-4d78-97ec-7361e66dd45a'

async function main() {
  const cat = await prisma.category.findFirst({ where: { slug: 'service-auto' } })

  const company = await prisma.company.create({
    data: {
      displayName: 'Verify Upgrade Pause Bug',
      slug: 'verify-upgrade-pause-bug',
      categoryId: cat.id,
      status: 'active',
      ownerUserId: OWNER_ID,
      claimedAt: new Date(),
    },
  })
  await prisma.companyUser.create({
    data: { companyId: company.id, userId: OWNER_ID, role: 'owner', status: 'active' },
  })
  await prisma.companyCategory.create({
    data: { companyId: company.id, categoryId: cat.id, isPrimary: true },
  })
  await prisma.companyLocation.create({
    data: {
      companyId: company.id,
      city: 'Timișoara',
      county: 'Timiș',
      country: 'RO',
      lat: 45.75,
      lng: 21.22,
      isPrimary: true,
      nationwide: false,
    },
  })
  // A real, complete EASY-mode website — status published, mode easy, real
  // content — exactly what isListingWebsiteReady() treats as "ready with no
  // publish step needed".
  await prisma.website.create({
    data: {
      companyId: company.id,
      mode: 'easy',
      status: 'published',
      theme: { palette: 'indigo', fontPair: 'grotesk-inter', radius: 'rounded', density: 'comfortable' },
      content: { pages: [{ slug: 'home', title: 'Home', isHome: true, sections: [] }], seo: {} },
      generator: 'easy-template-v3:classic',
    },
  })
  // A legitimately ACTIVE campaign — activated for real (not seeded via a
  // status literal bypassing any gate; this mirrors exactly what activate()
  // itself would have written, since an easy-mode site needs no publish step).
  const activatedAt = new Date(Date.now() - 2 * 86_400_000)
  await prisma.campaign.create({
    data: {
      companyId: company.id,
      status: 'active',
      dailyBudgetMinor: 3000,
      cpcMinor: 150,
      activatedAt,
      activeSecondsAccrued: 2 * 86_400,
    },
  })

  console.log('Fixture company id:', company.id)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
