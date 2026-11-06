import 'reflect-metadata';
import { PublicCompanyController } from 'src/feed/public-company.controller';

const THROTTLER_TTL = 'THROTTLER:TTL';
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

function fakeSvc(company: any) {
  return { bySlug: jest.fn().mockResolvedValue(company), bundleFile: jest.fn() };
}

function fakeCampaigns() {
  return { registerClick: jest.fn().mockResolvedValue({ billed: true }) };
}

describe('PublicCompanyController', () => {
  it('carries a finite per-method rate limit (serves both organic page loads and billable click-throughs)', () => {
    const ttl = Reflect.getMetadata(
      `${THROTTLER_TTL}default`,
      PublicCompanyController.prototype.bySlug,
    );
    const limit = Reflect.getMetadata(
      `${THROTTLER_LIMIT}default`,
      PublicCompanyController.prototype.bySlug,
    );
    expect(ttl).toBe(60_000);
    expect(limit).toBe(300);
  });

  // ---------------------------------------------------------------------
  // This request is what replaced the separate POST /feed/click beacon as
  // the billing trigger (see the class's doc comment) — it must register a
  // click when, and only when, the page load actually followed a feed
  // click-through (`click=1`), never for a plain/organic page view.
  // ---------------------------------------------------------------------
  describe('bySlug', () => {
    it('registers a click when the query carries click=1', async () => {
      const svc = fakeSvc({ id: 'co1', slug: 'acme' });
      const campaigns = fakeCampaigns();
      const ctrl = new PublicCompanyController(svc as any, campaigns as any);

      await ctrl.bySlug(
        'acme',
        { click: '1', category: 'reparatii-auto', county: 'CJ', gclid: 'g1', vid: 'v1' },
        '1.2.3.4',
        'Mozilla/5.0',
      );

      expect(campaigns.registerClick).toHaveBeenCalledWith(
        'co1',
        '1.2.3.4',
        'Mozilla/5.0',
        { categorySlug: 'reparatii-auto', county: 'CJ' },
        'g1',
        'v1',
      );
    });

    it('never registers a click for a plain page load (no click=1)', async () => {
      const svc = fakeSvc({ id: 'co1', slug: 'acme' });
      const campaigns = fakeCampaigns();
      const ctrl = new PublicCompanyController(svc as any, campaigns as any);

      await ctrl.bySlug('acme', {}, '1.2.3.4', 'Mozilla/5.0');

      expect(campaigns.registerClick).not.toHaveBeenCalled();
    });

    it('still returns the page data even when registerClick rejects', async () => {
      const svc = fakeSvc({ id: 'co1', slug: 'acme' });
      const campaigns = { registerClick: jest.fn().mockRejectedValue(new Error('db blip')) };
      const ctrl = new PublicCompanyController(svc as any, campaigns as any);

      const result = await ctrl.bySlug('acme', { click: '1' }, '1.2.3.4', 'Mozilla/5.0');

      expect(result).toEqual({ id: 'co1', slug: 'acme' });
      // Let the rejected promise's catch handler run before the test exits.
      await new Promise((r) => setImmediate(r));
    });
  });
});
