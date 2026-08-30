import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { RuleBasedWebsiteGenerator } from '../src/website/website-generator';
import { GeneratorInput } from '../src/website/website.types';

const prisma = new PrismaClient();
const generator = new RuleBasedWebsiteGenerator();

/**
 * Category taxonomy: parent group -> exact service niches (PRD §6.2).
 * Children inherit the parent's icon. Slugs are stable identifiers.
 */
type I18n = { ro: string; en: string; de: string };
const TAXONOMY: {
  slug: string;
  icon: string;
  name: I18n;
  children: { slug: string; name: I18n }[];
}[] = [
  {
    slug: 'constructii',
    icon: 'mdi-hammer',
    name: { ro: 'Construcții', en: 'Construction', de: 'Bau' },
    children: [
      { slug: 'acoperisuri', name: { ro: 'Acoperișuri', en: 'Roofing', de: 'Dachdecker' } },
      {
        slug: 'amenajari-interioare',
        name: { ro: 'Amenajări interioare', en: 'Interior fit-out', de: 'Innenausbau' },
      },
      {
        slug: 'zidarie',
        name: { ro: 'Zidărie & structuri', en: 'Masonry & structures', de: 'Mauerwerk' },
      },
      {
        slug: 'izolatii',
        name: { ro: 'Izolații termice', en: 'Thermal insulation', de: 'Wärmedämmung' },
      },
    ],
  },
  {
    slug: 'instalatii',
    icon: 'mdi-pipe-wrench',
    name: { ro: 'Instalații', en: 'Installations', de: 'Installationen' },
    children: [
      {
        slug: 'instalatii-sanitare',
        name: { ro: 'Instalații sanitare', en: 'Plumbing', de: 'Sanitärinstallation' },
      },
      {
        slug: 'instalatii-electrice',
        name: { ro: 'Instalații electrice', en: 'Electrical', de: 'Elektroinstallation' },
      },
      { slug: 'climatizare', name: { ro: 'Climatizare & HVAC', en: 'HVAC', de: 'Klimatechnik' } },
    ],
  },
  {
    slug: 'auto',
    icon: 'mdi-car-wrench',
    name: { ro: 'Auto & transport', en: 'Automotive', de: 'Auto' },
    children: [
      {
        slug: 'service-auto',
        name: { ro: 'Service auto', en: 'Car service', de: 'Autowerkstatt' },
      },
      {
        slug: 'tinichigerie',
        name: { ro: 'Tinichigerie & vopsitorie', en: 'Body & paint', de: 'Karosserie & Lack' },
      },
      {
        slug: 'vulcanizare',
        name: { ro: 'Vulcanizare & anvelope', en: 'Tyres', de: 'Reifenservice' },
      },
    ],
  },
  {
    slug: 'curatenie',
    icon: 'mdi-broom',
    name: { ro: 'Curățenie', en: 'Cleaning', de: 'Reinigung' },
    children: [
      {
        slug: 'curatenie-rezidentiala',
        name: { ro: 'Curățenie rezidențială', en: 'Home cleaning', de: 'Wohnungsreinigung' },
      },
      {
        slug: 'curatenie-birouri',
        name: { ro: 'Curățenie birouri', en: 'Office cleaning', de: 'Büroreinigung' },
      },
      {
        slug: 'curatenie-post-constructor',
        name: {
          ro: 'Curățenie după constructor',
          en: 'Post-construction cleaning',
          de: 'Bauendreinigung',
        },
      },
    ],
  },
  {
    slug: 'frumusete',
    icon: 'mdi-content-cut',
    name: { ro: 'Frumusețe & îngrijire', en: 'Beauty & care', de: 'Schönheit & Pflege' },
    children: [
      { slug: 'coafor', name: { ro: 'Coafor & frizerie', en: 'Hairdressers', de: 'Friseure' } },
      {
        slug: 'cosmetica',
        name: { ro: 'Cosmetică & make-up', en: 'Cosmetics & make-up', de: 'Kosmetik & Make-up' },
      },
      {
        slug: 'manichiura',
        name: { ro: 'Manichiură & pedichiură', en: 'Nail salons', de: 'Nagelstudios' },
      },
    ],
  },
  {
    slug: 'horeca',
    icon: 'mdi-silverware-fork-knife',
    name: { ro: 'Restaurante & catering', en: 'Food & catering', de: 'Gastronomie' },
    children: [
      { slug: 'restaurante', name: { ro: 'Restaurante', en: 'Restaurants', de: 'Restaurants' } },
      {
        slug: 'cafenele',
        name: { ro: 'Cafenele & patiserii', en: 'Cafés & bakeries', de: 'Cafés & Bäckereien' },
      },
      {
        slug: 'catering',
        name: { ro: 'Catering & evenimente', en: 'Catering & events', de: 'Catering & Events' },
      },
    ],
  },
  {
    slug: 'digital',
    icon: 'mdi-monitor',
    name: { ro: 'Servicii digitale', en: 'Digital services', de: 'Digitale Dienste' },
    children: [
      {
        slug: 'web-design',
        name: {
          ro: 'Web design & dezvoltare',
          en: 'Web design & development',
          de: 'Webdesign & Entwicklung',
        },
      },
      {
        slug: 'marketing-seo',
        name: { ro: 'Marketing & SEO', en: 'Marketing & SEO', de: 'Marketing & SEO' },
      },
      {
        slug: 'foto-video',
        name: { ro: 'Fotografie & video', en: 'Photography & video', de: 'Foto & Video' },
      },
    ],
  },
  {
    slug: 'sanatate',
    icon: 'mdi-hospital-box-outline',
    name: { ro: 'Sănătate', en: 'Health', de: 'Gesundheit' },
    children: [
      {
        slug: 'stomatologie',
        name: { ro: 'Cabinete stomatologice', en: 'Dental clinics', de: 'Zahnarztpraxen' },
      },
      {
        slug: 'kinetoterapie',
        name: { ro: 'Kinetoterapie & recuperare', en: 'Physiotherapy', de: 'Physiotherapie' },
      },
    ],
  },
  {
    slug: 'educatie',
    icon: 'mdi-school-outline',
    name: { ro: 'Educație', en: 'Education', de: 'Bildung' },
    children: [
      {
        slug: 'scoli-soferi',
        name: { ro: 'Școli de șoferi', en: 'Driving schools', de: 'Fahrschulen' },
      },
      {
        slug: 'meditatii',
        name: { ro: 'Meditații & cursuri', en: 'Tutoring & courses', de: 'Nachhilfe & Kurse' },
      },
    ],
  },
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
    slug: 'novak-bau-stuttgart',
    name: 'Novak Bau',
    categorySlug: 'amenajari-interioare',
    city: 'Stuttgart',
    country: 'DE',
    type: 'construction company',
    services: ['Full renovations', 'Extensions', 'Bathrooms', 'Drywall'],
    description:
      'Novak Bau is a construction team in Stuttgart doing full renovations and extensions for homes and small offices.',
    phone: '+49 711 123 456',
    email: 'kontakt@novakbau.de',
    featured: true,
    quality: 0.86,
    ageDays: 220,
  },
  {
    slug: 'lumina-electric-cluj',
    name: 'Lumina Electric',
    categorySlug: 'instalatii-electrice',
    city: 'Cluj-Napoca',
    region: 'Cluj',
    country: 'RO',
    type: 'electrical services',
    services: ['Panel upgrades', 'Wiring', 'EV chargers', 'Emergency callouts'],
    description:
      'Authorised electricians in Cluj-Napoca for homes and businesses. Same-day emergency callouts.',
    phone: '+40 722 100 200',
    email: 'office@luminaelectric.ro',
    featured: true,
    quality: 0.82,
    ageDays: 140,
  },
  {
    slug: 'aqua-fix-muenchen',
    name: 'AquaFix',
    categorySlug: 'instalatii-sanitare',
    city: 'München',
    country: 'DE',
    type: 'plumbing company',
    services: ['Leak detection', 'Boiler service', 'Drain unblocking', 'Bathroom fit-out'],
    description:
      'AquaFix handles plumbing emergencies and bathroom renovations across München with transparent pricing.',
    phone: '+49 89 555 010',
    email: 'hallo@aquafix.de',
    quality: 0.74,
    ageDays: 90,
  },
  {
    slug: 'acoperis-pro-timisoara',
    name: 'Acoperiș Pro',
    categorySlug: 'acoperisuri',
    city: 'Timișoara',
    region: 'Timiș',
    country: 'RO',
    type: 'roofing company',
    services: ['Roof repair', 'Full re-roofing', 'Gutters', 'Insulation'],
    description:
      'Roofing specialists in Timișoara: repairs, re-roofing and insulation with a 5-year workmanship guarantee.',
    phone: '+40 744 300 400',
    email: 'contact@acoperispro.ro',
    quality: 0.7,
    ageDays: 60,
  },
  {
    slug: 'sparkle-clean-berlin',
    name: 'Sparkle Clean',
    categorySlug: 'curatenie-birouri',
    city: 'Berlin',
    country: 'DE',
    type: 'cleaning service',
    services: ['Office cleaning', 'Move-out cleaning', 'Window cleaning'],
    description:
      'Reliable office and move-out cleaning in Berlin, insured teams, flexible scheduling.',
    phone: '+49 30 700 800',
    email: 'team@sparkleclean.de',
    quality: 0.63,
    ageDays: 30,
  },
  {
    slug: 'autotech-garage-bucuresti',
    name: 'AutoTech Garage',
    categorySlug: 'service-auto',
    city: 'București',
    country: 'RO',
    type: 'car service',
    services: ['Diagnostics', 'Brakes & suspension', 'AC service', 'Pre-purchase check'],
    description:
      'Independent car service in București with dealer-level diagnostics at fair prices.',
    phone: '+40 731 500 600',
    email: 'service@autotech.ro',
    quality: 0.68,
    ageDays: 45,
  },
  {
    slug: 'bistro-nordic-cluj',
    name: 'Bistro Nordic',
    categorySlug: 'restaurante',
    city: 'Cluj-Napoca',
    region: 'Cluj',
    country: 'RO',
    type: 'bistro restaurant',
    services: ['Lunch menu', 'Events & catering', 'Vegetarian menu'],
    description:
      'A small Nordic-inspired bistro in central Cluj-Napoca. Seasonal menu, weekday lunch, private events.',
    phone: '+40 726 111 222',
    email: 'hello@bistronordic.ro',
    quality: 0.71,
    ageDays: 12,
  },
  {
    slug: 'pixel-studio-web-stuttgart',
    name: 'Pixel Studio',
    categorySlug: 'web-design',
    city: 'Stuttgart',
    country: 'DE',
    type: 'web design studio',
    services: ['Website design', 'Branding', 'SEO', 'Webshops'],
    description:
      'Pixel Studio designs fast, modern websites and brand identities for local businesses in the Stuttgart area.',
    phone: '+49 711 909 100',
    email: 'studio@pixel.de',
    quality: 0.6,
    ageDays: 3,
  },
];

