import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { RuleBasedWebsiteGenerator } from '../src/website/website-generator';
import { GeneratorInput } from '../src/website/website.types';

const prisma = new PrismaClient();
const generator = new RuleBasedWebsiteGenerator();

/** Launch-category seed (PRD §6.2 — seed supply before demand). */
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

interface DemoCompany {
  slug: string;
  name: string;
  categorySlug: string;
  city: string;
  region?: string;
  country: string;
  type: string;
  services: string[];
  description: string;
  phone: string;
  email: string;
  featured?: boolean;
  quality: number;
  ageDays: number;
}

const DEMO: DemoCompany[] = [
  {
    slug: 'novak-bau-stuttgart', name: 'Novak Bau', categorySlug: 'construction', city: 'Stuttgart', country: 'DE',
    type: 'construction company', services: ['Full renovations', 'Extensions', 'Bathrooms', 'Drywall'],
    description: 'Novak Bau is a construction team in Stuttgart doing full renovations and extensions for homes and small offices.',
    phone: '+49 711 123 456', email: 'kontakt@novakbau.de', featured: true, quality: 0.86, ageDays: 220,
  },
  {
    slug: 'lumina-electric-cluj', name: 'Lumina Electric', categorySlug: 'electrician', city: 'Cluj-Napoca', region: 'Cluj', country: 'RO',
    type: 'electrical services', services: ['Panel upgrades', 'Wiring', 'EV chargers', 'Emergency callouts'],
    description: 'Authorised electricians in Cluj-Napoca for homes and businesses. Same-day emergency callouts.',
    phone: '+40 722 100 200', email: 'office@luminaelectric.ro', featured: true, quality: 0.82, ageDays: 140,
  },
  {
    slug: 'aqua-fix-muenchen', name: 'AquaFix', categorySlug: 'plumbing', city: 'München', country: 'DE',
    type: 'plumbing company', services: ['Leak detection', 'Boiler service', 'Drain unblocking', 'Bathroom fit-out'],
    description: 'AquaFix handles plumbing emergencies and bathroom renovations across München with transparent pricing.',
    phone: '+49 89 555 010', email: 'hallo@aquafix.de', quality: 0.74, ageDays: 90,
  },
  {
    slug: 'acoperis-pro-timisoara', name: 'Acoperiș Pro', categorySlug: 'roofing', city: 'Timișoara', region: 'Timiș', country: 'RO',
    type: 'roofing company', services: ['Roof repair', 'Full re-roofing', 'Gutters', 'Insulation'],
    description: 'Roofing specialists in Timișoara: repairs, re-roofing and insulation with a 5-year workmanship guarantee.',
    phone: '+40 744 300 400', email: 'contact@acoperispro.ro', quality: 0.7, ageDays: 60,
  },
  {
    slug: 'sparkle-clean-berlin', name: 'Sparkle Clean', categorySlug: 'cleaning', city: 'Berlin', country: 'DE',
    type: 'cleaning service', services: ['Office cleaning', 'Move-out cleaning', 'Window cleaning'],
    description: 'Reliable office and move-out cleaning in Berlin, insured teams, flexible scheduling.',
    phone: '+49 30 700 800', email: 'team@sparkleclean.de', quality: 0.63, ageDays: 30,
  },
  {
    slug: 'autotech-garage-bucuresti', name: 'AutoTech Garage', categorySlug: 'automotive', city: 'București', country: 'RO',
    type: 'car service', services: ['Diagnostics', 'Brakes & suspension', 'AC service', 'Pre-purchase check'],
    description: 'Independent car service in București with dealer-level diagnostics at fair prices.',
    phone: '+40 731 500 600', email: 'service@autotech.ro', quality: 0.68, ageDays: 45,
  },
  {
    slug: 'bistro-nordic-cluj', name: 'Bistro Nordic', categorySlug: 'restaurant', city: 'Cluj-Napoca', region: 'Cluj', country: 'RO',
    type: 'bistro restaurant', services: ['Lunch menu', 'Events & catering', 'Vegetarian menu'],
    description: 'A small Nordic-inspired bistro in central Cluj-Napoca. Seasonal menu, weekday lunch, private events.',
    phone: '+40 726 111 222', email: 'hello@bistronordic.ro', quality: 0.71, ageDays: 12,
  },
  {
    slug: 'pixel-studio-web-stuttgart', name: 'Pixel Studio', categorySlug: 'web-design', city: 'Stuttgart', country: 'DE',
    type: 'web design studio', services: ['Website design', 'Branding', 'SEO', 'Webshops'],
    description: 'Pixel Studio designs fast, modern websites and brand identities for local businesses in the Stuttgart area.',
    phone: '+49 711 909 100', email: 'studio@pixel.de', quality: 0.6, ageDays: 3,
  },
];

async function seedCategories() {
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

async function demoOwner() {
  const email = 'demo-owner@totalvizibil.local';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: { email, name: 'Demo Seed Owner', passwordHash: await argon2.hash('demo-seed-' + Date.now()) },
  });
}

async function seedCompanies() {
  const owner = await demoOwner();
  const categories = await prisma.category.findMany();
  const catId = (slug: string) => categories.find((c) => c.slug === slug)?.id;

  for (const d of DEMO) {
    const input: GeneratorInput = {
      mode: 'easy',
      businessName: d.name,
      businessType: d.type,
      city: d.city,
      services: d.services,
      shortDescription: d.description,
    };
    const generated = generator.generate(input);
    const createdAt = new Date(Date.now() - d.ageDays * 86_400_000);

    const existing = await prisma.company.findUnique({ where: { slug: d.slug } });
    if (existing) {
      await prisma.company.update({
        where: { slug: d.slug },
        data: { qualityScore: d.quality, featured: d.featured ?? false, status: 'active' },
      });
      continue;
    }

    await prisma.company.create({
      data: {
        slug: d.slug,
        displayName: d.name,
        description: d.description,
        categoryId: catId(d.categorySlug),
        ownerUserId: owner.id,
        status: 'active',
        country: d.country,
        defaultLocale: d.country === 'DE' ? 'de' : 'ro',
        currency: d.country === 'DE' ? 'EUR' : 'RON',
        qualityScore: d.quality,
        featured: d.featured ?? false,
        claimedAt: createdAt,
        createdAt,
        members: { create: { userId: owner.id, role: 'owner', status: 'active' } },
        locations: {
          create: { city: d.city, region: d.region ?? null, country: d.country, isPrimary: true },
        },
        contacts: {
          createMany: {
            data: [
              { type: 'phone', value: d.phone },
              { type: 'email', value: d.email },
            ],
          },
        },
        services: {
          createMany: { data: d.services.map((name, i) => ({ name, position: i })) },
        },
        website: {
          create: {
            mode: 'easy',
            status: 'published',
            theme: generated.theme as unknown as Prisma.InputJsonValue,
            content: generated.content as unknown as Prisma.InputJsonValue,
            generator: generated.generator,
          },
        },
      },
    });
  }
  console.log(`Seeded ${DEMO.length} demo companies (with websites).`);
}

async function main() {
  await seedCategories();
  await seedCompanies();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
