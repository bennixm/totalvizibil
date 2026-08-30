import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import { CREDIT_MINOR } from '../../wallet/money';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { RuleBasedWebsiteGenerator } from '../website-generator';
import {
  BuilderAnswers,
  BuilderStep,
  BuilderTurn,
  advanceBuilder,
  buildAdvancedInput,
  openingBuilderTranscript,
} from './builder-script';

const CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager];

interface BuilderState {
  step: BuilderStep;
  answers: BuilderAnswers;
}

@Injectable()
export class WebsiteBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
    private readonly generator: RuleBasedWebsiteGenerator,
  ) {}

  private async load(companyId: string, userId: string, needEdit = false) {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') throw new NotFoundException('Company not found');
    if (needEdit && !CAN_EDIT.includes(member.role)) {
      throw new ForbiddenException('Your role cannot edit the website');
    }
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { website: true },
    });
    if (!company.website) throw new NotFoundException('No website');
    if (company.website.mode !== 'advanced') {
      throw new BadRequestException('not_an_advanced_website');
    }
    return company;
  }

  private state(website: { builderSpec: unknown }): BuilderState {
    const raw = (website.builderSpec ?? null) as BuilderState | null;
    return { step: raw?.step ?? 'business', answers: raw?.answers ?? {} };
  }

  private async view(companyId: string, userId: string) {
    const company = await this.load(companyId, userId);
    const w = company.website!;
    const [price, walletSummary] = await Promise.all([
      this.settings.advancedBuilderPriceCredits(),
      this.wallet.getSummary(company.ownerUserId),
    ]);
    const { step } = this.state(w);
    return {
      unlocked: company.advancedUnlockedAt != null,
      priceCredits: price,
      wallet: { balance: walletSummary.balance },
      websiteStatus: w.status,
      step,
      complete: step === 'done',
      transcript: (w.builderChat as unknown as BuilderTurn[] | null) ?? openingBuilderTranscript(),
      theme: (w.theme as unknown) ?? null,
      content: (w.content as unknown) ?? null,
    };
  }

  get(userId: string, companyId: string) {
    return this.view(companyId, userId);
  }

  /** Pay the one-time advanced-builder fee from the wallet. */
  async unlock(userId: string, companyId: string) {
    const company = await this.load(companyId, userId, true);
    if (company.advancedUnlockedAt) return this.view(companyId, userId);

    const price = await this.settings.advancedBuilderPriceCredits();
    await this.wallet.spend(company.ownerUserId, price * CREDIT_MINOR, {
      description: 'Advanced website builder',
      companyId,
    });
    await this.prisma.company.update({
      where: { id: companyId },
      data: { advancedUnlockedAt: new Date() },
    });
    return this.view(companyId, userId);
  }

  /** One builder message: advance the script, regenerate the website, persist. */
  async sendMessage(userId: string, companyId: string, rawText: string) {
    const company = await this.load(companyId, userId, true);
    if (!company.advancedUnlockedAt) throw new ForbiddenException('advanced_builder_locked');

    const text = rawText.trim();
    if (!text) throw new BadRequestException('Message is empty');

    const w = company.website!;
    const { step, answers } = this.state(w);
    const transcript = (
      (w.builderChat as unknown as BuilderTurn[] | null) ?? openingBuilderTranscript()
    ).slice();
    const at = new Date().toISOString();

    const result = advanceBuilder(step, answers, text);
    transcript.push({ role: 'user', text: text.slice(0, 2000), at });
    for (const key of result.assistant) transcript.push({ role: 'assistant', key, at });

    const data: Prisma.WebsiteUpdateInput = {
      builderSpec: {
        step: result.step,
        answers: result.answers,
      } as unknown as Prisma.InputJsonValue,
      builderChat: transcript as unknown as Prisma.InputJsonValue,
    };
    if (result.regenerate) {
      const g = this.generator.generate(buildAdvancedInput(result.answers));
      data.theme = g.theme as unknown as Prisma.InputJsonValue;
      data.content = g.content as unknown as Prisma.InputJsonValue;
      data.generator = g.generator;
    }

    await this.prisma.website.update({ where: { companyId }, data });
    return this.view(companyId, userId);
  }
}
