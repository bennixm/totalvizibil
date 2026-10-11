/**
 * Feed ranking integration tests.
 *
 * Seeds real companies and verifies GET /feed returns them in the correct
 * visibility-score order.
 *
 * Visibility Score = CPC×0.50 + ResponseRate×0.20 + Plan×0.15 + Age×0.15
 *
 * CPC minimum = costPromovare (100 minor) + marjaProfit (10 minor) = 110 minor.
 * All test companies bid >= 110 to clear the eligibility floor.
 *
 * Equal-CPC tests isolate each non-CPC factor: same bid on both companies so
 * only the factor under test decides the ranking.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from 'src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { resetDb } from './helpers/db';
import { createUserDirect } from './helpers/auth';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => resetDb(prisma, app));

afterAll(async () => app.close());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedCategory() {
  const parent = await prisma.category.create({
    data: { slug: 'services', nameI18n: { ro: 'Servicii' }, isActive: true, position: 0 },
  });
  const leaf = await prisma.category.create({
    data: {
      slug: 'cleaning',
      nameI18n: { ro: 'Curățenie' },
      isActive: true,
      position: 0,
      parentId: parent.id,
    },
  });
  return { parent, leaf };
}

interface SeedCompanyOpts {
  slug: string;
  displayName: string;
  ownerUserId: string;
  categoryId: string;
  cpcMinor: number;
  dailyBudgetMinor?: number;
  appearFirst?: boolean;
  /** Banked active seconds — drives the age sub-score. */
  activeSecondsAccrued?: number;
  /** Website mode — 'advanced' scores 1.0, 'easy'/null scores 0.5. */
  websiteMode?: 'easy' | 'advanced';
  /** Campaign status, default 'active'. */
  campaignStatus?: 'active' | 'paused' | 'draft';
  /** If true, no campaign row is created at all. */
  noCampaign?: boolean;
  /** Location: nationwide (default) or a specific RO county. */
  county?: string;
}

async function seedFeedCompany(opts: SeedCompanyOpts) {
  const company = await prisma.company.create({
    data: {
      slug: opts.slug,
      displayName: opts.displayName,
      status: 'active',
      ownerUserId: opts.ownerUserId,
      categoryAssignments: {
        create: { categoryId: opts.categoryId, isPrimary: true },
      },
      locations: {
        create: opts.county
          ? { county: opts.county, isPrimary: true, nationwide: false }
          : { nationwide: true, isPrimary: true },
      },
      ...(!opts.noCampaign
        ? {
            campaign: {
              create: {
                status: opts.campaignStatus ?? 'active',
                cpcMinor: opts.cpcMinor,
                dailyBudgetMinor: opts.dailyBudgetMinor ?? 2000,
                appearFirst: opts.appearFirst ?? false,
                activeSecondsAccrued: opts.activeSecondsAccrued ?? 0,
              },
            },
          }
        : {}),
      ...(opts.websiteMode
        ? {
            website: {
              create: {
                mode: opts.websiteMode,
                status: 'published',
                theme: {},
                content: {},
              },
            },
          }
        : {}),
    },
  });

  return company;
}

