/**
 * 스모크 E2E (docs/05 §6, P1-1·P1-2) — 대표 페이지 5종 × en/ko 를 실제 브라우저로 연다.
 *
 * 정적 HTML 불변식(전 페이지 hreflang 대칭 등)은 test/export-invariants.spec.ts 가 이미 본다.
 * 여기는 브라우저에서만 드러나는 것: 콘솔 에러·깨진 요청 0, 렌더된 h1·배지, 스위처·허브·인접 링크 이동,
 * 그리고 **뒤로가기(history) 후 실패 요청 0** — postbuild 가 RSC `.txt` 를 프루닝(D18)해도 클라이언트가
 * 페이로드를 요청하지 않음을 확인하는 유일한 브라우저 경로.
 * 점 포함 슬러그(qwen3.5-9b)를 일부러 대표로 둔다 — 확장자로 오인되는 경로 매핑 회귀 방지. 콤보는 점 슬러그가
 * 중간 세그먼트에 오는 중첩 경로 + cpu-moe(MoE) 페이지 하나씩.
 *
 * 셀렉터 계약(apps/web 이 지킨다):
 *   - 판정 배지: `data-verdict="S|A|B|F"`
 *   - 로케일 스위처: `a[data-locale-switch]` + `hreflang` = 전환 대상 로케일
 *   - 내부 링크: 절대 경로의 일반 `<a href>` (next/link 아님 — docs/05 JS 예산)
 *   - 콤보: `[data-verdict-sentence]`(배지 포함 판정 문장) · `figure[data-snippet="llama.cpp"|"ollama"] pre code` ·
 *     `a[data-adjacent]`(인접 콤보 링크) · 미공개 콤보만 `meta[name=robots][content*=noindex]` (data/publish.json, D9)
 *
 * DOM 전역(document 등)은 쓰지 않는다 — 루트 tsconfig 에 DOM lib 이 없다. locator API 만.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LOCALES = ['en', 'ko'] as const;
type Locale = (typeof LOCALES)[number];

type PageSpec = {
  name: string;
  /** 로케일 무관 경로 */
  path: string;
  /** 허브·콤보 — 판정 배지 + BreadcrumbList/FAQPage 구조화 데이터를 가진 페이지 */
  structured: boolean;
  /** 콤보 페이지 (`/can-i-run/{model}/on/{gpu}`) */
  combo: boolean;
};

const PAGES: readonly PageSpec[] = [
  { name: 'home', path: '/', structured: false, combo: false },
  { name: 'gpu hub', path: '/gpu/rtx-4060', structured: true, combo: false },
  { name: 'model hub', path: '/model/qwen3.5-9b', structured: true, combo: false },
  { name: 'combo', path: '/can-i-run/qwen3.5-9b/on/rtx-4060', structured: true, combo: true },
  {
    name: 'combo moe',
    path: '/can-i-run/qwen3-30b-a3b-2507/on/rtx-3060-12gb',
    structured: true,
    combo: true,
  },
];

/** 로케일 무관 경로 → 해당 로케일 URL 경로 (en 무프리픽스, ko 홈은 `/ko`) */
function localePath(locale: Locale, path: string): string {
  if (locale === 'en') return path;
  return path === '/' ? '/ko' : `/ko${path}`;
}

function otherLocale(locale: Locale): Locale {
  return locale === 'en' ? 'ko' : 'en';
}

/** 절대·상대 href → pathname (루트는 '/') */
function pathnameOf(href: string | null, base: string): string {
  expect(href, 'href attribute').not.toBeNull();
  return new URL(href ?? '', base).pathname || '/';
}

/** 콤보 경로 → 카탈로그 id 쌍 */
function comboIds(path: string): { modelId: string; gpuId: string } {
  const match = /^\/can-i-run\/([^/]+)\/on\/([^/]+)$/.exec(path);
  if (!match) throw new Error(`not a combo path: ${path}`);
  return { modelId: match[1] ?? '', gpuId: match[2] ?? '' };
}

type PublishPlan = {
  currentBatch: number;
  batches: readonly { batch: number; gpuIds: readonly string[]; modelIds: readonly string[] }[];
};

