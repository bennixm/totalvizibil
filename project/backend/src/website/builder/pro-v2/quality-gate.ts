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

export interface QualityCheckInput {
  /** Paths the turn's own tool calls claim to have touched. */
  changedPaths: string[];
  filesBefore: Map<string, string>;
  filesAfter: Map<string, string>;
  reply: string;
  mutatingToolCallCount: number;
}

export interface QualityCheckResult {
  passed: boolean;
  reason?: string;
}

export function checkStaticQuality(input: QualityCheckInput): QualityCheckResult {
  if (input.mutatingToolCallCount > 0 && input.changedPaths.length === 0) {
    return { passed: false, reason: 'Tool calls ran but no files ended up different' };
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

  return { passed: true };
}
