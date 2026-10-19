/**
 * 목록 페이지 E2E (10-19 `/models`·`/gpus`) — 정적 HTML 불변식(전 행·ItemList·브레드크럼·사이트맵)은 test/export-invariants.spec.ts 가 본다.
 * 여기는 브라우저에서만 드러나는 것: 하이드레이션 뒤 정렬·거르기 컨트롤이 서버가 그린 행을 다시 놓고 숨기는지, 지연 청크 0,
 * 행 링크로 허브 이동, 허브 브레드크럼의 목록 단계, 그리고 375px 폰에서 페이지가 가로로 넓어지지 않는지.
 * DOM 전역은 쓰지 않는다 — locator API 와 문자열형 evaluate 만 (helpers.ts 머리말).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { breadcrumbItems, clickThrough, collectProblems, LOCALES, localePath, open, readJsonLd, repoRoot, trackChunkRequests } from './helpers';

type ModelRow = { id: string; korean?: boolean; thinking?: string; moe: boolean };
const readSeed = <T>(file: string): T => JSON.parse(readFileSync(resolve(repoRoot, 'data', file), 'utf8')) as T;

/** 보이는 행의 속성 값 (DOM 순서) */
async function visibleAttr(rows: Locator, attr: string): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  for (const row of await rows.all()) {
    if (await row.isVisible()) out.push(await row.getAttribute(attr));
  }
  return out;
}

/** 375px 폰에서 화면 밖으로 나가는 요소 — 가로 스크롤 영역(`[role=region]`) 안쪽은 그 영역 안에서 스크롤되므로 뺀다 */
async function overflowing(page: Page, width: number): Promise<string[]> {
  return (await page.evaluate(`(() => {
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const region = el.closest('[role="region"]');
      if (region && region !== el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > ${width} + 0.5) bad.push(el.tagName + ' ' + String(el.className).slice(0, 60) + ' → ' + Math.round(r.right));
    }
    return bad.slice(0, 10);
  })()`)) as string[];
}

