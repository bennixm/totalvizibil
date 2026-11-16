import { TEMPLATE_KEYS, pickTemplate, templateKey } from 'src/website/drafts/easy-compose';

describe('easy-compose template selection', () => {
  describe('templateKey', () => {
    it('accepts any of the 6 known keys', () => {
      for (const k of TEMPLATE_KEYS) expect(templateKey(k)).toBe(k);
    });

    it('falls back to classic for anything else, including the old default', () => {
      expect(templateKey(undefined)).toBe('classic');
      expect(templateKey('nonsense')).toBe('classic');
    });
  });

  describe('pickTemplate', () => {
    it('is deterministic for the same seed + businessType + tone', () => {
      const a = pickTemplate('professional', 'instalații sanitare', 'draft-1');
      const b = pickTemplate('professional', 'instalații sanitare', 'draft-1');
      expect(a).toBe(b);
      expect(TEMPLATE_KEYS).toContain(a);
    });

    it('spreads different seeds across more than one template', () => {
      const picks = new Set(
        Array.from({ length: 12 }, (_, i) =>
          pickTemplate(null, 'instalații sanitare', `draft-${i}`),
        ),
      );
      // Never every draft collapsing onto the same single template again.
      expect(picks.size).toBeGreaterThan(1);
    });

    it('never used to resolve to classic for every unset-template draft', () => {
      // Regression guard for the bug this feature fixes: `template` left
      // unset used to always resolve to `classic` (templateKey(undefined)).
      // pickTemplate must spread across the set instead.
      const picks = Array.from({ length: 10 }, (_, i) => pickTemplate(null, '', `seed-${i}`));
      expect(new Set(picks).size).toBeGreaterThan(1);
    });

    it('keeps an unknown/missing tone within the full template set', () => {
      const pick = pickTemplate(undefined, 'orice', 'seed-x');
      expect(TEMPLATE_KEYS).toContain(pick);
    });
  });
});
