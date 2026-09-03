import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Max decoded size for an uploaded website image. */
const MAX_ASSET_BYTES = 4_500_000;
const DATA_URI_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

/** Section-image slots the Advanced builder can upload to. */
export const BUILDER_ASSET_KINDS = ['hero', 'gallery', 'team', 'logo', 'about'] as const;
export type BuilderAssetKind = (typeof BUILDER_ASSET_KINDS)[number];

@Injectable()
export class WebsiteAssetService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string): Promise<{ mime: string; bytes: Buffer }> {
    const row = await this.prisma.websiteAsset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('asset_not_found');
    return { mime: row.mime, bytes: Buffer.from(row.bytes) };
  }

  private decode(dataUri: string): { mime: string; bytes: Buffer } {
    const m = DATA_URI_RE.exec(dataUri.trim());
    if (!m) throw new BadRequestException('bad_image');
    const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
    if (bytes.length === 0) throw new BadRequestException('bad_image');
    if (bytes.length > MAX_ASSET_BYTES) throw new BadRequestException('image_too_large');
    return { mime: m[1], bytes };
  }

  /** Store a base64 image against a company (Advanced builder). Returns its URL. */
  async addCompanyAsset(
    companyId: string,
    dataUri: string,
    kind: string,
  ): Promise<{ id: string; url: string }> {
    if (!BUILDER_ASSET_KINDS.includes(kind as BuilderAssetKind)) {
      throw new BadRequestException('bad_kind');
    }
    const count = await this.prisma.websiteAsset.count({ where: { companyId } });
    if (count >= 60) throw new BadRequestException('asset_limit');
    const { mime, bytes } = this.decode(dataUri);
    const row = await this.prisma.websiteAsset.create({
      data: { companyId, kind, mime, bytes, size: bytes.length },
    });
    return { id: row.id, url: `/api/v1/website-assets/${row.id}` };
  }
}