for (const locale of LOCALES) {
  test.describe(`${locale} model list`, () => {
    const path = localePath(locale, '/models');

    test('renders every catalog model; sort and filters reorder and hide rows; no lazy chunk; a row opens its hub', async ({ page }) => {
      const models = readSeed<ModelRow[]>('models.json');
      const problems = collectProblems(page);
      const chunks = trackChunkRequests(page);
      await open(page, path);
      const chunksAfterLoad = chunks();
      const rows = page.locator('table[data-list="models"] tbody tr');
      await expect(rows).toHaveCount(models.length);
      await expect(page.locator('table[data-list="models"] a[data-browse-model]')).toHaveCount(models.length);

      const sort = page.locator('select[data-list-sort]');
      await expect(sort).toBeEnabled();
      const status = page.locator('[data-list-status]');
      await expect(status).toHaveText('');

      // 최신순: 출시일 내림차순
      await sort.selectOption('newest');
      const released = (await visibleAttr(rows, 'data-released')).map(Number);
      expect(released).toEqual([...released].sort((a, b) => b - a));
      await expect(status).not.toHaveText('');

      // 작은 모델부터: 파라미터 오름차순
      await sort.selectOption('smallest');
      const params = (await visibleAttr(rows, 'data-params')).map(Number);
      expect(params).toEqual([...params].sort((a, b) => a - b));

      // 한국 모델만 → 보이는 행 = 한국 모델 전부, 상태 문장에 그 수
      const korean = models.filter((m) => m.korean).length;
      await page.locator('input[data-list-toggle="korean"]').check();
      expect(await visibleAttr(rows, 'data-korean')).toEqual(Array(korean).fill('1'));
      await expect(status).toContainText(String(korean));

      // + MoE → 한국 MoE 모델만
      const koreanMoe = models.filter((m) => m.korean && m.moe).length;
      await page.locator('input[data-list-toggle="moe"]').check();
      expect((await visibleAttr(rows, 'data-model-id')).length).toBe(koreanMoe);
      await page.locator('input[data-list-toggle="moe"]').uncheck();
      await page.locator('input[data-list-toggle="korean"]').uncheck();

      // 크기 50B 이상만
      await page.locator('select[data-list-filter="size"]').selectOption('xl');
      const sizes = await visibleAttr(rows, 'data-size');
      expect(sizes.length).toBeGreaterThan(0);
      expect(new Set(sizes)).toEqual(new Set(['xl']));
      await page.locator('select[data-list-filter="size"]').selectOption('');

      // 생각 모드 있음 → 생각 모드가 있는 모델 수
      await page.locator('input[data-list-toggle="thinking"]').check();
      expect((await visibleAttr(rows, 'data-thinking')).length).toBe(models.filter((m) => m.thinking).length);
      await page.locator('input[data-list-toggle="thinking"]').uncheck();

      // 기본 순서로 돌아가면 서버 순서 그대로
      await sort.selectOption('popular');
      expect((await visibleAttr(rows, 'data-sort-index')).map(Number)).toEqual(models.map((_, i) => i));

      await page.waitForLoadState('networkidle');
      expect(chunks(), 'no lazy chunk after interaction').toBe(chunksAfterLoad);

      await clickThrough(page, rows.first().locator('a[data-browse-model]'));
      expect(problems, 'console errors / failed requests').toEqual([]);
    });

    test('model hubs put the list between home and the hub in the breadcrumb', async ({ page }) => {
      await open(page, localePath(locale, '/model/qwen3-14b'));
      const crumbs = breadcrumbItems(await readJsonLd(page));
      expect(crumbs).toHaveLength(3);
      expect(new URL(String(crumbs[1]!.item)).pathname).toBe(path);
      await clickThrough(page, page.locator(`main nav a[href="${path}"]`).first());
    });
  });

  test.describe(`${locale} GPU list`, () => {
    const path = localePath(locale, '/gpus');

    test('renders every catalog GPU grouped by type; price and memory sorts work inside each group; a row opens its hub', async ({ page }) => {
      const gpus = readSeed<Array<{ id: string }>>('gpus.json');
      const problems = collectProblems(page);
      await open(page, path);
      await expect(page.locator('table[data-list="gpus"] tbody tr')).toHaveCount(gpus.length);
      await expect(page.locator('table[data-list="gpus"] a[data-browse-gpu]')).toHaveCount(gpus.length);

      const sort = page.locator('select[data-list-sort]');
      await expect(sort).toBeEnabled();
      await sort.selectOption('price');
      const nvidia = page.locator('table[data-gpu-group="nvidia"] tbody tr');
      const order: Array<number | null> = [];
      for (const row of await nvidia.all()) {
        const price = await row.getAttribute('data-price');
        order.push(price === null ? null : Number(price));
      }
      // 가격 있는 행이 앞에 오름차순, 가격 없는 행은 그 뒤
      const priced = order.filter((p): p is number => p !== null);
      expect(priced.length).toBeGreaterThan(2);
      expect(order.slice(0, priced.length)).toEqual([...priced].sort((a, b) => a - b));
      expect(order.slice(priced.length).every((p) => p === null)).toBe(true);

      await sort.selectOption('memory');
      const apple = page.locator('table[data-gpu-group="apple"] tbody tr');
      const memory = (await visibleAttr(apple, 'data-memory')).map(Number);
      expect(memory).toEqual([...memory].sort((a, b) => b - a));
      await expect(page.locator('[data-list-status]')).not.toHaveText('');

      await clickThrough(page, page.locator('table[data-gpu-group="apple"] a[data-browse-gpu]').first());
      expect(problems, 'console errors / failed requests').toEqual([]);
    });

    test('GPU hubs put the list between home and the hub in the breadcrumb', async ({ page }) => {
      await open(page, localePath(locale, '/gpu/rtx-4060'));
      const crumbs = breadcrumbItems(await readJsonLd(page));
      expect(crumbs).toHaveLength(3);
      expect(new URL(String(crumbs[1]!.item)).pathname).toBe(path);
    });
  });

  test.describe(`${locale} list pages on a phone`, () => {
    test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

    for (const list of ['/models', '/gpus']) {
      test(`${list}: nothing wider than the screen (tables scroll inside their region), controls ≥ 40px tall`, async ({ page }) => {
        const problems = collectProblems(page);
        await open(page, localePath(locale, list));
        await expect(page.locator('select[data-list-sort]')).toBeEnabled();
        expect(await overflowing(page, 375)).toEqual([]);
        const scrollX = (await page.evaluate('(() => { window.scrollTo(100, 0); return window.scrollX; })()')) as number;
        expect(scrollX).toBe(0);
        for (const selector of ['select[data-list-sort]', 'header a[data-nav-gpus]']) {
          const box = await page.locator(selector).first().boundingBox();
          expect(box?.height ?? 0, selector).toBeGreaterThanOrEqual(selector.startsWith('select') ? 40 : 32);
        }
        expect(problems).toEqual([]);
      });
    }
  });
}
