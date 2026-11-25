import { ConfigService } from '@nestjs/config';
import { AiService } from '../ai/ai.service';
import { AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActionStore,
  GoogleAdsOptimizerService,
  OptimizerSettings,
} from '../google-ads/optimization/google-ads-optimizer.service';
import { GoogleAdsUserClient } from './google-ads-user-client';
import { UserAgentSettings } from './agent-settings';

/**
 * The platform optimizer, unchanged, bound to ONE customer campaign: their
 * OAuth client, their agent settings, and their own action table
 * (`google_ads_user_actions`, same columns) with every row tagged with the
 * billed cycle that produced it. Created per cycle, never a Nest singleton.
 */
export class UserGoogleAdsOptimizer extends GoogleAdsOptimizerService {
  private readonly store: ActionStore;

  constructor(
    client: GoogleAdsUserClient,
    ai: AiService,
    agent: UserAgentSettings,
    private readonly db: PrismaService,
    config: ConfigService<AppConfig, true>,
    cycleId: string | null,
  ) {
    const settings: OptimizerSettings = {
      googleAdsAgentAutoFillGapsEnabled: async () => agent.autoApply,
      googleAdsAgentCreativeCooldownDays: async () => agent.creativeCooldownDays,
    };
    super(client, ai, settings, db, config);
    const table = db.googleAdsUserAction;
    // Same delegate, plus the cycle id on every row this optimizer creates.
    this.store = new Proxy(table, {
      get(target, prop, receiver) {
        if (prop === 'create' && cycleId) {
          return (args: { data: Record<string, unknown> }) =>
            target.create({ ...args, data: { ...args.data, cycleId } } as never);
        }
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as unknown as ActionStore;
  }

  /** Not a Nest singleton; the agent service resumes its read-backs. */
  override onModuleInit(): void {}

  /** Nothing is written while the owner's agent or account is stopped. */
  protected override async mayRestore(actionId: string): Promise<boolean> {
    const a = await this.db.googleAdsUserAction.findUnique({
      where: { id: actionId },
      select: { userCampaign: { select: { status: true, user: { select: { status: true } } } } },
    });
    return a?.userCampaign.status === 'active' && a.userCampaign.user.status === 'active';
  }

  protected override get actions(): ActionStore {
    return this.store;
  }
}
