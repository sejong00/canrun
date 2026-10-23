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
 *
 * zh(10-19 D109 — 화면 문구만 기계번역, 공개 작업 전까지 noindex): 위 en/ko 불변식은 en/ko 페이지(`pages`)에만 건다.
 * zh 페이지(`zhPages`)는 맨 아래 "zh (D109)" 블록이 따로 본다 — 템플릿 페이지 집합 = en, 전부 noindex·자기 캐노니컬·hreflang 없음,
 * 사이트맵·RSS 밖, 한글·원화 없음, 내부 링크는 /zh/* 만(푸터의 영어 정적 페이지 예외).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMPARES, COMPARE_SLUGS, publishedCompares } from '../apps/web/content/compares';
import { GUIDES, GUIDE_SLUGS, type GuideSlug } from '../apps/web/content/guides';
import { GPU_INTRO_IDS, HUB_INTROS_UPDATED, MODEL_INTRO_IDS } from '../apps/web/content/hubs';
import { MODEL_ABOUT, MODEL_ABOUT_IDS, hasModelAbout } from '../apps/web/content/model-about';
import { seriesMembers } from '../apps/web/content/model-series';
import { RUNTIME_FACTS, RUNTIME_FACT_SOURCE_KEYS, isRuntimeFactId } from '../apps/web/lib/runtime-facts';
import { SITE_UPDATES, latestSiteUpdate } from '../apps/web/content/updates';
import { ADSENSE_CLIENT, DAUM_WEBMASTER_LINE, INDEXNOW_KEY } from '../apps/web/lib/site';
import { ENGINE_SPEC_DATE } from '../packages/engine/src/index';
import { CF_PAGES_REDIRECT_LINE_LIMIT } from '../scripts/build-redirects';
import { comboCardText, loadCatalog, ogTranslators } from '../scripts/og-cards';
import { HUB_POLICY, MAC_LINES, summarizeGpu, type GpuHubData } from '../packages/data/src/index';
import { comboOgImage, compareOgImage, defaultOgImage, guideOgImage, hubOgImage } from '../apps/web/lib/og-images';
import { STATIC_PAGE_SLUGS } from '../apps/web/content/pages';
import { ALL_LOCALES, CONTENT_LOCALES, HTML_LANG, INDEXED_LOCALES, OG_LOCALE } from '../apps/web/i18n/locales';
import {
  comboIndexable,
  comboOf,
  comboPath,
  compareSlugOf,
  createFactsContext,
  extractPageFacts,
  hubPath,
  isKoPath,
  isZhPath,
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
/** IndexNow 키 파일 (10-16 D93 — 내용 = 키, 공개 값) */
const INDEXNOW_KEY_FILE = `${INDEXNOW_KEY}.txt`;
/** 허용 비-HTML 파일 (P1-5 사이트맵·robots·RSS·기본 공유 카드, ads·llms 대비 · 허브 카드 D60 · IndexNow 키 파일 D93 · 공개 콤보·게시 가이드 카드 D96 · favicon.ico D99 · 게시 GPU 비교 카드 D106) */
const ROOT_FILE_ALLOWLIST =
  /^(?:_redirects|icon\.svg|favicon\.ico|robots\.txt|sitemap[^/]*\.xml|ads\.txt|llms\.txt|[0-9a-f]{32}\.txt|rss\.xml|ko\/rss\.xml|og\/default-(?:en|ko)\.png|og\/(?:gpu|model|guide|compare)\/[a-z0-9.-]+-(?:en|ko)\.png|og\/combo\/[a-z0-9.-]+\/[a-z0-9.-]+-(?:en|ko)\.png)$/;
const TXT_ALLOWLIST = new Set(['robots.txt', 'ads.txt', 'llms.txt', INDEXNOW_KEY_FILE]);
/** RSS 파일 크기 상한 (10-16 D93 — 본문 전체를 넣은 피드를 수집기가 한 번에 받도록 10MB 아래로. 정책 값) */
const RSS_SIZE_MAX = 10 * 1000 * 1000;
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
/** YYYY-MM-DD 둘 중 늦은 날 */
const laterDate = (a: string, b: string) => (a > b ? a : b);
/** React 가 텍스트를 이스케이프하는 방식 — 렌더된 HTML 에서 messages 문장을 찾을 때 */
const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/** 검색 노출 로캘(en·ko) 페이지 — 기존 불변식 전부의 대상 */
type IndexedPageFacts = PageFacts & { locale: 'en' | 'ko' };
let pages: IndexedPageFacts[] = [];
/** zh 페이지 (10-19 D109) — "zh (D109)" 블록만 본다 */
let zhPages: PageFacts[] = [];
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
  zhPages = [];
  for (const { rel } of outFiles) {
    if (!rel.endsWith('.html') || EXCLUDED.has(rel)) continue;
    // HTML 은 이 스코프를 벗어나면 버려진다 (D17). 단 V8 은 정규식 일치·slice 로 얻은 부분 문자열이 원본 HTML 을 가리키게 둬서
    // (sliced string) facts 의 문자열 하나만 남아도 페이지 HTML 전체가 힙에 남는다 — 복제로 끊는다(10-20: 8,998장에서 힙 4.1GB 로 Node 기본 상한을 넘어 메모리 부족 → 복제 후 0.3GB)
    const facts = structuredClone(extractPageFacts(readFileSync(join(outDir, rel), 'utf8'), rel, ctx));
    if (facts.locale === 'zh') zhPages.push(facts);
    else pages.push(facts as IndexedPageFacts);
  }
  // 10-19 D109: zh 템플릿 페이지 약 2,700장이 더해져 HTML 이 약 5,900 → 8,600장 — 사실 추출이 그만큼 길어져 상한을 2분 → 4분으로
}, 240_000);

// ---------------------------------------------------------------------------
// 공용 조회
// ---------------------------------------------------------------------------

const isHub = (page: PageFacts) => page.kind === 'gpu' || page.kind === 'model';
const isCalculator = (page: PageFacts) => page.kind === 'calculator';
/** GPU 비교 (10-19 D106) — 페이지·목차. 초안 쌍은 noindex·미링크, 목차는 게시 쌍이 0이면 noindex·미링크(가이드와 같은 규칙) */
const isCompare = (page: PageFacts) => page.kind === 'compare';
const isCompareIndex = (page: PageFacts) => page.kind === 'compare-index';
const PUBLISHED_COMPARES = publishedCompares();
const comparePublished = (slug: string) => (PUBLISHED_COMPARES as readonly string[]).includes(slug);
const isStructured = (page: PageFacts) => isHub(page) || page.kind === 'combo' || isCalculator(page) || isCompare(page);
const isGuide = (page: PageFacts) => page.kind === 'guide';
const isGuidesIndex = (page: PageFacts) => page.kind === 'guides-index';
/** 모델·GPU 목록 (10-19) */
const isList = (page: PageFacts) => page.kind === 'models-index' || page.kind === 'gpus-index';
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
function requireCalculators(): IndexedPageFacts[] {
  const calcs = pages.filter(isCalculator);
  if (calcs.length === 0) throw new Error('no /calculator page under apps/web/out — P1-3 calculator not exported');
  return calcs;
}
const urlSet = () => new Set(pages.map((p) => p.urlPath));
const byUrl = () => new Map(pages.map((p) => [p.urlPath, p]));

/** 콤보 페이지 — EXPECT_COMBOS 이고 0건이면 명확히 실패 */
function requireCombos(): IndexedPageFacts[] {
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

  it('sitemap lastmod of a hub with an intro is the latest of the data, engine (D93) and intro dates; other hubs the later of data and engine', () => {
    const numbersDate = laterDate(readJson<{ dataUpdated: string }>('data/meta.json').dataUpdated, ENGINE_SPEC_DATE);
    const introDate = laterDate(numbersDate, HUB_INTROS_UPDATED);
    const withIntro = new Set([...GPU_INTRO_IDS.map((id) => `/gpu/${id}`), ...MODEL_INTRO_IDS.map((id) => `/model/${id}`)]);
    let checked = 0;
    for (const file of ['sitemap-gpus.xml', 'sitemap-models.xml']) {
      const xml = readFileSync(join(outDir, file), 'utf8');
      for (const m of xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) {
        const path = urlToPath(m[1]!).replace(/^\/ko(?=\/)/, '');
        const hubDate = withIntro.has(path) ? introDate : numbersDate;
        // 모델 소개(10-19 D102)가 붙은 모델 허브는 그 소개를 고친 날까지
        const aboutId = path.startsWith('/model/') ? path.slice('/model/'.length) : '';
        expect(m[2], `${file} ${m[1]} lastmod`).toBe(hasModelAbout(aboutId) ? laterDate(hubDate, MODEL_ABOUT[aboutId]) : hubDate);
        checked += 1;
      }
    }
    expect(checked, 'hub sitemap entries').toBeGreaterThan(withIntro.size * 2);
  });
});

