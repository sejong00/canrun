/**
 * 정적 export 산출물 불변식 — P0-1 i18n 스파이크의 실증 + 상시 회귀.
 *
 * 외부 리뷰 반영(2026-08): 홈 2페이지 고정 검사 → **산출물 재귀 열거** 로 확장.
 * P1-2(D17): 3,300여 페이지를 다루므로 beforeAll 에서 페이지별 사실(PageFacts)만 추출하고
 * HTML 은 폐기한다 (test/export-facts.ts). `pnpm build` 이후 전 HTML 페이지에 대해:
 *  - en/ko 짝 존재 (전 페이지 대칭 — docs/04 §6)
 *  - canonical == 실제 파일 경로의 URL (자기참조, CLAUDE.md 규칙 5)
 *  - hreflang {en, ko, x-default} 상호 대조 (짝 페이지와 동일 집합, x-default=en)
 *  - URL 당 파일 1개 (foo.html 과 foo/index.html 중복 금지)
 *  - out/en/ 부재 (평탄화), en 페이지에 /en 프리픽스 링크 0건, _redirects 한도
 *  - 허브·콤보 구조화 데이터, 규칙 3 밴드, 제목·description 유일, 고아 0, 한글 누출 0
 *  - 콤보(P1-2): 전 조합 존재 · publish.json 게이트(noindex) · 링크 규칙 · 깊이(D15) ·
 *    보일러플레이트(D16) · 파일 위생(D18)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GUIDES, GUIDE_SLUGS, type GuideSlug } from '../apps/web/content/guides';
import { GPU_INTRO_IDS, HUB_INTROS_UPDATED, MODEL_INTRO_IDS } from '../apps/web/content/hubs';
import { SITE_UPDATES, latestSiteUpdate } from '../apps/web/content/updates';
import { ADSENSE_CLIENT } from '../apps/web/lib/site';
import { CF_PAGES_REDIRECT_LINE_LIMIT } from '../scripts/build-redirects';
import {
  comboIndexable,
  comboOf,
  comboPath,
  createFactsContext,
  extractPageFacts,
  hubPath,
  isKoPath,
  localePath,
  median,
  mulberry32,
  parsePublishPlan,
  pickDistinct,
  stripLocale,
  urlToPath,
  type GpuRecord,
  type ModelRecord,
  type PageFacts,
  type PublishPlan,
  type UnitTable,
} from './export-facts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'apps/web/out');

/** hreflang 짝 검사에서 제외되는 에러/시스템 페이지 */
const EXCLUDED = new Set(['404.html', '_not-found.html']);

/**
 * 콤보 페이지(P1-2)가 산출물에 있어야 한다. true 면 콤보가 0건일 때 콤보 불변식이
 * 조용히 통과하지 않고 명확한 메시지로 실패한다.
 */
const EXPECT_COMBOS = true;
/** D15 표본 PRNG 시드 (AC 기록: 세 페이지 URL 을 콘솔에 남긴다) */
const DEPTH_SEED = 20260929;
/** D16 — 보일러플레이트 글자 비율 상한 */
const BOILERPLATE_MAX = 0.6;
/** D18 — Cloudflare Pages 파일 20,000개 한도 대비 여유. source: docs/05 §3 (policy) */
const FILE_COUNT_MAX = 16_000;
/** D18 — CF Pages 단일 파일 25 MiB 한도 */
const FILE_SIZE_MAX = 25 * 1024 * 1024;
/** 허용 비-HTML 파일 (P1-5 사이트맵·robots·RSS·기본 공유 카드, ads·llms 대비) */
const ROOT_FILE_ALLOWLIST = /^(?:_redirects|icon\.svg|robots\.txt|sitemap[^/]*\.xml|ads\.txt|llms\.txt|rss\.xml|ko\/rss\.xml|og\/default-(?:en|ko)\.png|og\/(?:gpu|model)\/[a-z0-9.-]+-(?:en|ko)\.png)$/;
const TXT_ALLOWLIST = new Set(['robots.txt', 'ads.txt', 'llms.txt']);
const HEAVY_TIMEOUT = 60_000;

type OutFile = { rel: string; size: number };

/** out/ 전체 열거 (파일 + 디렉터리, posix 상대 경로) — 단일 패스 */
function walkOut(dir: string, rel = ''): { files: OutFile[]; dirs: string[] } {
  const files: OutFile[] = [];
  const dirs: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      dirs.push(entryRel);
      const sub = walkOut(join(dir, entry.name), entryRel);
      files.push(...sub.files);
      dirs.push(...sub.dirs);
    } else {
      files.push({ rel: entryRel, size: statSync(join(dir, entry.name)).size });
    }
  }
  return { files, dirs };
}

const readJson = <T>(relPath: string): T => JSON.parse(readFileSync(join(repoRoot, relPath), 'utf8')) as T;

let pages: PageFacts[] = [];
let outFiles: OutFile[] = [];
let outDirs: string[] = [];
let units: UnitTable;
let gpus: GpuRecord[] = [];
let models: ModelRecord[] = [];

beforeAll(() => {
  if (!existsSync(outDir)) {
    throw new Error('apps/web/out not found — run `pnpm build` before `pnpm test:export`');
  }
  gpus = readJson<GpuRecord[]>('data/gpus.json');
  models = readJson<ModelRecord[]>('data/models.json');
  const ctx = createFactsContext({
    gpus,
    models,
    gpuNameOverrides: (['en', 'ko'] as const).map(
      (locale) => readJson<{ GpuName?: Record<string, string> }>(`apps/web/messages/${locale}.json`).GpuName ?? {},
    ),
  });
  units = ctx.units;

  const walked = walkOut(outDir);
  outFiles = walked.files;
  outDirs = walked.dirs;
  pages = [];
  for (const { rel } of outFiles) {
    if (!rel.endsWith('.html') || EXCLUDED.has(rel)) continue;
    // HTML 은 이 스코프를 벗어나면 버려진다 (D17)
    pages.push(extractPageFacts(readFileSync(join(outDir, rel), 'utf8'), rel, ctx));
  }
}, 120_000);

// ---------------------------------------------------------------------------
// 공용 조회
// ---------------------------------------------------------------------------

const isHub = (page: PageFacts) => page.kind === 'gpu' || page.kind === 'model';
const isCalculator = (page: PageFacts) => page.kind === 'calculator';
const isStructured = (page: PageFacts) => isHub(page) || page.kind === 'combo' || isCalculator(page);
const isGuide = (page: PageFacts) => page.kind === 'guide';
const isGuidesIndex = (page: PageFacts) => page.kind === 'guides-index';
/** 소개·계산 방법·개인정보처리방침·문의 (P1-5) */
const isStatic = (page: PageFacts) => page.kind === 'static';
/** 가이드 URL → 슬러그 (레지스트리 밖이면 undefined) */
const guideSlugOf = (urlPath: string): GuideSlug | undefined => {
  const slug = /\/guides\/([^/]+)$/.exec(urlPath)?.[1];
  return slug && (GUIDE_SLUGS as readonly string[]).includes(slug) ? (slug as GuideSlug) : undefined;
};
const guidePublished = (slug: GuideSlug) => GUIDES[slug].status === 'published';
const PUBLISHED_GUIDES = GUIDE_SLUGS.filter(guidePublished);
/** 계산기 페이지 (P1-3) — 없으면 명확히 실패 */
function requireCalculators(): PageFacts[] {
  const calcs = pages.filter(isCalculator);
  if (calcs.length === 0) throw new Error('no /calculator page under apps/web/out — P1-3 calculator not exported');
  return calcs;
}
const urlSet = () => new Set(pages.map((p) => p.urlPath));
const byUrl = () => new Map(pages.map((p) => [p.urlPath, p]));

