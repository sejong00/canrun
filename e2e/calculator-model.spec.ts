/**
 * 계산기 모델 모드 (10-03 D65 — 모델을 고르면 돌릴 수 있는 GPU). 브라우저에서만 드러나는 것: `?mode=model` 딥링크의
 * 하이드레이션(콘솔 에러 0)·레이아웃 이동, GPU 행(판정 = 모델 허브 표와 같은 값, 속도 밴드 + 신뢰 라벨), 종류·예산·판정 필터와
 * 정렬의 URL 동기, ko 원화 참고값, 두 방향 왕복(카드 → GPU 목록 → GPU 로 모든 모델), 불러온 모델(이론 추정), 모델 허브 링크, 휴대폰 폭.
 * 브라우저 측 코드는 전부 문자열형 evaluate/addInitScript — 루트 tsconfig 에 DOM lib 이 없다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { collectProblems, LOCALES, localePath, mockHf, open, RANGE_RE, repoRoot } from './helpers';

const GPU_COUNT = (JSON.parse(readFileSync(resolve(repoRoot, 'data/gpus.json'), 'utf8')) as unknown[]).length;
const MODEL = 'qwen3-14b';

/** 누적 레이아웃 이동(입력 직후 제외) — 로드 전에 심는다 */
const CLS_OBSERVER = `
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: 'layout-shift', buffered: true });
`;

/** 행마다 속성 하나 (locator API 만 — DOM 타입 없이) */
async function attrs(page: Page, selector: string, name: string): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  for (const el of await page.locator(selector).all()) out.push(await el.getAttribute(name));
  return out;
}

/** 행(li 또는 tr)마다 첫 판정 배지 — GPU id → 판정 */
async function verdictsBy(page: Page, rowSelector: string): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const row of await page.locator(rowSelector).all()) {
    out[(await row.getAttribute('data-gpu-id')) ?? '?'] = await row.locator('[data-verdict]').first().getAttribute('data-verdict');
  }
  return out;
}

const rowPrices = async (page: Page): Promise<Array<number | null>> =>
  (await attrs(page, '[data-gpu-row]', 'data-price')).map((p) => (p === null ? null : Number(p)));