async function seedCategories() {
  const keep = new Set<string>();
  let pos = 0;
  let leafCount = 0;

  for (const parent of TAXONOMY) {
    keep.add(parent.slug);
    const p = await prisma.category.upsert({
      where: { slug: parent.slug },
      update: {
        nameI18n: parent.name,
        icon: parent.icon,
        position: pos,
        isActive: true,
        parentId: null,
      },
      create: { slug: parent.slug, nameI18n: parent.name, icon: parent.icon, position: pos },
    });
    pos += 1;

    let childPos = 0;
    for (const child of parent.children) {
      keep.add(child.slug);
      await prisma.category.upsert({
        where: { slug: child.slug },
        update: {
          nameI18n: child.name,
          icon: parent.icon,
          position: childPos,
          isActive: true,
          parentId: p.id,
        },
        create: {
          slug: child.slug,
          nameI18n: child.name,
          icon: parent.icon,
          position: childPos,
          parentId: p.id,
        },
      });
      childPos += 1;
      leafCount += 1;
    }
  }

  // Retire categories no longer in the taxonomy (kept for FK safety).
  await prisma.category.updateMany({
    where: { slug: { notIn: [...keep] } },
    data: { isActive: false },
  });

  console.log(`Seeded ${TAXONOMY.length} category groups / ${leafCount} niches.`);
}

async function demoOwner() {
  const email = 'demo-owner@totalvizibil.local';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      name: 'Demo Seed Owner',
      passwordHash: await argon2.hash('demo-seed-' + Date.now()),
    },
  });
}

async function seedAdmin() {
  const email = 'admin@totalvizibil.local';
  const password = 'admin1234';
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Platform Admin',
      passwordHash: await argon2.hash(password),
      passwordChangedAt: new Date(),
    },
  });
  await prisma.platformRoleAssignment.upsert({
    where: { userId_role: { userId: user.id, role: 'admin' } },
    update: {},
    create: { userId: user.id, role: 'admin' },
  });
  console.log(`Seeded platform admin: ${email} / ${password}`);
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
        data: {
          qualityScore: d.quality,
          featured: d.featured ?? false,
          status: 'active',
          categoryId: catId(d.categorySlug),
        },
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

async function seedPlatformSettings() {
  await prisma.platformSetting.upsert({
    where: { key: 'eur_ron_rate' },
    create: { key: 'eur_ron_rate', value: '5.05' },
    update: {},
  });
  console.log('Seeded platform settings (eur_ron_rate).');
}

async function main() {
  await seedCategories();
  await seedAdmin();
  await seedPlatformSettings();
  await seedCompanies();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