/** 콤보 페이지 — EXPECT_COMBOS 이고 0건이면 명확히 실패 */
function requireCombos(): PageFacts[] {
  const combos = pages.filter((p) => p.kind === 'combo');
  if (combos.length === 0 && EXPECT_COMBOS) {
    throw new Error(
      'no combo pages (/can-i-run/{model}/on/{gpu}) found under apps/web/out — P1-2 combo template not exported. ' +
        'Set EXPECT_COMBOS = false only if combos are intentionally absent.',
    );
  }
  return combos;
}

let publishCache: PublishPlan | undefined;
function loadPublish(): PublishPlan {
  publishCache ??= parsePublishPlan(readJson<unknown>('data/publish.json'));
  return publishCache;
}

function indexableOf(page: PageFacts): boolean {
  return page.combo !== undefined && comboIndexable(loadPublish(), page.combo.gpuId, page.combo.modelId);
}

/** href → 콤보 indexable 여부 (콤보 href 가 아니면 undefined) */
function hrefIndexable(href: string): boolean | undefined {
  const combo = comboOf(href);
  return combo ? comboIndexable(loadPublish(), combo.gpuId, combo.modelId) : undefined;
}

// ---------------------------------------------------------------------------
// P0-1 · P1-1 불변식
// ---------------------------------------------------------------------------

