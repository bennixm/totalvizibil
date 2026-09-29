import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WebsiteAssetService } from './website-asset.service';

/**
 * Public image delivery for Simple-site assets (landing background, portfolio
 * photos). URLs are content-addressed by row id and immutable, so they cache
 * hard. Referenced from `Website.content` / draft content JSON.
 */
@Controller('website-assets')
export class WebsiteAssetController {
  constructor(private readonly assets: WebsiteAssetService) {}

  @Get(':id')
  async serve(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const { mime, bytes } = await this.assets.get(id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // These are public, content-addressed, immutable images meant to be
    // embeddable anywhere they're referenced — the PRO V2 builder's live
    // preview (StackBlitz's WebContainer, a genuinely cross-origin sandbox)
    // included. Helmet's default `Cross-Origin-Resource-Policy: same-origin`
    // blocks exactly that (browser console: net::ERR_BLOCKED_BY_RESPONSE,
    // "NotSameOrigin") even though the image loads fine same-origin (the
    // public site, the dashboard preview) — override it for this endpoint
    // only, since nothing here is sensitive or auth-gated.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(bytes);
  }
}
