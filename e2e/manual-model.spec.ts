/**
 * 계산기 — 모델 값 직접 입력 (계산기 P2, PROGRESS §4 D66). 모델 카드·config.json 숫자를 넣으면 결과 맨 위 고정 카드(이론 추정,
 * 명령·링크 없음, "약 N GB")가 생기고 URL `mm=` 로 공유·복원된다. Hugging Face 에는 아무 요청도 보내지 않는다.
 * 확인: 입력 → 카드·mm= 동기 → 새로고침 복원, config.json 키 안내(늘 보임)·필수 안내(입력을 시작한 뒤), MoE 비율 안내와 최소값, 입력한 값 지우기,
 * HF 불러오기와 서로 대체(HF 모델이 있는 동안 생각 모드·최대 컨텍스트 비활성), 목록에 있는 HF id·카탈로그 모델 고르기 뒤 입력했던 값 되살리기,
 * 모델 모드 대상, 휴대폰 폭.
 */
import { expect, test, type Page } from '@playwright/test';
import { collectProblems, LOCALES, localePath, mockHf, open } from './helpers';

const TEXT = {
  en: {
    name: 'Custom model',
    heading: 'your custom model',
    badge: 'Entered by hand',
    approx: 'about',
    below: 'below',
    theoretical: 'theoretical estimate ±30%',
    required: 'Needed to calculate.',
  },
  ko: {
    name: '직접 입력한 모델',
    heading: '직접 입력한 모델',
    badge: '직접 입력',
    approx: '약',
    below: '아래에서',
    theoretical: '이론 추정 ±30%',
    required: '계산에 필요한 값입니다.',
  },
} as const;

/** 펼침 영역 열기 — 요약 줄 클릭 */
async function openManual(page: Page) {
  const details = page.locator('details[data-manual-model]');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await expect(details.locator('input[name="mm-paramsB"]')).toBeEnabled();
  return details;
}

/** huggingface.co 로 나간 요청 수 */
function countHfRequests(page: Page): () => number {
  let n = 0;
  page.on('request', (req) => {
    if (new URL(req.url()).hostname.endsWith('huggingface.co')) n += 1;
  });
  return () => n;
}