describe('URL space integrity', () => {
  it('found at least the en/ko home pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });

  it('exactly one file per URL (no foo.html + foo/index.html duplicates)', () => {
    const files = new Map<string, string[]>();
    for (const page of pages) {
      files.set(page.urlPath, [...(files.get(page.urlPath) ?? []), page.file]);
    }
    for (const [urlPath, list] of files) {
      expect(list, `duplicate files for ${urlPath}`).toHaveLength(1);
    }
  });

  it('leaves no out/en directory or /en-prefixed pages behind after flattening', () => {
    expect(existsSync(join(outDir, 'en'))).toBe(false);
    expect(existsSync(join(outDir, 'en.html'))).toBe(false);
    for (const page of pages) {
      expect(page.urlPath === '/en' || page.urlPath.startsWith('/en/'), page.file).toBe(false);
    }
  });
});

describe('en/ko page pairing (docs/04 §6 — every page in both locales)', () => {
  it('every en page has its /ko twin and vice versa', () => {
    const urls = urlSet();
    for (const url of urls) {
      if (isKoPath(url)) {
        const enTwin = stripLocale(url);
        expect(urls.has(enTwin), `ko page ${url} missing en twin ${enTwin}`).toBe(true);
      } else {
        const koTwin = localePath('ko', url);
        expect(urls.has(koTwin), `en page ${url} missing ko twin ${koTwin}`).toBe(true);
      }
    }
  });
});

describe('canonical + hreflang per page (CLAUDE.md rule 5)', () => {
  it('canonical is self-referencing: canonical path == actual file URL path', () => {
    for (const page of pages) {
      expect(page.canonical, `${page.file} missing canonical`).toBeDefined();
      expect(urlToPath(page.canonical!), `${page.file} canonical mismatch`).toBe(page.urlPath);
    }
  });

  it('hreflang set is {en, ko, x-default}, points at the real pair, x-default=en', () => {
    const urls = urlSet();
    for (const page of pages) {
      const map = page.hreflang;
      expect(Object.keys(map).sort(), page.file).toEqual(['en', 'ko', 'x-default']);
      expect(map['x-default'], `${page.file} x-default != en`).toBe(map.en);

      const enPath = urlToPath(map.en!);
      const koPath = urlToPath(map.ko!);
      // 자기참조 + 짝 참조가 실제 존재하는 페이지를 가리켜야 한다 (상호 대조)
      expect(page.locale === 'ko' ? koPath : enPath, `${page.file} hreflang self-ref`).toBe(page.urlPath);
      expect(urls.has(enPath), `${page.file} hreflang en → missing page ${enPath}`).toBe(true);
      expect(urls.has(koPath), `${page.file} hreflang ko → missing page ${koPath}`).toBe(true);
    }
  });

  it('hreflang maps are identical across each en/ko pair', () => {
    const map = byUrl();
    for (const page of pages) {
      if (page.locale === 'ko') continue;
      const twin = map.get(localePath('ko', page.urlPath));
      expect(twin, `${page.urlPath} ko twin`).toBeDefined();
      expect(page.hreflang, `pair mismatch at ${page.urlPath}`).toEqual(twin!.hreflang);
    }
  });
});

describe('en pages carry no /en-prefixed internal links', () => {
  it('no href="/en" or href="/en/…" anywhere', () => {
    for (const page of pages) {
      expect(page.enPrefixedLinkCount, page.file).toBe(0);
    }
  });
});

describe('hub pages exist for every catalog record (결정 D1 — 허브 전체 생성)', () => {
  it('every gpus.json / models.json id has an en and a ko hub', () => {
    const urls = urlSet();
    for (const { id } of gpus) {
      expect(urls.has(`/gpu/${id}`), `/gpu/${id}`).toBe(true);
      expect(urls.has(`/ko/gpu/${id}`), `/ko/gpu/${id}`).toBe(true);
    }
    for (const { id } of models) {
      expect(urls.has(`/model/${id}`), `/model/${id}`).toBe(true);
      expect(urls.has(`/ko/model/${id}`), `/ko/model/${id}`).toBe(true);
    }
  });
});

describe('hub intros (10-14 D74 — 손으로 쓴 소개글은 레지스트리 허브에만)', () => {
  it('exactly the registered GPU and model hubs render an intro in both locales: 2–3 paragraphs citing data, no block inside <p>', () => {
    const expected = [...GPU_INTRO_IDS.map((id) => `/gpu/${id}`), ...MODEL_INTRO_IDS.map((id) => `/model/${id}`)].sort();
    const seen: Record<'en' | 'ko', string[]> = { en: [], ko: [] };
    const hubs = pages.filter(isHub);
    expect(hubs.length).toBeGreaterThan(0);
    for (const page of hubs) {
      const path = stripLocale(page.urlPath);
      const { hubIntroParagraphs, hubIntroData, blockInParagraph } = page.markers;
      expect(blockInParagraph, `${page.file} block inside <p> (hydration mismatch)`).toBe(0);
      if (hubIntroParagraphs === 0) continue;
      seen[page.locale].push(path);
      expect(hubIntroParagraphs, `${page.file} intro paragraphs`).toBeGreaterThanOrEqual(2);
      expect(hubIntroParagraphs, `${page.file} intro paragraphs`).toBeLessThanOrEqual(3);
      expect(hubIntroData, `${page.file} intro cites no data component`).toBeGreaterThan(0);
    }
    // 소개가 없는 허브는 지금과 같게 렌더된다 — 레지스트리 밖 허브에 [data-hub-intro] 가 생기면 여기서 걸린다
    expect(seen.en.sort(), 'en hubs with an intro').toEqual(expected);
    expect(seen.ko.sort(), 'ko hubs with an intro').toEqual(expected);
  });

  it('sitemap lastmod of a hub with an intro is the later of the data date and the intro date; other hubs keep the data date', () => {
    const dataUpdated = readJson<{ dataUpdated: string }>('data/meta.json').dataUpdated;
    const introDate = dataUpdated > HUB_INTROS_UPDATED ? dataUpdated : HUB_INTROS_UPDATED;
    const withIntro = new Set([...GPU_INTRO_IDS.map((id) => `/gpu/${id}`), ...MODEL_INTRO_IDS.map((id) => `/model/${id}`)]);
    let checked = 0;
    for (const file of ['sitemap-gpus.xml', 'sitemap-models.xml']) {
      const xml = readFileSync(join(outDir, file), 'utf8');
      for (const m of xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) {
        const path = urlToPath(m[1]!).replace(/^\/ko(?=\/)/, '');
        expect(m[2], `${file} ${m[1]} lastmod`).toBe(withIntro.has(path) ? introDate : dataUpdated);
        checked += 1;
      }
    }
    expect(checked, 'hub sitemap entries').toBeGreaterThan(withIntro.size * 2);
  });
});

describe('share cards (D60 — 허브별 og:image)', () => {
  it('every page has an og:image that exists in out/; hubs use their own card', () => {
    for (const page of pages) {
      expect(page.ogImage, page.file).toBeDefined();
      const path = new URL(page.ogImage!).pathname;
      expect(existsSync(join(outDir, path.slice(1))), `${page.file} → ${path}`).toBe(true);
      if (isHub(page)) {
        const id = page.urlPath.split('/').pop();
        expect(path, page.file).toBe(`/og/${page.kind}/${id}-${page.locale}.png`);
      }
    }
  });
});

describe('KRW reference prices (D61 — ko 만, 환산 안내 동반)', () => {
  it('en pages show no KRW; every ko model hub shows KRW; any page showing KRW also shows the conversion note', () => {
    for (const page of pages) {
      if (page.locale === 'en') expect(page.krwPrices, page.file).toBe(0);
      if (page.locale === 'ko' && page.kind === 'model') expect(page.krwPrices, page.file).toBeGreaterThan(0);
      if (page.krwPrices > 0) expect(page.krwNote, page.file).toBe(true);
    }
  });
});

describe('html lang matches the locale', () => {
  it('ko pages are lang="ko", everything else lang="en"', () => {
    for (const page of pages) {
      expect(page.lang, page.file).toBe(page.locale);
    }
  });
});

describe('structured data (docs/04 §5)', () => {
  it('every JSON-LD block parses; hubs, combos and the calculator carry BreadcrumbList + FAQPage; calculator adds SoftwareApplication, home WebSite', () => {
    for (const page of pages) {
      expect(page.jsonLdError, page.file).toBeUndefined();
      const types = page.jsonLd.map((b) => b['@type']);
      if (page.kind === 'home') expect(types, page.file).toContain('WebSite');
      if (isCalculator(page)) expect(types, page.file).toContain('SoftwareApplication');
      if (isGuide(page)) expect(types, page.file).toEqual(expect.arrayContaining(['Article', 'BreadcrumbList']));
      if (isGuidesIndex(page)) expect(types, page.file).toContain('BreadcrumbList');
      if (!isStructured(page)) continue;
      expect(types, page.file).toContain('BreadcrumbList');
      expect(types, page.file).toContain('FAQPage');
    }
  });

  it('home WebSite: name CanRun + alternate names, url written exactly like the canonical (10-06 D70)', () => {
    for (const page of pages.filter((p) => p.kind === 'home')) {
      const site = page.jsonLd.find((b) => b['@type'] === 'WebSite')!;
      expect(site.name, page.file).toBe('CanRun');
      expect(site.alternateName, page.file).toEqual(['CanRun LLM', 'canrunllm.com', '캔런']);
      expect(site.url, page.file).toBe(page.canonical);
    }
  });

  it('breadcrumbs: every item has a URL (결정 D7), the last one is the canonical; combos are 3 levels (D10)', () => {
    for (const page of pages.filter(isStructured)) {
      const crumbs = page.jsonLd.find((b) => b['@type'] === 'BreadcrumbList')!;
      const items = crumbs.itemListElement as Array<{ item?: string; position: number }>;
      expect(items.length, page.file).toBeGreaterThanOrEqual(2);
      items.forEach((item, i) => {
        expect(item.position, page.file).toBe(i + 1);
        expect(item.item, page.file).toMatch(/^https?:\/\//);
      });
      expect(items.at(-1)!.item, page.file).toBe(page.canonical);
      if (page.combo) {
        // 홈 › 모델 허브 › 콤보(캐노니컬)
        expect(items.length, page.file).toBe(3);
        expect(urlToPath(items[0]!.item!), `${page.file} crumb 1`).toBe(localePath(page.locale, '/'));
        expect(urlToPath(items[1]!.item!), `${page.file} crumb 2`).toBe(
          hubPath(page.locale, 'model', page.combo.modelId),
        );
      }
    }
  });

  it('guides: 3-level breadcrumb (home › /guides › guide), index 2 levels; Article fields equal the registry (P1-4 D41)', () => {
    const guides = pages.filter(isGuide);
    expect(guides.length, 'guide pages exported (en + ko)').toBe(GUIDE_SLUGS.length * 2);
    for (const page of [...guides, ...pages.filter(isGuidesIndex)]) {
      const items = page.jsonLd.find((b) => b['@type'] === 'BreadcrumbList')!.itemListElement as Array<{ item: string }>;
      expect(items.length, page.file).toBe(isGuide(page) ? 3 : 2);
      expect(urlToPath(items[0]!.item), `${page.file} crumb 1`).toBe(localePath(page.locale, '/'));
      if (isGuide(page)) expect(urlToPath(items[1]!.item), `${page.file} crumb 2`).toBe(localePath(page.locale, '/guides'));
      expect(items.at(-1)!.item, page.file).toBe(page.canonical);
    }
    for (const page of guides) {
      const entry = GUIDES[guideSlugOf(page.urlPath)!];
      const article = page.jsonLd.find((b) => b['@type'] === 'Article')!;
      expect(article.headline, page.file).toBe(entry.locales[page.locale].title);
      expect(article.description, page.file).toBe(entry.locales[page.locale].description);
      expect(article.url, page.file).toBe(page.canonical);
      expect(article.inLanguage, page.file).toBe(page.locale);
      expect([article.datePublished, article.dateModified], page.file).toEqual([entry.datePublished, entry.dateModified]);
      expect((article.author as { name: string }).name, page.file).toBe(entry.author);
    }
  });

  it('FAQPage text equals the visible FAQ (Google FAQ guideline)', () => {
    for (const page of pages.filter(isStructured)) {
      const faq = page.jsonLd.find((b) => b['@type'] === 'FAQPage')!;
      const entities = (
        faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>
      ).map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }));
      expect(entities.length, page.file).toBe(3);
      expect(entities, page.file).toEqual(page.faq);
    }
  });
});

