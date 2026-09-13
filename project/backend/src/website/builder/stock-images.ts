/**
 * Curated stock-photo pools for the AI / fallback site generators.
 *
 * The LLM is *terrible* at inventing real Unsplash photo ids — it recycles a
 * handful it memorised (every generated site ends up with the same pictures) or
 * hallucinates ids that 404 on the published page. So the generators no longer
 * trust model-supplied image URLs: every `image` field is (re)filled here from a
 * vetted, hot-linkable pool, keyed to the business category and rotated by a
 * per-section hash so two sites — and two sections of one site — differ.
 *
 * All URLs are `images.unsplash.com/photo-…` (Unsplash explicitly allows
 * hot-linking) and pass `section-catalog.ts`'s `IMG_ALLOW`. Swap this file for a
 * live Unsplash/Pexels search later without touching the callers.
 */
import type { SeedCtx } from './section-catalog';
import type { BuilderDoc } from './compose-advanced';

const U = (id: string): string =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1400&q=80`;

export type StockBucket =
  | 'construction'
  | 'cleaning'
  | 'food'
  | 'beauty'
  | 'auto'
  | 'tech'
  | 'health'
  | 'professional'
  | 'education'
  | 'events'
  | 'retail'
  | 'realestate'
  | 'fitness'
  | 'generic';

/** ~8 vetted photos per bucket. Order is irrelevant — callers hash-rotate. */
export const STOCK_POOLS: Record<StockBucket, string[]> = {
  construction: [
    U('1503387762-592deb58ef4e'),
    U('1541888946425-d81bb19240f5'),
    U('1504307651254-35680f356dfd'),
    U('1600585154340-be6161a56a0c'),
    U('1523413651479-597eb2da0ad6'),
    U('1581094794329-c8112a89af12'),
    U('1416339306562-611f8298ff8b'),
    U('1592928302636-c83cab4a5d97'),
  ],
  cleaning: [
    U('1581578731548-c64695cc6952'),
    U('1527515637462-cff94eecc1ac'),
    U('1584820927498-cfe5211fd8bf'),
    U('1600880292203-757bb62b4baf'),
    U('1563453392212-326f5e854473'),
    U('1585421514738-01798e348b17'),
    U('1596263576925-d78e9c6a1c1a'),
    U('1517646287270-a5a9ca602e5c'),
  ],
  food: [
    U('1517248135467-4c7edcad34c4'),
    U('1414235077428-338989a2e8c0'),
    U('1504674900247-0877df9cc836'),
    U('1466978913421-dad2ebd01d17'),
    U('1424847651672-bf20a4b0982b'),
    U('1552566626-52f8b828add9'),
    U('1555396273-367ea4eb4db5'),
    U('1481833761820-0509d3217039'),
  ],
  beauty: [
    U('1560066984-138dadb4c035'),
    U('1595476108010-b4d1f102b1b1'),
    U('1522337360788-8b13dee7a37e'),
    U('1596178065887-1198b6148b2b'),
    U('1487412947147-5cebf100ffc2'),
    U('1503951914875-452162b0f3f1'),
    U('1470259078422-826894b933ad'),
    U('1560869713-7d0a29430803'),
  ],
  auto: [
    U('1486262715619-67b85e0b08d3'),
    U('1492144534655-ae79c964c9d7'),
    U('1493238792000-8113da705763'),
    U('1487754180451-c456f719a1fc'),
    U('1503376780353-7e6692767b70'),
    U('1552519507-da3b142c6e3d'),
    U('1517524008697-84bbe3c3fd98'),
    U('1605559424843-9e4c228bf1c2'),
  ],
  tech: [
    U('1518770660439-4636190af475'),
    U('1461749280684-dccba630e2f6'),
    U('1551288049-bebda4e38f71'),
    U('1498050108023-c5249f4df085'),
    U('1504384308090-c894fdcc538d'),
    U('1519389950473-47ba0277781c'),
    U('1531482615713-2afd69097998'),
    U('1487058792275-0ad4aaf24ca7'),
  ],
  health: [
    U('1576091160399-112ba8d25d1d'),
    U('1519494026892-80bbd2d6fd0d'),
    U('1579684385127-1ef15d508118'),
    U('1512678080530-7760d81faba6'),
    U('1631217868264-e5b90bb7e133'),
    U('1550831107-1553da8c8464'),
    U('1505751172876-fa1923c5c528'),
    U('1584982751601-97dcc096659c'),
  ],
  professional: [
    U('1521791136064-7986c2920216'),
    U('1454165804606-c3d57bc86b40'),
    U('1450101499163-c8848c66ca85'),
    U('1556761175-b413da4baf72'),
    U('1507003211169-0a1dd7228f2d'),
    U('1600880292089-90a7e086ee0c'),
    U('1542744173-8e7e53415bb0'),
    U('1517245386807-bb43f82c33c4'),
  ],
  education: [
    U('1503676260728-1c00da094a0b'),
    U('1522202176988-66273c2fd55f'),
    U('1509062522246-3755977927d7'),
    U('1524178232363-1fb2b075b655'),
    U('1513258496099-48168024aec0'),
    U('1546410531-bb4caa6b424d'),
    U('1497633762265-9d179a990aa6'),
    U('1427504494785-3a9ca7044f45'),
  ],
  events: [
    U('1519671482749-fd09be7ccebf'),
    U('1464366400600-7168b8af9bc3'),
    U('1511578314322-379afb476865'),
    U('1530103862676-de8c9debad1d'),
    U('1492684223066-81342ee5ff30'),
    U('1470229722913-7c0e2dbbafd3'),
    U('1533174072545-7a4b6ad7a6c3'),
    U('1478146896981-b80fe463b330'),
  ],
  retail: [
    U('1441986300917-64674bd600d8'),
    U('1472851294608-062f824d29cc'),
    U('1445205170230-053b83016050'),
    U('1483985988355-763728e1935b'),
    U('1560343090-f0409e92791a'),
    U('1556742049-0cfed4f6a45d'),
    U('1513708927688-890fe41c2e99'),
    U('1528698827591-e19ccd7bc23d'),
  ],
  realestate: [
    U('1560518883-ce09059eeffa'),
    U('1512917774080-9991f1c4c750'),
    U('1600596542815-ffad4c1539a9'),
    U('1449844908441-8829872d2607'),
    U('1570129477492-45c003edd2be'),
    U('1600607687939-ce8a6c25118c'),
    U('1554995207-c18c203602cb'),
    U('1416331108676-a22ccb276e35'),
  ],
  fitness: [
    U('1571019613454-1cb2f99b2d8b'),
    U('1534438327276-14e5300c3a48'),
    U('1517836357463-d25dfeac3438'),
    U('1540497077202-7c8a3999166f'),
    U('1518611012118-696072aa579a'),
    U('1549060279-7e168fcee0c2'),
    U('1571902943202-507ec2618e8f'),
    U('1583454110551-21f2fa2afe61'),
  ],
  generic: [
    U('1497366216548-37526070297c'),
    U('1600880292203-757bb62b4baf'),
    U('1521737711867-e3b97375f902'),
    U('1600607687939-ce8a6c25118c'),
    U('1497366811353-6870744d04b2'),
    U('1524758631624-e2822e304c36'),
    U('1531973576160-7125cd663d86'),
    U('1542744094-3a31f272c490'),
  ],
};

const BUCKET_KEYWORDS: [StockBucket, RegExp][] = [
  [
    'construction',
    /construc|acoperi|instal|zugrav|electric|instalator|amenaj|tâmpl|tamplar|dulgher|izola|renov|fațad|fatad|hidroizol|pavaj|gard|beton|schel|bau|roof|plumb|renovation|contractor/i,
  ],
  ['cleaning', /cur[ăa][țt]|clean|sp[ăa]l|deratiz|dezinsec|reinig|menaj|housekeep/i],
  [
    'food',
    /restaurant|cafenea|caf[eé]|bar\b|bistro|pizz|patiser|cofet|catering|food|buc[ăa]t|meniu|gastro|braserie|pub\b|lounge|bakery|deli\b/i,
  ],
  [
    'beauty',
    /salon|coaf|frizer|manichi|pedichi|cosmet|beauty|barber|make-?up|machiaj|spa\b|masaj|epilar|unghii|hair|nails|kosmetik/i,
  ],
  [
    'auto',
    /auto\b|mașin|masin|service auto|vulcaniz|tinichig|caroser|anvelop|ITP|detailing|mechanic|garage|car wash|sp[ăa]l[ăa]torie auto/i,
  ],
  [
    'tech',
    /software|aplica[țt]|app\b|saas|platform[ăa]|startup|\bit\b|web\s?design|dezvoltar|programare|digital|automatiz|dashboard|api\b|cloud|dev\b|agen[țt]ie (web|digital|marketing)|seo\b/i,
  ],
  [
    'health',
    /clinic|cabinet|medic|dentist|stomatolog|kineto|fizio|psiholog|terapi|nutri|optic|farmaci|veterinar|dental|doctor|health|wellness/i,
  ],
  [
    'professional',
    /avocat|notar|contab|audit|consult|juridic|fiscal|imobiliar broker|asigur|financiar|hr\b|recrut|traduc|arhitect(?!ur[ăa] peisag)|inginer|expertiz|law\b|accounting|legal/i,
  ],
  [
    'education',
    /școal|scoal|curs|training|educa|medita[țt]|grădini[țț]|gradinit|kindergarten|academy|academi|tutor|lec[țt]i|e-?learning|school/i,
  ],
  [
    'events',
    /eveniment|nunt[ăa]|botez|organizare event|wedding|dj\b|forma[țt]ie|sonoriz|decor eveniment|party|petrecere|conferin[țt]|corporate event/i,
  ],
  [
    'retail',
    /magazin|shop\b|store\b|boutique|butic|ecommerce|e-?commerce|vânz|vanz|produs|showroom|distribu[țt]|retail/i,
  ],
  [
    'realestate',
    /imobiliar|real ?estate|apartament|dezvoltator rezidential|ansamblu rezidential|închirier|inchirier|property|agen[țt]ie imobiliar/i,
  ],
  [
    'fitness',
    /fitness|sal[ăa] de sport|gym\b|antrenor|personal trainer|crossfit|yoga|pilates|aerobic|kickbox|arte mar[țt]iale|sport club/i,
  ],
];

/** Best-guess photo bucket for a business, from its type + services + brief. */
export function bucketFor(ctx: SeedCtx, brief = ''): StockBucket {
  const hay = `${ctx.businessType} ${ctx.services.join(' ')} ${brief}`.toLowerCase();
  for (const [bucket, re] of BUCKET_KEYWORDS) if (re.test(hay)) return bucket;
  return 'generic';
}

/** djb2 — small, stable, dependency-free string hash. */
export function hashInt(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Local uploads are always kept; only remote/blank slots get pool photos. */
function isLocalAsset(v: unknown): boolean {
  return typeof v === 'string' && /^\/api\/v1\/website-assets\//.test(v);
}

/**
 * A site with more image slots than the pool has photos still shouldn't repeat
 * a picture verbatim — Unsplash's CDN honours `crop`, so a second use of a photo
 * is served as a visibly different framing.
 */
const CROP_ROUNDS = ['', '&crop=entropy', '&crop=edges', '&crop=faces,center'];

/**
 * Fill every image slot in a builder doc from the category pool. Local uploads
 * are preserved; anything else (blank, or a model-supplied URL) is replaced.
 * De-dupes within the doc so a site never shows the same photo the same way.
 * `keepExisting` (follow-up AI plans): also keep any non-blank URL already set,
 * so an "improve" pass doesn't reshuffle unchanged sections' photos.
 */
export function fillDocImages(
  doc: BuilderDoc,
  ctx: SeedCtx,
  brief = '',
  opts: { keepExisting?: boolean } = {},
): void {
  const pool = STOCK_POOLS[bucketFor(ctx, brief)] ?? STOCK_POOLS.generic;
  const used = new Set<string>();
  let idx = hashInt(ctx.businessName || 'site') % pool.length;

  const next = (): string => {
    for (let k = 0; k < pool.length * CROP_ROUNDS.length; k++) {
      const round = Math.floor(idx / pool.length) % CROP_ROUNDS.length;
      const url = pool[idx % pool.length] + CROP_ROUNDS[round];
      idx++;
      if (!used.has(url)) {
        used.add(url);
        return url;
      }
    }
    const url = pool[idx % pool.length] + CROP_ROUNDS[idx % CROP_ROUNDS.length];
    idx++;
    return url;
  };

  const slot = (obj: Record<string, unknown>, key: string): void => {
    const cur = obj[key];
    if (isLocalAsset(cur) || (opts.keepExisting && typeof cur === 'string' && cur.trim())) {
      if (typeof cur === 'string') used.add(cur);
      return;
    }
    obj[key] = next();
  };

  for (const page of doc.pages) {
    for (const s of page.sections) {
      const c = s.content ?? {};
      if (s.type === 'showcase' || (s.type === 'hero' && s.variant !== 'minimal')) {
        // Every hero / showcase gets a photo — the renderer's `--photo` styling
        // kicks in automatically (a "forgotten" hero image was a common AI miss).
        // EXCEPT a "minimal" hero — that variant is deliberately text-only (it's
        // also used as the lean, image-free header on secondary pages).
        slot(c, 'backgroundImage');
      } else if (s.type === 'video') {
        slot(c, 'posterImage');
      } else if (s.type === 'caseStudy') {
        slot(c, 'imageUrl');
      } else if (s.type === 'beforeAfter') {
        slot(c, 'beforeImage');
        slot(c, 'afterImage');
      } else if (s.type === 'about') {
        if (['imageRight', 'imageLeft', 'twoCol'].includes(s.variant)) slot(c, 'imageUrl');
      } else if (
        s.type === 'gallery' ||
        s.type === 'featureSplit' ||
        s.type === 'bento' ||
        s.type === 'tabs'
      ) {
        if (Array.isArray(c.items)) {
          for (const it of c.items as Record<string, unknown>[]) slot(it, 'imageUrl');
        }
      }
      // team / logos / quoteBig images stay empty on purpose (real people, real
      // client logos, a real quoted person).
    }
  }
}

const REMOTE_IMG_RE =
  /^https:\/\/(?:images|plus)\.unsplash\.com\/|^https:\/\/images\.pexels\.com\//;

/**
 * HEAD-check every remote (unsplash / pexels) image URL in the doc and swap any
 * that don't resolve for a working pool photo. A curated id can rot, and a model
 * can slip a same-host-but-fake id past `coerceImage`. Local uploads are trusted
 * and skipped. Best-effort: a network hiccup keeps the URL (never punishes a
 * probably-fine link). Returns how many slots were repaired.
 */
export async function verifyDocImages(doc: BuilderDoc, ctx: SeedCtx, brief = ''): Promise<number> {
  const pool = STOCK_POOLS[bucketFor(ctx, brief)] ?? STOCK_POOLS.generic;

  type Slot = { get: () => string; set: (u: string) => void };
  const slots: Slot[] = [];
  const collect = (obj: Record<string, unknown>, key: string): void => {
    const v = obj[key];
    if (typeof v === 'string' && REMOTE_IMG_RE.test(v)) {
      slots.push({ get: () => obj[key] as string, set: (u) => (obj[key] = u) });
    }
  };
  for (const page of doc.pages) {
    for (const s of page.sections) {
      const c = (s.content ?? {}) as Record<string, unknown>;
      for (const k of ['backgroundImage', 'posterImage', 'imageUrl', 'beforeImage', 'afterImage']) {
        collect(c, k);
      }
      if (Array.isArray(c.items)) {
        for (const it of c.items as Record<string, unknown>[]) collect(it, 'imageUrl');
      }
    }
  }
  if (!slots.length) return 0;

  const verdict = new Map<string, boolean>();
  const check = async (url: string): Promise<boolean> => {
    const cached = verdict.get(url);
    if (cached !== undefined) return cached;
    let good = true; // default: assume fine unless we get a definite "not found"
    try {
      const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      if (r.status === 405 || r.status === 403) {
        const g = await fetch(url, {
          method: 'GET',
          headers: { range: 'bytes=0-0' },
          signal: AbortSignal.timeout(4000),
        });
        good = g.ok || g.status === 206;
      } else {
        good = r.ok;
      }
    } catch {
      good = true; // timeout / DNS blip — leave the URL alone
    }
    verdict.set(url, good);
    return good;
  };

  await Promise.allSettled([...new Set(slots.map((s) => s.get()))].map(check));

  const used = new Set(slots.map((s) => s.get()).filter((u) => verdict.get(u) !== false));
  const nextGood = async (): Promise<string> => {
    for (const src of [pool, STOCK_POOLS.generic]) {
      for (const base of src) {
        if (used.has(base)) continue;
        if (await check(base)) {
          used.add(base);
          return base;
        }
      }
    }
    return ''; // renderer hides an empty image slot gracefully
  };

  let fixed = 0;
  for (const slot of slots) {
    if (verdict.get(slot.get()) === false) {
      slot.set(await nextGood());
      fixed++;
    }
  }
  return fixed;
}
