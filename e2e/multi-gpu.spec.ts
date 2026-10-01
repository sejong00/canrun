/**
 * 계산기 — 같은 GPU 여러 장 (docs/02 §6 베타, PROGRESS §4 D58): 장수 선택 → 베타 안내·이론 추정·URL gpus= 동기, 통합 메모리로 바꾸면 사라짐.
 */
import { expect, test } from '@playwright/test';
import { collectProblems, LOCALES, localePath, open } from './helpers';

for (const locale of LOCALES) {
  const calc = localePath(locale, '/calculator');

  test(`${locale} calculator — two identical GPUs add up their VRAM (beta)`, async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, `${calc}?gpu=rtx-3090&ram=64`);
    const card70b = page.locator('[data-result-card][data-model-id="llama-3.3-70b"]');
    await expect(card70b).toBeVisible();
    const before = await card70b.locator('[data-verdict]').first().getAttribute('data-verdict');

    await page.locator('select[name="gpus"]').selectOption('2');
    await expect.poll(() => new URL(page.url()).searchParams.get('gpus')).toBe('2');
    await expect(page.locator('[data-assumptions]')).toContainText(locale === 'ko' ? '2장' : '2×');
    // 48GB 에 70B Q4 가 다 올라간다 — 판정이 같거나 오른다
    const after = await card70b.locator('[data-verdict]').first().getAttribute('data-verdict');
    expect('FBAS'.indexOf(after ?? 'F')).toBeGreaterThanOrEqual('FBAS'.indexOf(before ?? 'F'));
    await expect(card70b).toContainText('48');

    await page.reload();
    await expect(page.locator('select[name="gpus"]')).toHaveValue('2');

    // 통합 메모리 칩으로 바꾸면 장수 선택이 사라지고 URL 에서도 빠진다
    await open(page, `${calc}?gpu=apple-m4-pro&gpus=2`);
    await expect(page.locator('select[name="gpus"]')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('gpus')).toBeNull();
    expect(problems).toEqual([]);
  });
}
