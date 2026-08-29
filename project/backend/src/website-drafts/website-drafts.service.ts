import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CompaniesService } from '../companies/companies.service';
import { RuleBasedWebsiteGenerator } from '../website/website-generator';
import { GeneratorInput, WebsiteContent, WebsiteTheme } from '../website/website.types';
import { CreateDraftDto } from './dto/create-draft.dto';
import { ClaimDraftDto } from './dto/claim-draft.dto';

function draftView(d: {
  token: string;
  mode: string;
  status: string;
  theme: Prisma.JsonValue;
  content: Prisma.JsonValue;
  generator: string;
  input: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    token: d.token,
    mode: d.mode,
    status: d.status,
    theme: d.theme as unknown as WebsiteTheme,
    content: d.content as unknown as WebsiteContent,
    generator: d.generator,
    input: d.input,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

@Injectable()
export class WebsiteDraftsService {
  private readonly generator = new RuleBasedWebsiteGenerator();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly companies: CompaniesService,
  ) {}

  private toGeneratorInput(dto: CreateDraftDto): GeneratorInput {
    const base = {
      businessName: dto.businessName,
      businessType: dto.businessType,
      city: dto.city,
      services: dto.services.map((s) => s.trim()).filter(Boolean),
      shortDescription: dto.shortDescription,
    };
    if (dto.mode === 'advanced') {
      return {
        mode: 'advanced',
        ...base,
        region: dto.region,
        targetAudience: dto.targetAudience,
        toneOfVoice: dto.toneOfVoice,
        palette: dto.palette,
        fontPair: dto.fontPair,
        radius: dto.radius,
        primaryCta: dto.primaryCta,
        includeFaq: dto.includeFaq,
        includeTestimonials: dto.includeTestimonials,
        seoKeywords: dto.seoKeywords,
        phone: dto.phone,
        email: dto.email,
      };
    }
    return { mode: 'easy', ...base };
  }

  async create(dto: CreateDraftDto) {
    const input = this.toGeneratorInput(dto);
    const generated = this.generator.generate(input);
    const token = randomBytes(18).toString('base64url');

    const draft = await this.prisma.websiteDraft.create({
      data: {
        token,
        mode: dto.mode,
        status: 'ready',
        input: input as unknown as Prisma.InputJsonValue,
        content: generated.content as unknown as Prisma.InputJsonValue,
        theme: generated.theme as unknown as Prisma.InputJsonValue,
        generator: generated.generator,
      },
    });
    return draftView(draft);
  }

  async get(token: string) {
    const draft = await this.prisma.websiteDraft.findUnique({ where: { token } });
    if (!draft) throw new NotFoundException('Draft not found');
    return draftView(draft);
  }

  async updateContent(token: string, content: WebsiteContent) {
    const draft = await this.prisma.websiteDraft.findUnique({ where: { token } });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== 'ready') {
      throw new ConflictException('This draft can no longer be edited');
    }
    const updated = await this.prisma.websiteDraft.update({
      where: { token },
      data: { content: content as unknown as Prisma.InputJsonValue },
    });
    return draftView(updated);
  }

  /** Best-effort map of the free-text business type onto a seeded category. */
  private async matchCategoryId(businessType: string): Promise<string | undefined> {
    const t = businessType.toLowerCase();
    const categories = await this.prisma.category.findMany({ where: { isActive: true } });
    const hit = categories.find((c) => {
      const name = c.nameI18n as Record<string, string> | null;
      const en = name?.en?.toLowerCase() ?? '';
      return t.includes(c.slug.replace('-', ' ')) || (en && t.includes(en.replace(/s$/, '')));
    });
    return hit?.id;
  }

  /**
   * Register-at-the-end: creates the account, the company (from the draft's
   * answers) and the website (from the draft's generated content), then marks
   * the draft claimed. Returns the created user + company; the caller sets the
   * session cookie.
   */
  async claim(token: string, dto: ClaimDraftDto) {
    const draft = await this.prisma.websiteDraft.findUnique({ where: { token } });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status === 'claimed') {
      throw new ConflictException('This draft has already been claimed');
    }

    const input = draft.input as unknown as GeneratorInput;
    const user = await this.auth.register({
      email: dto.email,
      password: dto.password,
      name: dto.name,
    });

    const advanced = input.mode === 'advanced' ? input : null;
    const company = await this.companies.create(user.id, {
      displayName: input.businessName,
      description: input.shortDescription,
      categoryId: await this.matchCategoryId(input.businessType),
      phone: advanced?.phone,
      email: advanced?.email ?? dto.email,
      location: { city: input.city, region: advanced?.region },
      services: input.services.map((name) => ({ name })),
    });

    await this.prisma.website.create({
      data: {
        companyId: company.id,
        mode: draft.mode,
        status: 'draft',
        theme: draft.theme as unknown as Prisma.InputJsonValue,
        content: draft.content as unknown as Prisma.InputJsonValue,
        generator: draft.generator,
      },
    });

    await this.prisma.websiteDraft.update({
      where: { token },
      data: { status: 'claimed', claimedCompanyId: company.id },
    });

    return { user, company };
  }
}