for (const locale of LOCALES) {
  const calc = localePath(locale, '/calculator');
  const text = TEXT[locale];

  test.describe(`${locale} calculator — model values entered by hand`, () => {
    test('a dense model: pinned theoretical card without a command, mm= in the URL, restored on reload, no Hugging Face request', async ({ page }) => {
      const problems = collectProblems(page);
      const hfRequests = countHfRequests(page);
      await open(page, `${calc}?gpu=rtx-4060`);
      await expect(page.locator('[data-results] [data-result-card]').first()).toBeVisible();
      const details = await openManual(page);
      // config.json 키 안내는 빈 칸에서도 보이고, "계산에 필요한 값" 은 입력을 시작한 뒤 빈 필수 칸에만 붙는다 (리뷰 반영)
      const layersHint = details.locator('div:has(> input[name="mm-layers"]) > p');
      await expect(layersHint).toContainText('num_hidden_layers');
      await expect(layersHint).not.toContainText(text.required);
      await expect(details.locator('div:has(> select[name="mm-ctx"]) > p')).toContainText('max_position_embeddings');
      await details.locator('input[name="mm-paramsB"]').fill('8.03');
      await expect(layersHint).toContainText(text.required);
      await expect(layersHint).toContainText('num_hidden_layers');
      await details.locator('input[name="mm-layers"]').fill('32');
      await expect(layersHint).not.toContainText(text.required);
      await details.locator('input[name="mm-kvHeads"]').fill('8');
      await details.locator('input[name="mm-headDim"]').fill('128');

      const pinned = page.locator('[data-hf-result][data-pinned-kind="manual"]');
      const card = pinned.locator('[data-result-card]');
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute('data-model-id', 'manual');
      await expect(card.locator('h3')).toContainText(text.name);
      await expect(card).toContainText(text.badge);
      await expect(card.locator('[data-verdict]').first()).toBeVisible();
      await expect(card.locator('[data-speed-text]')).toContainText(text.theoretical);
      await expect(card.locator('dd').first()).toContainText(text.approx);
      // 받을 파일·페이지가 없다 — 명령·콤보·HF 링크 없음
      await expect(card.locator('[data-hf-command]')).toHaveCount(0);
      await expect(card.locator('[data-combo-link]')).toHaveCount(0);
      await expect(card.locator('a[href*="huggingface.co"]')).toHaveCount(0);
      await expect(details.locator('[data-manual-status]')).not.toBeEmpty();
      // 카운트·목록 밖
      await expect(page.locator('[data-results] [data-model-id="manual"]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('mm')).toBe('p8.03-l32-k8-d128');

      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-hf-result][data-pinned-kind="manual"] [data-result-card] h3')).toContainText(text.name);
      await expect(page.locator('details[data-manual-model]')).toHaveAttribute('open', '');
      await expect(page.locator('input[name="mm-paramsB"]')).toHaveValue('8.03');
      expect(hfRequests()).toBe(0);
      expect(problems).toEqual([]);
    });

    test('MoE: a too-small active count names the minimum, the minimum works, Clear values clears the card and mm=', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${calc}?gpu=rtx-4060`);
      await expect(page.locator('[data-results] [data-result-card]').first()).toBeVisible();
      const details = await openManual(page);
      await details.locator('input[name="mm-paramsB"]').fill('30.5');
      await details.locator('input[name="mm-layers"]').fill('48');
      await details.locator('input[name="mm-kvHeads"]').fill('4');
      await details.locator('input[name="mm-headDim"]').fill('128');
      await expect(page.locator('[data-hf-result]')).toHaveCount(1);
      await details.locator('input[name="mm-moe"]').check();
      await expect(details.locator('[data-manual-moe]')).toBeVisible();
      // MoE 값을 하나라도 넣으면 셋 다 있어야 계산한다
      await details.locator('input[name="mm-experts"]').fill('128');
      await expect(page.locator('[data-hf-result]')).toHaveCount(0);
      await details.locator('input[name="mm-topK"]').fill('8');
      const active = details.locator('input[name="mm-activeParamsB"]');
      await active.fill('1.5');
      await expect(active).toHaveAttribute('aria-invalid', 'true');
      await expect(details.locator('[data-manual-moe]')).toContainText('1.92');
      await active.fill('1.92');
      await expect(active).not.toHaveAttribute('aria-invalid', 'true');
      await active.fill('3.3');
      await expect(page.locator('[data-hf-result][data-pinned-kind="manual"] [data-result-card]')).toHaveCount(1);
      await expect.poll(() => new URL(page.url()).searchParams.get('mm')).toBe('p30.5-a3.3-e128-t8-l48-k4-d128');

      // 정수 칸의 소수는 안내 문장
      const layers = details.locator('input[name="mm-layers"]');
      await layers.fill('48.5');
      await expect(layers).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('[data-hf-result]')).toHaveCount(0);
      await layers.fill('48');

      // 지우기는 펼침 영역 안에 — HF 폼의 "빼기"는 불러온 모델에만 (리뷰 반영)
      await expect(page.locator('[data-hf-remove]')).toHaveCount(0);
      await details.locator('[data-manual-clear]').click();
      await expect(page.locator('[data-hf-result]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('mm')).toBeNull();
      await expect(details.locator('input[name="mm-paramsB"]')).toHaveValue('');
      // 방문자가 직접 지운 값은 되살리기를 권하지 않는다
      await expect(details.locator('[data-manual-restore]')).toHaveCount(0);
      expect(problems).toEqual([]);
    });

    test('loading a Hugging Face model replaces the typed values and typing replaces it again; a not-found error points below', async ({ page }) => {
      await mockHf(page);
      await open(page, `${calc}?gpu=rtx-4060&mm=p8.03-l32-k8-d128`);
      const panel = page.locator('[data-hf-panel]');
      await expect(page.locator('[data-hf-result][data-pinned-kind="manual"] [data-result-card]')).toHaveCount(1);

      await panel.locator('input[name="hf"]').fill('Qwen/Qwen3-4B');
      await panel.locator('[data-hf-submit]').click();
      await expect(page.locator('[data-hf-result][data-pinned-kind="hf"] [data-result-card] h3')).toContainText('Qwen3 4B');
      await expect.poll(() => new URL(page.url()).searchParams.get('hf')).toBe('Qwen/Qwen3-4B');
      expect(new URL(page.url()).searchParams.get('mm')).toBeNull();

      const details = await openManual(page);
      await expect(details.locator('input[name="mm-paramsB"]')).toHaveValue('');
      // 생각 모드·최대 컨텍스트만으로는 불러온 모델을 바꾸지 않는다 — HF 모델이 있는 동안 비활성 (리뷰 반영)
      await expect(details.locator('input[name="mm-thinking"]')).toBeDisabled();
      await expect(details.locator('select[name="mm-ctx"]')).toBeDisabled();
      await details.locator('input[name="mm-paramsB"]').fill('7');
      await expect(details.locator('input[name="mm-thinking"]')).toBeEnabled();
      await expect(page.locator('[data-hf-result]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('hf')).toBeNull();
      await expect.poll(() => new URL(page.url()).searchParams.get('mm')).toBe('p7');

      // 모델이 Hugging Face 에 없으면(가짜 404) 직접 입력을 권한다
      await panel.locator('input[name="hf"]').fill('acme/not-a-real-model');
      await panel.locator('[data-hf-submit]').click();
      await expect(panel.locator('[data-hf-status]')).toContainText(text.below);
    });

    test('a Hugging Face id already in the list drops the typed model; the typed values come back with one click', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${calc}?gpu=rtx-4060&mm=p8.03-l32-k8-d128`);
      const pinned = page.locator('[data-hf-result][data-pinned-kind="manual"] [data-result-card]');
      await expect(pinned).toHaveCount(1);
      const panel = page.locator('[data-hf-panel]');
      // 목록에 있는 모델(Qwen/Qwen3-8B = qwen3-8b) — 그 카드를 강조하고, 직접 입력 카드는 내려놓는다 (리뷰 반영)
      await panel.locator('input[name="hf"]').fill('Qwen/Qwen3-8B');
      await panel.locator('[data-hf-submit]').click();
      await expect(panel.locator('[data-hf-status]')).toContainText('Qwen3 8B');
      await expect(page.locator('[data-hf-result]')).toHaveCount(0);
      await expect(page.locator('[data-result-card][data-model-id="qwen3-8b"]')).toHaveAttribute('aria-current', 'true');
      await expect.poll(() => new URL(page.url()).searchParams.get('mm')).toBeNull();
      const details = page.locator('details[data-manual-model]');
      await expect(details.locator('input[name="mm-paramsB"]')).toHaveValue('');
      await details.locator('[data-manual-restore]').click();
      await expect(pinned).toHaveCount(1);
      await expect(details.locator('input[name="mm-paramsB"]')).toHaveValue('8.03');
      await expect.poll(() => new URL(page.url()).searchParams.get('mm')).toBe('p8.03-l32-k8-d128');
      await expect(details.locator('[data-manual-restore]')).toHaveCount(0);
      expect(problems).toEqual([]);
    });

    test('model mode: picking a catalog model replaces the typed model, and the typed values come back as the target', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${calc}?mode=model&mm=p30.5-a3.3-e128-t8-l48-k4-d128`);
      const heading = page.locator('[data-gpu-results] #results-heading');
      await expect(heading).toContainText(text.heading);
      await page.locator('[data-model-form] select[name="m"]').selectOption('qwen3-14b');
      await expect(heading).toContainText('Qwen3 14B');
      await expect.poll(() => new URL(page.url()).searchParams.get('mm')).toBeNull();
      const details = page.locator('details[data-manual-model]');
      await details.locator('[data-manual-restore]').click();
      await expect(heading).toContainText(text.heading);
      // MoE 칸도 함께 되살아난다
      await expect(details.locator('input[name="mm-activeParamsB"]')).toHaveValue('3.3');
      await expect.poll(() => new URL(page.url()).searchParams.get('mm')).toBe('p30.5-a3.3-e128-t8-l48-k4-d128');
      expect(problems).toEqual([]);
    });

    test('model mode: the typed model is the target — its name, approximate sizes and the note', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${calc}?mode=model&mm=p8.03-l32-k8-d128-c131072`);
      const results = page.locator('[data-gpu-results]');
      await expect(results.locator('#results-heading')).toContainText(text.heading);
      await expect(page.locator('[data-model-form] select[name="m"] option:checked')).toHaveText(text.name);
      const row = results.locator('[data-gpu-row]').first();
      await expect(row).toBeVisible();
      await expect(row.locator('dd').first()).toContainText(text.approx);
      await expect(row.locator('[data-combo-link]')).toHaveCount(0);
      await expect(page.locator('details[data-manual-model] [data-manual-status]')).not.toBeEmpty();
      expect(problems).toEqual([]);
    });

    test('the open fields and the pinned card do not widen the page on a phone', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, `${calc}?gpu=rtx-4060&mm=p30.5-a3.3-e128-t8-l48-k4-d128`);
      await expect(page.locator('[data-hf-result] [data-result-card]')).toBeVisible();
      await expect(page.locator('details[data-manual-model] [data-manual-moe]')).toBeVisible();
      const scrollX = await page.evaluate('(() => { window.scrollTo(100, 0); return window.scrollX; })()');
      expect(scrollX).toBe(0);
    });
  });
}
