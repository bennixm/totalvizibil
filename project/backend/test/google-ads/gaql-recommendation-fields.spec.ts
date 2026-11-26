import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Google Ads API v25 rejects selecting a sub-field of a recommendation's
 * details (`recommendation.<kind>_recommendation.<field>`) with
 * UNRECOGNIZED_FIELD; only the whole object can be selected (checked live).
 * Such a query fails at runtime only, so this guards every GAQL string.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

it('no GAQL query selects a sub-field of a recommendation detail object', () => {
  const bad = files(join(__dirname, '../../src')).flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/recommendation\.[a-z_]+_recommendation\.[a-z_]+/g)].map(
      (m) => `${f}: ${m[0]}`,
    ),
  );
  expect(bad).toEqual([]);
});
