/**
 * One-off synthetic traffic generator for the LOCAL dev environment —
 * users, businesses (active, published websites), funded wallets, running
 * campaigns, and 14 days of backdated click/lead history so the site
 * "looks alive" for demos. Mirrors the real billing mechanics exactly
 * (see WalletService.chargeClickWithin): one AdClick row per click + one
 * rolled-up WalletTransaction per company per UTC day, same unique-key
 * shape the real charge path uses — so the admin panel and the owner's own
 * Consumption/Campaign pages read consistent numbers, not just a balance
 * that happens to look right.
 *
 * Scratch script — not part of the committed seed pipeline. Run with:
 *   npx ts-node --transpile-only scripts/seed-traffic.ts
 * Delete after running.
 */
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { RO_CITIES } from '../src/geo/ro-cities';

const prisma = new PrismaClient();

const DAYS = 14;
const DAY_MS = 86_400_000;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function fakeHash(seed: string): string {
  return createHash('sha256').update(seed + randomUUID()).digest('hex');
}

const FIRST_NAMES = ['Andrei', 'Maria', 'Ion', 'Elena', 'Cristian', 'Ioana', 'Radu', 'Ana', 'Mihai', 'Diana'];
const LAST_NAMES = ['Popescu', 'Ionescu', 'Popa', 'Dumitrescu', 'Stan', 'Gheorghe', 'Constantin', 'Marin', 'Tudor', 'Nistor'];

const BUSINESS_TEMPLATES: Record<string, { names: string[]; services: string[] }> = {
  'spalatorie-detailing-auto': {
    names: ['CleanCar Detailing', 'ShinyWheels Auto Spa', 'Polish Pro'],
    services: ['Spălare exterior', 'Detailing interior', 'Polish caroserie', 'Tratament ceramic'],
  },
  curatenie: {
    names: ['CurățimTot', 'SparkleHome', 'PerfectClean'],
    services: ['Curățenie apartamente', 'Curățenie birouri', 'Curățenie după renovare'],
  },
  'salon-coafura': {
    names: ['StudioHair', 'Bella Coafor', 'Style Lounge'],
    services: ['Tuns & coafat', 'Vopsit', 'Tratamente păr', 'Styling evenimente'],
  },
  restaurant: {
    names: ['La Bunica', 'Taverna Veche', 'Bistro Central'],
    services: ['Meniu zilnic', 'Evenimente private', 'Catering', 'Livrare'],
  },
  cafenea: {
    names: ['Colț de Cafea', 'Espresso Bar', 'Cafeneaua Mică'],
    services: ['Cafea specialty', 'Prăjituri de casă', 'Mic dejun', 'Spațiu de lucru'],
  },
  'clinica-stomatologica': {
    names: ['DentalCare Plus', 'Zâmbet Perfect', 'Clinica Dr. Ionescu'],
    services: ['Consultații', 'Albire dentară', 'Implanturi', 'Ortodonție'],
  },
  'service-auto': {
    names: ['AutoExpert Service', 'MotorFix', 'GarajulTău'],
    services: ['Diagnoză computerizată', 'Schimb ulei', 'Reparații frâne', 'ITP'],
  },
  instalatii: {
    names: ['InstalSanitar Pro', 'ElectroInstal', 'Tehnician Rapid'],
    services: ['Instalații sanitare', 'Instalații electrice', 'Intervenții urgență', 'Reparații'],
  },
  'constructii-renovari': {
    names: ['RenovExpert', 'ConstructPro', 'CasaNouă Construct'],
    services: ['Renovări complete', 'Amenajări interioare', 'Zugrăveli', 'Gips-carton'],
  },
  vulcanizare: {
    names: ['AnvelopePro', 'VulcanizareRapidă', 'TireCenter'],
    services: ['Montaj anvelope', 'Echilibrare roți', 'Depozitare sezonieră', 'Reparații pană'],
  },
};