/** Seed N leads for a company. Responded leads have firstResponseAt = createdAt (0-minute response). */
async function seedLeads(
  companyId: string,
  total: number,
  responded: number,
) {
  await prisma.lead.createMany({
    data: Array.from({ length: total }, (_, i) => ({
      companyId,
      channel: 'form' as const,
      visitorHash: `test-hash-${companyId}-${i}`,
      firstResponseAt: i < responded ? new Date() : null,
    })),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feed ranking', () => {
  describe('GET /feed?category=cleaning', () => {
    // CPC sub-score (weight 0.50)
    it('higher CPC bid ranks first', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const companyA = await seedFeedCompany({
        slug: 'acme-srl',
        displayName: 'Acme SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 300,
      });
      const companyB = await seedFeedCompany({
        slug: 'beta-srl',
        displayName: 'Beta SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 150,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].id).toBe(companyA.id);
      expect(res.body.items[1].id).toBe(companyB.id);
    });

    // appearFirst boost (+0.25 on top of visibility score)
    it('appearFirst boost overrides a lower CPC bid and jumps to top', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      await seedFeedCompany({
        slug: 'acme-srl',
        displayName: 'Acme SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 300,
      });
      const boosted = await seedFeedCompany({
        slug: 'boosted-srl',
        displayName: 'Boosted SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 150,
        appearFirst: true,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items[0].id).toBe(boosted.id);
    });

    // Response rate sub-score (weight 0.20)
    // Equal CPC — only response history differs.
    // A: 0 leads → neutral 0.5   score = 0.5*1.0 + 0.20*0.5 + 0.15*0.5 = 0.675
    // B: 10/10 led. instant resp. → 1.0  score = 0.5*1.0 + 0.20*1.0 + 0.15*0.5 = 0.775
    it('better response rate ranks higher when CPC is equal', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const noResponse = await seedFeedCompany({
        slug: 'no-response-srl',
        displayName: 'No Response SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
      });
      const fastResponse = await seedFeedCompany({
        slug: 'fast-response-srl',
        displayName: 'Fast Response SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
      });
      await seedLeads(fastResponse.id, 10, 10);

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].id).toBe(fastResponse.id);
      expect(res.body.items[1].id).toBe(noResponse.id);
    });

    // Plan sub-score (weight 0.15)
    // Equal CPC — only website plan differs.
    // easy:     score = 0.5*1.0 + 0.20*0.5 + 0.15*0.5 + 0 = 0.675
    // advanced: score = 0.5*1.0 + 0.20*0.5 + 0.15*1.0 + 0 = 0.750
    it('advanced website plan ranks higher than easy plan when CPC is equal', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const easyPlan = await seedFeedCompany({
        slug: 'easy-srl',
        displayName: 'Easy SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        websiteMode: 'easy',
      });
      const advancedPlan = await seedFeedCompany({
        slug: 'advanced-srl',
        displayName: 'Advanced SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        websiteMode: 'advanced',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].id).toBe(advancedPlan.id);
      expect(res.body.items[1].id).toBe(easyPlan.id);
    });

    // Age sub-score (weight 0.15)
    // Equal CPC — only activeSecondsAccrued differs.
    // 0 days:  score = 0.5*1.0 + 0.20*0.5 + 0.15*0.5 + 0.15*0     = 0.675
    // 20 days: score = 0.5*1.0 + 0.20*0.5 + 0.15*0.5 + 0.15*0.667 = 0.775
    it('longer-running campaign ranks higher when CPC is equal', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const freshCampaign = await seedFeedCompany({
        slug: 'fresh-srl',
        displayName: 'Fresh SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        activeSecondsAccrued: 0,
      });
      const veteranCampaign = await seedFeedCompany({
        slug: 'veteran-srl',
        displayName: 'Veteran SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        activeSecondsAccrued: 20 * 86_400,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].id).toBe(veteranCampaign.id);
      expect(res.body.items[1].id).toBe(freshCampaign.id);
    });

    // Eligibility floor
    it('company below CPC minimum (< 110 minor) does not appear', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const eligible = await seedFeedCompany({
        slug: 'acme-srl',
        displayName: 'Acme SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
      });
      await seedFeedCompany({
        slug: 'cheap-srl',
        displayName: 'Cheap SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 50,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(eligible.id);
    });

    it('inactive company does not appear even with a high bid', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      await seedFeedCompany({
        slug: 'acme-srl',
        displayName: 'Acme SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 300,
      });
      const inactive = await seedFeedCompany({
        slug: 'inactive-srl',
        displayName: 'Inactive SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 500,
      });
      await prisma.company.update({ where: { id: inactive.id }, data: { status: 'draft' } });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).not.toBe(inactive.id);
    });

    // Paused campaign — active company status is not enough
    it('company with paused campaign does not appear', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const active = await seedFeedCompany({
        slug: 'active-srl',
        displayName: 'Active SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
      });
      await seedFeedCompany({
        slug: 'paused-srl',
        displayName: 'Paused SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 500,
        campaignStatus: 'paused',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(active.id);
    });

    // No campaign row at all
    it('company with no campaign does not appear', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const withCampaign = await seedFeedCompany({
        slug: 'with-campaign-srl',
        displayName: 'With Campaign SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
      });
      await seedFeedCompany({
        slug: 'no-campaign-srl',
        displayName: 'No Campaign SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        noCampaign: true,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(withCampaign.id);
    });

    // County filter — county-specific company hidden from other county search
    it('county-specific company does not appear in different county search', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      await seedFeedCompany({
        slug: 'cluj-srl',
        displayName: 'Cluj SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        county: 'Cluj',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning&county=Iași')
        .expect(200);

      expect(res.body.items).toHaveLength(0);
    });

    // Nationwide company appears in any county search
    it('nationwide company appears in any county search', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const nationwide = await seedFeedCompany({
        slug: 'nationwide-srl',
        displayName: 'Nationwide SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        // no county → defaults to nationwide: true
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning&county=Cluj')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(nationwide.id);
    });

    // Budget adequacy — underfunded daily budget drives CPC score down
    // budgetRef = 2000 minor. A: budget 2000 (adequacy 1.0). B: budget 200 (adequacy 0.1).
    // Same bid 200, cpcRef 200.
    // A CPC score = min(1.0, 1.0) = 1.0 → score ≈ 0.675
    // B CPC score = min(1.0, 0.1) = 0.1 → score ≈ 0.225
    it('higher daily budget wins when CPC bid is equal', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      const wellFunded = await seedFeedCompany({
        slug: 'well-funded-srl',
        displayName: 'Well Funded SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        dailyBudgetMinor: 2000,
      });
      const underfunded = await seedFeedCompany({
        slug: 'underfunded-srl',
        displayName: 'Underfunded SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 200,
        dailyBudgetMinor: 200,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].id).toBe(wellFunded.id);
      expect(res.body.items[1].id).toBe(underfunded.id);
    });

    // Wrong category — company not shown in unrelated category
    it('company does not appear in a different category search', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf: cleaningLeaf } = await seedCategory();

      // Seed a second unrelated category
      const parent2 = await prisma.category.create({
        data: { slug: 'construction', nameI18n: { ro: 'Construcții' }, isActive: true, position: 1 },
      });
      const plumbingLeaf = await prisma.category.create({
        data: {
          slug: 'plumbing',
          nameI18n: { ro: 'Instalații' },
          isActive: true,
          position: 0,
          parentId: parent2.id,
        },
      });

      await seedFeedCompany({
        slug: 'cleaning-srl',
        displayName: 'Cleaning SRL',
        ownerUserId: owner.id,
        categoryId: cleaningLeaf.id,
        cpcMinor: 200,
      });

      // Search plumbing — cleaning company must not appear
      const res = await request(app.getHttpServer())
        .get(`/api/v1/feed?category=${plumbingLeaf.slug}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
    });

    // Combined-factors gauntlet — 5 companies, non-obvious rank order.
    //
    // cpcRef = max(500, 400, 250, 500, 110) = 500 (highest bid among all eligible peers)
    // budgetRef = 2000 minor
    //
    // A (champion):      cpc=1.00 rr≈1.00 plan=1.00 age=1.00  → score ≈ 1.000
    // C (mid + maxed):   cpc=0.50 rr≈1.00 plan=1.00 age=1.00  → score ≈ 0.750
    // B (high bid weak): cpc=0.80 rr=0.50 plan=0.50 age=0.00  → score ≈ 0.575
    // E (min viable):    cpc=0.22 rr=0.50 plan=0.50 age=0.00  → score ≈ 0.285
    // D (budget-starved):cpc=0.15 rr=0.50 plan=0.50 age=0.00  → score ≈ 0.250
    //
    // Key insights verified:
    //   - C (250 bid) outranks B (400 bid) — better response/plan/age compensate
    //   - D (500 bid) ranks last — budget adequacy (300/2000=0.15) collapses cpcScore
    it('full gauntlet: 5 companies produce correct rank order across all factors', async () => {
      const owner = await createUserDirect(prisma, { email: 'owner@example.com', name: 'Owner' });
      const { leaf } = await seedCategory();

      // A: max bid + all factors maxed
      const companyA = await seedFeedCompany({
        slug: 'champion-srl',
        displayName: 'Champion SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 500,
        dailyBudgetMinor: 2000,
        websiteMode: 'advanced',
        activeSecondsAccrued: 30 * 86_400,
      });
      await seedLeads(companyA.id, 10, 10);

      // B: high bid but all other factors at floor
      const companyB = await seedFeedCompany({
        slug: 'high-bidder-srl',
        displayName: 'High Bidder SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 400,
        dailyBudgetMinor: 2000,
      });

      // C: mid bid + all other factors maxed → beats B despite lower bid
      const companyC = await seedFeedCompany({
        slug: 'mid-bidder-srl',
        displayName: 'Mid Bidder SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 250,
        dailyBudgetMinor: 2000,
        websiteMode: 'advanced',
        activeSecondsAccrued: 30 * 86_400,
      });
      await seedLeads(companyC.id, 10, 10);

      // D: same bid as A but daily budget 300 → adequacy 0.15 → cpcScore collapses to 0.15
      const companyD = await seedFeedCompany({
        slug: 'budget-starved-srl',
        displayName: 'Budget Starved SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 500,
        dailyBudgetMinor: 300,
      });

      // E: exactly at CPC floor (110), full budget
      const companyE = await seedFeedCompany({
        slug: 'minimum-viable-srl',
        displayName: 'Minimum Viable SRL',
        ownerUserId: owner.id,
        categoryId: leaf.id,
        cpcMinor: 110,
        dailyBudgetMinor: 2000,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed?category=cleaning')
        .expect(200);

      expect(res.body.items).toHaveLength(5);
      const ids = res.body.items.map((item: { id: string }) => item.id);
      expect(ids[0]).toBe(companyA.id); // best across all factors
      expect(ids[1]).toBe(companyC.id); // mid-bid + maxed factors beats high-bid + floor factors
      expect(ids[2]).toBe(companyB.id);
      expect(ids[3]).toBe(companyE.id);
      expect(ids[4]).toBe(companyD.id); // budget-starved ranks last despite matching A's bid
    });
  });
});
