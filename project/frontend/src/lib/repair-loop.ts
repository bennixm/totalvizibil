/**
 * Pure decision logic for PRO V2's self-correction loop — kept separate from
 * the WebContainer/Vue wiring so the actual retry/dedup rules are trivially
 * unit-testable without mocking a sandbox or a component.
 */

export const MAX_REPAIR_ATTEMPTS = 3

/** Collapses volatile detail (line/col numbers, hashes, whitespace) so two
 *  reports of the "same" underlying error compare equal even if a number in
 *  a stack trace shifts slightly between runs. */
export function normalizeErrorKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

export interface RepairState {
  /** How many repair turns have already been sent for the current generation/edit. */
  attempts: number
  /** Normalized key of the error the most recent repair attempt targeted, or null if none yet. */
  lastErrorKey: string | null
}

export type RepairAction =
  | { type: 'repair' }
  | { type: 'stop_repeated_error' }
  | { type: 'stop_max_attempts' }

/** Given the loop's current state and a newly observed error, decide whether
 *  to fire another repair turn or give up.
 *
 *  - The exact same error coming back after we already tried to fix it means
 *    that attempt didn't work — stop immediately rather than burn the
 *    remaining budget on a fix that provably isn't landing.
 *  - Otherwise, bounded to MAX_REPAIR_ATTEMPTS total per generation/edit. */
export function decideRepairAction(state: RepairState, newErrorKey: string): RepairAction {
  if (state.lastErrorKey !== null && newErrorKey === state.lastErrorKey) {
    return { type: 'stop_repeated_error' }
  }
  if (state.attempts >= MAX_REPAIR_ATTEMPTS) {
    return { type: 'stop_max_attempts' }
  }
  return { type: 'repair' }
}

/** Best-effort extraction of a project-relative file path from an error's
 *  text/stack, so the repair report can point Claude at the likely file. */
export function extractFilePath(text: string): string | undefined {
  const match = text.match(/(?:^|[\s(])((?:src|components)\/[\w./-]*\.(?:vue|ts|js|tsx|jsx|css))/i)
  return match?.[1]
}
