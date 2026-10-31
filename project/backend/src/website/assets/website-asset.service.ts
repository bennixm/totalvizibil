import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ASSET_STORAGE, AssetStorageProvider } from './asset-storage';

/** Max decoded size for an uploaded website image. */
const MAX_ASSET_BYTES = 4_500_000;
const DATA_URI_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

/** Section-image slots the Advanced builder can upload to. `custom` is the
 *  Website Builder's own kind — any image the owner attaches in chat
 *  (portfolio/product/team/logo/etc.) for the agent to place where asked. */
export const BUILDER_ASSET_KINDS = ['hero', 'gallery', 'team', 'logo', 'about', 'custom'] as const;
export type BuilderAssetKind = (typeof BUILDER_ASSET_KINDS)[number];

/** Upload slots the Simple-site pre-account draft flow can use. */
export const DRAFT_ASSET_KINDS = ['landing', 'portfolio', 'logo'] as const;
export type DraftAssetKind = (typeof DRAFT_ASSET_KINDS)[number];

const MAX_COMPANY_ASSETS = 60;
const MAX_DRAFT_PORTFOLIO_ASSETS = 20;

/**
 * The one place website image uploads get validated and stored, for every
 * builder (Simple-site draft, Advanced, PRO V2). Owns the upload-time rules
 * (data-URI shape, size cap, kind allow-list, per-owner quota) and delegates
 * the actual bytes write/read to an injected AssetStorageProvider — see
 * asset-storage.ts for why that split exists.
 */
@Injectable()
export class WebsiteAssetService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorageProvider,
  ) {}

  async get(id: string): Promise<{ mime: string; bytes: Buffer }> {
    const asset = await this.storage.get(id);
    if (!asset) throw new NotFoundException('asset_not_found');
    return asset;
  }

  private decode(dataUri: string): { mime: string; bytes: Buffer } {
    const m = DATA_URI_RE.exec(dataUri.trim());
    if (!m) throw new BadRequestException('bad_image');
    const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
    if (bytes.length === 0) throw new BadRequestException('bad_image');
    if (bytes.length > MAX_ASSET_BYTES) throw new BadRequestException('image_too_large');
    return { mime: m[1], bytes };
  }

  /** Store a base64 image against a company (Advanced/PRO V2 builders). */
  async addCompanyAsset(
    companyId: string,
    dataUri: string,
    kind: string,
  ): Promise<{ id: string; url: string }> {
    if (!BUILDER_ASSET_KINDS.includes(kind as BuilderAssetKind)) {
      throw new BadRequestException('bad_kind');
    }
    const count = await this.prisma.websiteAsset.count({ where: { companyId } });
    if (count >= MAX_COMPANY_ASSETS) throw new BadRequestException('asset_limit');
    const { mime, bytes } = this.decode(dataUri);
    return this.storage.put(bytes, mime, kind, { companyId });
  }

  /** Store a base64 image against an anonymous Simple-site draft. */
  async addDraftAsset(
    draftId: string,
    dataUri: string,
    kind: string,
  ): Promise<{ id: string; url: string }> {
    if (!DRAFT_ASSET_KINDS.includes(kind as DraftAssetKind)) {
      throw new BadRequestException('bad_kind');
    }
    if (kind === 'portfolio') {
      const count = await this.prisma.websiteAsset.count({ where: { draftId, kind: 'portfolio' } });
      if (count >= MAX_DRAFT_PORTFOLIO_ASSETS) throw new BadRequestException('portfolio_full');
    }
    const { mime, bytes } = this.decode(dataUri);
    return this.storage.put(bytes, mime, kind, { draftId });
  }
}
