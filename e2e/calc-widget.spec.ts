/**
 * 상세 페이지 계산기 위젯 (10-19 D107 — 검색으로 콤보·허브·비교 페이지에 들어온 사람이 계산기를 바로 써 보게).
 * 정적 HTML 계약(위젯 1개·action·숨은 값·딥 링크 쿼리)은 test/export-invariants.spec.ts 가 전 페이지에서 본다.
 * 여기는 브라우저에서만 드러나는 것: 판정이 위젯보다 위, 미리 고른 GPU 그대로 제출·다른 GPU 로 바꿔 제출, 모델 허브의 빈 칸 → 모델 모드,
 * 하이드레이션 오류·실패 요청 0.
 */
import { expect, test, type Page } from '@playwright/test';
import { collectProblems, LOCALES, localePath, open } from './helpers';

const COMBO = { path: '/can-i-run/qwen3-14b/on/rtx-4060', gpu: 'rtx-4060', model: 'qwen3-14b' };
const MODEL_HUB = { path: '/model/qwen3.5-9b', model: 'qwen3.5-9b' };

const widget = (page: Page) => page.locator('form[data-calc-widget]');
const params = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

for (const locale of LOCALES) {
  const calc = localePath(locale, '/calculator');

  test.describe(`${locale} calculator widget on detail pages`, () => {
    test('combo: under the verdict, prefilled; submitting opens the calculator on this GPU with the model highlighted', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, localePath(locale, COMBO.path));
      await expect(widget(page)).toHaveCount(1);
      // 답이 먼저 — 판정 문장이 위젯보다 위
      const verdictBox = await page.locator('[data-verdict-sentence]').boundingBox();
      const widgetBox = await widget(page).boundingBox();
      expect(verdictBox!.y).toBeLessThan(widgetBox!.y);
      await expect(widget(page).locator('input[role="combobox"]')).toHaveValue(/RTX 4060/);
      await widget(page).locator('button[type="submit"]').click();
      await page.waitForURL((u) => u.pathname === calc && u.searchParams.get('gpu') === COMBO.gpu && u.searchParams.get('m') === COMBO.model);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(`[data-result-card][data-model-id="${COMBO.model}"]`)).toHaveAttribute('aria-current', 'true');
      expect(problems, 'console errors / failed requests').toEqual([]);
    });

    test('combo: picking another GPU keeps the model; the direct link opens the same pair', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, localePath(locale, COMBO.path));
      const input = widget(page).locator('input[role="combobox"]');
      await input.click();
      await input.fill('4070');
      await widget(page).locator('[role="option"][data-gpu-id="rtx-4070"]').click();
      await page.waitForURL((u) => u.pathname === calc && u.searchParams.get('gpu') === 'rtx-4070');
      expect(params(page).m).toBe(COMBO.model);
      await page.goBack();
      await page.waitForLoadState('networkidle');
      await widget(page).locator('a[data-calc-deep-link="combo"]').click();
      await page.waitForURL((u) => u.pathname === calc);
      expect(params(page)).toEqual({ gpu: COMBO.gpu, m: COMBO.model });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      expect(problems, 'console errors / failed requests').toEqual([]);
    });

    test('GPU hub: prefilled with the hub GPU', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, localePath(locale, '/gpu/rtx-4060'));
      await expect(widget(page)).toHaveCount(1);
      await widget(page).locator('button[type="submit"]').click();
      await page.waitForURL((u) => u.pathname === calc);
      expect(params(page)).toEqual({ gpu: 'rtx-4060' });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      expect(problems, 'console errors / failed requests').toEqual([]);
    });

    test('model hub: an empty GPU box opens model mode for this model; a picked GPU opens that GPU with the model highlighted', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, localePath(locale, MODEL_HUB.path));
      await expect(widget(page)).toHaveCount(1);
      await expect(widget(page).locator('input[role="combobox"]')).toHaveValue('');
      await widget(page).locator('button[type="submit"]').click();
      await page.waitForURL((u) => u.pathname === calc);
      expect(params(page)).toEqual({ m: MODEL_HUB.model, mode: 'model' });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-gpu-row]').first()).toBeVisible();

      await open(page, localePath(locale, MODEL_HUB.path));
      const input = widget(page).locator('input[role="combobox"]');
      await input.click();
      await input.fill('4070');
      await widget(page).locator('[role="option"][data-gpu-id="rtx-4070"]').click();
      await page.waitForURL((u) => u.pathname === calc && u.searchParams.get('gpu') === 'rtx-4070');
      expect(params(page)).toEqual({ m: MODEL_HUB.model, gpu: 'rtx-4070' });
      await page.waitForLoadState('networkidle');
      await expect(page.locator(`[data-result-card][data-model-id="${MODEL_HUB.model}"]`)).toHaveAttribute('aria-current', 'true');
      expect(problems, 'console errors / failed requests').toEqual([]);
    });

    test('compare page: prefilled with the first device, a link for each device', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, localePath(locale, '/compare/rtx-4090-vs-rtx-5090'));
      await expect(widget(page)).toHaveCount(1);
      await expect(widget(page).locator('a[data-calc-deep-link]')).toHaveCount(2);
      await widget(page).locator('a[data-calc-deep-link="b"]').click();
      await page.waitForURL((u) => u.pathname === calc);
      expect(params(page)).toEqual({ gpu: 'rtx-5090' });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      expect(problems, 'console errors / failed requests').toEqual([]);
    });
  });
}
