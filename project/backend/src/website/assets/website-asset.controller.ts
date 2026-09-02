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
    res.end(bytes);
  }
}
