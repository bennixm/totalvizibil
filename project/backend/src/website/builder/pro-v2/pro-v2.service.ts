import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole, ProV2File, ProV2Project } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WalletService } from '../../../wallet/wallet.service';
import { CREDIT_MINOR } from '../../../wallet/money';
import { PlatformSettingsService } from '../../../platform-settings/platform-settings.service';
import { STARTER_FILES } from './starter-project';
import {
  MAX_BUNDLE_FILES,
  MAX_BUNDLE_FILE_BYTES,
  MAX_BUNDLE_TOTAL_BYTES,
  MAX_FILES_PER_PROJECT,
  assertFileSize,
  normalizeProjectPath,
} from './path-safety';
import { isPublishableBundlePath, mimeForBundlePath } from './bundle-mime';

const CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager];

export interface FileMatch {
  path: string;
  line: number;
  snippet: string;
}

/**
 * Persistence + ownership for the Website Builder's project — a real
 * Vue/Vite file tree, one row per file (not one JSON blob), so a targeted
 * tool read/write never has to load or rewrite the whole tree. This is the
 * ONE website builder: opening/editing/publishing a project all require the
 * same one-time paid "advanced builder" unlock the Advanced business-creation
 * flow charges for (`assertUnlocked`) — this used to be independent while it
 * was an experimental side feature (PRO V2), but now that it's the only
 * builder it must enforce the same paywall the old builder did.
 */
