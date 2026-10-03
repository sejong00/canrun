/**
 * 아일랜드 E2E (P1-3 이월분): 콤보 페이지 ctx 슬라이더·KV 토글(D28)·시스템 RAM 토글(10-03 D64)과 모델 허브 가격 정렬.
 * 브라우저에서만 드러나는 것 — 하이드레이션 후 컨트롤 활성, 정적 표 셀 강조·요약 문장이 정적 셀과 같은 수치,
 * 실행 명령 교체, 그리고 지연 청크 없음(초기 스크립트만) + 뒤로가기 실패 요청 0(D18).
 */
import { expect, test } from '@playwright/test';
import { clickThrough, collectProblems, LOCALES, localePath, open, RANGE_RE, trackChunkRequests } from './helpers';

const COMBOS = ['/can-i-run/qwen3-14b/on/rtx-4060', '/can-i-run/qwen3-30b-a3b-2507/on/rtx-3060-12gb'];

for (const locale of LOCALES) {
  for (const combo of COMBOS) {
    const path = localePath(locale, combo);

    test.describe(`${locale} combo island (${path})`, () => {
      test('slider and KV toggle update the summary from the static cell, swap the commands, no extra chunk', async ({
        page,
      }) => {
        const problems = collectProblems(page);
        const chunks = trackChunkRequests(page);
        await open(page, path);
        const chunksAfterLoad = chunks();

        const slider = page.locator('[data-ctx-slider]');
        await expect(slider).toBeEnabled();
        const summary = page.locator('[data-live-summary]');
        await expect(summary).toHaveText('');

        // 16k 로 이동 (인덱스 2: 4k·8k·16k …)
        await slider.focus();
        await page.keyboard.press('ArrowRight');
        await expect(summary).toHaveAttribute('data-ctx', '16384');
        await expect(summary).toHaveAttribute('data-kv', 'f16');
        const text = (await summary.textContent()) ?? '';
        expect(text.length).toBeGreaterThan(20);

        // 강조된 셀 = 선택한 조건, 요약 문장의 필요량이 그 셀에도 있다
        const cell = page.locator('[data-ctx-cell="16384:f16"]');
        await expect(cell).toHaveAttribute('aria-current', 'true');
        const cellText = (await cell.textContent()) ?? '';
        const gbMatch = /(\d[\d.,]*)\s?GB/.exec(cellText);
        expect(gbMatch, 'cell shows the need in GB').not.toBeNull();
        expect(text).toContain(gbMatch![1]!);
        if (!/does not fit|미탑재/.test(cellText)) expect(text, 'rule 3 band in summary').toMatch(RANGE_RE);

        // 명령 교체: llama.cpp `-c 16384`
        const llama = page.locator('[data-snippet-code="llama.cpp"]');
        await expect(llama).toContainText('-c 16384');

        // KV q8_0 → Ollama 서버 env 도 선택 ctx 를 따른다 (있을 때). 셀에 Ollama 명령이 없으면 블록이 숨겨진다 (리뷰 지적)
        await page.locator('[data-kv-toggle] input[value="q8_0"]').check();
        await expect(summary).toHaveAttribute('data-kv', 'q8_0');
        await expect(llama).toContainText('--cache-type-k q8_0');
        const ollamaFigure = page.locator('figure[data-snippet="ollama"]');
        if ((await ollamaFigure.count()) > 0) {
          const visible = await ollamaFigure.isVisible();
          if (visible) await expect(page.locator('[data-snippet-code="ollama"]')).toContainText('16384');
          else await expect(ollamaFigure).toBeHidden();
        }

        // 되돌리기 → 요약 비움·초기 명령 복원 (눈금 버튼 "8k" 와 구분되는 전용 셀렉터)
        await page.locator('button[data-ctx-reset]').click();
        await expect(summary).toHaveText('');
        await expect(llama).toContainText('-c 8192');

        // 아일랜드는 초기 스크립트만 쓴다 — 상호작용 뒤 추가 청크 요청 0 (D28: 지연 청크 없음)
        await page.waitForLoadState('networkidle');
        expect(chunks(), 'no lazy chunk after interaction').toBe(chunksAfterLoad);

        // 인접 콤보 이동 → 뒤로가기 실패 요청 0 (D18 유지)
        await clickThrough(page, page.locator('a[data-adjacent]').first());
        await page.goBack();
        await page.waitForLoadState('networkidle');
        expect(problems, 'console errors / failed requests').toEqual([]);
      });
    });
  }

  test.describe(`${locale} combo island Ollama block follows the cell both ways (review fix)`, () => {
    test('8k·f16 cpu-moe → q4_0 full-gpu cell swaps the Ollama command and notes → back', async ({ page }) => {
      // 8k·f16 은 cpu-moe(Ollama 0.30+ 자동 전문가 배치 각주), 8k·q4_0 은 full-gpu — data 로 확인한 쌍
      // (10-01 D56 부터 cpu-moe 도 Ollama 명령을 보여 준다 — 생략은 분할 GGUF 뿐이라 셀마다 바뀌지 않는다)
      const problems = collectProblems(page);
      const moeNote = locale === 'ko' ? 'Ollama 0.30 이상' : 'Ollama 0.30 and later';
      const notes = page.locator('figure[data-snippet="ollama"] [data-snippet-notes="ollama"]');
      await open(page, localePath(locale, '/can-i-run/kanana-1.5-15.7b-a3b/on/rtx-4070'));
      await expect(page.locator('figure[data-snippet-omitted="ollama"]')).toHaveCount(0);
      await expect(page.locator('figure[data-snippet="ollama"]')).toHaveCount(1);
      await expect(notes).toContainText(moeNote);
      await expect(page.locator('[data-ctx-slider]')).toBeEnabled();

      await page.locator('[data-kv-toggle] input[value="q4_0"]').check();
      const code = page.locator('figure[data-snippet="ollama"] [data-snippet-code="ollama"]');
      await expect(code).toContainText('OLLAMA_CONTEXT_LENGTH');
      await expect(code).toContainText('8192');
      // 셀이 KV q4_0 을 가정하므로 Ollama 서버도 같은 KV 타입으로 띄운다 (재검증 — 없으면 f16 KV 로 돌아 안 들어간다)
      await expect(code).toContainText('OLLAMA_KV_CACHE_TYPE');
      await expect(code).toContainText('q4_0');
      await expect(code).toContainText('OLLAMA_FLASH_ATTENTION');
      await expect(page.locator('figure[data-snippet="ollama"] [data-snippet-code="ollama-repl"]')).toContainText('num_ctx 8192');
      await expect(notes).not.toContainText(moeNote);

      await page.locator('button[data-ctx-reset]').click();
      await expect(notes).toContainText(moeNote);
      await expect(page.locator('figure[data-snippet="ollama"] [data-snippet-code="ollama"]')).not.toContainText('OLLAMA_KV_CACHE_TYPE');
      expect(problems).toEqual([]);
    });

    test('every ctx step keeps exactly one Ollama state and the command matches the selected ctx', async ({ page }) => {
      // 8k full-gpu, 긴 ctx 에선 cpu-moe·미탑재로 바뀌는 페이지 — 셀마다 Ollama 블록이 정확히 하나
      await open(page, localePath(locale, '/can-i-run/gpt-oss-20b/on/rtx-5070-ti'));
      const slider = page.locator('[data-ctx-slider]');
      await expect(slider).toBeEnabled();
      const ticks = await page.locator('button[data-ctx-tick]').all();
      for (const tick of ticks) {
        const ctx = (await tick.getAttribute('data-ctx-tick')) ?? '';
        await tick.click();
        const withCode = await page.locator('figure[data-snippet="ollama"]').count();
        const omitted = await page.locator('figure[data-snippet-omitted="ollama"]').count();
        expect(withCode + omitted, `ctx ${ctx}: exactly one Ollama block`).toBe(1);
        const summary = (await page.locator('[data-live-summary]').textContent()) ?? '';
        // 명령 없는 셀(미탑재)은 8k·f16 블록을 유지한다 (CtxControls.commandNone)
        const hasCommand = !/기준 그대로|stay at 8k/.test(summary);
        if (withCode && hasCommand) {
          await expect(page.locator('figure[data-snippet="ollama"] [data-snippet-code="ollama"]')).toContainText(ctx);
        }
      }
    });
  });

  test.describe(`${locale} combo island summaries stay truthful (re-verification)`, () => {
    test('a page without a run command never talks about "the commands below"', async ({ page }) => {
      await open(page, localePath(locale, '/can-i-run/llama-3.3-70b/on/rtx-5060'));
      await expect(page.locator('[data-no-run]')).toBeVisible();
      await page.locator('button[data-ctx-tick="4096"]').click();
      const summary = page.locator('[data-live-summary]');
      await expect(summary).toHaveAttribute('data-ctx', '4096');
      await expect(summary).not.toHaveText(/stay at 8k|follow this setting|기준 그대로|이 설정을 따릅니다/);
      await expect(page.locator('[data-no-run]')).toBeVisible();
    });

    test('a dGPU no-fit cell names VRAM plus RAM as the limit, not VRAM alone', async ({ page }) => {
      await open(page, localePath(locale, '/can-i-run/llama-3.3-70b/on/rtx-5090'));
      await page.locator('button[data-ctx-tick="65536"]').click();
      const summary = page.locator('[data-live-summary]');
      await expect(summary).toHaveAttribute('data-ctx', '65536');
      await expect(summary).toContainText('VRAM');
      await expect(summary).toContainText('RAM');
    });
  });

  test.describe(`${locale} combo system RAM toggle (10-03 D64)`, () => {
    // 16GB 에서는 기준 파일이 안 들어가 다른 양자화로 바뀌는 페이지 — 기대값은 정적 목록의 data 속성에서 읽는다(하드코딩 금지)
    const ramPath = localePath(locale, '/can-i-run/qwen3-30b-a3b-2507/on/rtx-4060');
    const BELOW = /commands below|아래 (실행 )?명령/;

    test('picking another RAM locks ctx/KV, shows that RAM verdict and command, and the static block stays', async ({ page }) => {
      const problems = collectProblems(page);
      const chunks = trackChunkRequests(page);
      await open(page, ramPath);
      const chunksAfterLoad = chunks();
      const toggle = page.locator('[data-ram-toggle]');
      await expect(toggle.locator('input').first()).toBeEnabled();
      const staticCommand = (await page.locator('[data-snippet-code="llama.cpp"]').textContent()) ?? '';
      const assumedRam = (await page.locator('[data-ram-step][data-assumed]').getAttribute('data-ram-step')) ?? '';
      await expect(toggle.locator(`input[value="${assumedRam}"]`)).toBeChecked();

      const row = page.locator('[data-ram-step="16"]');
      const quant = (await row.getAttribute('data-quant')) ?? '';
      expect(await row.getAttribute('data-fits')).toBe('true');
      expect(quant).not.toBe(await page.locator('[data-ram-step][data-assumed]').getAttribute('data-quant'));

      await toggle.locator('input[value="16"]').check();
      const summary = page.locator('[data-live-summary]');
      await expect(summary).toHaveAttribute('data-ram', '16');
      await expect(summary).not.toHaveAttribute('data-ctx', /.*/);
      await expect(summary).toContainText(quant);
      expect((await summary.textContent()) ?? '', 'rule 3 band').toMatch(RANGE_RE);
      await expect(summary).not.toHaveText(BELOW);
      // 기준 파일이 안 들어가는 이유는 시스템 RAM 몫으로 말한다 — 16GB 에서 쓸 수 있는 RAM 12.0GB (리뷰 반영: VRAM 몫만 말하지 않는다)
      await expect(summary).toContainText(/12[.,]0\s?GB/);
      await expect(row).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('[data-ctx-cell][aria-current]')).toHaveCount(0);
      await expect(page.locator('[data-ctx-slider]')).toBeDisabled();
      await expect(page.locator('[data-kv-toggle] input').first()).toBeDisabled();

      // 아일랜드가 그리는 결과 블록: 설명·파일 줄·명령이 모두 고른 RAM 의 양자화를 따른다
      const result = page.locator('[data-ram-result="16"]');
      await expect(result.locator('p').nth(0), 'intro line').toContainText(quant);
      await expect(result.locator('p').nth(0), 'intro line names the RAM').toContainText('16');
      // 코드 영역 이름에 RAM 이 들어가 정적 스니펫의 같은 이름 영역과 구분된다
      await expect(result.locator('[role="region"]').first()).toHaveAttribute('aria-label', /16/);
      await expect(result.locator('p').nth(1), 'file line').toContainText(quant);
      await expect(result.locator('[data-ram-code="llama.cpp"]')).toContainText(quant);
      await expect(result.locator('[data-ram-code="llama.cpp"]')).toContainText('-c 8192');
      await expect(result.locator('a[data-ram-calc]')).toHaveAttribute('href', /calculator\?gpu=rtx-4060.*&ram=16/);
      // 정적 스니펫(정적 기준 RAM)은 그대로
      await expect(page.locator('[data-snippet-code="llama.cpp"]')).toHaveText(staticCommand);

      // 처음 RAM 으로 돌아가면 잠금이 풀리고 결과 블록이 사라진다
      await toggle.locator(`input[value="${assumedRam}"]`).check();
      await expect(page.locator('[data-ctx-slider]')).toBeEnabled();
      await expect(summary).toHaveText('');
      await expect(page.locator('[data-ram-result]')).toHaveCount(0);
      await expect(page.locator('[data-ram-step][aria-current]')).toHaveCount(0);

      // 되돌리기 버튼은 RAM 도 처음으로
      await toggle.locator('input[value="64"]').check();
      await expect(summary).toHaveAttribute('data-ram', '64');
      await page.locator('button[data-ctx-reset]').click();
      await expect(toggle.locator(`input[value="${assumedRam}"]`)).toBeChecked();
      await expect(summary).toHaveText('');
      await expect(page.locator('[data-snippet-code="llama.cpp"]')).toHaveText(staticCommand);

      await page.waitForLoadState('networkidle');
      expect(chunks(), 'no lazy chunk after interaction').toBe(chunksAfterLoad);
      expect(problems, 'console errors / failed requests').toEqual([]);
    });

    test('?ram=16 opens in the same state (calculator deep link)', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${ramPath}?ram=16&ctx=32768`);
      await expect(page.locator('[data-ram-toggle] input[value="16"]')).toBeChecked();
      await expect(page.locator('[data-live-summary]')).toHaveAttribute('data-ram', '16');
      await expect(page.locator('[data-ram-step="16"]')).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('[data-ctx-slider]')).toBeDisabled();
      await expect(page.locator('[data-ctx-tick="8192"]')).toHaveAttribute('aria-pressed', 'true');
      expect(problems).toEqual([]);
    });

    test('the calculator "How to run" link (?ram=16#snippet) lands on commands that say which RAM they are for', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${ramPath}?ram=16#snippet`);
      const quant = (await page.locator('[data-ram-step="16"]').getAttribute('data-quant')) ?? '';
      const assumedRam = (await page.locator('[data-ram-step][data-assumed]').getAttribute('data-ram-step')) ?? '';
      // 앵커의 정적 명령은 정적 기준 RAM 의 것이라고 밝히고, 다른 RAM 의 명령이 있는 섹션 이름을 가리킨다
      const note = page.locator('#snippet [data-snippet-ram]');
      await expect(note).toHaveAttribute('data-snippet-ram', assumedRam);
      await expect(note).toContainText(assumedRam);
      await expect(note).toContainText(((await page.locator('#ctx-heading').textContent()) ?? '').trim());
      // 그 섹션에는 16GB 가 골라져 있고 16GB 의 파일로 된 명령이 있다
      await expect(page.locator('[data-ram-result="16"] [data-ram-code="llama.cpp"]')).toContainText(quant);
      expect(problems).toEqual([]);
    });

    test('a RAM-hint page starts at the hint RAM; a RAM where nothing fits shows no command', async ({ page }) => {
      await open(page, localePath(locale, '/can-i-run/gpt-oss-120b/on/rtx-4060'));
      const commandsRow = page.locator('[data-ram-step][data-commands]');
      await expect(commandsRow).toHaveCount(1);
      const hintRam = (await commandsRow.getAttribute('data-ram-step')) ?? '';
      await expect(page.locator(`[data-ram-toggle] input[value="${hintRam}"]`)).toBeChecked();
      expect(await page.locator('[data-ram-step="16"]').getAttribute('data-fits')).toBe('false');
      await page.locator('[data-ram-toggle] input[value="16"]').check();
      await expect(page.locator('[data-live-summary]')).toHaveAttribute('data-ram', '16');
      await expect(page.locator('[data-live-summary]')).not.toHaveText(BELOW);
      await expect(page.locator('[data-ram-result="16"] [data-ram-code]')).toHaveCount(0);
      await expect(page.locator('[data-ram-result="16"] a[data-ram-calc]')).toBeVisible();
      await expect(page.locator('figure[data-snippet="llama.cpp"]')).toBeVisible();
    });

    test('a page without a static run command shows the command a bigger RAM allows, never "the commands below"', async ({ page }) => {
      await open(page, localePath(locale, '/can-i-run/llama-3.3-70b/on/rtx-5060'));
      await expect(page.locator('[data-no-run]')).toBeVisible();
      // 명령이 없는 자리에서도 다른 RAM 의 명령이 있는 곳을 가리킨다
      await expect(page.locator('[data-no-run]')).toContainText(((await page.locator('#ctx-heading').textContent()) ?? '').trim());
      // 판정만 같고 들어가는지만 바뀌는 행도 어느 파일인지 적는다 (리뷰 반영)
      for (const row of await page.locator('[data-ram-step]').all()) {
        await expect(row).toContainText((await row.getAttribute('data-quant')) ?? '');
      }
      const runs = page.locator('[data-ram-step][data-fits="true"]');
      expect(await runs.count(), 'some RAM step fits').toBeGreaterThan(0);
      const ram = (await runs.first().getAttribute('data-ram-step')) ?? '';
      await page.locator(`[data-ram-toggle] input[value="${ram}"]`).check();
      const summary = page.locator('[data-live-summary]');
      await expect(summary).toHaveAttribute('data-ram', ram);
      await expect(summary).not.toHaveText(BELOW);
      await expect(page.locator(`[data-ram-result="${ram}"] [data-ram-code="llama.cpp"]`)).toContainText('llama-server');
      await page.locator('[data-ram-toggle] input[value="16"]').check();
      await expect(summary).toHaveAttribute('data-ram', '16');
      await expect(summary).not.toHaveText(BELOW);
      await expect(page.locator('[data-ram-result="16"] [data-ram-code]')).toHaveCount(0);
      await expect(page.locator('[data-no-run]')).toBeVisible();
    });

    test('pages whose verdict does not depend on RAM have no toggle and say so', async ({ page }) => {
      await open(page, localePath(locale, '/can-i-run/qwen3-14b/on/rtx-4060'));
      await expect(page.locator('[data-ram-toggle]')).toHaveCount(0);
      await expect(page.locator('[data-ram-step]')).toHaveCount(0);
      await expect(page.locator('[data-ram-same]')).toHaveCount(1);
    });
  });

  test.describe(`${locale} combo RAM toggle on a phone`, () => {
    test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

    test('the RAM result block does not widen the page', async ({ page }) => {
      await open(page, localePath(locale, '/can-i-run/qwen3-30b-a3b-2507/on/rtx-4060?ram=16'));
      await expect(page.locator('[data-ram-result="16"] [data-ram-code="llama.cpp"]')).toBeVisible();
      // 레이아웃으로 잰다 — isMobile 에뮬레이션은 넓어진 내용에 맞춰 레이아웃 뷰포트를 키워 scrollX 검사로는 잡히지 않는다(리뷰 지적).
      // fieldset 기본 min-inline-size(min-content)가 줄바꿈 없는 명령 폭까지 늘어나지 않고, 명령은 코드 영역 안에서 가로로 스크롤된다
      const box = (await page.evaluate(`(() => {
        const right = (s) => document.querySelector(s).getBoundingClientRect().right;
        const code = document.querySelector('[data-ram-result="16"] [role="region"]');
        return {
          main: right('main'),
          fieldset: right('[data-ctx-controls]'),
          result: right('[data-ram-result="16"]'),
          code: code.getBoundingClientRect().right,
          scrolls: code.scrollWidth > code.clientWidth,
        };
      })()`)) as { main: number; fieldset: number; result: number; code: number; scrolls: boolean };
      expect(box.fieldset, 'fieldset inside <main>').toBeLessThanOrEqual(box.main + 0.5);
      expect(box.result, 'RAM result inside <main>').toBeLessThanOrEqual(box.main + 0.5);
      expect(box.code, 'code region inside <main>').toBeLessThanOrEqual(box.main + 0.5);
      expect(box.scrolls, 'the long command scrolls inside its region').toBe(true);
    });
  });

  test.describe(`${locale} model hub price sort`, () => {
    test('sorting by street price reorders rows and the default order restores', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, localePath(locale, '/model/qwen3-14b'));
      const select = page.locator('select[data-sort-control]');
      await expect(select).toBeEnabled();
      const rows = page.locator('table[data-gpu-table] tbody tr');
      const first = (await rows.first().textContent()) ?? '';

      await select.selectOption('price-asc');
      // DOM 순서대로 data-price 를 읽는다 (locator API 만 — DOM lib 없음)
      const prices: number[] = [];
      for (const row of await page.locator('table[data-gpu-table] tbody tr[data-price]').all()) {
        prices.push(Number(await row.getAttribute('data-price')));
      }
      expect(prices.length).toBeGreaterThan(2);
      // 가격 있는 행이 앞에 오름차순, 첫 행이 바뀌었다
      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
      await expect(rows.first()).toHaveAttribute('data-price', String(prices[0]));
      // 미가격 첫 행은 가격 행들 뒤에 온다 — DOM 순서대로 속성 유무를 읽는다
      // (`evaluateAll` 에 문자열을 주면 표현식으로만 평가되어 함수가 호출되지 않는다 → locator 순회)
      const order: number[] = [];
      for (const row of await rows.all()) order.push((await row.getAttribute('data-price')) === null ? 0 : 1);
      const firstUnpriced = order.indexOf(0) === -1 ? order.length : order.indexOf(0);
      expect(order.lastIndexOf(1)).toBeLessThan(firstUnpriced);

      await select.selectOption('verdict');
      expect((await rows.first().textContent()) ?? '').toBe(first);
      expect(problems).toEqual([]);
    });
  });
}
