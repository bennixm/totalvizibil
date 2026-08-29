import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Launch-category seed (PRD §6.2 — seed supply before demand).
 * Local service categories relevant to the RO/DE launch metros.
 */
const CATEGORIES: { slug: string; icon: string; name: { ro: string; en: string; de: string } }[] = [
  { slug: 'electrician', icon: 'mdi-flash', name: { ro: 'Electricieni', en: 'Electricians', de: 'Elektriker' } },
  { slug: 'plumbing', icon: 'mdi-pipe-wrench', name: { ro: 'Instalatori', en: 'Plumbers', de: 'Klempner' } },
  { slug: 'roofing', icon: 'mdi-home-roof', name: { ro: 'Acoperișuri', en: 'Roofing', de: 'Dachdecker' } },
  { slug: 'construction', icon: 'mdi-hammer', name: { ro: 'Construcții', en: 'Construction', de: 'Bau' } },
  { slug: 'cleaning', icon: 'mdi-broom', name: { ro: 'Curățenie', en: 'Cleaning', de: 'Reinigung' } },
  { slug: 'automotive', icon: 'mdi-car-wrench', name: { ro: 'Auto service', en: 'Automotive', de: 'Autowerkstatt' } },
  { slug: 'restaurant', icon: 'mdi-silverware-fork-knife', name: { ro: 'Restaurante', en: 'Restaurants', de: 'Restaurants' } },
  { slug: 'hairdresser', icon: 'mdi-content-cut', name: { ro: 'Coafor & frizerie', en: 'Hairdressers', de: 'Friseure' } },
  { slug: 'dental', icon: 'mdi-tooth-outline', name: { ro: 'Cabinete stomatologice', en: 'Dental clinics', de: 'Zahnarztpraxen' } },
  { slug: 'driving-school', icon: 'mdi-car', name: { ro: 'Școli de șoferi', en: 'Driving schools', de: 'Fahrschulen' } },
  { slug: 'web-design', icon: 'mdi-monitor', name: { ro: 'Web design', en: 'Web design', de: 'Webdesign' } },
  { slug: 'photography', icon: 'mdi-camera', name: { ro: 'Fotografi', en: 'Photographers', de: 'Fotografen' } },
];

async function main() {
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { nameI18n: c.name, icon: c.icon, position: i, isActive: true },
      create: { slug: c.slug, nameI18n: c.name, icon: c.icon, position: i },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} categories.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
