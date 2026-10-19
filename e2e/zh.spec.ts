/**
 * zh E2E (10-19 D109) — 중국어(간체) 화면판. 화면 문구만 기계번역(사용자 승인)이고 공개 작업(애드센스 승인 뒤) 전까지 noindex·hreflang 밖이다.
 * 정적 HTML 불변식(전 zh 페이지 noindex·자기 캐노니컬·한글 없음·내부 링크 /zh/*)은 test/export-invariants.spec.ts "zh (D109)" 가 본다.
 * 여기는 브라우저에서만 드러나는 것: 로드·하이드레이션 콘솔 에러 0, 계산기에서 GPU 를 고르면 결과가 나온다, 언어 전환 왕복,
 * 장문 페이지(정적·가이드)는 zh 에 없다(404) — 그 페이지의 中文 전환은 zh 홈으로 간다.
 *
 * 문구 내용은 고정하지 않는다(번역은 따로 들어온다) — 셀렉터 계약과 경로·속성만 본다. DOM 전역은 쓰지 않는다(루트 tsconfig 에 DOM lib 없음).
 */
import { expect, test, type Page } from '@playwright/test';
import { clickThrough, collectProblems, open, pathnameOf, RANGE_RE } from './helpers';

const ZH_LANG = 'zh-Hans';

async function pickGpu(page: Page, text: string, optionId: string) {
  const input = page.locator('form[data-calc-form] input[name="gpu"]');
  await expect(input).toHaveAttribute('role', 'combobox');
  await input.fill(text);
  await page.locator(`[role="option"][data-gpu-id="${optionId}"]`).first().click();
}

test.describe('zh (D109)', () => {
  test('/zh loads cleanly: lang zh-Hans, noindex, self canonical, no hreflang alternates, no guides menu', async ({ page }) => {
    const problems = collectProblems(page);
    const response = await open(page, '/zh');
    expect(response?.status(), 'document status').toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', ZH_LANG);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
    expect(pathnameOf(await page.locator('link[rel="canonical"]').getAttribute('href'), page.url())).toBe('/zh');
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveCount(0);
    await expect(page.locator('a[data-nav-guides]')).toHaveCount(0);
    await expect(page.locator('h1:visible')).toHaveCount(1);
    // 푸터 정적 페이지는 영어판으로 (hreflang="en")
    const privacy = page.locator('footer a[data-footer-link="privacy"]');
    await expect(privacy).toHaveAttribute('href', '/privacy');
    await expect(privacy).toHaveAttribute('hreflang', 'en');
    expect(problems, 'console errors / failed requests').toEqual([]);
  });

  test('/zh/calculator: picking a GPU renders verdict cards with a band, syncs the URL and the switcher query', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, '/zh/calculator');
    await pickGpu(page, '4060', 'rtx-4060');
    const cards = page.locator('[data-result-card]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(10);
    await expect(
      page.locator('[data-result-card] [data-verdict]:not([data-verdict="S"]):not([data-verdict="A"]):not([data-verdict="B"]):not([data-verdict="F"])'),
    ).toHaveCount(0);
    for (const speed of await page.locator('[data-result-card] [data-speed]').all()) {
      expect((await speed.textContent()) ?? '').toMatch(RANGE_RE);
    }
    await expect.poll(() => new URL(page.url()).search).toBe('?gpu=rtx-4060');
    const toEnglish = page.locator('a[data-locale-switch][hreflang="en"]');
    await expect.poll(async () => (await toEnglish.getAttribute('href')) ?? '').toBe('/calculator?gpu=rtx-4060');
    expect(problems, 'console errors / failed requests (hydration mismatch shows here)').toEqual([]);
  });

  test('language switch round trip: en → 中文 → 한국어 → English on the same hub', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, '/gpu/rtx-4060');
    expect(await clickThrough(page, page.locator(`a[data-locale-switch][hreflang="${ZH_LANG}"]`))).toBe('/zh/gpu/rtx-4060');
    await expect(page.locator('html')).toHaveAttribute('lang', ZH_LANG);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
    expect(await clickThrough(page, page.locator('a[data-locale-switch][hreflang="ko"]'))).toBe('/ko/gpu/rtx-4060');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    expect(await clickThrough(page, page.locator('a[data-locale-switch][hreflang="en"]'))).toBe('/gpu/rtx-4060');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(problems, 'console errors / failed requests').toEqual([]);
  });

  test('long-form pages have no zh version: /zh/about and /zh/guides are 404, and their 中文 switch goes to the zh home', async ({ page }) => {
    for (const path of ['/zh/about', '/zh/guides', '/zh/guides/vram-requirements']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await open(page, '/about');
    const toZh = page.locator(`a[data-locale-switch][hreflang="${ZH_LANG}"]`);
    await expect(toZh).toHaveAttribute('href', '/zh');
    expect(pathnameOf(await page.locator('a[data-locale-switch][hreflang="ko"]').getAttribute('href'), page.url())).toBe('/ko/about');
  });
});
