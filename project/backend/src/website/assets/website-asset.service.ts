import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WebsiteAssetService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string): Promise<{ mime: string; bytes: Buffer }> {
    const row = await this.prisma.websiteAsset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('asset_not_found');
    return { mime: row.mime, bytes: Buffer.from(row.bytes) };
  }
}
