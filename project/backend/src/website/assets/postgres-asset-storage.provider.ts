import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetOwner, AssetStorageProvider, StoredAsset } from './asset-storage';

/** Today's only real AssetStorageProvider — bytes live in the `website_assets`
 *  Postgres table, served back out through GET /website-assets/:id. */
@Injectable()
export class PostgresAssetStorageProvider implements AssetStorageProvider {
  constructor(private readonly prisma: PrismaService) {}

  async put(bytes: Buffer, mime: string, kind: string, owner: AssetOwner): Promise<StoredAsset> {
    const row = await this.prisma.websiteAsset.create({
      data: { ...owner, kind, mime, bytes, size: bytes.length },
    });
    return { id: row.id, url: `/api/v1/website-assets/${row.id}` };
  }

  async get(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
    const row = await this.prisma.websiteAsset.findUnique({ where: { id } });
    if (!row) return null;
    return { mime: row.mime, bytes: Buffer.from(row.bytes) };
  }
}