describe('estimates always carry a band (CLAUDE.md 규칙 3)', () => {
  const RANGE = /\d[\d.,]*–\d[\d.,]*/;
  const QUOTED_SPEED = /\d[\d.,]*\s*tok\/s/;
  it('descriptions, FAQ answers, verdict sentences, alternative cards and <dd> cells that quote a tok/s value also quote a range', () => {
    for (const page of pages) {
      for (const text of page.speedTexts) {
        if (!QUOTED_SPEED.test(text)) continue;
        expect(RANGE.test(text), `${page.file}: ${text}`).toBe(true);
      }
    }
  });

  it('measured labels never sit on a zero-width band or an empty measured context (D46)', () => {
    const bad = pages.filter((p) => p.measuredLabelIssues.length > 0).map((p) => `${p.file}: ${p.measuredLabelIssues.join(' | ')}`);
    expect(bad).toEqual([]);
  });
});

describe('titles and descriptions (docs/04 §4 — no duplicate templates)', () => {
  it('are present and unique across pages', () => {
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const page of pages) {
      const { title, description } = page;
      expect(title, `${page.file} title`).toBeTruthy();
      expect(description, `${page.file} description`).toBeTruthy();
      expect(titles.get(title!), `duplicate title: ${title}`).toBeUndefined();
      expect(descriptions.get(description!), `duplicate description: ${description}`).toBeUndefined();
      titles.set(title!, page.file);
      descriptions.set(description!, page.file);
    }
  });
});

describe('internal linking (docs/04 §2 — 고아 페이지 0)', () => {
  it('every hub is linked from at least one other page', () => {
    const inbound = new Map<string, number>();
    for (const page of pages) {
      // 로케일 전환 링크는 제외 — 짝 페이지의 스위처가 항상 인바운드가 되어 검사가 무력해진다
      const hrefs = new Set(page.links.filter((l) => !l.localeSwitch).map((l) => l.href));
      for (const href of hrefs) {
        if (href === page.urlPath) continue;
        inbound.set(href, (inbound.get(href) ?? 0) + 1);
      }
    }
    // 가이드: published 만 링크 대상(초안은 URL 로만 — D40). 목차는 published ≥1 일 때만
    const linkedGuides = (p: PageFacts) =>
      (isGuide(p) && guidePublished(guideSlugOf(p.urlPath)!)) || (isGuidesIndex(p) && PUBLISHED_GUIDES.length > 0);
    for (const page of pages.filter((p) => isHub(p) || isCalculator(p) || linkedGuides(p) || isStatic(p))) {
      expect(inbound.get(page.urlPath) ?? 0, `orphan ${page.kind} ${page.urlPath}`).toBeGreaterThan(0);
    }
  });

  it('every page links to the locale-correct calculator from the header (P1-3 D36)', () => {
    for (const page of pages) {
      expect(page.markers.navCalculator, `${page.file} a[data-nav-calculator]`).toBe(localePath(page.locale, '/calculator'));
    }
  });

  it('header guides link appears iff ≥1 guide is published, and no page links a draft guide (P1-4 D40)', () => {
    for (const page of pages) {
      expect(page.markers.navGuides, `${page.file} a[data-nav-guides]`).toBe(
        PUBLISHED_GUIDES.length > 0 ? localePath(page.locale, '/guides') : undefined,
      );
      for (const { href, localeSwitch } of page.links) {
        if (localeSwitch || href === page.urlPath) continue;
        const slug = guideSlugOf(href);
        if (slug) expect(guidePublished(slug), `${page.file} links draft guide ${href}`).toBe(true);
        // 가이드 본문의 브레드크럼은 목차로 간다 — 목차가 비어 있으면(published 0) 그 가이드도 초안이라 미링크·noindex
        if (stripLocale(href) === '/guides' && !isGuide(page)) expect(PUBLISHED_GUIDES.length, `${page.file} links the empty guides index`).toBeGreaterThan(0);
      }
    }
  });

  it('a[data-related-guide] on a combo points to a published guide in the same locale whose grid covers that combo (D44)', () => {
    for (const page of pages.filter((p) => p.combo)) {
      for (const href of page.relatedGuideHrefs) {
        const slug = guideSlugOf(href);
        expect(slug !== undefined && guidePublished(slug), `${page.file} related guide ${href}`).toBe(true);
        const covers = Object.values(GUIDES[slug!].grids).some(
          (g) => g.gpus.includes(page.combo!.gpuId) && g.models.includes(page.combo!.modelId),
        );
        expect(covers, `${page.file} related guide ${href} does not cover this combo`).toBe(true);
        expect(isKoPath(href), `${page.file} related guide locale`).toBe(page.locale === 'ko');
      }
    }
  });

  it('ko pages link only to /ko/* (except the locale switcher)', () => {
    for (const page of pages.filter((p) => p.locale === 'ko')) {
      for (const { href, localeSwitch } of page.links) {
        if (localeSwitch) continue;
        expect(isKoPath(href), `${page.file} → ${href}`).toBe(true);
      }
    }
  });
});

describe('en pages render no Korean text (CLAUDE.md 규칙 4)', () => {
  it('only the locale switcher label may be Hangul', () => {
    for (const page of pages.filter((p) => p.locale === 'en')) {
      expect(page.hangulWords.filter((w) => w !== '한국어'), page.file).toEqual([]);
    }
  });
});

describe('_redirects (docs/05 §3)', () => {
  it('exists, includes the /en cleanup rules, stays under the CF limit', () => {
    const path = join(outDir, '_redirects');
    expect(existsSync(path)).toBe(true);
    const rules = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.length).toBeLessThanOrEqual(CF_PAGES_REDIRECT_LINE_LIMIT);
    expect(rules).toContain('/en/* /:splat 301');
  });
});

// ---------------------------------------------------------------------------
// P1-2 콤보 페이지 불변식 (docs/04 §3·§4, 결정 D9~D18)
// ---------------------------------------------------------------------------

describe('combo pages exist for the whole catalog (결정 D9 — 전 조합 생성)', () => {
  it('every gpus.json × models.json pair has an en and a ko combo page', () => {
    requireCombos();
    const urls = urlSet();
    const missing: string[] = [];
    for (const gpu of gpus) {
      for (const model of models) {
        for (const locale of ['en', 'ko'] as const) {
          const path = comboPath(locale, model.id, gpu.id);
          if (!urls.has(path)) missing.push(path);
        }
      }
    }
    expect(missing, `${missing.length} combo pages missing (first: ${missing.slice(0, 5).join(', ')})`).toEqual([]);
  });

  it('every combo URL names a catalog GPU and model (no stray combos)', () => {
    const gpuIds = new Set(gpus.map((g) => g.id));
    const modelIds = new Set(models.map((m) => m.id));
    for (const page of requireCombos()) {
      expect(gpuIds.has(page.combo!.gpuId), `${page.file}: unknown gpu ${page.combo!.gpuId}`).toBe(true);
      expect(modelIds.has(page.combo!.modelId), `${page.file}: unknown model ${page.combo!.modelId}`).toBe(true);
    }
  });

  it('carries one h1, a verdict sentence, both hub links, adjacent combo links and a llama.cpp snippet', () => {
    for (const page of requireCombos()) {
      const { gpuId, modelId } = page.combo!;
      expect(page.h1Count, `${page.file} h1 count`).toBe(1);
      expect(page.verdictSentence, `${page.file} [data-verdict-sentence]`).toBeTruthy();

      const hrefs = new Set(page.links.map((l) => l.href));
      expect(hrefs.has(hubPath(page.locale, 'gpu', gpuId)), `${page.file} → gpu hub link`).toBe(true);
      expect(hrefs.has(hubPath(page.locale, 'model', modelId)), `${page.file} → model hub link`).toBe(true);

      expect(page.adjacentHrefs.length, `${page.file} a[data-adjacent]`).toBeGreaterThan(0);
      for (const href of page.adjacentHrefs) {
        expect(comboOf(href), `${page.file} adjacent → ${href} is not a combo`).toBeDefined();
        expect(isKoPath(href), `${page.file} adjacent → ${href} locale`).toBe(page.locale === 'ko');
        expect(href, `${page.file} adjacent self-link`).not.toBe(page.urlPath);
      }

      // 실행 명령은 fit 이 있을 때만 — 미탑재(RAM 힌트도 없음) 페이지는 [data-no-run] 으로 명시한다
      const llama = page.snippets.find((s) => s.kind === 'llama.cpp');
      if (page.noRun) {
        expect(llama, `${page.file} has both [data-no-run] and a llama.cpp snippet`).toBeUndefined();
      } else {
        expect(llama?.text, `${page.file} figure[data-snippet="llama.cpp"]`).toContain('llama-server -hf');
      }
      const ollama = page.snippets.find((s) => s.kind === 'ollama');
      if (ollama) expect(ollama.text, `${page.file} ollama snippet`).toContain('OLLAMA_CONTEXT_LENGTH');
    }
  });
});

