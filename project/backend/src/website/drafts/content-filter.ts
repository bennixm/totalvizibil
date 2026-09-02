import { BadRequestException } from '@nestjs/common';

/**
 * Lightweight moderation for text the client puts on a public one-pager
 * (service names, headings, About, testimonials, FAQ, CTA…). Deterministic —
 * no AI call. Catches sexual-explicit terms, slurs and threats in RO + EN,
 * including common spacing / leetspeak evasion. Tuned to favour false
 * negatives over blocking legitimate trade wording.
 */

// Word-boundary terms (checked against the normalised, spacing-preserved text).
const BANNED_WORDS: string[] = [
  // RO — sexual / vulgar
  'pula',
  'puli',
  'pizda',
  'pizde',
  'muie',
  'muist',
  'futai',
  'fut',
  'futut',
  'futem',
  'sugi pula',
  'bagmias',
  'cur in',
  'gaoaza',
  'coaie',
  'slobozi',
  'labar',
  'curva',
  'curve',
  'tarfa',
  'zdreanta',
  'bulangiu',
  'poponar',
  'cioara',
  'jidan',
  'tigan imputit',
  'te fut',
  'te omor',
  'va omor',
  // EN — sexual / vulgar
  'fuck',
  'fucking',
  'motherfucker',
  'cunt',
  'pussy',
  'dick',
  'cock',
  'blowjob',
  'handjob',
  'cumshot',
  'creampie',
  'whore',
  'slut',
  'bitch',
  'bastard',
  'jerkoff',
  'porn',
  'porno',
  'xxx',
  'hentai',
  'milf',
  'bdsm',
  'onlyfans',
  'anal sex',
  'oral sex',
  'sex shop',
  'sexshop',
  'sex toys',
  'escort service',
  // EN — slurs / hate
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'retarded',
  'kike',
  'spic',
  'chink',
  'tranny',
  // threats / harassment
  'kill you',
  'kill yourself',
  'kys',
  'rape',
  'raping',
  'rapist',
  'i will find you',
];

// Strong terms also checked against the fully de-spaced text (catches
// "p u l a", "f-u-c-k"). Only unambiguous ≥4-char sequences.
const SQUASHED_TERMS: string[] = [
  'pula',
  'pizda',
  'muie',
  'futai',
  'curva',
  'tarfa',
  'poponar',
  'fuck',
  'motherfucker',
  'cunt',
  'blowjob',
  'nigger',
  'nigga',
  'faggot',
  'hentai',
  'killyou',
  'killyourself',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
};

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[013457@$!|]/g, (c) => LEET[c] ?? c);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORD_RE = new RegExp(`(^|[^a-z])(${BANNED_WORDS.map(escapeRe).join('|')})([^a-z]|$)`, 'i');

export function containsBannedContent(text: string): boolean {
  const raw = (text ?? '').toString();
  if (!raw.trim()) return false;
  const norm = normalise(raw);
  if (WORD_RE.test(norm)) return true;
  const squashed = norm.replace(/[^a-z]/g, '');
  return SQUASHED_TERMS.some((t) => squashed.includes(t));
}

/** Throws `banned_content` if any of the given strings trips the filter. */
export function assertClean(...values: (string | undefined | null)[]): void {
  for (const v of values) {
    if (typeof v === 'string' && containsBannedContent(v)) {
      throw new BadRequestException('banned_content');
    }
  }
}
