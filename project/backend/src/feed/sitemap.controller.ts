import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Public pages that never change address (the app's own routes). */
const STATIC_PATHS = [
  '/',
  '/start',
  '/create',
  '/google-ads',
  '/ghid',
  '/ghid/site-simplu',
  '/ghid/builder-avansat',
  '/ghid/optimizare-google-ads',
];
/** One sitemap file holds at most 50 000 addresses. */
const MAX_URLS = 50_000;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * `/sitemap.xml` for search engines (nginx forwards it here, see
 * deploy/nginx/totalvizibil.conf): the public pages, every active category
 * feed and every active business page, at the same flat SEO paths the app
 * uses (frontend/src/services/routes.ts `companyCrumbs`).
 */
@Controller('sitemap.xml')
export class SitemapController {
  private readonly origin: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.origin = config.get('frontendOrigin', { infer: true }).replace(/\/$/, '');
  }

  @Get()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemap(): Promise<string> {
    const [categories, companies] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        select: { slug: true, parent: { select: { slug: true, isActive: true } } },
      }),
      this.prisma.company.findMany({
        where: { status: 'active' },
        select: {
          slug: true,
          updatedAt: true,
          category: { select: { slug: true, parent: { select: { slug: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: MAX_URLS,
      }),
    ]);
    const urls: { path: string; lastmod?: Date }[] = [
      ...STATIC_PATHS.map((path) => ({ path })),
      ...categories
        .filter((c) => !c.parent || c.parent.isActive)
        .map((c) => ({ path: `/${c.parent ? `${c.parent.slug}/` : ''}${c.slug}` })),
      ...companies.map((c) => ({
        path: `/${[c.category?.parent?.slug, c.category?.slug, c.slug].filter(Boolean).join('/')}`,
        lastmod: c.updatedAt,
      })),
    ].slice(0, MAX_URLS);
    const body = urls
      .map(
        (u) =>
          `<url><loc>${esc(this.origin + u.path)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`,
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
  }
}