for (const locale of LOCALES) {
  const calc = localePath(locale, '/calculator');

  test.describe(`${locale} calculator — model mode`, () => {
    test('deep link: hydrates cleanly without layout shift, lists every GPU with the model hub verdicts and banded speeds', async ({ page }) => {
      const problems = collectProblems(page);
      await page.addInitScript(CLS_OBSERVER);
      await open(page, `${calc}?mode=model&m=${MODEL}`);
      const rows = page.locator('[data-gpu-row]');
      await expect(rows).toHaveCount(GPU_COUNT);
      await expect(page.locator('[data-mode-switch] input[value="model"]')).toBeChecked();
      await expect(page.locator('[data-model-form] select[name="m"]')).toHaveValue(MODEL);
      // 하드웨어 폼은 모델 폼으로 바뀌었다
      await expect(page.locator('form[data-calc-form]')).toHaveCount(0);
      // 규칙 3: 속도가 보이는 행마다 범위 + 신뢰 라벨
      const speeds = page.locator('[data-gpu-row] [data-speed]');
      expect(await speeds.count()).toBeGreaterThan(10);
      for (const speed of await speeds.all()) {
        expect((await speed.textContent()) ?? '').toMatch(RANGE_RE);
        await expect(speed.locator('[data-confidence]')).toHaveCount(1);
      }
      expect(new URL(page.url()).search).toBe(`?mode=model&m=${MODEL}`);
      const cls = (await page.evaluate('window.__cls')) as number;
      expect(cls, 'layout shift after the model-mode deep link').toBeLessThanOrEqual(0.1);

      // 판정은 같은 로캘 모델 허브 표와 같다 (값을 고정하지 않는다 — 경계 근처 조합이 데이터 갱신으로 바뀔 수 있다)
      const calcVerdicts = await verdictsBy(page, '[data-gpu-row]');
      expect(Object.keys(calcVerdicts)).toHaveLength(GPU_COUNT);
      expect(Object.values(calcVerdicts).every((v) => v === 'S' || v === 'A' || v === 'B' || v === 'F')).toBe(true);
      await open(page, localePath(locale, `/model/${MODEL}`));
      const hubVerdicts = await verdictsBy(page, 'table[data-gpu-table] tr[data-gpu-id]');
      expect(calcVerdicts).toEqual(hubVerdicts);
      expect(problems).toEqual([]);
    });

    test('type, budget, verdict filters and sorting sync to the URL; prices use the street price only', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${calc}?mode=model&m=${MODEL}`);
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);

      await page.locator('[data-gpu-results] label:has(input[value="laptop"])').click();
      await expect.poll(() => new URL(page.url()).searchParams.get('type')).toBe('laptop');
      const laptopTypes = await attrs(page, '[data-gpu-row]', 'data-type');
      expect(laptopTypes.length).toBeGreaterThan(0);
      expect(new Set(laptopTypes)).toEqual(new Set(['laptop']));
      // 노트북 설명은 목록 아래 한 번만, 최저가 상자는 필터와 무관하다고 밝힌다
      await expect(page.locator('[data-gpu-results]')).toContainText(locale === 'ko' ? '노트북마다 전력 제한' : 'vary from laptop to laptop');
      await expect(page.locator('[data-gpu-row] h3', { hasText: locale === 'ko' ? '전력 제한' : 'power limits' })).toHaveCount(0);
      await expect(page.locator('[data-cheapest]')).toContainText(locale === 'ko' ? '필터와 관계없이' : 'regardless of filters');
      await page.locator('[data-gpu-results] label:has(input[value="laptop"])').click();
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);

      await page.locator('[data-gpu-results] select[name="budget"]').selectOption('500');
      await expect.poll(() => new URL(page.url()).searchParams.get('budget')).toBe('500');
      const budgetPrices = await rowPrices(page);
      expect(budgetPrices.length).toBeGreaterThan(0);
      for (const p of budgetPrices) expect(p !== null && p <= 500).toBe(true);
      // 실거래가가 없는 행을 뺐다는 안내
      await expect(page.locator('[data-gpu-results]')).toContainText(locale === 'ko' ? '실거래가가 확인되지 않은' : 'without a street price');
      await page.locator('[data-gpu-results] select[name="budget"]').selectOption('');

      await page.locator('[data-gpu-results] select[name="gsort"]').selectOption('price');
      await expect.poll(() => new URL(page.url()).searchParams.get('gsort')).toBe('price');
      const prices = await rowPrices(page);
      const firstNull = prices.indexOf(null);
      expect(firstNull).toBeGreaterThan(0);
      const priced = prices.slice(0, firstNull) as number[];
      expect(priced).toEqual([...priced].sort((a, b) => a - b));
      expect(prices.slice(firstNull).every((p) => p === null)).toBe(true);

      await page.locator('[data-gpu-results] label:has(input[value="A"])').click();
      await expect.poll(() => new URL(page.url()).searchParams.get('min')).toBe('A');
      const verdicts = Object.values(await verdictsBy(page, '[data-gpu-row]'));
      expect(verdicts.length).toBeGreaterThan(0);
      expect(verdicts.every((v) => v === 'S' || v === 'A')).toBe(true);

      // 새로고침 복원
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-gpu-results] select[name="gsort"]')).toHaveValue('price');
      expect(Object.values(await verdictsBy(page, '[data-gpu-row]')).every((v) => v === 'S' || v === 'A')).toBe(true);
      // 로캘 스위처 href 에 쿼리 유지
      await expect.poll(async () => (await page.locator('a[data-locale-switch]').first().getAttribute('href')) ?? '').toContain('mode=model');
      expect(problems).toEqual([]);
    });

    test(`prices: ${locale === 'ko' ? 'KRW reference with the conversion note' : 'no KRW at all'}`, async ({ page }) => {
      await open(page, `${calc}?mode=model&m=${MODEL}`);
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);
      const text = (await page.locator('[data-gpu-results]').textContent()) ?? '';
      if (locale === 'ko') {
        expect(text).toContain('만 원');
        expect(text).toContain('원화 금액은');
      } else {
        expect(text).not.toMatch(/KRW|만 원/);
      }
    });

    test('round trip: a model card → its GPU list (my GPU marked, my setup pinned) → a GPU row → all models on that GPU', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${calc}?gpu=rtx-4060&ram=16`);
      await page.locator(`[data-result-card][data-model-id="${MODEL}"] [data-see-gpus]`).click();
      await expect.poll(() => new URL(page.url()).search).toBe(`?gpu=rtx-4060&ram=16&mode=model&m=${MODEL}`);
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);
      await expect(page.locator('#results-heading')).toBeFocused();
      await expect(page.locator('[data-gpu-row][data-gpu-id="rtx-4060"]')).toHaveAttribute('aria-current', 'true');
      // "내 구성" = 하드웨어 모드에서 넣은 RAM 16GB 로 계산한 행
      const mine = page.locator('[data-mine-result]');
      await expect(mine).toContainText('16');
      await expect(mine.locator('[data-verdict]').first()).toBeVisible();

      await page.locator('[data-gpu-row][data-gpu-id="rtx-3090"] [data-use-gpu]').click();
      await expect.poll(() => new URL(page.url()).search).toBe(`?gpu=rtx-3090&ram=16&m=${MODEL}`);
      await expect(page.locator(`[data-result-card][data-model-id="${MODEL}"]`)).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('form[data-calc-form] input[name="gpu"]')).toHaveValue(/3090/);

      // 맥 행은 그 행이 쓴 메모리 용량을 가져간다
      await page.locator('[data-mode-switch] label:has(input[value="model"])').click();
      const mac = page.locator('[data-gpu-row][data-type="unified"]').first();
      const macId = await mac.getAttribute('data-gpu-id');
      await mac.locator('[data-use-gpu]').click();
      await expect.poll(() => new URL(page.url()).searchParams.get('gpu')).toBe(macId);
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      expect(problems).toEqual([]);
    });

    test('switching modes keeps what was typed: a GPU name not committed yet and a Hugging Face address', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, calc);
      const gpuInput = page.locator('form[data-calc-form] input[name="gpu"]');
      // 메모리 형제가 있는 이름은 자동 반영 없이 blur·Enter 로만 확정된다 — 입력창이 blur 된 직후 폼이 사라져도 남아야 한다
      await gpuInput.fill('4060 ti');
      await page.locator('[data-mode-switch] label:has(input[value="model"])').click();
      await expect(page.locator('[data-model-form]')).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.get('gpu')).toBe('4060 ti');
      const hf = page.locator('[data-hf-panel] input[name="hf"]');
      await hf.fill('Qwen/Qwen3-4B');
      await page.locator('[data-mode-switch] label:has(input[value="hardware"])').click();
      await expect(gpuInput).toHaveValue('4060 ti');
      await expect(hf).toHaveValue('Qwen/Qwen3-4B');
      expect(problems).toEqual([]);
    });

    test('a context above the model maximum: the assumption sentence and my-setup line use the length actually computed', async ({ page }) => {
      await open(page, `${calc}?gpu=rtx-4060&ctx=131072&mode=model&m=${MODEL}`);
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);
      for (const selector of ['[data-model-assumptions]', '[data-mine-result]']) {
        await expect(page.locator(selector)).toContainText('32k');
        await expect(page.locator(selector)).not.toContainText('128k');
      }
    });

    test('the mode switch starts empty, then picking a model fills the list', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, calc);
      await page.locator('[data-mode-switch] label:has(input[value="model"])').click();
      await expect(page.locator('[data-model-form]')).toBeVisible();
      await expect(page.locator('[data-gpu-row]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).search).toBe('?mode=model');
      await page.locator('[data-model-form] select[name="m"]').selectOption('gpt-oss-20b');
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);
      await expect.poll(() => new URL(page.url()).search).toBe('?mode=model&m=gpt-oss-20b');
      // 컨텍스트를 바꾸면 URL 과 상세 링크가 그 셀을 따른다
      await page.locator('[data-model-form] select[name="ctx"]').selectOption('32768');
      await expect.poll(() => new URL(page.url()).search).toBe('?ctx=32768&mode=model&m=gpt-oss-20b');
      await expect(page.locator('[data-gpu-row] a[data-combo-link]').first()).toHaveAttribute('href', /\?ctx=32768&kv=f16$/);
      expect(problems).toEqual([]);
    });

    test('a model loaded from Hugging Face becomes the target: theoretical rows, no combo links; picking a catalog model drops it', async ({ page }) => {
      const problems = collectProblems(page);
      await mockHf(page);
      await open(page, `${calc}?mode=model&hf=Qwen%2FQwen3-4B`);
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);
      await expect(page.locator('#results-heading')).toContainText('Qwen3 4B');
      const labels = await attrs(page, '[data-gpu-row] [data-confidence]', 'data-confidence');
      expect(labels.length).toBeGreaterThan(0);
      expect(new Set(labels)).toEqual(new Set(['theoretical']));
      await expect(page.locator('[data-gpu-row] a[data-combo-link]')).toHaveCount(0);

      await page.locator('[data-model-form] select[name="m"]').selectOption(MODEL);
      await expect.poll(() => new URL(page.url()).search).toBe(`?mode=model&m=${MODEL}`);
      await expect(page.locator('[data-gpu-row] a[data-combo-link]').first()).toBeVisible();
      expect(problems).toEqual([]);
    });

    test('the model hub links to the calculator in model mode', async ({ page }) => {
      await open(page, localePath(locale, `/model/${MODEL}`));
      const link = page.locator('a[data-calc-model-link]');
      await expect(link).toHaveAttribute('href', `${calc}?mode=model&m=${MODEL}`);
      await link.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);
    });
  });

  test.describe(`${locale} calculator model mode on a phone`, () => {
    test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

    test('no horizontal scroll and tap targets ≥ 40px', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${calc}?mode=model&m=${MODEL}`);
      await expect(page.locator('[data-gpu-row]')).toHaveCount(GPU_COUNT);
      const scrollX = (await page.evaluate('(() => { window.scrollTo(100, 0); return window.scrollX; })()')) as number;
      expect(scrollX).toBe(0);
      for (const selector of ['[data-mode-switch] label', '[data-model-form] select[name="m"]', '[data-gpu-row] [data-use-gpu]', '[data-gpu-results] select[name="budget"]']) {
        const box = await page.locator(selector).first().boundingBox();
        expect(box?.height ?? 0, selector).toBeGreaterThanOrEqual(40);
      }
      expect(problems).toEqual([]);
    });
  });
}
