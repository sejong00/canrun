/**
 * 계산기 — 같은 GPU 여러 장 (docs/02 §6 베타, PROGRESS §4 D58): 장수 선택 → 베타 안내·이론 추정·URL gpus= 동기, 통합 메모리로 바꾸면 사라짐.
 * 서로 다른 GPU 섞기 (10-03 D67): "다른 GPU 함께 쓰기" → 카드 고르기 → URL plus=·안내·가정 문장·VRAM 합, 합계 4장 상한, 빼기, 맥이면 사라짐.
 * DGX Spark 여러 대 연결 (10-23 D118): 대수 선택(1~4) → URL nodes=·가정 문장·이론 추정 안내·RPC 명령, 다른 통합 메모리 기기면 사라짐.
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
    // 추가 카드 줄은 'GPU 수' 바로 아래 한 묶음 (리뷰 반영 — 컨텍스트 길이 아래로 떨어져 있었다)
    await expect(page.locator('[data-gpu-set] select[name="gpus"]')).toHaveCount(1);
    await expect(page.locator('[data-gpu-set] [data-extra-gpus]')).toHaveCount(1);

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
    // 카드 한 장만 쓰는 방법(--device·--list-devices)은 카드마다 되풀이하지 않고 안내 문단에 한 번 (리뷰 반영)
    await expect(card8b.locator('[data-single-gpu]')).not.toContainText('--list-devices');
    await expect(page.getByText(locale === 'ko' ? '서로 다른 GPU 섞어 쓰기는 베타 기능입니다' : 'Mixing different GPUs is a beta')).toContainText('--list-devices');
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
    // 가정 문장의 VRAM 은 카드마다 — 더하면 계산에 쓴 합계 68GB. 화면 출력은 1번 GPU
    await expect(page.locator('[data-assumptions]')).toContainText('24 + 24 + 12 + 8');
    await expect(page.locator('[data-assumptions]')).toContainText(locale === 'ko' ? '첫 번째 GPU가 화면 출력 담당' : 'first GPU driving the display');
    // '빼기' 버튼 이름에 어느 GPU 인지 (3번째 = 3060)
    await expect(page.locator('[data-remove-gpu]').first()).toHaveAccessibleName(locale === 'ko' ? '3번째 GPU 빼기' : 'Remove GPU 3');

    // 빼기 → 남은 카드만 URL 에
    await page.locator('[data-remove-gpu]').first().click();
    await expect.poll(() => new URL(page.url()).searchParams.get('plus')).toBe('rtx-4060');
    await expect(page.locator('[data-add-gpu]')).toBeEnabled();

    // 고르기 전 줄이 열린 채 위 카드를 키보드로 빼면 포커스는 그 빈 줄로 — 다음 카드의 '빼기'에 남아 한 번 더 누르면 그 카드까지 지워지던 문제(리뷰 반영)
    await page.locator('[data-add-gpu]').click();
    await expect(rows).toHaveCount(2);
    await page.locator('[data-remove-gpu]').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('plus')).toBeNull();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toBeFocused();
    await expect(rows.first()).toHaveValue('');

    // 합계 4장이 되면 빈 줄을 버린다 — 장수를 다시 줄여도 되살아나지 않는다(리뷰 반영)
    await page.locator('select[name="gpus"]').selectOption('4');
    await expect(rows).toHaveCount(0);
    await page.locator('select[name="gpus"]').selectOption('2');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('[data-add-gpu]')).toBeEnabled();

    // 맥이면 섞기 컨트롤이 없고 URL 에서도 빠진다
    await open(page, `${calc}?gpu=apple-m4-pro&plus=rtx-3060-12gb`);
    await expect(page.locator('[data-extra-gpus]')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('plus')).toBeNull();
    expect(problems).toEqual([]);
  });

  test(`${locale} calculator — linked DGX Spark units: units select, nodes=, RPC commands, theoretical notice (10-23 D118)`, async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, `${calc}?gpu=nvidia-dgx-spark`);
    const nodes = page.locator('select[name="nodes"]');
    await expect(nodes).toHaveValue('1');
    await expect(nodes.locator('option')).toHaveCount(4);
    // 통합 메모리 기기는 GPU 장수 선택이 없다(대수 선택만)
    await expect(page.locator('select[name="gpus"]')).toHaveCount(0);
    const oss = page.locator('[data-result-card][data-model-id="gpt-oss-120b"]');
    await expect(oss).toBeVisible();
    await expect(oss.locator('[data-rpc-command]')).toHaveCount(0);
    await expect(oss.locator('[data-one-unit-hint]')).toHaveCount(0);

    await nodes.selectOption('2');
    await expect.poll(() => new URL(page.url()).searchParams.get('nodes')).toBe('2');
    await expect(page.locator('[data-assumptions]')).toContainText(locale === 'ko' ? '2대' : '2×');
    await expect(page.getByText(locale === 'ko' ? '2대 연결은 llama.cpp RPC 방식으로 계산합니다' : 'Linking 2 units is calculated as llama.cpp RPC')).toBeVisible();
    const command = oss.locator('[data-rpc-command]');
    await expect(command).toContainText('ggml-rpc-server -H <node2-ip> -p 50052 -c');
    await expect(command).toContainText('--rpc <node2-ip>:50052');
    await expect(oss.locator('[data-cluster-links] a')).toHaveCount(3);
    // 1대로 충분(10-23 D121): gpt-oss-120b MXFP4 는 128GB 한 대에 다 들어간다 — 고른 대수의 결과는 그대로, 참고 줄 하나
    await expect(oss.locator('[data-one-unit-hint]')).toContainText(locale === 'ko' ? '1대로 충분합니다' : 'One unit is enough');

    await page.reload();
    await expect(page.locator('select[name="nodes"]')).toHaveValue('2');

    // 다른 통합 메모리 기기는 대수 선택이 없고 URL 에서도 빠진다
    await open(page, `${calc}?gpu=apple-m4-pro&nodes=2`);
    await expect(page.locator('select[name="nodes"]')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('nodes')).toBeNull();
    expect(problems).toEqual([]);
  });
}