/**
 * data/publish.json 인덱싱 게이트 (D9) — 콤보 배치 = gpuIds·modelIds 가 **둘 다** 그 쌍을 포함하는 항목들의
 * 최소 batch, 공개 ⇔ batch ≤ currentBatch. packages/data 의 comboPublishState 와 같은 규칙을 독립 구현해
 * 렌더된 robots 메타와 교차 검증한다. 테스트 안에서 읽는다(파일 부재가 `--list` 를 깨지 않게).
 */
function isComboIndexable(modelId: string, gpuId: string): boolean {
  const plan = JSON.parse(readFileSync(resolve(repoRoot, 'data/publish.json'), 'utf8')) as PublishPlan;
  const batches = plan.batches
    .filter((b) => b.gpuIds.includes(gpuId) && b.modelIds.includes(modelId))
    .map((b) => b.batch);
  return batches.length > 0 && Math.min(...batches) <= plan.currentBatch;
}

/** 콘솔 에러·페이지 예외·실패/4xx·5xx 요청을 모은다 (예외 없음) */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()} (${msg.location().url})`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) =>
    problems.push(`requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? '?'}`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  return problems;
}

/** 이동 후 네트워크가 잠잠해질 때까지 — 하이드레이션 뒤 늦게 나는 에러·프리페치 404 까지 잡는다 */
async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState('networkidle');
  return response;
}

/** `<a>` 클릭으로 같은 탭 이동 → 문서 응답 상태·URL·h1 확인 */
async function clickThrough(page: Page, link: Locator): Promise<string> {
  const target = pathnameOf(await link.getAttribute('href'), page.url());
  const [navResponse] = await Promise.all([
    page.waitForResponse(
      (res) => res.request().isNavigationRequest() && new URL(res.url()).pathname === target,
    ),
    link.click(),
  ]);
  expect(navResponse.status(), `status of ${target}`).toBe(200);
  await page.waitForLoadState('networkidle');
  expect(new URL(page.url()).pathname).toBe(target);
  await expect(page.locator('h1:visible')).toHaveCount(1);
  return target;
}

async function readJsonLd(page: Page): Promise<unknown[]> {
  const texts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return texts.map((text, i) => {
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      throw new Error(`JSON-LD block #${i} does not parse: ${String(err)}\n${text.slice(0, 200)}`);
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 최상위 노드(배열·@graph 포함)를 깊이 우선으로 방문 */
function visitJsonLd(blocks: readonly unknown[], visit: (node: Record<string, unknown>) => void): void {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isRecord(node)) return;
    visit(node);
    if (node['@graph'] !== undefined) walk(node['@graph']);
  };
  blocks.forEach(walk);
}

/** 최상위 노드의 @type 집합 */
function jsonLdTypes(blocks: readonly unknown[]): Set<string> {
  const types = new Set<string>();
  visitJsonLd(blocks, (node) => {
    const type = node['@type'];
    for (const t of Array.isArray(type) ? type : [type]) {
      if (typeof t === 'string') types.add(t);
    }
  });
  return types;
}

