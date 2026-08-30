import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RuleBasedWebsiteGenerator } from '../website-generator';
import {
  DraftAnswers,
  DraftStep,
  FREE_MAX_TURNS,
  TranscriptTurn,
  advance,
  buildEasyInput,
  openingTranscript,
} from './website-draft.script';
import { toDraftView, WebsiteDraftView } from './website-draft.view';

/** Anonymous drafts live for a week before they are considered abandoned. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class WebsiteDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: RuleBasedWebsiteGenerator,
  ) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Start a fresh draft. The raw token is returned once and never stored.
   * `input.mode` picks the plan (`advanced` for the paid builder); an optional
   * `seed` pre-fills the basics so a starter website exists immediately.
   */
  async create(
    input: {
      mode?: 'easy' | 'advanced';
      seed?: { businessName: string; businessType: string; city?: string };
    } = {},
  ): Promise<{ id: string; token: string; draft: WebsiteDraftView }> {
    const token = randomBytes(32).toString('base64url');
    const advanced = input.mode === 'advanced';

    const data: Prisma.WebsiteDraftCreateInput = {
      tokenHash: WebsiteDraftService.hash(token),
      mode: advanced ? 'advanced' : 'easy',
      plan: advanced ? 'advanced' : 'free',
      step: 'business',
      answers: {},
      transcript: openingTranscript() as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    };

    if (input.seed?.businessName && input.seed?.businessType) {
      const answers: DraftAnswers = {
        businessName: input.seed.businessName.trim().slice(0, 80),
        businessType: input.seed.businessType.trim().slice(0, 80),
        description: input.seed.businessType.trim(),
        city: input.seed.city?.trim().slice(0, 80),
      };
      const g = this.generator.generate(buildEasyInput(answers));
      data.answers = answers as unknown as Prisma.InputJsonValue;
      data.step = 'refine';
      data.status = 'ready';
      data.theme = g.theme as unknown as Prisma.InputJsonValue;
      data.content = g.content as unknown as Prisma.InputJsonValue;
      data.generator = g.generator;
    }

    const draft = await this.prisma.websiteDraft.create({ data });
    return { id: draft.id, token, draft: toDraftView(draft) };
  }

  async get(id: string, token: string): Promise<WebsiteDraftView> {
    return toDraftView(await this.load(id, token));
  }

  /** Process one visitor message: advance the script, regenerate, persist. */
  async sendMessage(id: string, token: string, rawText: string): Promise<WebsiteDraftView> {
    const draft = await this.load(id, token);

    const text = rawText.trim();
    if (!text) throw new BadRequestException('Message is empty');
    if (draft.turnsUsed >= FREE_MAX_TURNS) {
      throw new ForbiddenException('free_plan_turn_limit');
    }

    const answers = (draft.answers as unknown as DraftAnswers) ?? {};
    const transcript = ((draft.transcript as unknown as TranscriptTurn[]) ?? []).slice();
    const at = new Date().toISOString();

    const result = advance(draft.step as DraftStep, answers, text);

    transcript.push({ role: 'user', text: text.slice(0, 2000), at });
    for (const key of result.assistant) transcript.push({ role: 'assistant', key, at });

    const turnsUsed = draft.turnsUsed + 1;
    if (turnsUsed >= FREE_MAX_TURNS && result.step !== 'done') {
      transcript.push({ role: 'assistant', key: 'cap', at });
    }

    let generated: Pick<Prisma.WebsiteDraftUpdateInput, 'theme' | 'content' | 'generator'> = {};
    if (result.regenerate) {
      const g = this.generator.generate(buildEasyInput(result.answers));
      generated = {
        theme: g.theme as unknown as Prisma.InputJsonValue,
        content: g.content as unknown as Prisma.InputJsonValue,
        generator: g.generator,
      };
    }

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        step: result.step,
        answers: result.answers as unknown as Prisma.InputJsonValue,
        transcript: transcript as unknown as Prisma.InputJsonValue,
        turnsUsed,
        status: result.step === 'done' ? 'ready' : draft.status,
        ...generated,
      },
    });
    return toDraftView(updated);
  }

  /**
   * Assert a slug is an active category and return it. Accepts either an
   * exact-niche (leaf) subcategory or a whole parent group ("all services in
   * Construction"). The create flow must pin one so the business is filed in
   * the feed.
   */
  async assertCategory(slug: string): Promise<{ id: string; slug: string }> {
    const category = await this.prisma.category.findUnique({ where: { slug } });
    if (!category || !category.isActive) {
      throw new BadRequestException('unknown_category');
    }
    return { id: category.id, slug: category.slug };
  }

  /** Persist the location + category step (M2). Requires the one-pager first. */
  async setLocation(
    id: string,
    token: string,
    input: {
      categorySlug: string;
      city: string;
      region?: string;
      country?: string;
      lat: number;
      lng: number;
      radiusKm: number;
    },
  ): Promise<WebsiteDraftView> {
    const draft = await this.load(id, token);
    if (draft.content == null) {
      throw new BadRequestException('generate_website_first');
    }
    const category = await this.assertCategory(input.categorySlug);

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        categorySlug: category.slug,
        locationCity: input.city.trim(),
        locationRegion: input.region?.trim() || null,
        locationCountry: (input.country || 'RO').toUpperCase().slice(0, 2),
        locationLat: input.lat,
        locationLng: input.lng,
        locationRadiusKm: Math.round(input.radiusKm),
      },
    });
    return toDraftView(updated);
  }

  /** Resolve a draft by its opaque token alone (used by the account claim step). */
  async loadByToken(token: string) {
    if (!token) throw new NotFoundException('Draft not found');
    const draft = await this.prisma.websiteDraft.findUnique({
      where: { tokenHash: WebsiteDraftService.hash(token) },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.expiresAt.getTime() < Date.now()) throw new NotFoundException('Draft expired');
    return draft;
  }

  /** Mark a draft as claimed by a company. Runs inside the caller's transaction. */
  markClaimed(tx: Prisma.TransactionClient, draftId: string, companyId: string): Promise<unknown> {
    return tx.websiteDraft.update({
      where: { id: draftId },
      data: { status: 'claimed', claimedCompanyId: companyId },
    });
  }

  private async load(id: string, token: string) {
    const draft = await this.loadByToken(token);
    if (draft.id !== id) throw new NotFoundException('Draft not found');
    return draft;
  }
}
