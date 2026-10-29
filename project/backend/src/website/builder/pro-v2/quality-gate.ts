/**
 * Static, structural quality checks — the subset of item 3's list that's
 * actually checkable server-side without running the code. Whether the app
 * "builds/runs" or has "no runtime errors" can only be known by the browser's
 * own WebContainer (see the §5 self-correction report) — those stay the
 * real, dynamic quality gate, reached via the EXISTING repair loop when a
 * cheap model's output turns out broken. This catches the cheap, obvious
 * failures — a model that claimed to do something but didn't, or that wiped
 * out the project's own scaffold — before ever syncing them to the browser.
 */

const CORE_SCAFFOLD_PATHS = ['package.json', 'index.html', 'src/main.ts', 'src/App.vue'];
const REFUSAL_RE = /^(i cannot|i can't|i'm unable to|as an ai|i don't have the ability)/i;

/** The system prompt explicitly allows ONE kind of tool-less turn: a short
 *  clarifying question asked in plain text ("Ask at most one or two short
 *  questions ... and do NOT call any file tools on that turn"). Everything
 *  else that answers a build/edit request in prose instead of calling a tool
 *  is the failure this gate must catch — so a tool-less reply only survives
 *  when it actually reads like that allowed question: short, containing a
 *  real question, and NOT claiming work that never happened. */
const MAX_CLARIFYING_REPLY_CHARS = 600;
const COMPLETION_CLAIM_RE =
  /\b(?:i(?:'ve| have)?\s+(?:now\s+)?(?:updated|changed|renamed|removed|deleted|added|created|built|fixed|swapped|reordered|replaced|made)|am\s+(?:actualizat|modificat|ad[aă]ugat|schimbat|redenumit|[sș]ters))\b/i;

export function looksLikeClarifyingQuestion(reply: string): boolean {
  const text = reply.trim();
  if (!text.includes('?')) return false;
  if (text.length > MAX_CLARIFYING_REPLY_CHARS) return false;
  // "I renamed it — anything else?" is a completion claim wearing a question
  // mark, not a request for missing information.
  return !COMPLETION_CLAIM_RE.test(text);
}

/** Does this user turn actually ask for a file change? Everything reaching
 *  PRO V2 is already scope-guarded to website work, so the answer is "yes"
 *  unless the message is phrased as a plain informational question about the
 *  existing site ("why is the footer gone?", "ce culoare are hero-ul?") —
 *  those are the only turns where a tool-less prose reply is the correct
 *  outcome. An automatic sandbox repair report is never informational. */
const INFO_QUESTION_RE =
  /^(?:why|what|which|where|when|who|how|is|are|does|do|did|can you (?:explain|tell|show)|de ce|ce\b|cum|unde|c[aâ]nd|care|cine)\b/i;

export function expectsMutation(input: { isRepair: boolean; userContent: string }): boolean {
  if (input.isRepair) return true;
  const text = input.userContent.trim();
  return !(text.endsWith('?') && INFO_QUESTION_RE.test(text));
}

/** The four SEO fundamentals that are cheap and reliable to check statically
 *  (title, description, heading structure, image alt text) — deliberately
 *  NOT the full SEO checklist from the system prompt (canonical URLs,
 *  structured data, sitemap, social cards, ...): those are genuinely
 *  "where applicable" and would need real judgement a regex can't make, so
 *  they stay prompt-guidance only. Only checked when `index.html` was
 *  itself touched this turn — that's the reliable signal for "the page
 *  shell was (re)built," which is when these fundamentals actually matter;
 *  a small unrelated edit shouldn't be penalized for pre-existing gaps in
 *  files it never touched. */
function checkSeoBasics(filesAfter: Map<string, string>): QualityCheckResult {
  const indexHtml = filesAfter.get('index.html') ?? '';
  if (!/<title>[^<]*\S[^<]*<\/title>/i.test(indexHtml)) {
    return { passed: false, reason: 'index.html is missing a non-empty <title>' };
  }
  if (!/<meta\s+name=["']description["']\s+content=["'][^"']*\S[^"']*["']/i.test(indexHtml)) {
    return { passed: false, reason: 'index.html is missing a <meta name="description"> tag' };
  }

  const pageMarkup = [...filesAfter.entries()]
    .filter(([path]) => path.endsWith('.vue'))
    .map(([, content]) => content)
    .join('\n');
  if (!/<h1[\s>]/i.test(pageMarkup)) {
    return { passed: false, reason: 'No <h1> heading found anywhere on the page' };
  }
  const imgTags = pageMarkup.match(/<img\b[^>]*>/gi) ?? [];
  if (imgTags.some((tag) => !/\balt\s*=/i.test(tag))) {
    return { passed: false, reason: 'One or more <img> tags is missing an alt attribute' };
  }

  return { passed: true };
}

export interface QualityCheckInput {
  /** Paths the turn's own tool calls claim to have touched. */
  changedPaths: string[];
  filesBefore: Map<string, string>;
  filesAfter: Map<string, string>;
  reply: string;
  mutatingToolCallCount: number;
  /** Whether this turn was issued as a build/edit request (see
   *  `expectsMutation`) rather than a plain informational question. When it
   *  was, a turn that called no mutating tool at all is a silent no-op — the
   *  single most expensive failure mode here, because without this flag the
   *  turn looks like a success and gets billed. */
  mutationExpected: boolean;
}

export interface QualityCheckResult {
  passed: boolean;
  reason?: string;
}

export function checkStaticQuality(input: QualityCheckInput): QualityCheckResult {
  if (input.mutatingToolCallCount > 0 && input.changedPaths.length === 0) {
    return { passed: false, reason: 'Tool calls ran but no files ended up different' };
  }

  // The mirror image of the check above, and the one that actually bites: the
  // model never called a mutating tool AT ALL and just answered a build/edit
  // request in prose. The check above can't see this (its own precondition is
  // `mutatingToolCallCount > 0`), so before this existed such a turn passed
  // the gate, was accepted as final, and was billed for changing nothing.
  // A genuine clarifying question is the one allowed exception.
  if (
    input.mutationExpected &&
    input.mutatingToolCallCount === 0 &&
    !looksLikeClarifyingQuestion(input.reply)
  ) {
    return {
      passed: false,
      reason: 'Model answered a change request in prose without calling any mutating tool',
    };
  }

  for (const path of input.changedPaths) {
    const before = input.filesBefore.get(path);
    const after = input.filesAfter.get(path);
    if (after === undefined) continue; // deleted — fine, checked separately below
    if (before === after) {
      return { passed: false, reason: `"${path}" was reported as changed but is identical` };
    }
    if (path.endsWith('.vue') && !after.includes('<template')) {
      return { passed: false, reason: `"${path}" no longer has a <template> block` };
    }
  }

  for (const path of CORE_SCAFFOLD_PATHS) {
    if (input.filesBefore.has(path) && !input.filesAfter.has(path)) {
      return { passed: false, reason: `Core scaffold file "${path}" was deleted` };
    }
  }

  const reply = input.reply.trim();
  if (!reply) return { passed: false, reason: 'Empty final reply' };
  if (REFUSAL_RE.test(reply)) return { passed: false, reason: 'Model declined the task' };

  if (input.changedPaths.includes('index.html')) {
    const seo = checkSeoBasics(input.filesAfter);
    if (!seo.passed) return seo;
  }

  return { passed: true };
}