describe('model about (10-19 D102 — "어떤 모델인가요" 한 문단은 레지스트리 모델에만)', () => {
  it('exactly the registered model hubs render it in both locales, before the hub intro and the specs: one paragraph + a source line led by the model card', () => {
    const hfIds = new Map(readJson<Array<{ id: string; hfId: string }>>('data/models.json').map((m) => [m.id, m.hfId]));
    const expected = MODEL_ABOUT_IDS.map((id) => `/model/${id}`).sort();
    const seen: Record<'en' | 'ko', string[]> = { en: [], ko: [] };
    for (const page of pages.filter(isHub)) {
      const path = stripLocale(page.urlPath);
      const { modelAboutParagraphs, modelAboutHrefs, modelAboutFirst } = page.markers;
      if (modelAboutParagraphs === 0) {
        // 소개가 없는 허브(GPU 허브 포함)는 지금과 같게 렌더된다
        expect(modelAboutHrefs, `${page.file} stray about links`).toEqual([]);
        continue;
      }
      seen[page.locale].push(path);
      const id = path.slice('/model/'.length);
      expect(page.kind, `${page.file} about on a non-model page`).toBe('model');
      expect(modelAboutParagraphs, `${page.file} about paragraphs`).toBe(2);
      expect(modelAboutFirst, `${page.file} about comes before the intro and the specs`).toBe(true);
      expect(modelAboutHrefs[0], `${page.file} first source`).toBe(`https://huggingface.co/${hfIds.get(id)}`);
      for (const href of modelAboutHrefs) expect(href, `${page.file} about link`).toMatch(/^https:\/\//);
    }
    expect(seen.en.sort(), 'en hubs with an about text').toEqual(expected);
    expect(seen.ko.sort(), 'ko hubs with an about text').toEqual(expected);
  });
});

describe('model series table (10-19 — 같은 계열의 다른 크기, content/model-series.ts)', () => {
  it('a model hub whose series has ≥2 members links every sibling hub exactly once, smallest first, and marks itself unlinked; other pages render no table', () => {
    const catalogModels = readJson<Array<{ id: string; paramsB: number }>>('data/models.json');
    let tables = 0;
    for (const page of pages) {
      const id = page.kind === 'model' ? stripLocale(page.urlPath).slice('/model/'.length) : undefined;
      const members = id === undefined ? [] : seriesMembers(catalogModels, id);
      if (members.length === 0) {
        expect(page.modelSeries, `${page.file} renders a series table`).toBeUndefined();
        continue;
      }
      tables += 1;
      const series = page.modelSeries;
      expect(series, `${page.file} series table`).toBeDefined();
      // 순서까지 같다 = 형제마다 링크 한 번, 파라미터 작은 순 — 현재 모델은 링크가 아니라 표시 한 줄
      expect(series!.hrefs, `${page.file} sibling links`).toEqual(
        members.filter((m) => m.id !== id).map((m) => hubPath(page.locale, 'model', m.id)),
      );
      expect(series!.hrefs, `${page.file} links itself`).not.toContain(page.urlPath);
      expect(series!.currentRows, `${page.file} current-model rows`).toBe(1);
    }
    expect(tables, 'model hubs with a series table (en + ko)').toBeGreaterThan(0);
    expect(tables % 2, 'en/ko render the same tables').toBe(0);
  });
});

describe('share cards (D60 허브별 · D96 공개 콤보·게시 가이드별 og:image)', () => {
  const ogPath = (page: PageFacts) => new URL(page.ogImage!).pathname;

  it('every page has an og:image that exists in out/, and twitter:image is the same card', () => {
    for (const page of pages) {
      expect(page.ogImage, page.file).toBeDefined();
      const path = ogPath(page);
      expect(existsSync(join(outDir, path.slice(1))), `${page.file} → ${path}`).toBe(true);
      expect(page.twitterImage, page.file).toBe(page.ogImage);
    }
  });

  it('hubs, published combos and published guides use their own card; unpublished combos and drafts keep the default', () => {
    let combos = 0;
    for (const page of pages) {
      const path = ogPath(page);
      if (isHub(page)) {
        expect(path, page.file).toBe(hubOgImage(page.kind as 'gpu' | 'model', page.urlPath.split('/').pop()!, page.locale));
      } else if (page.kind === 'combo') {
        const { modelId, gpuId } = page.combo!;
        expect(path, page.file).toBe(indexableOf(page) ? comboOgImage(modelId, gpuId, page.locale) : defaultOgImage(page.locale));
        combos += 1;
      } else if (isCompare(page)) {
        const slug = page.compareSlug!;
        expect(path, page.file).toBe(comparePublished(slug) ? compareOgImage(slug, page.locale) : defaultOgImage(page.locale));
      } else if (isCompareIndex(page)) {
        expect(path, page.file).toBe(defaultOgImage(page.locale));
      } else if (isGuide(page)) {
        const slug = guideSlugOf(page.urlPath)!;
        expect(path, page.file).toBe(guidePublished(slug) ? guideOgImage(slug, page.locale) : defaultOgImage(page.locale));
        // Article.image 도 같은 카드
        const article = page.jsonLd.find((b) => b['@type'] === 'Article')!;
        expect(article.image, page.file).toBe(page.ogImage);
      }
    }
    expect(combos, 'combo pages checked').toBeGreaterThan(0);
  });

  it('cards exist only for published pages (file count follows the indexable set, D18)', () => {
    const plan = loadPublish();
    const published = gpus.flatMap((g) => models.filter((m) => comboIndexable(plan, g.id, m.id))).length;
    const count = (prefix: string) => outFiles.filter((f) => f.rel.startsWith(prefix)).length;
    expect(count('og/combo/'), 'combo cards = indexable combos × 2 locales').toBe(published * 2);
    expect(count('og/guide/'), 'guide cards = published guides × 2 locales').toBe(PUBLISHED_GUIDES.length * 2);
    expect(count('og/compare/'), 'compare cards = published compare pairs × 2 locales').toBe(PUBLISHED_COMPARES.length * 2);
  });

  it('a combo card shows the title verdict and the description memory and speed band with its label (규칙 3)', () => {
    const catalog = loadCatalog();
    const hubs = new Map<string, GpuHubData>();
    const hubOf = (gpuId: string) => {
      if (!hubs.has(gpuId)) hubs.set(gpuId, summarizeGpu(catalog, catalog.gpus.find((g) => g.id === gpuId)!));
      return hubs.get(gpuId)!;
    };
    const t = { en: ogTranslators('en'), ko: ogTranslators('ko') };
    let checked = 0;
    for (const page of requireCombos().filter(indexableOf)) {
      const card = comboCardText(hubOf(page.combo!.gpuId), page.combo!.modelId, t[page.locale], page.locale);
      expect(page.title, `${page.file} title verdict`).toContain(card.verdictText);
      const need = /(\d[\d.,]*)\s?GB/.exec(card.need)?.[1];
      expect(need, `${page.file} card need`).toBeDefined();
      expect(page.description, `${page.file} need`).toContain(need!);
      if (card.speed) {
        expect(page.description, `${page.file} speed`).toContain(card.speed.value);
        // 추정은 description 과 같은 밴드·라벨, 실측은 측정 조건이 붙은 라벨
        if (/±\d+%/.test(card.speed.label)) expect(page.description, `${page.file} label`).toContain(card.speed.label);
        else expect(card.speed.label, page.file).toMatch(/measured|실측/);
      } else {
        expect(card.need, `${page.file} no speed only when it does not fit`).toMatch(/does not fit|들어가지 않습니다/);
      }
      checked += 1;
    }
    expect(checked, 'published combo pages').toBeGreaterThan(0);
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
      if (isList(page)) expect(types, page.file).toEqual(expect.arrayContaining(['BreadcrumbList', 'ItemList']));
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

  it('breadcrumbs: every item has a URL (결정 D7), the last one is the canonical; hubs go through their list page and combos through the model hub, 3 levels each (10-19 · D10)', () => {
    for (const page of pages.filter((p) => isStructured(p) || isList(p))) {
      const crumbs = page.jsonLd.find((b) => b['@type'] === 'BreadcrumbList')!;
      const items = crumbs.itemListElement as Array<{ item?: string; position: number }>;
      expect(items.length, page.file).toBeGreaterThanOrEqual(2);
      items.forEach((item, i) => {
        expect(item.position, page.file).toBe(i + 1);
        expect(item.item, page.file).toMatch(/^https?:\/\//);
      });
      expect(items.at(-1)!.item, page.file).toBe(page.canonical);
      expect(urlToPath(items[0]!.item!), `${page.file} crumb 1`).toBe(localePath(page.locale, '/'));
      // 목록 페이지는 2단(홈 › 목록), 허브는 3단(홈 › 목록 › 허브 — 10-19, 그 전에는 목록 페이지가 없어 2단이었다)
      if (isList(page)) expect(items.length, page.file).toBe(2);
      if (isHub(page)) {
        expect(items.length, page.file).toBe(3);
        expect(urlToPath(items[1]!.item!), `${page.file} crumb 2`).toBe(localePath(page.locale, page.kind === 'gpu' ? '/gpus' : '/models'));
      }
      if (isCompare(page)) {
        // 홈 › GPU 비교 목차 › 비교 (10-19 D106 — 가이드와 같은 3단)
        expect(items.length, page.file).toBe(3);
        expect(urlToPath(items[1]!.item!), `${page.file} crumb 2`).toBe(localePath(page.locale, '/compare'));
      }
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

describe('runtime facts (10-19 — 가이드 <RuntimeFact>, lib/runtime-facts.ts)', () => {
  it('every rendered fact is "sentence (source line)" in the page locale, with one link to its record’s source and the checked date', () => {
    const guideData = Object.fromEntries(
      (['en', 'ko'] as const).map((locale) => [locale, readJson<{ GuideData: Record<string, string> }>(`apps/web/messages/${locale}.json`).GuideData]),
    ) as Record<'en' | 'ko', Record<string, string>>;
    const seen: Record<'en' | 'ko', number> = { en: 0, ko: 0 };
    for (const page of pages) {
      for (const fact of page.runtimeFacts) {
        seen[page.locale] += 1;
        expect(isRuntimeFactId(fact.id), `${page.file} unknown fact ${fact.id}`).toBe(true);
        const record = RUNTIME_FACTS[fact.id as keyof typeof RUNTIME_FACTS];
        const messages = guideData[page.locale];
        const sourceLine = messages[RUNTIME_FACT_SOURCE_KEYS[record.tool]]!.replace('{date}', record.checked);
        expect(fact.hrefs, `${page.file} ${fact.id} source link`).toEqual([record.source]);
        expect(fact.text, `${page.file} ${fact.id} text`).toBe(`${messages[record.message]} (${sourceLine})`);
      }
    }
    expect(seen.en, 'en pages render runtime facts').toBeGreaterThan(0);
    expect(seen.ko, 'ko pages render runtime facts').toBeGreaterThan(0);
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

  it('GPU hub descriptions name the same largest model and quant as FAQ Q1 (10-16 D95)', () => {
    // 긴 이름부터 — "Qwen3 30B-A3B (2507)" 이 "Qwen3 30B-A3B" 보다 먼저 맞아야 한다
    const names = models.map((m) => m.name).sort((a, b) => b.length - a.length);
    const problems: string[] = [];
    let named = 0;
    for (const page of pages.filter((p) => p.kind === 'gpu')) {
      const answer = page.faq[0]?.answer ?? '';
      const model = names.find((n) => answer.startsWith(n));
      if (!model) continue; // "전부 올라가는 모델 없음" 답 — description 도 가장 큰 모델을 말하지 않는다
      named += 1;
      // en "{model} at {quant} (…" · ko "{model} {quant}(…" — description 도 같은 이음새로 쓴다
      const quant = answer.slice(model.length).match(/^(?: at | )[A-Za-z0-9_-]+/)?.[0];
      const key = `${model}${quant ?? ''}`;
      if (!quant || !(page.description ?? '').includes(key)) problems.push(`${page.file}: FAQ Q1 "${key}" — description "${page.description}"`);
    }
    expect(named, 'GPU hubs whose FAQ Q1 names a model').toBeGreaterThan(0);
    expect(problems.slice(0, 10)).toEqual([]);
  });
});

describe('Korean model names (10-16 D94 — 한글 표기는 한국어 페이지에, 페이지마다 한 번)', () => {
  it('ko model hubs put "Name(한글)" in the title, description and h1 and nowhere else in the body; ko combos name it once in the body, never in the title', () => {
    const problems: string[] = [];
    let hubs = 0;
    let combos = 0;
    for (const page of pages) {
      const ko = page.koModelName;
      if (!ko) continue;
      if (page.kind === 'model') {
        hubs += 1;
        if (!ko.title || !ko.description || !ko.h1) problems.push(`${page.file}: "${ko.name}" missing from title/description/h1`);
        if (ko.body !== 1) problems.push(`${page.file}: "${ko.name}" appears ${ko.body}× in the body (h1 only)`);
      } else if (page.kind === 'combo') {
        combos += 1;
        if (ko.title) problems.push(`${page.file}: "${ko.name}" in the combo title`);
        if (ko.body !== 1) problems.push(`${page.file}: "${ko.name}" appears ${ko.body}× in the body (model hub link only)`);
      }
    }
    expect(hubs, 'ko model hubs with a Hangul family name').toBeGreaterThan(0);
    expect(combos, 'ko combos with a Hangul family name').toBeGreaterThan(0);
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('no page writes Qwen in Hangul (큐웬·큐원 collide with other brands on Naver)', () => {
    expect(pages.filter((p) => p.qwenHangul).map((p) => p.file)).toEqual([]);
  });
});

describe('Mac product names (10-16 D97 — Apple 칩 허브의 제목·H1·설명, data/gpus.json products)', () => {
  it('Apple hubs name every Mac line in the title and h1, the description names the lines sold with its memory size, and no combo or other hub title names a Mac', () => {
    const lineNames = Object.fromEntries(
      (['en', 'ko'] as const).map((locale) => {
        const ns = readJson<{ MacProduct: Record<string, string> }>(`apps/web/messages/${locale}.json`).MacProduct;
        return [locale, MAC_LINES.map((line) => ({ line, name: ns[line]! }))];
      }),
    ) as Record<'en' | 'ko', Array<{ line: string; name: string }>>;
    const problems: string[] = [];
    let apple = 0;
    for (const page of pages.filter((p) => p.kind === 'gpu' || p.kind === 'combo')) {
      const gpu = gpus.find((g) => g.id === (page.combo?.gpuId ?? page.urlPath.split('/').pop()));
      const names = lineNames[page.locale];
      if (page.kind === 'gpu' && gpu?.products) {
        apple += 1;
        const lines = new Set(gpu.products.map((p) => p.line));
        // 설명은 요약 구성(최대 메모리)으로 파는 계열만 — M4 Pro 64GB 는 맥 미니뿐
        const ram = Math.max(...(gpu.ramOptionsGB ?? []));
        const sold = new Set(gpu.products.filter((p) => p.memoryGB.includes(ram)).map((p) => p.line));
        for (const { line, name } of names) {
          if (lines.has(line) !== (page.title ?? '').includes(name)) problems.push(`${page.file}: title "${page.title}" and ${name}`);
          if (lines.has(line) !== (page.hubH1 ?? '').includes(name)) problems.push(`${page.file}: h1 "${page.hubH1}" and ${name}`);
          if (sold.has(line) !== (page.description ?? '').includes(name)) problems.push(`${page.file}: description "${page.description}" and ${name}`);
        }
      } else {
        // 콤보 제목은 지금 구글 순위가 붙은 제목이라 그대로 둔다(배치 2 를 열 때 한 번에 바꾼다 — D94)
        for (const { name } of names) if ((page.title ?? '').includes(name)) problems.push(`${page.file}: title "${page.title}" names ${name}`);
      }
    }
    expect(apple, 'Apple chip hubs (en + ko)').toBe(2 * gpus.filter((g) => g.products).length);
    expect(problems.slice(0, 20)).toEqual([]);
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
    // GPU 비교: 게시 쌍만 링크 대상, 목차는 게시 쌍이 1개 이상일 때만 (10-19 D106)
    const linkedCompares = (p: PageFacts) =>
      (isCompare(p) && comparePublished(p.compareSlug!)) || (isCompareIndex(p) && PUBLISHED_COMPARES.length > 0);
    for (const page of pages.filter((p) => isHub(p) || isCalculator(p) || linkedGuides(p) || isStatic(p) || isList(p) || linkedCompares(p))) {
      expect(inbound.get(page.urlPath) ?? 0, `orphan ${page.kind} ${page.urlPath}`).toBeGreaterThan(0);
    }
  });

  it('every page links to the locale-correct calculator from the header (P1-3 D36)', () => {
    for (const page of pages) {
      expect(page.markers.navCalculator, `${page.file} a[data-nav-calculator]`).toBe(localePath(page.locale, '/calculator'));
    }
  });

  it('every page links to the locale-correct model and GPU lists from the header (10-19)', () => {
    for (const page of pages) {
      expect([page.markers.navModels, page.markers.navGpus], `${page.file} a[data-nav-models|gpus]`).toEqual([
        localePath(page.locale, '/models'),
        localePath(page.locale, '/gpus'),
      ]);
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
        // GPU 비교(10-19 D106): 초안 쌍으로는 링크하지 않는다. 비교 페이지의 브레드크럼·"전체 비교 목록"은 목차로 간다 — 목차가 비어 있으면 그 쌍도 초안이다
        const compareSlug = compareSlugOf(href);
        if (compareSlug) expect(comparePublished(compareSlug), `${page.file} links draft compare page ${href}`).toBe(true);
        if (stripLocale(href) === '/compare' && !isCompare(page)) expect(PUBLISHED_COMPARES.length, `${page.file} links the empty compare index`).toBeGreaterThan(0);
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
    for (const page of pages.filter((p) => p.kind !== 'combo' && !isGuide(p) && !isGuidesIndex(p) && !isCompare(p) && !isCompareIndex(p))) {
      expect(page.robotsNoindex, `${page.file} must not be noindex`).toBe(false);
    }
    // GPU 비교 감수 게이트 (10-19 D106 — 가이드 D40 과 같은 규칙): 쌍 noindex ⇔ 초안, 목차 noindex ⇔ 게시 쌍 0
    for (const page of pages.filter(isCompare)) {
      expect(page.robotsNoindex, `${page.file} noindex ⇔ draft`).toBe(!comparePublished(page.compareSlug!));
    }
    for (const page of pages.filter(isCompareIndex)) {
      expect(page.robotsNoindex, `${page.file} index noindex ⇔ no published pair`).toBe(PUBLISHED_COMPARES.length === 0);
      expect(page.markers.comparesEmpty, `${page.file} empty state`).toBe(PUBLISHED_COMPARES.length === 0);
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
        p.kind === 'home' ||
        isCalculator(p) ||
        isHub(p) ||
        isGuide(p) ||
        isGuidesIndex(p) ||
        isStatic(p) ||
        (p.kind === 'combo' && indexableOf(p)) ||
        // GPU 비교(10-19 D106): 게시 쌍과 목차 — 초안 쌍도 공개 콤보로만 링크한다(아래 compare 블록이 본다)
        (isCompare(p) && comparePublished(p.compareSlug!)) ||
        isCompareIndex(p),
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

describe('GPU comparison pages (10-19 D106 — /compare/{a}-vs-{b}, 레지스트리 쌍만)', () => {
  const requireCompares = () => {
    const found = pages.filter(isCompare);
    expect(found.length, 'compare pages exported (en + ko)').toBe(COMPARE_SLUGS.length * 2);
    return found;
  };

  it('every registry pair has an en and a ko page, and the index exists in both locales; no stray /compare/* page', () => {
    const urls = urlSet();
    for (const slug of COMPARE_SLUGS) {
      for (const locale of ['en', 'ko'] as const) expect(urls.has(localePath(locale, `/compare/${slug}`)), `${locale} ${slug}`).toBe(true);
    }
    expect(pages.filter(isCompareIndex).map((p) => p.urlPath).sort()).toEqual(['/compare', '/ko/compare']);
    const stray = pages.filter((p) => /^(?:\/ko)?\/compare\/[^/]+$/.test(p.urlPath) && !isCompare(p)).map((p) => p.file);
    expect(stray).toEqual([]);
  });

  it('one h1, the speed summary, links to both GPU hubs and to the index; combo links only to indexable combos (drafts too)', () => {
    for (const page of requireCompares()) {
      const { a, b } = COMPARES[page.compareSlug! as keyof typeof COMPARES];
      expect(page.h1Count, `${page.file} h1`).toBe(1);
      expect(page.markers.compareSummary, `${page.file} [data-compare-summary]`).toBe(true);
      expect(page.markers.blockInParagraph, `${page.file} block inside <p>`).toBe(0);
      const hrefs = new Set(page.links.filter((l) => !l.localeSwitch).map((l) => l.href));
      expect(hrefs.has(hubPath(page.locale, 'gpu', a)), `${page.file} → ${a} hub`).toBe(true);
      expect(hrefs.has(hubPath(page.locale, 'gpu', b)), `${page.file} → ${b} hub`).toBe(true);
      expect(hrefs.has(localePath(page.locale, '/compare')), `${page.file} → /compare`).toBe(true);
      for (const href of page.comboLinkHrefs) expect(hrefIndexable(href), `${page.file} a[data-combo-link] → ${href}`).toBe(true);
      for (const { href } of page.links) {
        if (hrefIndexable(href) === false) throw new Error(`${page.file} links non-indexable combo ${href}`);
      }
    }
  });

  it('GPU hubs link exactly the published pairs they belong to (none while every pair is a draft)', () => {
    for (const page of pages.filter((p) => p.kind === 'gpu')) {
      const gpuId = page.urlPath.split('/').pop()!;
      const expected = PUBLISHED_COMPARES.filter((slug) => COMPARES[slug].a === gpuId || COMPARES[slug].b === gpuId).map((slug) =>
        localePath(page.locale, `/compare/${slug}`),
      );
      expect(page.compareLinkHrefs, `${page.file} a[data-compare-link]`).toEqual(expected);
    }
    for (const page of pages.filter((p) => p.kind !== 'gpu')) expect(page.compareLinkHrefs, `${page.file} a[data-compare-link]`).toEqual([]);
  });

  it('the index lists exactly the published pairs, 2-level breadcrumb', () => {
    for (const page of pages.filter(isCompareIndex)) {
      const items = page.jsonLd.find((b) => b['@type'] === 'BreadcrumbList')!.itemListElement as Array<{ item: string }>;
      expect(items.length, page.file).toBe(2);
      expect(items.at(-1)!.item, page.file).toBe(page.canonical);
      const listed = page.links.map((l) => l.href).filter((href) => compareSlugOf(href) !== undefined);
      expect([...new Set(listed)].sort(), page.file).toEqual(PUBLISHED_COMPARES.map((slug) => localePath(page.locale, `/compare/${slug}`)).sort());
    }
  });
});

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

  it('DGX Spark combos list one unit then 64·128 GB × 2 and × 4 linked units (never the page configuration), with the RPC note; no other combo has linked rows (10-23 D118)', () => {
    let dgx = 0;
    for (const page of requireCombos()) {
      const linked = page.ramSteps.filter((r) => r.nodes > 1);
      if (page.combo!.gpuId !== 'nvidia-dgx-spark') {
        expect(linked, `${page.file} linked rows`).toEqual([]);
        expect(page.clusterNotes, `${page.file} cluster note`).toBe(0);
        continue;
      }
      dgx += 1;
      expect(page.ramSteps.map((r) => (r.nodes > 1 ? `${r.ram}x${r.nodes}` : String(r.ram))), page.file).toEqual(['64', '128', '64x2', '128x2', '64x4', '128x4']);
      expect(linked.some((r) => r.assumed), `${page.file} a linked row is the page configuration`).toBe(false);
      expect(page.clusterNotes, `${page.file} cluster note`).toBe(1);
      // 1대로 충분(10-23 D121): 그 행에는 판정 배지·표시 양자화가 없고 같은 메모리 1대 행은 기준 양자화가 들어간다(불가가 아니다).
      // 그 밖의 여러 대 행은 판정 배지가 있다. 1대 행에는 이 표시가 없다
      for (const r of linked) {
        const single = page.ramSteps.find((s) => s.nodes === 1 && s.ram === r.ram)!;
        if (r.oneUnit) {
          expect([r.verdict, r.quant, r.displayVerdict], `${page.file} ${r.ram}x${r.nodes} one unit`).toEqual(['', '', '']);
          expect(single.verdict, `${page.file} ${r.ram}x${r.nodes} one unit but ${r.ram} GB is F`).not.toBe('F');
        } else {
          expect(r.verdict, `${page.file} ${r.ram}x${r.nodes} verdict`).not.toBe('');
        }
      }
      expect(page.ramSteps.filter((r) => r.nodes === 1).some((r) => r.oneUnit), `${page.file} one-unit mark on a one-unit row`).toBe(false);
      // 행과 그 안의 칩이 한 번씩
      expect(page.oneUnitMarks, `${page.file} one-unit marks`).toBe(linked.filter((r) => r.oneUnit).length * 2);
    }
    expect(dgx, 'DGX Spark combos').toBeGreaterThan(0);
    // 한 대에 들어가는 모델(1대로 충분)과 연결이 필요한 모델이 둘 다 실제로 있다 — 빈 검사가 아니다
    const dgxRows = requireCombos().filter((p) => p.combo!.gpuId === 'nvidia-dgx-spark').flatMap((p) => p.ramSteps.filter((r) => r.nodes > 1));
    expect(dgxRows.some((r) => r.oneUnit)).toBe(true);
    expect(dgxRows.some((r) => !r.oneUnit)).toBe(true);
  });

  it('GPU hubs: the DGX Spark summary adds 64·128 GB × 2 and × 4 after one unit, with the note; other hubs list only their own sizes (10-23 D118)', () => {
    const hubs = pages.filter((p) => p.kind === 'gpu');
    let dgx = 0;
    for (const page of hubs) {
      const id = page.urlPath.split('/').pop()!;
      const gpu = gpus.find((g) => g.id === id)!;
      if (id === 'nvidia-dgx-spark') {
        dgx += 1;
        expect(page.hubConfigKeys, page.file).toEqual(['64', '128', '64x2', '128x2', '64x4', '128x4']);
        expect(page.clusterNotes, page.file).toBe(1);
        // 1대로 충분 수(10-23 D121)는 여러 대 행에만. 요약 칩 4개 + '메모리 구성별 판정' 표의 1대로 충분 칸 수
        const [one64, one128, ...linkedCounts] = page.hubOneUnitCounts;
        expect([one64, one128], page.file).toEqual([null, null]);
        for (const n of linkedCounts) expect(n !== null && n > 0, `${page.file} one-unit count ${n}`).toBe(true);
        expect(page.oneUnitMarks, page.file).toBe(4 + linkedCounts.reduce<number>((sum, n) => sum + n!, 0));
        continue;
      }
      expect(page.hubOneUnitCounts.every((n) => n === null), page.file).toBe(true);
      expect(page.oneUnitMarks, page.file).toBe(0);
      expect(page.clusterNotes, page.file).toBe(0);
      expect(page.hubConfigKeys, page.file).toEqual(gpu.kind === 'dgpu' ? [String(HUB_POLICY.dgpuRamGB)] : (gpu.ramOptionsGB ?? []).map(String));
    }
    expect(dgx, 'DGX Spark hubs (en + ko)').toBeGreaterThanOrEqual(2);
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

describe('calculator widget on detail pages (10-19 D107 — 검색으로 들어온 페이지에서 계산기를 바로 쓰게)', () => {
  const DETAIL_KINDS = new Set(['combo', 'gpu', 'model', 'compare']);
  const DEEP_LINK_KEYS = new Set(['gpu', 'ram', 'ddr', 'm']);
  const gpuNames = (locale: 'en' | 'ko') => readJson<{ GpuName?: Record<string, string> }>(`apps/web/messages/${locale}.json`).GpuName ?? {};
  const displayName = (locale: 'en' | 'ko', gpuId: string) => gpuNames(locale)[gpuId] ?? gpus.find((g) => g.id === gpuId)!.name;

  /** 딥 링크 = 로캘 계산기 + 계산기 코덱이 읽는 키만, gpu = 카탈로그 id, ram = 통합·CPU 면 그 기기의 메모리 구성 중 하나 */
  const expectDeepLink = (page: PageFacts, href: string, gpuId: string, modelId?: string) => {
    const url = new URL(href, 'https://deep-link.invalid');
    expect(url.pathname, `${page.file} ${href}`).toBe(localePath(page.locale, '/calculator'));
    const params = Object.fromEntries(url.searchParams);
    for (const key of Object.keys(params)) expect(DEEP_LINK_KEYS.has(key), `${page.file} ${href} key ${key}`).toBe(true);
    expect(params.gpu, `${page.file} ${href} gpu`).toBe(gpuId);
    expect(params.m, `${page.file} ${href} m`).toBe(modelId);
    const gpu = gpus.find((g) => g.id === gpuId)!;
    if (params.ram !== undefined) {
      expect(gpu.kind === 'dgpu' ? [8, 16, 24, 32, 48, 64, 96, 128, 192, 256] : gpu.ramOptionsGB, `${page.file} ${href} ram`).toContain(Number(params.ram));
    }
  };

  it('every combo, GPU hub, model hub and compare page has exactly one widget to the locale calculator, prefilled with the page GPU / model', () => {
    const detail = pages.filter((p) => DETAIL_KINDS.has(p.kind));
    for (const kind of DETAIL_KINDS) expect(detail.filter((p) => p.kind === kind).length, `${kind} pages`).toBeGreaterThan(0);
    for (const page of detail) {
      expect(page.markers.calcWidgets, `${page.file} calculator widget`).toBe(1);
      const form = page.calcWidgetForms[0]!;
      expect(form.action, `${page.file} action`).toBe(localePath(page.locale, '/calculator'));
      expect(form.home, `${page.file} data-home-form`).toBe(false);
      // 서버 HTML 에선 보이는 칸이 gpu 를 보낸다 — 숨은 gpu=<id> 는 하이드레이션 뒤에만 (JS 전에 친 GPU 를 덮지 않게, 리뷰 반영).
      // 미리 채운 표시명은 계산기가 이름으로 해석한다(D31 — 표시명 자기 해석은 apps/web/test/gpu-match.test.ts)
      expect(form.gpuInputName, `${page.file} GPU field name`).toBe('gpu');
      const id = page.urlPath.split('/').pop()!;
      if (page.kind === 'combo') {
        const { gpuId, modelId } = page.combo!;
        expect(form.hidden, `${page.file} hidden fields`).toEqual({ m: modelId });
        expect(form.gpuText, `${page.file} GPU field`).toBe(displayName(page.locale, gpuId));
        expect(page.calcDeepLinks.map((l) => l.kind), `${page.file} deep links`).toEqual(['combo']);
        expectDeepLink(page, page.calcDeepLinks[0]!.href, gpuId, modelId);
      } else if (page.kind === 'gpu') {
        expect(form.hidden, `${page.file} hidden fields`).toEqual({});
        expect(form.gpuText, `${page.file} GPU field`).toBe(displayName(page.locale, id));
        expect(page.calcDeepLinks, `${page.file} deep links`).toEqual([]);
      } else if (page.kind === 'model') {
        // GPU 칸은 비어 있다. 숨은 mode=model(비운 채 보내면 계산기 모델 모드)은 하이드레이션 뒤에 아일랜드가 붙인다 — E2E
        expect(form.hidden, `${page.file} hidden fields`).toEqual({ m: id });
        expect(form.gpuText, `${page.file} GPU field`).toBe('');
        expect(page.calcDeepLinks, `${page.file} deep links`).toEqual([]);
      } else {
        const entry = COMPARES[page.compareSlug as keyof typeof COMPARES];
        expect(form.hidden, `${page.file} hidden fields`).toEqual({});
        expect(form.gpuText, `${page.file} GPU field`).toBe(displayName(page.locale, entry.a));
        expect(page.calcDeepLinks.map((l) => l.kind), `${page.file} deep links`).toEqual(['a', 'b']);
        expectDeepLink(page, page.calcDeepLinks[0]!.href, entry.a);
        expectDeepLink(page, page.calcDeepLinks[1]!.href, entry.b);
      }
    }
  });

  it('home and guides keep the empty widget; no other page kind has a widget or a deep link', () => {
    for (const page of pages) {
      if (DETAIL_KINDS.has(page.kind)) continue;
      const expected = page.kind === 'home' || isGuide(page) ? 1 : 0;
      expect(page.markers.calcWidgets, `${page.file} calculator widgets`).toBe(expected);
      expect(page.calcDeepLinks, `${page.file} deep links`).toEqual([]);
      for (const form of page.calcWidgetForms) {
        expect(form.hidden, `${page.file} hidden fields`).toEqual({});
        expect(form.gpuText, `${page.file} GPU field`).toBe('');
        expect(form.gpuInputName, `${page.file} GPU field name`).toBe('gpu');
        expect(form.home, `${page.file} data-home-form`).toBe(page.kind === 'home');
      }
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
    for (const page of pages.filter((p) => p.kind === 'gpu' || p.kind === 'home' || isGuide(p) || isGuidesIndex(p) || isStatic(p) || isCompare(p) || isCompareIndex(p))) {
      expect(page.markers.sortControl || page.markers.ctxControls, `${page.file} has no island`).toBe(false);
    }
    // 목록 페이지(10-19)만 목록 정렬·거르기 컨트롤을 그린다
    for (const page of pages) {
      const expected = page.kind === 'models-index' ? 'models' : page.kind === 'gpus-index' ? 'gpus' : undefined;
      expect(page.markers.listControls, `${page.file} [data-list-controls]`).toBe(expected);
    }
  });
});

describe('list pages (10-19 — /models·/gpus: 카탈로그 전 모델·전 GPU 를 서버 HTML 에)', () => {
  const absolute = (page: PageFacts, path: string) => `${new URL(page.canonical!).origin}${path}`;
  const itemList = (page: PageFacts) => {
    const list = page.jsonLd.find((b) => b['@type'] === 'ItemList')!;
    return { list, urls: (list.itemListElement as Array<{ url: string; position: number }>).map((i) => i.url) };
  };
  // GPU 허브 요약 — 목록의 "쾌적·원활" 수가 허브와 같은 함수·같은 구성의 값인지 (허브 페이지와 같은 summarizeGpu)
  const hubs = new Map<string, GpuHubData>();
  let catalog: ReturnType<typeof loadCatalog> | undefined;
  const gpuHub = (id: string): GpuHubData => {
    catalog ??= loadCatalog();
    if (!hubs.has(id)) hubs.set(id, summarizeGpu(catalog, catalog.gpus.find((g) => g.id === id)!));
    return hubs.get(id)!;
  };
  const requireList = (kind: 'models-index' | 'gpus-index') => {
    const found = pages.filter((p) => p.kind === kind);
    expect(found.map((p) => p.locale).sort(), `${kind} pages`).toEqual(['en', 'ko']);
    return found;
  };

  it('/models: indexable, one row and one hub link per catalog model in the default order, and an ItemList in the same order', () => {
    // 기본 순서 = lib/browse.ts modelListOrder (인기도 → 30일 다운로드 → 이름)
    const full = readJson<Array<{ id: string; name: string; popularity: number; hfDownloads30d?: number }>>('data/models.json');
    const order = [...full]
      .sort((a, b) => b.popularity - a.popularity || (b.hfDownloads30d ?? -1) - (a.hfDownloads30d ?? -1) || a.name.localeCompare(b.name, 'en'))
      .map((m) => m.id);
    for (const page of requireList('models-index')) {
      expect(page.robotsNoindex, page.file).toBe(false);
      expect(page.listRows.map((r) => r.id), `${page.file} rows`).toEqual(order);
      expect(page.browseModelHrefs, `${page.file} model links`).toEqual(order.map((id) => hubPath(page.locale, 'model', id)));
      const { list, urls } = itemList(page);
      expect(list.numberOfItems, page.file).toBe(order.length);
      expect(list.url, page.file).toBe(page.canonical);
      expect(urls, `${page.file} ItemList`).toEqual(page.browseModelHrefs.map((href) => absolute(page, href)));
      // 정렬·거르기 값: 기본 순서 index, 크기 구간, 깃발은 있는 모델만
      page.listRows.forEach((row, i) => {
        expect(row.data['sort-index'], `${page.file} ${row.id}`).toBe(String(i));
        expect(['s', 'm', 'l', 'xl'], `${page.file} ${row.id} size`).toContain(row.data.size);
        expect(row.data.released, `${page.file} ${row.id} released`).toMatch(/^\d{8}$/);
        // 필요 메모리(D101) — 소수 1자리 GB, 거르기 값과 화면 값이 같은 반올림
        expect(row.data.need, `${page.file} ${row.id} need`).toMatch(/^\d+(?:\.\d)?$/);
      });
    }
  });

  it('/gpus: indexable, one row and one hub link per catalog GPU, an ItemList in page order, "runs great or well" equal to the GPU hub summary', () => {
    for (const page of requireList('gpus-index')) {
      expect(page.robotsNoindex, page.file).toBe(false);
      expect([...page.listRows.map((r) => r.id)].sort(), `${page.file} rows`).toEqual(gpus.map((g) => g.id).sort());
      expect(page.browseGpuHrefs, `${page.file} GPU links`).toEqual(page.listRows.map((r) => hubPath(page.locale, 'gpu', r.id)));
      const { list, urls } = itemList(page);
      expect(list.numberOfItems, page.file).toBe(gpus.length);
      expect(urls, `${page.file} ItemList`).toEqual(page.browseGpuHrefs.map((href) => absolute(page, href)));
      for (const row of page.listRows) {
        const hub = gpuHub(row.id);
        const counts = hub.counts[hub.primaryIndex]!;
        // 쾌적·원활을 따로(D101) — great = S, good = S+A, runs = S+A+B (CPU 전용은 B 까지라 runs 만 차이가 난다)
        expect([row.data.great, row.data.good, row.data.runs], `${page.file} ${row.id} counts`).toEqual([
          String(counts.S),
          String(counts.S + counts.A),
          String(counts.S + counts.A + counts.B),
        ]);
      }
      // 가격 정렬 값은 dGPU 실거래가(priceAsOf 동반)만 — 규칙 2
      for (const row of page.listRows.filter((r) => r.data.price !== undefined)) {
        const gpu = gpus.find((g) => g.id === row.id) as GpuRecord & { streetUSD?: number; priceAsOf?: string };
        expect([gpu.kind, String(gpu.streetUSD), Boolean(gpu.priceAsOf)], `${page.file} ${row.id} price`).toEqual(['dgpu', row.data.price, true]);
      }
      if (page.locale === 'ko') expect([page.krwPrices > 0, page.krwNote], `${page.file} KRW`).toEqual([true, true]);
      // 메모리 용량별 가장 싼 그래픽카드(D101) — VRAM 크기마다 데스크톱 그래픽카드 실거래가(priceAsOf 동반) 최저 1종, 크기 오름차순
      const priced = (gpus as Array<GpuRecord & { form?: string; vramGB?: number; streetUSD?: number; priceAsOf?: string }>).filter(
        (g) => g.kind === 'dgpu' && g.form !== 'laptop' && g.streetUSD !== undefined && Boolean(g.priceAsOf),
      );
      const sizes = [...new Set(priced.map((g) => g.vramGB!))].sort((a, b) => a - b);
      const expected = sizes.map((gb) => {
        const atSize = priced.filter((g) => g.vramGB === gb);
        return `${gb}:${atSize.find((g) => g.streetUSD === Math.min(...atSize.map((x) => x.streetUSD!)))!.id}`;
      });
      const html = readFileSync(join(outDir, page.file), 'utf8');
      const cheapest = [...html.matchAll(/<tr data-cheapest-vram="(\d+)">[\s\S]*?data-cheapest-gpu="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
      expect(cheapest, `${page.file} cheapest by memory`).toEqual(expected);
    }
  });

  it('home links both lists; the footer of every page links them too', () => {
    for (const page of pages.filter((p) => p.kind === 'home')) {
      expect([...page.browseAllHrefs].sort(), page.file).toEqual([localePath(page.locale, '/gpus'), localePath(page.locale, '/models')]);
    }
    for (const page of pages) {
      const hrefs = new Set(page.links.map((l) => l.href));
      expect(hrefs.has(localePath(page.locale, '/models')) && hrefs.has(localePath(page.locale, '/gpus')), page.file).toBe(true);
    }
  });

  it('sitemap lastmod: the model list follows the data, engine and download dates (memory needed · 30-day downloads — D101), the GPU list the data and engine dates (its counts are verdicts)', () => {
    const xml = readFileSync(join(outDir, 'sitemap-pages.xml'), 'utf8');
    const dataUpdated = readJson<{ dataUpdated: string }>('data/meta.json').dataUpdated;
    const lastmods = new Map([...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [urlToPath(m[1]!), m[2]!]));
    for (const locale of ['en', 'ko'] as const) {
      const downloadsDate = readJson<Array<{ hfDownloadsAsOf?: string }>>('data/models.json')
        .map((m) => m.hfDownloadsAsOf)
        .filter((d): d is string => d !== undefined)
        .reduce(laterDate, laterDate(dataUpdated, ENGINE_SPEC_DATE));
      expect(lastmods.get(localePath(locale, '/models')), `${locale} /models`).toBe(downloadsDate);
      expect(lastmods.get(localePath(locale, '/gpus')), `${locale} /gpus`).toBe(laterDate(dataUpdated, ENGINE_SPEC_DATE));
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
    // 다음 웹마스터도구 확인 줄은 맨 끝 (D99)
    if (DAUM_WEBMASTER_LINE) expect(robots.trimEnd().split('\n').at(-1)).toBe(DAUM_WEBMASTER_LINE);
  });

  it('serves /favicon.ico — 네이버 사이트 진단이 없는 파일을 접근 불가 페이지로 셌다 (D99)', () => {
    const ico = readFileSync(join(outDir, 'favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0); // ICONDIR reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type = icon
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0);
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

  it('RSS items carry the full guide body in <content:encoded> (D93): every body heading, absolute links, no scripts/nav/icons/screen attributes, under the size cap', () => {
    for (const [rel, locale] of [
      ['rss.xml', 'en'],
      ['ko/rss.xml', 'ko'],
    ] as const) {
      const xml = read(rel);
      console.log(`[rss] ${rel} ${xml.length} chars`);
      expect(Buffer.byteLength(xml), `${rel} bytes`).toBeLessThan(RSS_SIZE_MAX);
      expect(xml, rel).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
      const dataNote = readJson<{ Guides: { dataNote: string } }>(`apps/web/messages/${locale}.json`).Guides.dataNote;
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]!);
      expect(items.length, rel).toBe(PUBLISHED_GUIDES.length);
      for (const item of items) {
        const link = /<link>([^<]+)<\/link>/.exec(item)![1]!;
        expect(item, `${link} <description>`).toMatch(/<description>[^<]+<\/description>/);
        const encoded = /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/.exec(item)?.[1];
        expect(encoded, `${link} <content:encoded>`).toBeDefined();
        expect(encoded!.endsWith(`<p>${dataNote}</p>`), `${link} ends with the data note`).toBe(true);
        for (const banned of ['<script', '<style', '<nav', '<svg', '<form', '<!--', ' class=', ' style=', ' data-', ' aria-', 'href="/', '__next']) {
          expect(encoded!.includes(banned), `${link} content contains ${banned}`).toBe(false);
        }
        // 화면의 본문 = [data-guide-body] 시작부터 바로 뒤 데이터 안내 문단까지 — 그 안의 h2 가 피드에 전부 있다
        const html = readFileSync(join(outDir, `${urlToPath(link).slice(1)}.html`), 'utf8');
        const start = html.indexOf('data-guide-body');
        const end = html.indexOf(escHtml(dataNote), start);
        expect(start > 0 && end > start, `${link} page has a body followed by the data note`).toBe(true);
        const headings = [...html.slice(start, end).matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) =>
          m[1]!.replace(/<!--[\s\S]*?-->/g, '').replace(/\s(?:class|data-[\w-]+)="[^"]*"/g, ''),
        );
        expect(headings.length, `${link} body headings`).toBeGreaterThan(0);
        for (const heading of headings) expect(encoded!.includes(`<h2>${heading}</h2>`), `${link} heading "${heading}"`).toBe(true);
      }
    }
  });

  it('the IndexNow key file sits at the site root and holds just the key (D93)', () => {
    expect(INDEXNOW_KEY).toMatch(/^[0-9a-f]{32}$/);
    expect(existsSync(join(outDir, INDEXNOW_KEY_FILE)), INDEXNOW_KEY_FILE).toBe(true);
    expect(read(INDEXNOW_KEY_FILE)).toBe(INDEXNOW_KEY);
  });

  it('calculator and combo lastmod are the later of the data date and the engine date (D93); home keeps the data date', () => {
    const dataUpdated = readJson<{ dataUpdated: string }>('data/meta.json').dataUpdated;
    const numbersDate = laterDate(dataUpdated, ENGINE_SPEC_DATE);
    const lastmods = (xml: string) => [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [urlToPath(m[1]!), m[2]!] as const);
    const pageDates = new Map(lastmods(read('sitemap-pages.xml')));
    for (const locale of ['en', 'ko'] as const) {
      expect(pageDates.get(localePath(locale, '/')), `${locale} home`).toBe(dataUpdated);
      expect(pageDates.get(localePath(locale, '/calculator')), `${locale} calculator`).toBe(numbersDate);
      const combos = existsSync(join(outDir, `sitemap-combos-${locale}.xml`)) ? lastmods(read(`sitemap-combos-${locale}.xml`)) : [];
      for (const [path, lastmod] of combos) expect(lastmod, path).toBe(numbersDate);
    }
  });
});

// ---------------------------------------------------------------------------
// zh (10-19 D109) — 화면 문구만 기계번역(사용자 승인), 공개 작업(애드센스 승인 뒤) 전까지 검색 제외
// ---------------------------------------------------------------------------

describe('zh (D109 — 화면 문구만, 공개 작업 전까지 noindex·hreflang·사이트맵 밖)', () => {
  /** 장문 페이지 — 사람이 따로 쓴 MDX 가 있는 로캘(CONTENT_LOCALES)에만 있다 (CLAUDE.md 규칙 4) */
  const isLongForm = (page: PageFacts) => isGuide(page) || isGuidesIndex(page) || isStatic(page);
  const requireZh = (): PageFacts[] => {
    if (zhPages.length === 0) throw new Error('no /zh pages under apps/web/out — the zh locale was not exported');
    return zhPages;
  };
  const origin = () => new URL(pages.find((p) => p.urlPath === '/')!.canonical!).origin;

  it('the zh page set is exactly the en template pages — no guides, guides index or static pages', () => {
    const zh = requireZh();
    const expected = pages.filter((p) => p.locale === 'en' && !isLongForm(p)).map((p) => localePath('zh', p.urlPath));
    expect(zh.map((p) => p.urlPath).sort()).toEqual(expected.sort());
    expect(new Set(zh.map((p) => p.urlPath)).size, 'one file per zh URL').toBe(zh.length);
    expect(zh.filter(isLongForm).map((p) => p.file)).toEqual([]);
    for (const slug of STATIC_PAGE_SLUGS) expect(existsSync(join(outDir, `zh/${slug}.html`)), `zh/${slug}.html`).toBe(false);
    expect(existsSync(join(outDir, 'zh/guides.html')), 'zh/guides.html').toBe(false);
    expect(existsSync(join(outDir, 'zh/guides')), 'zh/guides/').toBe(false);
    console.log(`[zh] ${zh.length} zh pages · ${pages.length} en/ko pages · ${outFiles.length} files in out/`);
  });

  it('every zh page is noindex,follow with a self-referencing canonical, no hreflang and no RSS alternate, lang zh-Hans, og:locale zh_CN', () => {
    for (const page of requireZh()) {
      expect(page.robotsNoindex, `${page.file} noindex`).toBe(true);
      expect(page.canonical, `${page.file} canonical`).toBeDefined();
      expect(urlToPath(page.canonical!), `${page.file} canonical`).toBe(page.urlPath);
      expect(page.hreflang, `${page.file} hreflang`).toEqual({});
      expect(page.rssAlternate, `${page.file} RSS alternate`).toBeUndefined();
      expect(page.lang, page.file).toBe(HTML_LANG.zh);
      expect(page.ogLocale, page.file).toBe(OG_LOCALE.zh);
      expect(page.enPrefixedLinkCount, page.file).toBe(0);
    }
    // en/ko 는 지금 그대로 — hreflang 에 zh 가 없고(키 집합은 위 "canonical + hreflang" 블록), 로캘 RSS 대체 링크가 있다
    for (const page of pages) {
      expect(page.ogLocale, page.file).toBe(OG_LOCALE[page.locale]);
      expect(page.rssAlternate, `${page.file} RSS alternate`).toBe(`${origin()}${localePath(page.locale, '/rss.xml')}`);
    }
  });

  it('og:image is the card of the en twin page (cards are drawn for indexed locales only), twitter:image the same', () => {
    const map = byUrl();
    for (const page of requireZh()) {
      const twin = map.get(stripLocale(page.urlPath));
      expect(twin, `${page.file} en twin`).toBeDefined();
      expect(page.ogImage, page.file).toBe(twin!.ogImage);
      expect(page.twitterImage, page.file).toBe(page.ogImage);
    }
    expect(outFiles.filter((f) => /^og\/.*-zh\.png$/.test(f.rel)).map((f) => f.rel)).toEqual([]);
  });

  it('shows no Hangul (except the 한국어 switcher label) and no KRW; every quoted speed carries a range (CLAUDE.md rule 3)', () => {
    const RANGE = /\d[\d.,]*–\d[\d.,]*/;
    const QUOTED_SPEED = /\d[\d.,]*\s*tok\/s/;
    for (const page of requireZh()) {
      expect(page.hangulWords.filter((w) => w !== '한국어'), page.file).toEqual([]);
      expect([page.krwPrices, page.krwNote], `${page.file} KRW`).toEqual([0, false]);
      for (const text of page.speedTexts) {
        if (QUOTED_SPEED.test(text)) expect(RANGE.test(text), `${page.file}: ${text}`).toBe(true);
      }
    }
    const bad = zhPages.filter((p) => p.measuredLabelIssues.length > 0).map((p) => `${p.file}: ${p.measuredLabelIssues.join(' | ')}`);
    expect(bad).toEqual([]);
  });

  it('links only to /zh/* — apart from the switcher, the footer static pages go to the English pages with hreflang="en"; no guide links', () => {
    for (const page of requireZh()) {
      expect(page.markers.navGuides, `${page.file} a[data-nav-guides]`).toBeUndefined();
      expect(page.relatedGuideHrefs, `${page.file} a[data-related-guide]`).toEqual([]);
      expect([page.markers.navCalculator, page.markers.navModels, page.markers.navGpus], `${page.file} header`).toEqual(
        ['/calculator', '/models', '/gpus'].map((bare) => localePath('zh', bare)),
      );
      const footer: string[] = [];
      for (const link of page.links) {
        if (link.localeSwitch) continue;
        if (link.footerLink !== undefined && (STATIC_PAGE_SLUGS as readonly string[]).includes(link.footerLink)) {
          footer.push(link.footerLink);
          expect([link.href, link.hrefLang], `${page.file} footer ${link.footerLink}`).toEqual([`/${link.footerLink}`, 'en']);
          continue;
        }
        expect(isZhPath(link.href), `${page.file} → ${link.href}`).toBe(true);
        expect(/^\/zh\/guides(?:\/|$)/.test(link.href), `${page.file} links a guide ${link.href}`).toBe(false);
      }
      expect(footer, `${page.file} footer static links`).toEqual([...STATIC_PAGE_SLUGS]);
      for (const action of page.formActions) expect(action.split('?')[0], `${page.file} form action`).toBe(localePath('zh', '/calculator'));
    }
  });

  it('titles and descriptions are unique within zh; JSON-LD parses, FAQ JSON-LD equals the visible FAQ, breadcrumbs stay in zh, inLanguage is zh-Hans', () => {
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const page of requireZh()) {
      const { title, description } = page;
      expect(title, `${page.file} title`).toBeTruthy();
      expect(description, `${page.file} description`).toBeTruthy();
      expect(titles.get(title!), `duplicate zh title: ${title}`).toBeUndefined();
      expect(descriptions.get(description!), `duplicate zh description: ${description}`).toBeUndefined();
      titles.set(title!, page.file);
      descriptions.set(description!, page.file);
      expect(page.jsonLdError, page.file).toBeUndefined();
      for (const block of page.jsonLd) if ('inLanguage' in block) expect(block.inLanguage, `${page.file} inLanguage`).toBe(HTML_LANG.zh);
      const crumbs = page.jsonLd.find((b) => b['@type'] === 'BreadcrumbList');
      if (crumbs) {
        const items = crumbs.itemListElement as Array<{ item: string }>;
        expect(urlToPath(items[0]!.item), `${page.file} crumb 1`).toBe(localePath('zh', '/'));
        expect(items.at(-1)!.item, `${page.file} last crumb`).toBe(page.canonical);
      }
      if (!isStructured(page)) continue;
      const faq = page.jsonLd.find((b) => b['@type'] === 'FAQPage');
      expect(faq, `${page.file} FAQPage`).toBeDefined();
      const entities = (faq!.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>).map((q) => ({
        question: q.name,
        answer: q.acceptedAnswer.text,
      }));
      expect(entities.length, page.file).toBe(3);
      expect(entities, page.file).toEqual(page.faq);
    }
    const home = zhPages.find((p) => p.urlPath === localePath('zh', '/'))!;
    expect(home.jsonLd.find((b) => b['@type'] === 'WebSite')?.inLanguage, 'zh home WebSite').toBe(HTML_LANG.zh);
  });

  it('the zh home and calculator keep the calculator markup: GET form, datalist of every GPU, no static result cards', () => {
    const map = new Map(requireZh().map((p) => [p.urlPath, p]));
    const calc = map.get(localePath('zh', '/calculator'))!;
    expect([calc.markers.calculator, calc.markers.calcForm, calc.markers.inputList, calc.markers.resultCards]).toEqual([true, true, true, 0]);
    expect(calc.datalistOptionCount).toBeGreaterThanOrEqual(gpus.length);
    const home = map.get(localePath('zh', '/'))!;
    expect(home.formActions).toContain(localePath('zh', '/calculator'));
    expect(home.datalistOptionCount).toBeGreaterThanOrEqual(gpus.length);
  });

  it('sitemaps, their xhtml:link alternates and the RSS feeds never name /zh; there is no zh feed; robots.txt does not block /zh', () => {
    const zhUrl = `${origin()}/zh`;
    const files = [
      ...outFiles.map((f) => f.rel).filter((rel) => /^sitemap[^/]*\.xml$/.test(rel)),
      ...INDEXED_LOCALES.map((locale) => localePath(locale, '/rss.xml').slice(1)),
    ];
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const rel of files) {
      const xml = readFileSync(join(outDir, rel), 'utf8');
      expect([`${zhUrl}/`, `${zhUrl}<`, `${zhUrl}"`].some((s) => xml.includes(s)), `${rel} names /zh`).toBe(false);
      expect(/hreflang="zh/.test(xml), `${rel} zh hreflang`).toBe(false);
    }
    expect(existsSync(join(outDir, 'zh/rss.xml'))).toBe(false);
    // 막으면 크롤러가 noindex 를 읽지 못한다 (docs/04 §6)
    expect(readFileSync(join(outDir, 'robots.txt'), 'utf8')).not.toMatch(/^Disallow:.*\/zh/m);
  });

  it('en and ko pages carry no Chinese characters except the 中文 switcher label', () => {
    const bad = pages.filter((p) => p.hanWords.some((w) => w !== '中文')).map((p) => `${p.file}: ${[...new Set(p.hanWords)].join(' ')}`);
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('every language-switcher link (en/ko/zh) points at an existing page: the same page in the other locale, or the zh home from a long-form page', () => {
    const all = new Set([...pages, ...zhPages].map((p) => p.urlPath));
    for (const page of [...pages, ...zhPages]) {
      const bare = stripLocale(page.urlPath);
      const targets = ALL_LOCALES.filter((locale) => locale !== page.locale);
      const switches = page.links.filter((l) => l.localeSwitch);
      expect(switches.map((l) => l.href), `${page.file} switcher`).toEqual(
        targets.map((target) => localePath(target, (CONTENT_LOCALES as readonly string[]).includes(target) || !isLongForm(page) ? bare : '/')),
      );
      expect(switches.map((l) => l.hrefLang), `${page.file} switcher hreflang`).toEqual(targets.map((target) => HTML_LANG[target]));
      for (const { href } of switches) expect(all.has(href), `${page.file} switcher → missing ${href}`).toBe(true);
    }
  });

  it('_redirects send the reversed compare slug to the registry slug in every routed locale, zh included', () => {
    const rules = new Set(readFileSync(join(outDir, '_redirects'), 'utf8').split('\n'));
    for (const slug of COMPARE_SLUGS) {
      const { a, b } = COMPARES[slug];
      for (const locale of ALL_LOCALES) {
        const rule = `${localePath(locale, `/compare/${b}-vs-${a}`)} ${localePath(locale, `/compare/${slug}`)} 301`;
        expect(rules.has(rule), rule).toBe(true);
      }
    }
  });
});
