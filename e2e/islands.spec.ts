/**
 * 아일랜드 E2E (P1-3 이월분): 콤보 페이지 ctx 슬라이더·KV 토글(D28)과 모델 허브 가격 정렬.
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
