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
import { expect, test } from '@playwright/test';
import {
  breadcrumbItems,
  clickThrough,
  collectProblems,
  isComboIndexable,
  jsonLdTypes,
  LOCALES,
  localePath,
  open,
  otherLocale,
  pathnameOf,
  readJsonLd,
  comboIds,
} from './helpers';

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
  { name: 'calculator', path: '/calculator', structured: false, combo: false },
  { name: 'gpu hub', path: '/gpu/rtx-4060', structured: true, combo: false },
  { name: 'model hub', path: '/model/qwen3.5-9b', structured: true, combo: false },
  { name: 'combo', path: '/can-i-run/qwen3.5-9b/on/rtx-4060', structured: true, combo: true },
  {
    name: 'combo moe',
    path: '/can-i-run/qwen3-30b-a3b-2507/on/rtx-3060-12gb',
    structured: true,
    combo: true,
  },
  // P1-4 — 가이드 1편(초안이면 noindex·미링크, URL 로는 열린다) + 목차
  { name: 'guide', path: '/guides/ollama-context-length', structured: false, combo: false },
  { name: 'guides index', path: '/guides', structured: false, combo: false },
  { name: 'methodology', path: '/methodology', structured: false, combo: false },
];

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

      if (spec.name === 'guide') {
        test('guide: Article + 3-level breadcrumb, own-data block, calculator widget submits to the calculator (P1-4)', async ({ page }) => {
          const problems = collectProblems(page);
          await open(page, path);
          const blocks = await readJsonLd(page);
          expect([...jsonLdTypes(blocks)]).toEqual(expect.arrayContaining(['Article', 'BreadcrumbList']));
          expect(breadcrumbItems(blocks)).toHaveLength(3);
          await expect(page.locator('[data-guide-body] [data-guide-data]').first()).toBeVisible();
          const widget = page.locator('form[data-calc-widget]');
          await expect(widget).toHaveCount(1);
          await widget.locator('input[name="gpu"]').fill('rtx-4060');
          await widget.locator('button[type="submit"]').click();
          await page.waitForURL((u) => u.pathname === localePath(locale, '/calculator') && u.searchParams.get('gpu') === 'rtx-4060');
          await page.waitForLoadState('networkidle');
          await expect(page.locator('[data-result-card]').first()).toBeVisible();
          expect(problems, 'console errors / failed requests').toEqual([]);
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
