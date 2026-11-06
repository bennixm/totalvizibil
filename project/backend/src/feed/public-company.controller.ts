import {
  Controller,
  Get,
  Headers,
  Ip,
  Logger,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CampaignService } from '../campaigns/campaign.service';
import { PublicCompanyViewQueryDto } from './dto/public-company-view.dto';
import { PublicCompanyService } from './public-company.service';

@Controller('public/companies')
export class PublicCompanyController {
  private readonly logger = new Logger(PublicCompanyController.name);

  constructor(
    private readonly svc: PublicCompanyService,
    private readonly campaigns: CampaignService,
  ) {}

  /**
   * The public listing page's data. Same generous 300/min as `FeedController`'s
   * `list`/`facets` — most loads here are plain organic/SEO browsing, not
   * billable clicks, so it isn't throttled like a billing endpoint; the
   * precise per-(company, IP) anti-fraud cap on the billing SIDE of this
   * (`CampaignService.registerClick`'s `ipClickWindowLimit`) is what actually
   * bounds abuse of the `click=1` signal below.
   *
   * `click=1` (see `PublicCompanyViewQueryDto`) bills this visit's CPC the
   * same way the old `POST /feed/click` beacon did — folded into THIS
   * request, which the page cannot render without, instead of a separate
   * fire-and-forget call. That separate call was a real revenue leak: its
   * URL (literally containing "click") is exactly what ad-blocking /
   * tracking-protection extensions filter by default, so a real visitor's
   * click would silently never reach the backend. Fire-and-forget on purpose
   * — billing failure must never fail the page load the visitor is waiting on.
   */
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Get(':slug')
  async bySlug(
    @Param('slug') slug: string,
    @Query() query: PublicCompanyViewQueryDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const company = await this.svc.bySlug(slug);
    if (query.click === '1') {
      this.campaigns
        .registerClick(
          company.id,
          ip,
          userAgent,
          { categorySlug: query.category, county: query.county },
          query.gclid,
          query.vid,
        )
        .catch((err) => {
          // Never let a billing hiccup surface as a broken page load.
          this.logger.error('registerClick failed for a feed click-through', err);
        });
    }
    return company;
  }

  // Website Builder's published static bundle, served for the public page's
  // iframe. `index.html` first so an asset path never shadows it.
  @Get(':companyId/site/index.html')
  async siteIndex(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.serveBundleFile(companyId, 'index.html', res);
  }

  @Get(':companyId/site/*path')
  async siteAsset(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('path') path: string | string[],
    @Res() res: Response,
  ): Promise<void> {
    // Express 5's wildcard capture comes through as a string[] of segments.
    await this.serveBundleFile(companyId, Array.isArray(path) ? path.join('/') : path, res);
  }

  private async serveBundleFile(companyId: string, path: string, res: Response): Promise<void> {
    const { mime, bytes } = await this.svc.bundleFile(companyId, path);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', bytes.length);
    // Every app page carries Cross-Origin-Embedder-Policy: credentialless
    // (needed for the Website Builder's WebContainer sandbox — see
    // deploy/nginx/website-builder-headers.conf), which makes those pages
    // cross-origin-isolated. A cross-origin-isolated document can only embed
    // an iframe whose OWN response also declares a compatible COEP — even
    // for a same-origin frame — otherwise the browser blocks it outright.
    // This is that frame: the published-site preview in CompanyPublicView
    // and the dashboard's "View site" dialog.
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    // `index.html` can change on every publish; hashed asset filenames never
    // change content under the same name, so they can cache hard.
    res.setHeader(
      'Cache-Control',
      path === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    );
    res.end(bytes);
  }
}