/** BreadcrumbList 의 itemListElement (전 블록 합산) */
function breadcrumbItems(blocks: readonly unknown[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  visitJsonLd(blocks, (node) => {
    if (node['@type'] !== 'BreadcrumbList') return;
    const list = node.itemListElement;
    if (Array.isArray(list)) items.push(...list.filter(isRecord));
  });
  return items;
}

for (const locale of LOCALES) {
  for (const spec of PAGES) {
    const path = localePath(locale, spec.path);
    const twin = localePath(otherLocale(locale), spec.path);

    test.describe(`${locale} ${spec.name} (${path})`, () => {
      test('loads cleanly with SEO invariants', async ({ page }) => {
        const problems = collectProblems(page);
        const response = await open(page, path);
        expect(response?.status(), 'document status').toBe(200);

        await expect(page.locator('h1:visible')).toHaveCount(1);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);

        const canonical = page.locator('link[rel="canonical"]');
        await expect(canonical).toHaveCount(1);
        expect(pathnameOf(await canonical.getAttribute('href'), page.url())).toBe(path);

        const alternates = page.locator('link[rel="alternate"][hreflang]');
        await expect(alternates).toHaveCount(3);
        const hreflang: Record<string, string> = {};
        for (const link of await alternates.all()) {
          const lang = (await link.getAttribute('hreflang')) ?? '';
          hreflang[lang] = pathnameOf(await link.getAttribute('href'), page.url());
        }
        expect(hreflang).toEqual({
          en: localePath('en', spec.path),
          ko: localePath('ko', spec.path),
          'x-default': localePath('en', spec.path),
        });

        await readJsonLd(page);

        expect(problems, 'console errors / failed requests').toEqual([]);
      });

      test('locale switcher points to the twin page', async ({ page }) => {
        await open(page, path);
        const switcher = page.locator(`a[data-locale-switch][hreflang="${otherLocale(locale)}"]`);
        await expect(switcher.first()).toBeAttached();
        for (const link of await switcher.all()) {
          expect(pathnameOf(await link.getAttribute('href'), page.url())).toBe(twin);
        }
      });

      if (spec.structured) {
        test('renders verdict badges and structured data', async ({ page }) => {
          await open(page, path);
          await expect(page.locator('[data-verdict]').first()).toBeVisible();
          // 계약 밖 값 금지 (S|A|B|F)
          await expect(
            page.locator(
              '[data-verdict]:not([data-verdict="S"]):not([data-verdict="A"]):not([data-verdict="B"]):not([data-verdict="F"])',
            ),
          ).toHaveCount(0);

          const blocks = await readJsonLd(page);
          expect(blocks.length).toBeGreaterThanOrEqual(2);
          const types = jsonLdTypes(blocks);
          expect([...types]).toEqual(expect.arrayContaining(['BreadcrumbList', 'FAQPage']));

          // 브레드크럼: 허브 2단(D7)·콤보 3단(D10), 전 항목 item URL (마지막 = 캐노니컬)
          const crumbs = breadcrumbItems(blocks);
          expect(crumbs.length).toBeGreaterThanOrEqual(2);
          for (const crumb of crumbs) {
            const item = crumb.item;
            expect(typeof item === 'string' && item.startsWith('http'), `crumb ${JSON.stringify(crumb)}`).toBe(
              true,
            );
          }
        });
      }

      if (spec.name === 'gpu hub') {
        test('links through to a model hub', async ({ page }) => {
          const problems = collectProblems(page);
          await open(page, path);

          const prefix = localePath(locale, '/model/');
          await clickThrough(page, page.locator(`main a[href^="${prefix}"]`).first());

          expect(problems, 'console errors / failed requests').toEqual([]);
        });
      }

      if (spec.combo) {
        test('renders the verdict sentence and run snippets', async ({ page }) => {
          await open(page, path);

          const sentence = page.locator('[data-verdict-sentence]');
          await expect(sentence).toBeVisible();
          await expect(sentence.locator('[data-verdict]').first()).toBeVisible();

          const llamaCpp = page.locator('figure[data-snippet="llama.cpp"] pre code');
          await expect(llamaCpp).toHaveCount(1);
          await expect(llamaCpp).toContainText('llama-server -hf');

          // Ollama 블록은 조건부(no-fit·cpu-moe·분할 GGUF 면 생략) — 있으면 서버 ctx 환경변수를 안내해야 한다
          const ollama = page.locator('figure[data-snippet="ollama"] pre code');
          if ((await ollama.count()) > 0) {
            await expect(ollama.first()).toContainText('OLLAMA_CONTEXT_LENGTH');
          }
        });

        test('robots meta follows the data/publish.json gate', async ({ page }) => {
          await open(page, path);
          const { modelId, gpuId } = comboIds(spec.path);
          const indexable = isComboIndexable(modelId, gpuId);
          await expect(
            page.locator('meta[name="robots"][content*="noindex"]'),
            `noindex meta (indexable=${indexable})`,
          ).toHaveCount(indexable ? 0 : 1);
        });

        test('adjacent combo link navigates, and going back fetches nothing broken (D18)', async ({
          page,
        }) => {
          const problems = collectProblems(page);
          await open(page, path);

          const adjacent = page.locator('a[data-adjacent]');
          expect(await adjacent.count(), 'adjacent combo links').toBeGreaterThanOrEqual(2);
          const target = await clickThrough(page, adjacent.first());
          expect(target).toMatch(/\/can-i-run\//);

          // 뒤로가기 — 프루닝된 RSC `.txt` 를 라우터가 요청하면 여기서 404 로 잡힌다
          await page.goBack();
          await page.waitForLoadState('networkidle');
          expect(new URL(page.url()).pathname).toBe(path);
          await expect(page.locator('h1:visible')).toHaveCount(1);

          expect(problems, 'console errors / failed requests (incl. after goBack)').toEqual([]);
        });
      }
    });
  }
}