describe('combo indexing gate (data/publish.json — 결정 D9, docs/04 §3)', () => {
  it('robots noindex ⇔ !indexable(publish.json); hubs and home are never noindex', () => {
    const combos = requireCombos();
    const publish = loadPublish();
    const indexable = combos.filter(indexableOf).length;
    console.log(
      `[publish] currentBatch ${publish.currentBatch}, batches ${publish.batches.map((b) => b.batch).join(',') || '-'} → ` +
        `${indexable}/${combos.length} combo pages indexable`,
    );
    for (const page of combos) {
      expect(page.robotsNoindex, `${page.file} robots noindex (indexable=${indexableOf(page)})`).toBe(
        !indexableOf(page),
      );
    }
    for (const page of pages.filter((p) => p.kind !== 'combo' && !isGuide(p) && !isGuidesIndex(p))) {
      expect(page.robotsNoindex, `${page.file} must not be noindex`).toBe(false);
    }
    // 가이드 감수 게이트 (P1-4 D40 — D24 의 '비콤보 noindex 금지'를 가이드·목차에 한해 대체)
    for (const page of pages.filter(isGuide)) {
      const draft = !guidePublished(guideSlugOf(page.urlPath)!);
      expect(page.robotsNoindex, `${page.file} noindex ⇔ draft`).toBe(draft);
      expect(page.markers.guideDraft, `${page.file} draft notice ⇔ draft`).toBe(draft);
    }
    for (const page of pages.filter(isGuidesIndex)) {
      expect(page.robotsNoindex, `${page.file} index noindex ⇔ no published guide`).toBe(PUBLISHED_GUIDES.length === 0);
      expect(page.markers.guidesEmpty, `${page.file} empty state`).toBe(PUBLISHED_GUIDES.length === 0);
    }
  });

  it('noindex(en) === noindex(ko twin)', () => {
    const map = byUrl();
    for (const page of requireCombos().filter((p) => p.locale === 'en')) {
      const twin = map.get(localePath('ko', page.urlPath));
      expect(twin, `${page.urlPath} ko twin`).toBeDefined();
      expect(twin!.robotsNoindex, `${page.urlPath} noindex differs from ko twin`).toBe(page.robotsNoindex);
    }
  });
});

describe('combo linking rules (docs/04 §3 — 공개 페이지는 공개 콤보로만 링크)', () => {
  it('home, calculator, hub pages and indexable combos link only to indexable combos', () => {
    requireCombos();
    const publicPages = pages.filter(
      (p) =>
        p.kind === 'home' || isCalculator(p) || isHub(p) || isGuide(p) || isGuidesIndex(p) || isStatic(p) || (p.kind === 'combo' && indexableOf(p)),
    );
    for (const page of publicPages) {
      for (const { href } of page.links) {
        const indexable = hrefIndexable(href);
        if (indexable === undefined) continue;
        expect(indexable, `${page.file} (${page.kind}) links to non-indexable combo ${href}`).toBe(true);
      }
      for (const href of page.comboLinkHrefs) {
        expect(hrefIndexable(href), `${page.file} a[data-combo-link] → ${href} must be an indexable combo`).toBe(true);
      }
    }
  });

  it(
    'every indexable combo is linked from its GPU hub, its model hub and ≥1 other combo via data-adjacent',
    { timeout: HEAVY_TIMEOUT },
    () => {
      const combos = requireCombos();
      const map = byUrl();
      const adjacentInbound = new Map<string, number>();
      for (const page of combos) {
        for (const href of new Set(page.adjacentHrefs)) {
          if (href === page.urlPath) continue;
          adjacentInbound.set(href, (adjacentInbound.get(href) ?? 0) + 1);
        }
      }
      const indexable = combos.filter(indexableOf);
      if (indexable.length === 0) {
        // currentBatch 0 이면 검사 대상이 없다 — 공회전을 숨기지 않고 그 이유(게이트 닫힘)를 단언한다. P1-6 개방 후 실효
        expect(loadPublish().currentBatch, 'no indexable combo although the publish gate is open').toBe(0);
        return;
      }
      for (const page of indexable) {
        const { gpuId, modelId } = page.combo!;
        const gpuHub = map.get(hubPath(page.locale, 'gpu', gpuId));
        const modelHub = map.get(hubPath(page.locale, 'model', modelId));
        expect(gpuHub?.links.some((l) => l.href === page.urlPath), `${page.urlPath} not linked from its GPU hub`).toBe(true);
        expect(modelHub?.links.some((l) => l.href === page.urlPath), `${page.urlPath} not linked from its model hub`).toBe(
          true,
        );
        expect(adjacentInbound.get(page.urlPath) ?? 0, `${page.urlPath} has no data-adjacent inbound link`).toBeGreaterThan(
          0,
        );
      }
    },
  );

  it('every indexable combo is linked from ≥1 published guide in the same locale (docs/04 §2 ③, P1-4 D44)', () => {
    const indexable = requireCombos().filter(indexableOf);
    if (indexable.length === 0) {
      expect(loadPublish().currentBatch, 'no indexable combo although the publish gate is open').toBe(0);
      return;
    }
    const guideInbound = new Set<string>();
    for (const page of pages.filter((p) => isGuide(p) && !p.robotsNoindex)) for (const href of page.comboLinkHrefs) guideInbound.add(href);
    for (const page of indexable) {
      expect(guideInbound.has(page.urlPath), `${page.urlPath} has no inbound link from a published guide`).toBe(true);
    }
  });
});

