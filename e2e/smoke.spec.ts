/**
 * 스모크 E2E (docs/05 §6, P1-1) — 대표 페이지 3종 × en/ko 를 실제 브라우저로 연다.
 *
 * 정적 HTML 불변식(전 페이지 hreflang 대칭 등)은 test/export-invariants.spec.ts 가 이미 본다.
 * 여기는 브라우저에서만 드러나는 것: 콘솔 에러·깨진 요청 0, 렌더된 h1·배지, 스위처·허브 링크 이동.
 * 점 포함 슬러그(qwen3.5-9b)를 일부러 대표로 둔다 — 확장자로 오인되는 경로 매핑 회귀 방지.
 *
 * 셀렉터 계약(apps/web 이 지킨다):
 *   - 판정 배지: `data-verdict="S|A|B|F"`
 *   - 로케일 스위처: `a[data-locale-switch]` + `hreflang` = 전환 대상 로케일
 *   - 내부 링크: 절대 경로의 일반 `<a href>` (next/link 아님 — docs/05 JS 예산)
 *
 * DOM 전역(document 등)은 쓰지 않는다 — 루트 tsconfig 에 DOM lib 이 없다. locator API 만.
 */
import { expect, test, type Page } from '@playwright/test';

const LOCALES = ['en', 'ko'] as const;
type Locale = (typeof LOCALES)[number];

const PAGES = [
  { name: 'home', path: '/', hub: false },
  { name: 'gpu hub', path: '/gpu/rtx-4060', hub: true },
  { name: 'model hub', path: '/model/qwen3.5-9b', hub: true },
] as const;

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

/** 최상위 노드(배열·@graph 포함)의 @type 집합 */
function jsonLdTypes(blocks: readonly unknown[]): Set<string> {
  const types = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const type = record['@type'];
    for (const t of Array.isArray(type) ? type : [type]) {
      if (typeof t === 'string') types.add(t);
    }
    if (record['@graph'] !== undefined) visit(record['@graph']);
  };
  blocks.forEach(visit);
  return types;
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

      if (spec.hub) {
        test('renders verdict badges and hub structured data', async ({ page }) => {
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
        });
      }

      if (spec.name === 'gpu hub') {
        test('links through to a model hub', async ({ page }) => {
          const problems = collectProblems(page);
          await open(page, path);

          const prefix = localePath(locale, '/model/');
          const link = page.locator(`main a[href^="${prefix}"]`).first();
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

          expect(problems, 'console errors / failed requests').toEqual([]);
        });
      }
    });
  }
}
