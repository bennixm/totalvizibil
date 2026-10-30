import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const GROUPS = [
  {
    slug: 'auto-transport',
    nameI18n: { ro: 'Auto & Transport', en: 'Auto & Transport', de: 'Auto & Transport' },
    children: [
      { slug: 'spalatorie-detailing-auto', nameI18n: { ro: 'Spălătorie & Detailing Auto', en: 'Car Wash & Detailing', de: 'Autowäsche & Detailing' } },
      { slug: 'service-auto', nameI18n: { ro: 'Service Auto', en: 'Car Service', de: 'Autowerkstatt' } },
      { slug: 'vulcanizare', nameI18n: { ro: 'Vulcanizare', en: 'Tire Service', de: 'Reifenservice' } },
    ],
  },
  {
    slug: 'casa-constructii',
    nameI18n: { ro: 'Casă & Construcții', en: 'Home & Construction', de: 'Haus & Bau' },
    children: [
      { slug: 'curatenie', nameI18n: { ro: 'Curățenie', en: 'Cleaning', de: 'Reinigung' } },
      { slug: 'instalatii', nameI18n: { ro: 'Instalații', en: 'Plumbing', de: 'Installationen' } },
      { slug: 'constructii-renovari', nameI18n: { ro: 'Construcții & Renovări', en: 'Construction & Renovation', de: 'Bau & Renovierung' } },
    ],
  },
  {
    slug: 'frumusete-sanatate',
    nameI18n: { ro: 'Frumusețe & Sănătate', en: 'Beauty & Health', de: 'Schönheit & Gesundheit' },
    children: [
      { slug: 'salon-coafura', nameI18n: { ro: 'Salon & Coafură', en: 'Salon & Hair', de: 'Salon & Friseur' } },
      { slug: 'clinica-stomatologica', nameI18n: { ro: 'Clinică Stomatologică', en: 'Dental Clinic', de: 'Zahnklinik' } },
    ],
  },
  {
    slug: 'horeca',
    nameI18n: { ro: 'Restaurante & Cafenele', en: 'Restaurants & Cafes', de: 'Restaurants & Cafés' },
    children: [
      { slug: 'restaurant', nameI18n: { ro: 'Restaurant', en: 'Restaurant', de: 'Restaurant' } },
      { slug: 'cafenea', nameI18n: { ro: 'Cafenea', en: 'Cafe', de: 'Café' } },
    ],
  },
]

for (let gi = 0; gi < GROUPS.length; gi++) {
  const g = GROUPS[gi]
  const parent = await prisma.category.upsert({
    where: { slug: g.slug },
    update: { nameI18n: g.nameI18n, isActive: true, position: gi },
    create: { slug: g.slug, nameI18n: g.nameI18n, isActive: true, position: gi },
  })
  for (let ci = 0; ci < g.children.length; ci++) {
    const c = g.children[ci]
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { nameI18n: c.nameI18n, isActive: true, position: ci, parentId: parent.id },
      create: { slug: c.slug, nameI18n: c.nameI18n, isActive: true, position: ci, parentId: parent.id },
    })
  }
}

const count = await prisma.category.count()
console.log('Categories now in DB:', count)
await prisma.$disconnect()