describe('depth test (결정 D15 — GPU명을 가려도 수치로 구분된다)', () => {
  const groupByFingerprint = (combos: PageFacts[]) => {
    const groups = new Map<string, string[]>();
    for (const page of combos) {
      groups.set(page.numberFingerprint, [...(groups.get(page.numberFingerprint) ?? []), page.urlPath]);
    }
    return groups;
  };

  it('number fingerprints are unique across all combo pages of each locale', { timeout: HEAVY_TIMEOUT }, () => {
    const combos = requireCombos();
    for (const locale of ['en', 'ko'] as const) {
      const scoped = combos.filter((p) => p.locale === locale);
      expect(scoped.length, `${locale} combo pages`).toBeGreaterThan(0);
      for (const page of scoped) {
        expect(page.numberFingerprint, `${page.file} has no numbers in its visible text`).not.toBe('');
      }
      const collisions = [...groupByFingerprint(scoped).values()].filter((urls) => urls.length > 1);
      const report = collisions
        .slice(0, 10)
        .map((urls) => urls.join(' == '))
        .join('\n');
      expect(collisions, `${locale}: ${collisions.length} fingerprint collision group(s)\n${report}`).toEqual([]);
    }
  });

  it('seeded sample of 3 en combo pages is distinguishable (AC record — URLs logged)', () => {
    const enCombos = requireCombos()
      .filter((p) => p.locale === 'en')
      .sort((a, b) => a.urlPath.localeCompare(b.urlPath, 'en'));
    const groups = groupByFingerprint(enCombos);
    const picks = pickDistinct(mulberry32(DEPTH_SEED), enCombos.length, 3).map((i) => enCombos[i]!);
    console.log(`[depth] mulberry32(${DEPTH_SEED}) sample: ${picks.map((p) => p.urlPath).join(' · ')}`);
    expect(picks).toHaveLength(3);
    for (const page of picks) {
      expect(groups.get(page.numberFingerprint), `${page.urlPath} fingerprint is not unique`).toEqual([page.urlPath]);
    }
  });
});

