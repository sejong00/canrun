/**
 * 계산기 — 목록에 없는 모델 (계산기 P2, PROGRESS §4 D57). Hugging Face 요청은 전부 가짜 응답으로 막는다(CI 는 외부망을 쓰지 않는다).
 * 확인: 불러오기 → 결과 맨 위 카드(판정·밴드·명령), URL 의 hf= 동기와 새로고침 복원, 빼기, 지원하지 않는 구조·잘못된 입력 안내.
 */
import { expect, test, type Page } from '@playwright/test';
import { collectProblems, LOCALES, localePath, open } from './helpers';

const QWEN3_4B_CONFIG = {
  model_type: 'qwen3',
  num_hidden_layers: 36,
  num_attention_heads: 32,
  num_key_value_heads: 8,
  head_dim: 128,
  hidden_size: 2560,
  max_position_embeddings: 40960,
};

/** huggingface.co 요청 가짜 응답 — 모르는 주소는 404 (실제 망으로 새지 않게) */
async function mockHf(page: Page) {
  await page.route('https://huggingface.co/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === '/api/models/Qwen/Qwen3-4B') {
      return json({ id: 'Qwen/Qwen3-4B', siblings: [{ rfilename: 'config.json' }], cardData: { license: 'apache-2.0' }, safetensors: { total: 4_022_468_096 } });
    }
    if (p === '/api/models' && url.searchParams.get('filter') === 'gguf') {
      return json([{ id: 'unsloth/Qwen3-4B-GGUF' }, { id: 'Qwen/Qwen3-4B-GGUF' }]);
    }
    if (p === '/api/models/Qwen/Qwen3-4B-GGUF/tree/main') {
      return json([
        { type: 'file', path: 'Qwen3-4B-Q4_K_M.gguf', size: 2_497_280_256 },
        { type: 'file', path: 'Qwen3-4B-Q8_0.gguf', size: 4_280_404_736 },
        { type: 'file', path: 'README.md', size: 1200 },
      ]);
    }
    if (p === '/Qwen/Qwen3-4B/resolve/main/config.json') return json(QWEN3_4B_CONFIG);
    if (p === '/api/models/state-spaces/mamba2-2.7b') {
      return json({ id: 'state-spaces/mamba2-2.7b', siblings: [{ rfilename: 'config.json' }], safetensors: { total: 2_700_000_000 } });
    }
    if (p === '/api/models/state-spaces/mamba2-2.7b/tree/main' || p === '/api/models/state-spaces/mamba2-2.7b-GGUF/tree/main') {
      return json([{ type: 'file', path: 'mamba2-2.7b-Q4_K_M.gguf', size: 1_600_000_000 }]);
    }
    if (p === '/state-spaces/mamba2-2.7b/resolve/main/config.json') return json({ model_type: 'mamba2', num_hidden_layers: 64 });
    return json({ error: 'not found' }, 404);
  });
}

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
