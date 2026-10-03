/**
 * 계산기 — 같은 GPU 여러 장 (docs/02 §6 베타, PROGRESS §4 D58): 장수 선택 → 베타 안내·이론 추정·URL gpus= 동기, 통합 메모리로 바꾸면 사라짐.
 * 서로 다른 GPU 섞기 (10-03 D67): "다른 GPU 함께 쓰기" → 카드 고르기 → URL plus=·안내·가정 문장·VRAM 합, 합계 4장 상한, 빼기, 맥이면 사라짐.
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

  test(`${locale} calculator — mix a different GPU with the first one (beta)`, async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, `${calc}?gpu=rtx-3090&ram=64`);
    const rows = page.locator('[data-extra-gpu] select');
    await expect(rows).toHaveCount(0);

    await page.locator('[data-add-gpu]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toBeFocused();
    // 같은 제조사 데스크톱 카드만 (AMD·노트북·1번과 같은 카드 없음)
    await expect(rows.first().locator('option[value="rx-7900-xtx"]')).toHaveCount(0);
    await expect(rows.first().locator('option[value="rtx-4090-laptop"]')).toHaveCount(0);
    await expect(rows.first().locator('option[value="rtx-3090"]')).toHaveCount(0);
    await rows.first().selectOption('rtx-3060-12gb');
    await expect.poll(() => new URL(page.url()).searchParams.get('plus')).toBe('rtx-3060-12gb');

    await expect(page.getByText(locale === 'ko' ? '서로 다른 GPU 섞어 쓰기는 베타 기능입니다' : 'Mixing different GPUs is a beta')).toBeVisible();
    await expect(page.locator('[data-assumptions]')).toContainText('24 + 12');
    await expect(page.locator('[data-assumptions]')).toContainText(' + ');
    await expect(page.getByText(locale === 'ko' ? '첫 번째 GPU로 모니터 출력 중' : 'The first GPU drives my display')).toBeVisible();
    // VRAM 합 36GB 가 분모 — 70B Q4 는 두 카드 + 시스템 RAM
    const card70b = page.locator('[data-result-card][data-model-id="llama-3.3-70b"]');
    await expect(card70b).toContainText('36');
    // 3090 한 장에 들어가는 8B 는 "그 카드만 쓰면" 참고 줄 + 이 구성의 실행 명령
    const card8b = page.locator('[data-result-card][data-model-id="qwen3-8b"]');
    await expect(card8b.locator('[data-single-gpu]')).toContainText('RTX 3090');
    await expect(card8b.locator('[data-single-gpu]')).toContainText('--list-devices');
    await expect(card8b.locator('[data-run-command]')).toContainText('-ngl all');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveValue('rtx-3060-12gb');

    // 합계 4장: 3090 2장 + 3060 + 4060 → 추가 버튼이 꺼지고 GPU 수는 2장까지만
    await page.locator('select[name="gpus"]').selectOption('2');
    await page.locator('[data-add-gpu]').click();
    await rows.nth(1).selectOption('rtx-4060');
    await expect.poll(() => new URL(page.url()).searchParams.get('plus')).toBe('rtx-3060-12gb,rtx-4060');
    await expect(page.locator('[data-add-gpu]')).toBeDisabled();
    await expect(page.locator('select[name="gpus"] option')).toHaveCount(2);

    // 빼기 → 남은 카드만 URL 에
    await page.locator('[data-remove-gpu]').first().click();
    await expect.poll(() => new URL(page.url()).searchParams.get('plus')).toBe('rtx-4060');
    await expect(page.locator('[data-add-gpu]')).toBeEnabled();

    // 맥이면 섞기 컨트롤이 없고 URL 에서도 빠진다
    await open(page, `${calc}?gpu=apple-m4-pro&plus=rtx-3060-12gb`);
    await expect(page.locator('[data-extra-gpus]')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('plus')).toBeNull();
    expect(problems).toEqual([]);
  });
}
