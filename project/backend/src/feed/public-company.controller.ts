import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicCompanyService } from './public-company.service';

@Controller('public/companies')
export class PublicCompanyController {
  constructor(private readonly svc: PublicCompanyService) {}

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.svc.bySlug(slug);
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