@Injectable()
export class ProV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
  ) {}

  // --- ownership ---------------------------------------------------------

  private async assertCanEdit(companyId: string, userId: string): Promise<void> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (member && member.status === 'active') {
      if (!CAN_EDIT.includes(member.role)) {
        throw new ForbiddenException('Your role cannot edit this project');
      }
      return;
    }
    const isAdmin = await this.prisma.platformRoleAssignment.findFirst({
      where: { userId, role: 'admin' },
    });
    if (!isAdmin) throw new NotFoundException('Company not found');
  }

  /** A platform admin opening an un-unlocked company's builder IS the grant —
   *  heal the flag for free (same behavior the old builder's admin path had)
   *  so the studio opens instead of bouncing the admin to a pay screen. */
  private async assertUnlocked(companyId: string, userId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { advancedUnlockedAt: true },
    });
    if (company?.advancedUnlockedAt) return;
    const isAdmin = await this.prisma.platformRoleAssignment.findFirst({
      where: { userId, role: 'admin' },
    });
    if (!isAdmin) throw new ForbiddenException('advanced_builder_locked');
    await this.prisma.company.update({
      where: { id: companyId },
      data: { advancedUnlockedAt: new Date() },
    });
  }

  // --- unlock (the one-time paid gate, same fee as the old builder) ------

  async getUnlockStatus(companyId: string, userId: string) {
    await this.assertCanEdit(companyId, userId);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { advancedUnlockedAt: true, ownerUserId: true },
    });
    const [priceCredits, walletSummary] = await Promise.all([
      this.settings.advancedBuilderPriceCredits(),
      this.wallet.getSummary(company.ownerUserId),
    ]);
    return {
      unlocked: company.advancedUnlockedAt != null,
      priceCredits,
      wallet: { balance: walletSummary.balance },
    };
  }

  /** Owner-initiated paid unlock. */
  async unlock(companyId: string, userId: string): Promise<{ unlocked: true }> {
    await this.assertCanEdit(companyId, userId);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    await this.applyUnlock(company.id, company.ownerUserId, company.advancedUnlockedAt, {
      chargeOwner: true,
    });
    return { unlocked: true };
  }

  /** Admin-initiated grant — the admin guard is the access gate, optionally charged. */
  async unlockForAdmin(companyId: string, opts: { charge?: boolean } = {}): Promise<void> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    await this.applyUnlock(company.id, company.ownerUserId, company.advancedUnlockedAt, {
      chargeOwner: !!opts.charge,
    });
  }

  private async applyUnlock(
    companyId: string,
    ownerUserId: string,
    alreadyUnlockedAt: Date | null,
    opts: { chargeOwner: boolean },
  ): Promise<void> {
    if (alreadyUnlockedAt) return;
    if (opts.chargeOwner) {
      const price = await this.settings.advancedBuilderPriceCredits();
      await this.wallet.spend(ownerUserId, price * CREDIT_MINOR, {
        description: 'Advanced website builder',
        companyId,
      });
    }
    await this.prisma.company.update({
      where: { id: companyId },
      data: { advancedUnlockedAt: new Date() },
    });
    await this.prisma.website.updateMany({ where: { companyId }, data: { mode: 'advanced' } });
  }

  /** Real facts about the business, collected earlier in the Advanced
   *  business-creation flow (name, category, city, services) — given to the
   *  agent as ground truth so the owner never has to re-type what the app
   *  already knows. Never fabricated: any field the company hasn't filled in
   *  is simply omitted, never guessed. */
  async getBusinessFacts(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        category: true,
        locations: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        contacts: { where: { isPublic: true } },
        services: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!company) return '';
    const loc = company.locations[0];
    const phone = company.contacts.find((c) => c.type === 'phone')?.value;
    const email = company.contacts.find((c) => c.type === 'email')?.value;
    const lines = [
      `Name: ${company.displayName}`,
      company.category
        ? `Category: ${(company.category.nameI18n as Record<string, string>).en ?? company.category.slug}`
        : '',
      company.description ? `Description: ${company.description}` : '',
      loc?.nationwide ? 'Serves: the whole country' : loc?.city ? `City: ${loc.city}` : '',
      company.services.length ? `Services: ${company.services.map((s) => s.name).join(', ')}` : '',
      phone ? `Phone: ${phone}` : '',
      email ? `Email: ${email}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  // --- project lifecycle ---------------------------------------------------

  async getOrCreateProject(companyId: string, userId: string): Promise<ProV2Project> {
    await this.assertCanEdit(companyId, userId);
    await this.assertUnlocked(companyId, userId);
    const existing = await this.prisma.proV2Project.findUnique({ where: { companyId } });
    if (existing) return existing;
    return this.prisma.proV2Project.create({
      data: {
        companyId,
        files: {
          create: Object.entries(STARTER_FILES).map(([path, content]) => ({ path, content })),
        },
      },
    });
  }

  /** Full file tree + conversation, for the studio's first load / WebContainer mount. */
  async getView(companyId: string, userId: string) {
    const project = await this.getOrCreateProject(companyId, userId);
    const [files, messages, website] = await Promise.all([
      this.prisma.proV2File.findMany({
        where: { projectId: project.id },
        orderBy: { path: 'asc' },
      }),
      this.prisma.proV2Message.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.website.findUnique({ where: { companyId }, select: { publishedAt: true } }),
    ]);
    return { project, files, messages, publishedAt: website?.publishedAt ?? null };
  }

  // --- file access for the agent's tools (already-owned project) ---------

  async listFiles(projectId: string): Promise<{ path: string; bytes: number }[]> {
    const files = await this.prisma.proV2File.findMany({
      where: { projectId },
      orderBy: { path: 'asc' },
      select: { path: true, content: true },
    });
    return files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content, 'utf8') }));
  }

  async readFile(projectId: string, rawPath: string): Promise<ProV2File> {
    const path = normalizeProjectPath(rawPath);
    const file = await this.prisma.proV2File.findUnique({
      where: { projectId_path: { projectId, path } },
    });
    if (!file) throw new NotFoundException(`No file at "${path}"`);
    return file;
  }

  async searchFiles(projectId: string, query: string): Promise<FileMatch[]> {
    const q = query.trim().toLowerCase();
    if (!q) throw new BadRequestException('query is required');
    const files = await this.prisma.proV2File.findMany({ where: { projectId } });
    const matches: FileMatch[] = [];
    for (const f of files) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (matches.length >= 40) return;
        if (line.toLowerCase().includes(q)) {
          matches.push({ path: f.path, line: i + 1, snippet: line.trim().slice(0, 160) });
        }
      });
    }
    return matches;
  }

  async writeFile(projectId: string, rawPath: string, content: string): Promise<{ path: string }> {
    const path = normalizeProjectPath(rawPath);
    assertFileSize(content);
    const count = await this.prisma.proV2File.count({ where: { projectId } });
    const existing = await this.prisma.proV2File.findUnique({
      where: { projectId_path: { projectId, path } },
      select: { id: true },
    });
    if (!existing && count >= MAX_FILES_PER_PROJECT) {
      throw new BadRequestException(
        `This project already has the maximum of ${MAX_FILES_PER_PROJECT} files`,
      );
    }
    await this.prisma.proV2File.upsert({
      where: { projectId_path: { projectId, path } },
      create: { projectId, path, content },
      update: { content },
    });
    return { path };
  }

  async editFile(
    projectId: string,
    rawPath: string,
    oldString: string,
    newString: string,
  ): Promise<{ path: string }> {
    const path = normalizeProjectPath(rawPath);
    if (!oldString) throw new BadRequestException('oldString is required');
    const file = await this.prisma.proV2File.findUnique({
      where: { projectId_path: { projectId, path } },
    });
    if (!file) throw new NotFoundException(`No file at "${path}"`);
    const occurrences = file.content.split(oldString).length - 1;
    if (occurrences === 0) {
      throw new BadRequestException(
        `oldString was not found in "${path}" — read the file again to get its exact current content`,
      );
    }
    if (occurrences > 1) {
      throw new BadRequestException(
        `oldString appears ${occurrences} times in "${path}" — include more surrounding context so it matches exactly once, or use write_file to replace the whole file`,
      );
    }
    const content = file.content.replace(oldString, newString);
    assertFileSize(content);
    await this.prisma.proV2File.update({ where: { id: file.id }, data: { content } });
    return { path };
  }

  async deleteFile(projectId: string, rawPath: string): Promise<{ path: string }> {
    const path = normalizeProjectPath(rawPath);
    const file = await this.prisma.proV2File.findUnique({
      where: { projectId_path: { projectId, path } },
      select: { id: true },
    });
    if (!file) throw new NotFoundException(`No file at "${path}"`);
    const total = await this.prisma.proV2File.count({ where: { projectId } });
    if (total <= 1) throw new BadRequestException('Cannot delete the last remaining file');
    await this.prisma.proV2File.delete({ where: { id: file.id } });
    return { path };
  }

  // --- message log ---------------------------------------------------------

  /** Prior turns (as plain text, NOT their tool-call internals) kept for
   *  continuity — each new turn re-inspects the live files via tools rather
   *  than trusting a previous turn's now-possibly-stale tool results. */
  async recentMessages(
    projectId: string,
    limit: number,
  ): Promise<{ role: string; content: string }[]> {
    const rows = await this.prisma.proV2Message.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { role: true, content: true },
    });
    return rows.reverse();
  }

  async appendMessage(
    projectId: string,
    role: 'user' | 'assistant',
    content: string,
    meta?: {
      toolCalls?: { tool: string; summary: string }[];
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      iterations?: number;
      durationMs?: number;
    },
  ): Promise<void> {
    await this.prisma.proV2Message.create({
      data: {
        projectId,
        role,
        content,
        toolCalls: meta?.toolCalls as never,
        model: meta?.model,
        inputTokens: meta?.inputTokens,
        outputTokens: meta?.outputTokens,
        iterations: meta?.iterations,
        durationMs: meta?.durationMs,
      },
    });
  }

  // --- publish (the built `dist/` output → the public company page) --------

  /** Stores a freshly-built `dist/` output as the company's published static
   *  bundle, replacing whatever was published before. The build itself
   *  happens in the browser's WebContainer (this service never runs
   *  install/build itself) — this just persists the result and marks the
   *  website as having a live bundle to serve. Requires the same edit
   *  permission as the project itself; also requires a `Website` row to
   *  attach the bundle to (created earlier in onboarding), since the public
   *  page is keyed by `Website`, not `ProV2Project`. */
  async publishBundle(
    companyId: string,
    userId: string,
    files: { path: string; contentBase64: string }[],
  ): Promise<{ publishedAt: Date; fileCount: number }> {
    await this.assertCanEdit(companyId, userId);
    await this.assertUnlocked(companyId, userId);

    const website = await this.prisma.website.findUnique({ where: { companyId } });
    if (!website) {
      throw new NotFoundException('This company has no website yet to publish to');
    }

    const publishable = files.filter((f) => isPublishableBundlePath(f.path));
    if (publishable.length > MAX_BUNDLE_FILES) {
      throw new BadRequestException(`A bundle can have at most ${MAX_BUNDLE_FILES} files`);
    }

    const rows: { path: string; mime: string; bytes: Buffer; size: number }[] = [];
    let totalBytes = 0;
    for (const f of publishable) {
      const path = normalizeProjectPath(f.path);
      let bytes: Buffer;
      try {
        bytes = Buffer.from(f.contentBase64, 'base64');
      } catch {
        throw new BadRequestException(`"${path}" is not valid base64`);
      }
      if (bytes.length > MAX_BUNDLE_FILE_BYTES) {
        throw new BadRequestException(
          `"${path}" exceeds the ${MAX_BUNDLE_FILE_BYTES}-byte per-file limit`,
        );
      }
      totalBytes += bytes.length;
      rows.push({ path, mime: mimeForBundlePath(path), bytes, size: bytes.length });
    }
    if (totalBytes > MAX_BUNDLE_TOTAL_BYTES) {
      throw new BadRequestException(
        `Bundle is too large (${totalBytes} bytes, max ${MAX_BUNDLE_TOTAL_BYTES})`,
      );
    }
    if (!rows.some((r) => r.path === 'index.html')) {
      throw new BadRequestException('Bundle must include an "index.html" entry point');
    }

    const publishedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.websiteBundleFile.deleteMany({ where: { websiteId: website.id } }),
      this.prisma.websiteBundleFile.createMany({
        data: rows.map((r) => ({
          websiteId: website.id,
          path: r.path,
          mime: r.mime,
          bytes: r.bytes,
          size: r.size,
        })),
      }),
      this.prisma.website.update({ where: { id: website.id }, data: { publishedAt } }),
    ]);

    return { publishedAt, fileCount: rows.length };
  }
}
