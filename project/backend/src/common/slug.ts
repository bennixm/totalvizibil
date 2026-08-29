/**
 * Turn an arbitrary label into a URL-safe slug.
 * Diacritics are folded (Cluj-Napoca café -> cluj-napoca-cafe).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Given a desired slug and a predicate that reports whether a candidate is taken,
 * return the first free variant: `foo`, then `foo-2`, `foo-3`, …
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || 'company';
  if (!(await isTaken(root))) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Extremely unlikely; fall back to a random suffix.
  return `${root}-${Math.random().toString(36).slice(2, 8)}`;
}