async function main() {
  const leaves = await prisma.category.findMany({
    where: { isActive: true, parentId: { not: null } },
    include: { parent: true },
  });
  if (!leaves.length) throw new Error('No leaf categories found — nothing to assign businesses to.');

  const counties = ['Cluj', 'Timiș', 'Iași', 'Brașov', 'Constanța', 'București', 'Sibiu', 'Dolj', 'Bihor', 'Argeș'];

  let created = 0;
  for (let i = 0; i < leaves.length; i++) {
    const cat = leaves[i];
    const county = counties[i % counties.length];
    const tpl = BUSINESS_TEMPLATES[cat.slug] ?? { names: [cat.nameI18n['ro'] + ' Expert'], services: ['Consultanță', 'Servicii'] };
    const bizName = pick(tpl.names) + ' ' + county;
    const ownerFirst = pick(FIRST_NAMES);
    const ownerLast = pick(LAST_NAMES);
    const ownerName = `${ownerFirst} ${ownerLast}`;
    const slug = slugify(bizName) + '-' + randomUUID().slice(0, 6);
    const email = `seed.${slugify(ownerFirst)}.${slugify(ownerLast)}.${randomUUID().slice(0, 6)}@example.com`;

    const city = RO_CITIES.find((c) => c.county === county) ?? null;

    const createdAt = new Date(Date.now() - (DAYS + randInt(2, 6)) * DAY_MS);

    // --- owner + wallet ---
    const owner = await prisma.user.create({
      data: {
        email,
        name: ownerName,
        passwordHash: await argon2.hash('SeedTraffic1234!'),
        emailVerifiedAt: createdAt,
        createdAt,
      },
    });

    // --- company + website + category + location + contacts + services ---
    const cpcMinor = randInt(80, 200);
    const dailyBudgetMinor = randInt(2000, 6000);

    const company = await prisma.company.create({
      data: {
        slug,
        displayName: bizName,
        legalName: `${bizName} SRL`,
        description: `${bizName} oferă ${tpl.services[0].toLowerCase()} și alte servicii de calitate în ${county}.`,
        categoryId: cat.id,
        status: 'active',
        country: 'RO',
        defaultLocale: 'ro',
        currency: 'RON',
        ownerUserId: owner.id,
        claimedAt: createdAt,
        createdAt,
        qualityScore: Math.random() * 0.4 + 0.5,
        members: { create: { userId: owner.id, role: 'owner', status: 'active' } },
        categoryAssignments: { create: { categoryId: cat.id, isPrimary: true } },
        locations: {
          create: {
            city: city?.name ?? county,
            county,
            country: 'RO',
            isPrimary: true,
            lat: city?.lat ?? null,
            lng: city?.lng ?? null,
          },
        },
        contacts: {
          createMany: {
            data: [
              { type: 'phone', value: `+40 7${randInt(10, 99)} ${randInt(100, 999)} ${randInt(100, 999)}` },
              { type: 'email', value: email },
            ],
          },
        },
        services: {
          createMany: { data: tpl.services.map((name, idx) => ({ name, position: idx })) },
        },
        website: {
          create: {
            mode: 'easy',
            status: 'published',
            generator: 'seed-traffic-v1',
            theme: { palette: 'indigo', fontPair: 'grotesk-inter', radius: 'rounded', density: 'comfortable' } as unknown as Prisma.InputJsonValue,
            content: {
              pages: [
                {
                  slug: 'home',
                  title: bizName,
                  isHome: true,
                  sections: [
                    { id: randomUUID(), type: 'hero', visible: true, headline: `${bizName} — ${tpl.services[0]}`, subheadline: `Servicii de încredere în ${county}.`, primaryCta: 'Cere ofertă', secondaryCta: 'Vezi serviciile' },
                    { id: randomUUID(), type: 'about', visible: true, title: `Despre ${bizName}`, body: `${bizName} deservește clienți din ${county} cu profesionalism.` },
                    { id: randomUUID(), type: 'services', visible: true, title: 'Ce facem', items: tpl.services.map((name) => ({ name, description: `${name} la cele mai înalte standarde.` })) },
                    { id: randomUUID(), type: 'contact', visible: true, title: 'Contact', city: city?.name ?? county },
                  ],
                },
              ],
              seo: { title: `${bizName} — ${county}`, description: `${bizName} oferă servicii de calitate în ${county}.`, schemaType: 'LocalBusiness' },
            } as unknown as Prisma.InputJsonValue,
          },
        },
        campaign: {
          create: {
            status: 'active',
            dailyBudgetMinor,
            cpcMinor,
            appearFirst: Math.random() > 0.6,
            autoOptimize: false,
            activatedAt: createdAt,
            activeSecondsAccrued: 0,
          },
        },
      },
    });

    // --- historical clicks + daily wallet-transaction rollups ---
    const wallet = await prisma.wallet.upsert({ where: { userId: owner.id }, create: { userId: owner.id }, update: {} });
    let totalSpentMinor = 0;
    const popularity = Math.random() * 0.7 + 0.3; // 0.3–1.0, varies traffic per business
    for (let dAgo = DAYS - 1; dAgo >= 0; dAgo--) {
      const dayStart = startOfUtcDay(new Date(Date.now() - dAgo * DAY_MS));
      const clicksToday = Math.random() < 0.15 ? 0 : Math.round(randInt(0, 9) * popularity);
      if (clicksToday === 0) continue;

      const clickRows: Prisma.AdClickCreateManyInput[] = [];
      for (let c = 0; c < clicksToday; c++) {
        const at = new Date(dayStart.getTime() + randInt(8, 22) * 3_600_000 + randInt(0, 3_599_000));
        clickRows.push({
          companyId: company.id,
          visitorHash: fakeHash(company.id + dayStart.toISOString() + c),
          billed: true,
          costMinor: cpcMinor,
          feedCounty: county,
          feedCategoryId: cat.id,
          createdAt: at,
        });
      }
      await prisma.adClick.createMany({ data: clickRows });

      const dayTotalMinor = clicksToday * cpcMinor;
      totalSpentMinor += dayTotalMinor;

      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          companyId: company.id,
          type: 'spend',
          status: 'completed',
          provider: 'cpc',
          spendDay: dayStart,
          clickCount: clicksToday,
          amountMinor: -dayTotalMinor,
          description: 'Ad clicks',
          createdAt: new Date(dayStart.getTime() + 23 * 3_600_000),
        },
      });
    }

    // --- leads (cereri) spread across the window ---
    const leadCount = randInt(2, 6);
    for (let l = 0; l < leadCount; l++) {
      const dAgo = randInt(0, DAYS - 1);
      const at = new Date(Date.now() - dAgo * DAY_MS - randInt(0, 20) * 3_600_000);
      const channel = Math.random() > 0.5 ? 'form' : 'call';
      const resolved = Math.random() > 0.4;
      const responded = resolved || Math.random() > 0.5;
      const firstResponseAt = responded ? new Date(at.getTime() + randInt(1, 6) * 3_600_000) : null;
      await prisma.lead.create({
        data: {
          companyId: company.id,
          channel,
          status: resolved ? 'resolved' : responded ? 'seen' : 'new',
          name: channel === 'form' ? `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}` : null,
          email: channel === 'form' ? `client${randInt(1, 999)}@example.com` : null,
          phone: channel === 'form' ? null : `+40 7${randInt(10, 99)} ${randInt(100, 999)} ${randInt(100, 999)}`,
          message: channel === 'form' ? `Bună, aș avea nevoie de ${pick(tpl.services).toLowerCase()}. Mă puteți contacta?` : null,
          visitorHash: fakeHash(company.id + 'lead' + l),
          firstResponseAt,
          respondedVia: firstResponseAt ? pick(['email', 'phone', 'quick_reply']) : null,
          resolvedAt: resolved ? new Date((firstResponseAt ?? at).getTime() + randInt(1, 48) * 3_600_000) : null,
          createdAt: at,
        },
      });
    }

    // --- fund the wallet: enough to cover everything spent + a remaining buffer ---
    const bufferMinor = randInt(3000, 15000);
    const totalFundedMinor = totalSpentMinor + bufferMinor;
    await prisma.wallet.update({
      where: { userId: owner.id },
      data: { balanceMinor: bufferMinor, currency: 'RON' },
    });
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'purchase',
        status: 'completed',
        amountMinor: totalFundedMinor,
        eurCents: totalFundedMinor,
        description: 'Achiziție credite',
        createdAt,
      },
    });

    // spentTodayMinor / spendDay for the campaign (whatever "today" accrued above).
    const todayStart = startOfUtcDay(new Date());
    const todaySpentMinor = -(
      (await prisma.walletTransaction.findFirst({
        where: { companyId: company.id, provider: 'cpc', spendDay: todayStart },
        select: { amountMinor: true },
      }))?.amountMinor ?? 0
    );
    await prisma.campaign.update({
      where: { companyId: company.id },
      data: { spentTodayMinor: todaySpentMinor, spendDay: todayStart },
    });

    created++;
    console.log(`[${created}/${leaves.length}] ${bizName} — ${county} — ${cat.slug} — spent ${(totalSpentMinor / 100).toFixed(2)} cr, balance ${(bufferMinor / 100).toFixed(2)} cr, ${leadCount} leads`);
  }

  console.log(`\nDone. Created ${created} businesses with funded wallets, active campaigns, ${DAYS}-day click history, and leads.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