describe('boilerplate ratio (결정 D16 — ≥50% 페이지에 나타나는 문장 단위의 글자 비율 < 0.6)', () => {
  it('per locale, no combo page is 60% or more boilerplate by characters', { timeout: HEAVY_TIMEOUT }, () => {
    const combos = requireCombos();
    for (const locale of ['en', 'ko'] as const) {
      const scoped = combos.filter((p) => p.locale === locale);
      // df[unit] = 단위를 담은 콤보 페이지 수 (페이지당 Set 으로 중복 제거)
      const df = new Map<number, number>();
      for (const page of scoped) {
        for (const id of new Set(page.textUnitIds)) df.set(id, (df.get(id) ?? 0) + 1);
      }
      const threshold = 0.5 * scoped.length;
      const boilerplate = new Set([...df].filter(([, n]) => n >= threshold).map(([id]) => id));

      const ratios = scoped.map((page) => {
        expect(page.textChars, `${page.file} has no text units`).toBeGreaterThan(0);
        let hit = 0;
        for (const id of page.textUnitIds) if (boilerplate.has(id)) hit += units.text(id).length;
        return { page, ratio: hit / page.textChars };
      });
      const worst = ratios.reduce((a, b) => (b.ratio > a.ratio ? b : a));
      const values = ratios.map((r) => r.ratio);
      console.log(
        `[boilerplate] ${locale}: min ${Math.min(...values).toFixed(3)} median ${median(values).toFixed(3)} ` +
          `max ${worst.ratio.toFixed(3)} (${worst.page.urlPath}) — ${boilerplate.size}/${df.size} units boilerplate`,
      );
      expect(worst.ratio, `${locale} boilerplate max ${worst.ratio.toFixed(3)} at ${worst.page.urlPath}`).toBeLessThan(
        BOILERPLATE_MAX,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// P1-3 계산기·홈·아일랜드 불변식 (결정 D24~D36)
// ---------------------------------------------------------------------------

describe('calculator page (P1-3 D24·D29)', () => {
  it('exists in both locales, indexable, 2-level breadcrumb, form SSR markup and zero result cards in static HTML', () => {
    const calcs = requireCalculators();
    expect(calcs.map((p) => p.urlPath).sort()).toEqual(['/calculator', '/ko/calculator']);
    for (const page of calcs) {
      expect(page.robotsNoindex, page.file).toBe(false);
      expect(page.h1Count, page.file).toBe(1);
      expect(page.markers.calculator, `${page.file} [data-calculator]`).toBe(true);
      expect(page.markers.calcForm, `${page.file} form[data-calc-form]`).toBe(true);
      // SSR = datalist 폴백 (승격은 하이드레이션 뒤) — D29
      expect(page.markers.inputList, `${page.file} input[list]`).toBe(true);
      expect(page.datalistOptionCount, `${page.file} datalist options`).toBeGreaterThanOrEqual(gpus.length);
      expect(page.markers.resultCards, `${page.file} static result cards`).toBe(0);
      expect(page.formActions, `${page.file} form action`).toContain(localePath(page.locale, '/calculator'));
      const crumbs = page.jsonLd.find((b) => b['@type'] === 'BreadcrumbList')!;
      expect((crumbs.itemListElement as unknown[]).length, page.file).toBe(2);
    }
  });

  it('server-rendered starting points (10-14 D73): six catalog setups; model links go to indexable combos or model hubs, and they are the only static combo links', () => {
    for (const page of requireCalculators()) {
      expect(page.startGpuIds, `${page.file} [data-start-gpu]`).toHaveLength(6);
      expect(new Set(page.startGpuIds).size, page.file).toBe(page.startGpuIds.length);
      for (const id of page.startGpuIds) expect(gpus.some((g) => g.id === id), `${page.file} ${id}`).toBe(true);
      expect(page.startPickHrefs.length, `${page.file} a[data-start-pick]`).toBeGreaterThanOrEqual(page.startGpuIds.length);
      for (const href of page.startPickHrefs) {
        const combo = comboOf(href);
        if (combo) {
          expect(href, page.file).toBe(comboPath(page.locale, combo.modelId, combo.gpuId));
          expect(page.startGpuIds, `${page.file} ${href}`).toContain(combo.gpuId);
          expect(hrefIndexable(href), `${page.file} ${href} must be an indexable combo`).toBe(true);
        } else {
          const modelId = href.slice(localePath(page.locale, '/model/').length);
          expect(href, page.file).toBe(hubPath(page.locale, 'model', modelId));
          expect(models.some((m) => m.id === modelId), `${page.file} ${href}`).toBe(true);
        }
      }
      for (const href of page.links.map((l) => l.href).filter((h) => comboOf(h))) {
        expect(page.startPickHrefs, `${page.file} static combo link ${href} outside the starting points`).toContain(href);
      }
    }
  });
});

describe('home form (P1-3 D25)', () => {
  it('has a GET form to the locale-correct calculator with a datalist covering every GPU, plus a clean calculator link', () => {
    for (const page of pages.filter((p) => p.kind === 'home')) {
      expect(page.formActions, page.file).toContain(localePath(page.locale, '/calculator'));
      expect(page.datalistOptionCount, `${page.file} datalist options`).toBeGreaterThanOrEqual(gpus.length);
      expect(page.markers.openCalculator, `${page.file} a[data-open-calculator]`).toBe(localePath(page.locale, '/calculator'));
      expect(page.markers.calculator, `${page.file} must not embed the island`).toBe(false);
    }
  });
});

describe('guide pages (P1-4)', () => {
  it('one h1, ≥1 own-data block (AC — D42), the calculator widget, no block element inside a <p>', () => {
    const guides = pages.filter(isGuide);
    expect(guides.length).toBeGreaterThan(0);
    for (const page of guides) {
      expect(page.h1Count, `${page.file} h1`).toBe(1);
      expect(page.markers.guideData, `${page.file} [data-guide-data]`).toBeGreaterThan(0);
      expect(page.markers.calcWidgets, `${page.file} calculator widget`).toBe(1);
      expect(page.formActions, page.file).toContain(localePath(page.locale, '/calculator'));
      expect(page.datalistOptionCount, `${page.file} datalist options`).toBeGreaterThanOrEqual(gpus.length);
      expect(page.markers.blockInParagraph, `${page.file} block inside <p> (hydration mismatch)`).toBe(0);
    }
  });
});

describe('GPU picker payload carries no prices (D27 — the msrpUSD exception is calculator-only, 10-03 D65)', () => {
  it('home and guide pages ship no price fields', () => {
    const targets = pages.filter((p) => p.kind === 'home' || isGuide(p));
    expect(targets.length).toBeGreaterThan(2);
    for (const page of targets) {
      expect(readFileSync(join(outDir, page.file), 'utf8'), page.file).not.toMatch(/msrpUSD|streetUSD|priceAsOf/);
    }
  });
});

describe('memory-size verdict lists and the system RAM toggle (10-03 D64)', () => {
  const RANK: Record<string, number> = { F: 0, B: 1, A: 2, S: 3 };
  const kindOfGpu = (gpuId: string) => gpus.find((g) => g.id === gpuId)?.kind;

  it('dGPU combos show the 16–128 GB list with the RAM toggle exactly when the top verdict changes, otherwise the "same" phrase', () => {
    let listed = 0;
    for (const page of requireCombos()) {
      if (kindOfGpu(page.combo!.gpuId) !== 'dgpu') {
        expect(page.markers.ramToggle, `${page.file} RAM toggle off dGPU`).toBe(false);
        expect(page.ramSame, `${page.file} RAM phrase off dGPU`).toBe(false);
        continue;
      }
      const rams = page.ramSteps.map((r) => r.ram);
      expect([0, 5], `${page.file} RAM rows ${rams.join(',')}`).toContain(rams.length);
      const hasList = rams.length === 5;
      expect(page.markers.ramToggle, `${page.file} toggle ⇔ list`).toBe(hasList);
      expect(page.ramSame, `${page.file} "same verdict" phrase ⇔ no list`).toBe(!hasList);
      if (!hasList) continue;
      listed += 1;
      expect(rams, page.file).toEqual([16, 32, 64, 96, 128]);
      // 목록이 있으면 맨 위 판정이 실제로 바뀐다 — 설명 문구는 판정이 바뀌는지에 따라 갈린다
      const keys = new Set(page.ramSteps.map((r) => [r.verdict, r.quant, r.displayVerdict, r.fits].join('|')));
      expect(keys.size, `${page.file} list without any change`).toBeGreaterThan(1);
      const verdicts = new Set(page.ramSteps.map((r) => `${r.verdict}|${r.displayVerdict}`));
      expect(page.ramCaption, `${page.file} caption`).toBe(verdicts.size > 1 ? 'verdict' : 'file');
      // 기준 판정은 RAM 이 늘수록 내려가지 않는다
      for (let i = 1; i < page.ramSteps.length; i += 1) {
        expect(RANK[page.ramSteps[i]!.verdict]!, `${page.file} ${rams[i - 1]}→${rams[i]} GB`).toBeGreaterThanOrEqual(
          RANK[page.ramSteps[i - 1]!.verdict]!,
        );
      }
    }
    expect(listed, 'no dGPU combo lists RAM steps').toBeGreaterThan(0);
  });

  it('every list marks the page configuration once, and its badge is the header verdict; en and ko twins agree', () => {
    const map = byUrl();
    for (const page of requireCombos().filter((p) => p.ramSteps.length > 0)) {
      const assumed = page.ramSteps.filter((r) => r.assumed);
      expect(assumed.length, `${page.file} [data-assumed] rows`).toBe(1);
      expect(assumed[0]!.verdict, `${page.file} assumed row vs header`).toBe(page.headerVerdict);
      expect(page.ramSteps.filter((r) => r.commands).length, `${page.file} [data-commands] rows`).toBeLessThanOrEqual(1);
      if (page.locale !== 'en') continue;
      const twin = map.get(localePath('ko', page.urlPath))!;
      expect(twin.ramSteps, `${page.urlPath} ko twin rows`).toEqual(page.ramSteps);
    }
  });

  it('the live summary is empty in static HTML (filled only after interaction — D28)', () => {
    for (const page of requireCombos()) expect(page.liveSummary ?? '', `${page.file} [data-live-summary]`).toBe('');
  });
});

describe('model hub → calculator model mode (10-03 D65)', () => {
  it('every model hub links to the locale-correct calculator in model mode for that model; no other page kind does', () => {
    const models = pages.filter((p) => p.kind === 'model');
    expect(models.length).toBeGreaterThan(0);
    for (const page of models) {
      const modelId = page.urlPath.split('/').pop()!;
      expect(page.markers.calcModelLink, `${page.file} a[data-calc-model-link]`).toBe(`${localePath(page.locale, '/calculator')}?mode=model&m=${modelId}`);
    }
    for (const page of pages.filter((p) => p.kind !== 'model')) {
      expect(page.markers.calcModelLink, `${page.file} a[data-calc-model-link]`).toBeUndefined();
    }
  });
});

describe('islands SSR (P1-3 D28 · price sort)', () => {
  it('every combo page renders the ctx/KV controls and keeps the static ctx table; every model hub renders the sort control', () => {
    for (const page of requireCombos()) {
      expect(page.markers.ctxControls, `${page.file} [data-ctx-controls]`).toBe(true);
    }
    for (const page of pages.filter((p) => p.kind === 'model')) {
      expect(page.markers.sortControl, `${page.file} [data-sort-control]`).toBe(true);
    }
    for (const page of pages.filter((p) => p.kind === 'gpu' || p.kind === 'home' || isGuide(p) || isGuidesIndex(p) || isStatic(p))) {
      expect(page.markers.sortControl || page.markers.ctxControls, `${page.file} has no island`).toBe(false);
    }
  });
});

/** 초기 모듈 스크립트 gzip 합 (D34) — LHCI 는 8 URL 만 보므로 전 페이지를 여기서 본다. source: docs/01 §7 (policy) */
const SCRIPT_BUDGET = 150_000;
/** 계산기 별도 캡 — 첫 측정 152,686 B × 1.15 → lighthouserc.json 180,224(176 KiB) 와 정합 (전송 헤더 몫 제외). source: docs/01 §7 (policy) */
const CALC_SCRIPT_BUDGET = 176_000;
/** 홈 청크집합 대비 페이지별 추가분 상한 (콤보·허브 아일랜드) */
const EXTRA_CHUNK_MAX = 3_072;

describe('script budget (P1-3 D34 — 전 페이지 초기 모듈 스크립트 gzip 합)', () => {
  it('non-calculator pages ≤ 150,000 B, calculator ≤ cap, islands add ≤ 3 KiB over the home chunk set, no preload outside the initial set', () => {
    const { gzipSync } = require('node:zlib') as typeof import('node:zlib');
    const sizes = new Map<string, number>();
    const sizeOf = (src: string): number => {
      if (!sizes.has(src)) {
        const file = join(outDir, src.replace(/^\//, ''));
        sizes.set(src, existsSync(file) ? gzipSync(readFileSync(file), { level: 6 }).length : Number.NaN);
      }
      return sizes.get(src)!;
    };
    const home = pages.find((p) => p.urlPath === '/')!;
    const homeSet = new Set(home.scriptSrcs);
    const homeTotal = home.scriptSrcs.reduce((sum, s) => sum + sizeOf(s), 0);
    let worst = { page: home, total: homeTotal };
    let calcTotal = 0;
    for (const page of pages) {
      const total = page.scriptSrcs.reduce((sum, s) => sum + sizeOf(s), 0);
      expect(Number.isFinite(total), `${page.file} references a missing chunk`).toBe(true);
      for (const src of page.preloadSrcs) {
        expect(page.scriptSrcs.includes(src), `${page.file} preloads a chunk outside its initial set: ${src}`).toBe(true);
      }
      if (isCalculator(page)) {
        expect(total, `${page.file} script gz ${total}`).toBeLessThanOrEqual(CALC_SCRIPT_BUDGET);
        calcTotal = Math.max(calcTotal, total);
        continue;
      }
      expect(total, `${page.file} script gz ${total}`).toBeLessThanOrEqual(SCRIPT_BUDGET);
      const extra = page.scriptSrcs.filter((s) => !homeSet.has(s)).reduce((sum, s) => sum + sizeOf(s), 0);
      expect(extra, `${page.file} extra chunks over home ${extra} B`).toBeLessThanOrEqual(EXTRA_CHUNK_MAX);
      if (total > worst.total) worst = { page, total };
    }
    console.log(`[scripts] home ${homeTotal} B gz · worst non-calculator ${worst.total} B (${worst.page.urlPath}) · calculator ${calcTotal} B`);
  });
});

describe('export file hygiene (결정 D18 — RSC 페이로드 프루닝 · CF Pages 한도)', () => {
  const basename = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

  it('no *.txt outside the allowlist and no __next* directories', () => {
    const strayTxt = outFiles.map((f) => f.rel).filter((rel) => rel.endsWith('.txt') && !TXT_ALLOWLIST.has(basename(rel)));
    expect(strayTxt.slice(0, 20), `${strayTxt.length} stray .txt file(s)`).toEqual([]);
    const nextDirs = outDirs.filter((rel) => basename(rel).startsWith('__next'));
    expect(nextDirs.slice(0, 20), `${nextDirs.length} __next* director(ies)`).toEqual([]);
  });

  it(`fewer than ${FILE_COUNT_MAX} files, every file under 25 MiB`, () => {
    expect(outFiles.length, 'total file count').toBeLessThan(FILE_COUNT_MAX);
    const largest = outFiles.reduce((a, b) => (b.size > a.size ? b : a));
    expect(largest.size, `largest file ${largest.rel}`).toBeLessThan(FILE_SIZE_MAX);
  });

  it('non-HTML files live only under _next/static/** or the root allowlist', () => {
    const stray = outFiles
      .map((f) => f.rel)
      .filter((rel) => !rel.endsWith('.html') && !rel.startsWith('_next/static/') && !ROOT_FILE_ALLOWLIST.test(rel));
    expect(stray.slice(0, 20), `${stray.length} unexpected non-HTML file(s)`).toEqual([]);
  });
});

describe('updates page (10-14 D72 — /updates)', () => {
  it('both locales are indexable, show every registry entry in order and link every catalog model hub once', () => {
    const map = byUrl();
    for (const locale of ['en', 'ko'] as const) {
      const page = map.get(localePath(locale, '/updates'));
      expect(page, `${locale} /updates`).toBeDefined();
      expect(page!.kind, `${page!.file} kind`).toBe('static');
      expect(page!.robotsNoindex, `${page!.file} noindex`).toBe(false);
      expect(page!.updateIds, `${page!.file} [data-update]`).toEqual(SITE_UPDATES.map((u) => u.id));
      expect([...page!.addedModelHrefs].sort(), `${page!.file} a[data-added-model]`).toEqual(
        models.map((m) => localePath(locale, `/model/${m.id}`)).sort(),
      );
    }
  });

  it('its sitemap lastmod is the later of the data date and the newest entry', () => {
    const xml = readFileSync(join(outDir, 'sitemap-pages.xml'), 'utf8');
    const dataUpdated = readJson<{ dataUpdated: string }>('data/meta.json').dataUpdated;
    const expected = dataUpdated > latestSiteUpdate() ? dataUpdated : latestSiteUpdate();
    for (const locale of ['en', 'ko'] as const) {
      const entry = [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].find(
        (m) => urlToPath(m[1]!) === localePath(locale, '/updates'),
      );
      expect(entry?.[2], `${locale} /updates lastmod`).toBe(expected);
    }
  });
});

describe('sitemaps · robots.txt · RSS (P1-5)', () => {
  const read = (rel: string) => readFileSync(join(outDir, rel), 'utf8');
  const locsOf = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  const origin = () => new URL(pages.find((p) => p.urlPath === '/')!.canonical!).origin;

  it('the sitemap index lists existing sub-sitemaps whose URLs are exactly the canonicals of every indexable page', () => {
    const subs = locsOf(read('sitemap.xml'));
    expect(subs.length, 'sub-sitemaps').toBeGreaterThanOrEqual(4);
    const seen: string[] = [];
    for (const url of subs) {
      expect(url.startsWith(`${origin()}/`), url).toBe(true);
      const rel = url.slice(origin().length + 1);
      expect(existsSync(join(outDir, rel)), rel).toBe(true);
      seen.push(...locsOf(read(rel)));
    }
    expect(new Set(seen).size, 'duplicate <loc>').toBe(seen.length);
    const expected = pages.filter((p) => !p.robotsNoindex).map((p) => p.canonical ?? `(no canonical) ${p.file}`);
    // 빠짐·초과·noindex 포함 0 — 공개 콤보가 생기면(P1-6) combos-en/-ko 가 자동으로 여기 들어온다
    expect([...seen].sort()).toEqual([...expected].sort());
  });

  it('ads.txt exists exactly when an AdSense publisher ID is set, as the single Google line (Phase 1.5)', () => {
    const path = join(outDir, 'ads.txt');
    expect(existsSync(path), 'ads.txt present').toBe(ADSENSE_CLIENT !== '');
    if (ADSENSE_CLIENT) {
      expect(read('ads.txt')).toBe(`google.com, ${ADSENSE_CLIENT.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
      expect(ADSENSE_CLIENT).toMatch(/^ca-pub-\d{16}$/);
    }
  });

  it('robots.txt allows crawling (including /can-i-run/) and names the sitemap', () => {
    const robots = read('robots.txt');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).not.toMatch(/^Disallow:\s*\/\S/m);
    expect(robots).toContain(`Sitemap: ${origin()}/sitemap.xml`);
  });

  it('RSS per locale lists exactly the published guides, linking their canonical URLs', () => {
    for (const [rel, locale] of [
      ['rss.xml', 'en'],
      ['ko/rss.xml', 'ko'],
    ] as const) {
      const xml = read(rel);
      const links = [...xml.matchAll(/<item><title>[^<]*<\/title><link>([^<]+)<\/link>/g)].map((m) => m[1]!);
      const expected = PUBLISHED_GUIDES.map((slug) => `${origin()}${localePath(locale, `/guides/${slug}`)}`);
      expect([...links].sort(), rel).toEqual([...expected].sort());
    }
  });
});
