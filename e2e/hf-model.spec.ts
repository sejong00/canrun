/**
 * 계산기 — 목록에 없는 모델 (계산기 P2, PROGRESS §4 D57). Hugging Face 요청은 전부 가짜 응답으로 막는다(CI 는 외부망을 쓰지 않는다).
 * 확인: 불러오기 → 결과 맨 위 카드(판정·밴드·명령), URL 의 hf= 동기와 새로고침 복원, 빼기, 지원하지 않는 구조·잘못된 입력 안내.
 */
import { expect, test } from '@playwright/test';
import { collectProblems, LOCALES, localePath, mockHf, open } from './helpers';

for (const locale of LOCALES) {
  const calc = localePath(locale, '/calculator');

  test.describe(`${locale} calculator — model not in the list`, () => {
    test('loads a Hugging Face model, pins its card, syncs hf= and restores on reload', async ({ page }) => {
      const problems = collectProblems(page);
      await mockHf(page);
      await open(page, `${calc}?gpu=rtx-4060`);
      const panel = page.locator('[data-hf-panel]');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      await panel.locator('input[name="hf"]').fill('https://huggingface.co/Qwen/Qwen3-4B/tree/main');
      await panel.locator('[data-hf-submit]').click();

      const card = page.locator('[data-hf-result] [data-result-card]');
      await expect(card).toHaveCount(1);
      await expect(card.locator('h3')).toContainText('Qwen3 4B');
      await expect(card.locator('[data-verdict]').first()).toBeVisible();
      await expect(card.locator('[data-hf-command]')).toContainText('llama-server -hf Qwen/Qwen3-4B-GGUF:Q4_K_M');
      // 콤보 페이지가 없는 모델 — 상세 링크 대신 HF 링크
      await expect(card.locator('[data-combo-link]')).toHaveCount(0);
      await expect(card.locator('a[href="https://huggingface.co/Qwen/Qwen3-4B-GGUF"]')).toHaveCount(1);
      // 카운트·필터 대상이 아니다 — 카탈로그 카드 목록과 따로
      await expect(page.locator('[data-results] [data-model-id^="hf-"]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('hf')).toBe('Qwen/Qwen3-4B');

      await page.reload();
      await expect(page.locator('[data-hf-result] [data-result-card] h3')).toContainText('Qwen3 4B');

      // 다음 불러오기가 실패해도 이전 카드를 뺄 수 있다 (10-01 리뷰)
      await panel.locator('input[name="hf"]').fill('not a model');
      await panel.locator('[data-hf-submit]').click();
      await expect(panel.locator('[data-hf-status]')).not.toBeEmpty();
      await expect(page.locator('[data-hf-remove]')).toBeVisible();

      await page.locator('[data-hf-remove]').click();
      await expect(page.locator('[data-hf-result]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('hf')).toBeNull();
      expect(problems).toEqual([]);
    });

    test('the pinned card does not widen the page on a phone', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await mockHf(page);
      await open(page, `${calc}?gpu=rtx-4060&hf=Qwen%2FQwen3-4B`);
      await expect(page.locator('[data-hf-result] [data-hf-command]')).toBeVisible();
      const scrollX = await page.evaluate('(() => { window.scrollTo(100, 0); return window.scrollX; })()');
      expect(scrollX).toBe(0);
    });

    test('explains unsupported architectures, points catalog models to their card, rejects invalid input', async ({ page }) => {
      await mockHf(page);
      await open(page, `${calc}?gpu=rtx-4060`);
      const panel = page.locator('[data-hf-panel]');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();

      await panel.locator('input[name="hf"]').fill('state-spaces/mamba2-2.7b');
      await panel.locator('[data-hf-submit]').click();
      await expect(panel.locator('[data-hf-status]')).toContainText('mamba2');
      await expect(page.locator('[data-hf-result]')).toHaveCount(0);

      // 이미 목록에 있는 모델(Qwen/Qwen3-8B = qwen3-8b) — 요청 없이 그 카드를 강조
      await panel.locator('input[name="hf"]').fill('https://huggingface.co/Qwen/Qwen3-8B');
      await panel.locator('[data-hf-submit]').click();
      await expect(panel.locator('[data-hf-status]')).toContainText('Qwen3 8B');
      await expect(page.locator('[data-result-card][data-model-id="qwen3-8b"]')).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('[data-hf-result]')).toHaveCount(0);

      await panel.locator('input[name="hf"]').fill('not a model');
      await panel.locator('[data-hf-submit]').click();
      await expect(panel.locator('[data-hf-status]')).toContainText(locale === 'ko' ? '조직/모델' : 'org/model');
      expect(new URL(page.url()).searchParams.get('hf')).toBeNull();
    });
  });
}
