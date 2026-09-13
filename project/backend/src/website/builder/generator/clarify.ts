/**
 * Pre-generation clarification — runs BEFORE `generateSite`, from a separate
 * HTTP round trip (not an internal pipeline stage). Decides whether the
 * brief already gives enough to go on, or whether building now would force
 * a guess on something that matters (page structure, design direction, a
 * concrete fact) — and if so, returns a small, capped set of questions for
 * the client to answer instead of letting the model guess silently.
 *
 * Hard limits are enforced HERE, in code — never trust the prompt alone:
 * at most `MAX_TURNS` round trips, at most `MAX_QUESTIONS_PER_TURN` questions
 * per turn. An already-detailed brief (same threshold philosophy as Stage 0's
 * `SKIP_AI_OVER_CHARS`) skips straight to `done: true` — clarification only
 * helps a short/vague brief, and asking anyway would just be friction.
 */
import { classifyArchetype } from '../site-archetypes';
import type { StudioLocale } from '../section-catalog';
import type {
  ClarifyAnswer,
  ClarifyOption,
  ClarifyQuestion,
  GeneratorAi,
  GeneratorBusiness,
  SuggestedPage,
} from './types';

export const AI_CLARIFY_MAX_TURNS = 2;
const MAX_QUESTIONS_PER_TURN = 4;

/** Same threshold as Stage 0 — a brief this detailed rarely needs clarifying. */
const SKIP_CLARIFY_OVER_CHARS = 350;

export interface ClarifyTurnInput {
  brief: string;
  business: GeneratorBusiness;
  locale: StudioLocale;
  /** Answers accumulated across all turns so far (empty on the first turn). */
  answers: ClarifyAnswer[];
  /** How many clarification turns have already completed (0 on the first call). */
  turnsSoFar: number;
}

export interface ClarifyTurnResult {
  done: boolean;
  questions: ClarifyQuestion[];
}

/**
 * Persisted shape for `Website.builderChat` — the only state that survives
 * between the `ai/clarify` and `ai/clarify/answer` HTTP round trips. `brief`
 * is the raw text clarification started for; `aiPlan` only reuses a
 * `done:true` state whose `brief` still matches the one it was just asked to
 * generate — a different brief means starting over, not stale reuse.
 */
export interface ClarifyState {
  brief: string;
  done: boolean;
  turnsSoFar: number;
  answers: ClarifyAnswer[];
  /** Every question asked across all turns — lets `aiPlan` reconstruct
   *  readable "question: answer" pairs from just the answers' ids. */
  askedQuestions: ClarifyQuestion[];
}

/** The option the client's answer resolved to, if the question was a choice
 *  (matched by label — that's the exact string the client's click sent as
 *  the answer value). `undefined` for a free-text answer or no match. */
function chosenOption(state: ClarifyState, answer: ClarifyAnswer): ClarifyOption | undefined {
  const q = state.askedQuestions.find((q) => q.id === answer.questionId);
  return q?.options?.find((o) => o.label === answer.value);
}

/** Readable "question: answer" lines for the enriched brief — plain text, no
 *  markup, so it reads naturally alongside the rest of the brief. Answers
 *  that resolved to the "let the AI decide" option are deliberately DROPPED
 *  here — they carry no real information, and including the literal phrase
 *  repeatedly (once per skipped question) does real harm: it reads like an
 *  AI/software product to a downstream classifier, which can misclassify an
 *  ordinary business (a beauty salon has been seen coming back as "saas"
 *  purely from three "Decide AI" lines in the confirmed-facts block). */
export function formatClarifyContext(state: ClarifyState): string {
  if (!state.done || !state.answers.length) return '';
  const lines = state.answers
    .filter((a) => chosenOption(state, a)?.id !== 'ai_decide')
    .map((a) => {
      const q = state.askedQuestions.find((q) => q.id === a.questionId);
      return `- ${q?.prompt ?? a.questionId}: ${a.value}`;
    });
  return lines.join('\n');
}

/**
 * The concrete pages the client committed to, if any answer resolved to a
 * `pages`-bearing option — an EXPLICIT structural requirement, not a
 * suggestion. `undefined` when nothing prescribes a structure (every
 * page-related answer was "let the AI decide", or no page question was
 * asked/answered this session).
 */
export function resolveClarifiedPages(state: ClarifyState): SuggestedPage[] | undefined {
  if (!state.done) return undefined;
  for (const a of state.answers) {
    const pages = chosenOption(state, a)?.pages;
    if (pages?.length) return pages;
  }
  return undefined;
}

export async function clarifyTurn(
  ai: GeneratorAi,
  input: ClarifyTurnInput,
): Promise<ClarifyTurnResult> {
  if (
    !ai.configured ||
    input.brief.trim().length > SKIP_CLARIFY_OVER_CHARS ||
    input.turnsSoFar >= AI_CLARIFY_MAX_TURNS
  ) {
    return { done: true, questions: [] };
  }

  const archetype = classifyArchetype(input.brief, input.business.type, input.business.services);
  const raw = await ai
    .clarifyBrief({
      brief: input.brief,
      business: input.business,
      locale: input.locale,
      archetype,
      answers: input.answers,
    })
    .catch(() => null);

  if (!raw || raw.done || !Array.isArray(raw.questions) || !raw.questions.length) {
    return { done: true, questions: [] };
  }

  const seen = new Set<string>();
  const questions: ClarifyQuestion[] = [];
  for (const q of raw.questions) {
    if (!q || typeof q.id !== 'string' || typeof q.prompt !== 'string' || !q.prompt.trim()) {
      continue;
    }
    if (seen.has(q.id)) continue;
    if (q.kind === 'choice' && (!q.options || q.options.length < 2)) continue;
    if (q.kind !== 'choice' && q.kind !== 'text') continue;
    seen.add(q.id);
    questions.push(q);
    if (questions.length >= MAX_QUESTIONS_PER_TURN) break;
  }

  return questions.length ? { done: false, questions } : { done: true, questions: [] };
}
