/**
 * Task-aware model routing for PRO V2. Pure classification/tier functions
 * (trivially unit-testable, no DI) + a thin injectable `ModelRouter` that
 * resolves a tier to an actual configured provider — skipping straight to
 * Claude if DeepSeek isn't configured, so an unconfigured tier never wastes
 * a real escalation hop on a call that could never succeed.
 *
 * Real cost data (see the PRO V2 cost-optimization report) showed ~95% of
 * spend comes from large multi-file generation/expansion turns — exactly
 * the category item 7 says must stay on Claude for quality. The achievable
 * savings target is the small-edit/repair category, which is already cheap
 * per-call but frequent over a project's lifetime.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/env';
import { ClaudeProvider } from '../../../ai/claude.provider';
import { DeepSeekProvider } from '../../../ai/deepseek.provider';
import type { AiProvider } from '../../../ai/provider.types';

export type TaskCategory =
  'initial_generation' | 'simple_edit' | 'multi_file' | 'repair' | 'review';
export type ModelTier = 'deepseek-flash' | 'deepseek-pro' | 'claude';

// Keyword heuristics only — a router can't know a request's true scope before
// running it. Deliberately conservative: anything design/architecture-shaped
// or ambiguous falls through to the pricier multi_file tier rather than risking
// a visually-important change on the cheapest model.
const SIMPLE_EDIT_RE =
  /\b(rename|remove|delete|change the (?:color|colour|text|title|wording)|fix (?:the )?typo|make .* (?:smaller|bigger|shorter|longer)|swap|reorder)\b/i;
const SIMPLE_EDIT_MAX_CHARS = 200;

/** First message ever for a project is always initial generation; an
 *  automatic `[WebContainer error — automatic]` report is always a repair —
 *  both are structural facts the caller already knows, not guesses. */
export function classifyTask(input: {
  isFirstMessage: boolean;
  isRepair: boolean;
  userContent: string;
}): TaskCategory {
  if (input.isRepair) return 'repair';
  if (input.isFirstMessage) return 'initial_generation';
  const text = input.userContent.trim();
  if (text.length <= SIMPLE_EDIT_MAX_CHARS && SIMPLE_EDIT_RE.test(text)) return 'simple_edit';
  return 'multi_file';
}

/** Where a fresh (non-repair) turn starts. Initial generation and any future
 *  review pass are pinned to Claude — never moved for cost, per spec. */
export function initialTier(category: TaskCategory): ModelTier {
  switch (category) {
    case 'initial_generation':
    case 'review':
      return 'claude';
    case 'simple_edit':
      return 'deepseek-flash';
    case 'multi_file':
    case 'repair':
      return 'deepseek-flash';
  }
}

/** Escalation ladder: cheapest → strongest. Claude has no further tier. */
export function nextTier(tier: ModelTier): ModelTier {
  if (tier === 'deepseek-flash') return 'deepseek-pro';
  return 'claude';
}

/** A repair's tier is driven by the EXISTING §5 attempt counter (already
 *  tracked by the frontend's repair loop) — attempt 1 cheapest, escalating
 *  each time the browser reports the fix didn't actually land. */
export function tierForRepairAttempt(attempt: number): ModelTier {
  if (attempt <= 1) return 'deepseek-flash';
  if (attempt === 2) return 'deepseek-pro';
  return 'claude';
}

export interface ResolvedRoute {
  tier: ModelTier;
  provider: AiProvider;
  model: string;
  /** True when the requested tier was downgraded to Claude because DeepSeek isn't configured. */
  fellBackToClaudeUnconfigured: boolean;
}

@Injectable()
export class ModelRouter {
  constructor(
    private readonly claude: ClaudeProvider,
    private readonly deepseek: DeepSeekProvider,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Resolves a tier to a real, USABLE provider — if DeepSeek isn't
   *  configured, every DeepSeek tier resolves straight to Claude instead of
   *  wasting an escalation hop on a call that can only ever return null. */
  resolve(tier: ModelTier): ResolvedRoute {
    if (tier === 'claude' || !this.deepseek.configured) {
      return {
        tier: 'claude',
        provider: this.claude,
        model: this.config.get('anthropicModel', { infer: true }),
        fellBackToClaudeUnconfigured: tier !== 'claude' && !this.deepseek.configured,
      };
    }
    const model =
      tier === 'deepseek-flash'
        ? this.config.get('deepseekModelFlash', { infer: true })
        : this.config.get('deepseekModelPro', { infer: true });
    return { tier, provider: this.deepseek, model, fellBackToClaudeUnconfigured: false };
  }

  resolveInitial(category: TaskCategory): ResolvedRoute {
    return this.resolve(initialTier(category));
  }

  resolveNext(current: ModelTier): ResolvedRoute {
    return this.resolve(nextTier(current));
  }

  resolveForRepairAttempt(attempt: number): ResolvedRoute {
    return this.resolve(tierForRepairAttempt(attempt));
  }
}
