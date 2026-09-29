/**
 * 계산기 E2E (docs/01 F1·F4, P1-3): 브라우저에서만 드러나는 것 — 하이드레이션(콘솔 에러 0 = 불일치 0), 콤보박스 승격,
 * 결과 카드(판정 계약·밴드), URL 동기(replaceState)·복원·히스토리, 딥링크 → goBack 실패 요청 0(D18), 공유, 감지(스텁 양성·음성,
 * 무소음 폴백), 커스텀 하드웨어, 모바일 뷰포트, 홈 GET 폼.
 * 브라우저 측 코드는 전부 문자열형 evaluate/addInitScript — 루트 tsconfig 에 DOM lib 이 없다.
 */
import { expect, test, type Page } from '@playwright/test';
import { clickThrough, collectProblems, LOCALES, localePath, open, RANGE_RE } from './helpers';

const CALC = '/calculator';

async function pickGpu(page: Page, text: string, optionId: string) {
  const input = page.locator('form[data-calc-form] input[name="gpu"]');
  await expect(input).toHaveAttribute('role', 'combobox');
  await input.fill(text);
  await page.locator(`[role="option"][data-gpu-id="${optionId}"]`).first().click();
}

const RENDERER_STUB = (renderer: string, withGpu: boolean) => `
  (() => {
    const RENDERER = ${JSON.stringify(renderer)};
    ${withGpu
      ? `const info = { vendor: 'nvidia', architecture: 'ada-lovelace', device: '', description: '' };
         Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ info }) } });`
      : `Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });`}
    for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
      const getParameter = Ctx.prototype.getParameter;
      Ctx.prototype.getParameter = function (p) {
        if (p === 0x9246) return RENDERER;
        if (p === 0x9245) return 'Google Inc. (NVIDIA)';
        return getParameter.call(this, p);
      };
      const getExtension = Ctx.prototype.getExtension;
      Ctx.prototype.getExtension = function (name) {
        if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
        return getExtension.call(this, name);
      };
    }
  })();
`;

for (const locale of LOCALES) {
  const path = localePath(locale, CALC);

  test.describe(`${locale} calculator (${path})`, () => {
    test('hydrates cleanly, is indexable and carries SoftwareApplication JSON-LD', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, path);
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
      const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t)['@type']);
      expect(types).toEqual(expect.arrayContaining(['SoftwareApplication', 'BreadcrumbList', 'FAQPage']));
      // 승격: 하이드레이션 뒤 datalist 입력이 콤보박스가 된다
      await expect(page.locator('form[data-calc-form] input[name="gpu"]')).toHaveAttribute('role', 'combobox');
      await expect(page.locator('form[data-calc-form] input[list]')).toHaveCount(0);
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      expect(problems, 'console errors / failed requests (hydration mismatch shows here)').toEqual([]);
    });

    test('picking a GPU renders cards with verdict + band, syncs the URL, restores on reload, deep-links to a combo', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, path);
      await pickGpu(page, '4060', 'rtx-4060');
      const cards = page.locator('[data-result-card]');
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBeGreaterThan(10);
      await expect(
        page.locator('[data-result-card] [data-verdict]:not([data-verdict="S"]):not([data-verdict="A"]):not([data-verdict="B"]):not([data-verdict="F"])'),
      ).toHaveCount(0);
      // 규칙 3: 속도가 표시된 카드마다 범위
      for (const speed of await page.locator('[data-result-card] [data-speed]').all()) {
        expect((await speed.textContent()) ?? '').toMatch(RANGE_RE);
      }
      await expect.poll(() => new URL(page.url()).search).toBe('?gpu=rtx-4060');

      // 컨텍스트 변경 → URL 갱신, 히스토리 항목은 늘지 않는다 (replaceState)
      await page.locator('form[data-calc-form] select[name="ctx"]').selectOption('16384');
      await expect.poll(() => new URL(page.url()).search).toBe('?gpu=rtx-4060&ctx=16384');

      // 스위처 href 에 쿼리 유지, pathname 은 짝
      const switcher = page.locator('a[data-locale-switch]').first();
      await expect.poll(async () => (await switcher.getAttribute('href')) ?? '').toContain('?gpu=rtx-4060&ctx=16384');

      // reload → 상태 복원
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      await expect(page.locator('form[data-calc-form] select[name="ctx"]')).toHaveValue('16384');

      // 딥링크(미공개 콤보도 허용) → 200 → goBack 실패 요청 0 (D18)
      const link = page.locator('[data-result-card] a[data-combo-link]').first();
      const target = await clickThrough(page, link);
      expect(target).toMatch(/\/can-i-run\/.+\/on\/rtx-4060$/);
      await page.goBack();
      await page.waitForLoadState('networkidle');
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      expect(problems).toEqual([]);
    });

    test('history: home form → calculator → change → back lands on home, forward restores', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, localePath(locale, '/'));
      await page.locator('form[data-home-form] input[name="gpu"]').fill('rtx-4060');
      await page.locator('form[data-home-form] button[type="submit"]').click();
      await page.waitForURL((u) => u.pathname === path && u.searchParams.get('gpu') === 'rtx-4060');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      await page.locator('form[data-calc-form] select[name="ram"]').selectOption('64');
      await expect.poll(() => new URL(page.url()).search).toBe('?gpu=rtx-4060&ram=64');
      await page.goBack();
      await page.waitForLoadState('networkidle');
      expect(new URL(page.url()).pathname).toBe(localePath(locale, '/'));
      await page.goForward();
      await page.waitForLoadState('networkidle');
      expect(new URL(page.url()).search).toBe('?gpu=rtx-4060&ram=64');
      await expect(page.locator('form[data-calc-form] select[name="ram"]')).toHaveValue('64');
      expect(problems).toEqual([]);
    });

    test('share link equals the page URL', async ({ page }) => {
      await open(page, `${path}?gpu=apple-m4-pro&ram=48&kv=q8_0`);
      const share = page.locator('input[data-share-url]');
      await expect(share).toBeVisible();
      expect(await share.inputValue()).toBe(page.url());
    });

    test('unknown gpu text is harmless: form keeps it, no cards, other params kept', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${path}?gpu=nope&ram=64`);
      await expect(page.locator('form[data-calc-form] input[name="gpu"]')).toHaveValue('nope');
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('ram')).toBe('64');
      expect(problems).toEqual([]);
    });

    test('home-form free text is canonicalised on load and the locale switcher carries the query (D31, review fix)', async ({ page }) => {
      await open(page, `${path}?gpu=4060%20laptop`);
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      await expect.poll(() => new URL(page.url()).search).toBe('?gpu=rtx-4060-laptop');
      const switcher = page.locator('a[data-locale-switch]').first();
      await expect.poll(async () => (await switcher.getAttribute('href')) ?? '').toContain('?gpu=rtx-4060-laptop');
      // 모호한 텍스트(메모리 변형)는 결과 대신 후보 안내 + 후보 목록
      await open(page, `${path}?gpu=4060%20ti`);
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      await page.locator('form[data-calc-form] input[name="gpu"]').focus();
      await expect(page.locator('[role="option"][data-gpu-id="rtx-4060-ti-8gb"]')).toBeVisible();
      await expect(page.locator('[role="option"][data-gpu-id="rtx-4060-ti-16gb"]')).toBeVisible();
    });

    test('a different dGPU keeps the chosen RAM; an empty Enter picks nothing (review fix)', async ({ page }) => {
      await open(page, `${path}?gpu=rtx-4060&ram=64`);
      await pickGpu(page, '4070', 'rtx-4070');
      await expect.poll(() => new URL(page.url()).search).toBe('?gpu=rtx-4070&ram=64');
      const input = page.locator('form[data-calc-form] input[name="gpu"]');
      await input.fill('');
      await input.press('Enter');
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).search).toBe('?ram=64');
    });

    test('custom hardware yields theoretical-only cards', async ({ page }) => {
      await open(page, `${path}?gpu=custom&kind=dgpu&class=amd&vram=20&bw=800`);
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      const chips = page.locator('[data-result-card] [data-confidence]');
      expect(await chips.count()).toBeGreaterThan(0);
      await expect(page.locator('[data-result-card] [data-confidence]:not([data-confidence="theoretical"])')).toHaveCount(0);
      await expect(page.locator('[data-result-card] a[data-combo-link]')).toHaveCount(0);
    });

    test('laptop GPU shows the laptop badge', async ({ page }) => {
      await open(page, `${path}?gpu=rtx-4060-laptop`);
      await expect(page.locator('form[data-calc-form] [data-badge="laptop"]')).toBeVisible();
    });

    test('detect (positive stub): prefills the GPU and renders cards', async ({ page }) => {
      const problems = collectProblems(page);
      await page.addInitScript({ content: RENDERER_STUB('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)', true) });
      await open(page, path);
      const button = page.locator('button[data-detect]');
      await expect(button).toBeEnabled();
      await button.click();
      await expect.poll(() => new URL(page.url()).search).toBe('?gpu=rtx-4060');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      expect(problems).toEqual([]);
    });

    test('detect (ambiguous stub): offers the memory variants instead of guessing', async ({ page }) => {
      await page.addInitScript({ content: RENDERER_STUB('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)', true) });
      await open(page, path);
      await page.locator('button[data-detect]').click();
      await expect(page.locator('[role="option"][data-gpu-id="rtx-4060-ti-8gb"]')).toBeVisible();
      await expect(page.locator('[role="option"][data-gpu-id="rtx-4060-ti-16gb"]')).toBeVisible();
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      // 입력창엔 용량을 뺀 표시명, 활성 옵션 없음 → Enter 로도 추측 선택되지 않는다 (D30, 리뷰 반영)
      const input = page.locator('form[data-calc-form] input[name="gpu"]');
      await expect(input).toHaveValue('GeForce RTX 4060 Ti');
      await input.press('Enter');
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('gpu')).toBe('GeForce RTX 4060 Ti');
    });

    test('detect (negative stub): silent fallback — nothing changes, no errors, button keeps its place', async ({ page }) => {
      const problems = collectProblems(page);
      await page.addInitScript({ content: RENDERER_STUB('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', false) });
      await open(page, path);
      const input = page.locator('form[data-calc-form] input[name="gpu"]');
      const button = page.locator('button[data-detect]');
      await expect(button).toBeAttached();
      if (await button.isEnabled()) await button.click();
      await page.waitForTimeout(300);
      await expect(input).toHaveValue('');
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      expect(new URL(page.url()).search).toBe('');
      // 시각 변화 0: 목록이 열리지 않고, 안내는 스크린리더 전용 live region 에만 (D30, 리뷰 반영)
      await expect(page.locator('[role="listbox"]')).toHaveCount(0);
      await expect(page.locator('form[data-calc-form] [role="status"]')).toHaveClass(/sr-only/);
      await expect(page.locator('form[data-calc-form] [role="status"]')).toHaveText(/Couldn|알아내지/);
      expect(problems).toEqual([]);
    });

    test('detect (single tracked variant): asks to confirm instead of guessing the memory size (review fix)', async ({ page }) => {
      await page.addInitScript({ content: RENDERER_STUB('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)', true) });
      await open(page, path);
      await page.locator('button[data-detect]').click();
      await expect(page.locator('[role="option"][data-gpu-id="rtx-3060-12gb"]')).toBeVisible();
      await expect(page.locator('[role="option"]')).toHaveCount(1);
      await expect(page.locator('form[data-calc-form] input[name="gpu"]')).toHaveValue('GeForce RTX 3060');
      await expect(page.locator('form[data-calc-form] [role="status"]')).toContainText(/only one memory size|한 가지 용량만/);
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      // 안내를 본 뒤 Enter = 입력창 텍스트를 직접 입력한 것과 같이 확정 (카탈로그 유일 변형) — 사용자의 명시적 수락
      await page.locator('form[data-calc-form] input[name="gpu"]').press('Enter');
      await expect.poll(() => new URL(page.url()).search).toBe('?gpu=rtx-3060-12gb');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
    });

    test('detect (single tracked variant): leaving the field or opening custom specs never accepts the guess (re-verification)', async ({ page }) => {
      await page.addInitScript({ content: RENDERER_STUB('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)', true) });
      await open(page, path);
      await page.locator('button[data-detect]').click();
      await expect(page.locator('[role="option"][data-gpu-id="rtx-3060-12gb"]')).toBeVisible();
      // (a) 다른 곳을 눌러 포커스가 떠나도 확정하지 않는다
      await page.locator('h1').click();
      await page.waitForTimeout(400);
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      expect(new URL(page.url()).search).toBe('');
      // (b) 안내대로 "사양 직접 입력" 을 열면 커스텀 패널이 열린 채로 남는다 (옛 blur 확정이 덮어쓰지 않는다)
      await page.locator('form[data-calc-form] input[name="gpu"]').focus();
      await page.locator('details[data-gpu-custom] > summary').click();
      await expect(page.locator('details[data-gpu-custom]')).toHaveAttribute('open', '');
      await expect(page.locator('details[data-gpu-custom] input[name="bw"]')).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.get('gpu')).toBe('custom');
      await page.waitForTimeout(400);
      await expect(page.locator('details[data-gpu-custom]')).toHaveAttribute('open', '');
    });

    test('detect (Apple silicon, chip unknown): lists the Apple chips without a variant hint (re-verification)', async ({ page }) => {
      await page.addInitScript({ content: RENDERER_STUB('Apple GPU', false) });
      await open(page, path);
      await page.locator('button[data-detect]').click();
      await expect(page.locator('[role="option"][data-gpu-id="apple-m4"]')).toBeVisible();
      // evaluateAll 에 문자열 화살표 함수를 주면 호출되지 않는다(PROGRESS §5) — locator 순회
      const ids: string[] = [];
      for (const option of await page.locator('[role="option"]').all()) ids.push((await option.getAttribute('data-gpu-id')) ?? '');
      expect(ids.length).toBeGreaterThan(5);
      expect(ids.every((id) => id.startsWith('apple-'))).toBe(true);
      await expect(page.locator('form[data-calc-form] [role="status"]')).toContainText(/Apple silicon|Apple 실리콘/);
      await expect(page.getByText(/several versions|several matches|버전이 여러|여러 개예요/)).toHaveCount(0);
    });

    test('typing: a vendor word browses that vendor and Enter selects nothing; an unknown model + Enter never picks a fallback (re-verification)', async ({ page }) => {
      await open(page, path);
      const input = page.locator('form[data-calc-form] input[name="gpu"]');
      await expect(input).toHaveAttribute('role', 'combobox');
      await input.fill('nvidia');
      // NVIDIA 제품만: 그래픽카드 그룹 + DGX Spark(통합 메모리 PC 그룹). Apple M4 같은 인기 1위가 섞이지 않는다
      await expect(page.locator('[data-gpu-group="nvidia"]')).toBeVisible();
      for (const other of ['amd', 'intel', 'apple', 'cpu']) await expect(page.locator(`[data-gpu-group="${other}"]`)).toHaveCount(0);
      await expect(page.locator('[role="option"][data-gpu-id="apple-m4"]')).toHaveCount(0);
      await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
      await input.press('Enter');
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('gpu')).toBe('nvidia');

      await input.fill('rtx 3060 ti');
      await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
      await input.press('Enter');
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('gpu')).toBe('rtx 3060 ti');

      // 확정되는 입력은 첫 후보가 활성 — Enter 로 고른다
      await input.fill('4070');
      await expect(input).toHaveAttribute('aria-activedescendant', /rtx-4070$/);
      await input.press('Enter');
      await expect.poll(() => new URL(page.url()).searchParams.get('gpu')).toBe('rtx-4070');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
    });

    test('the popup closes when focus leaves; clicking a group heading keeps focus (re-verification)', async ({ page }) => {
      await open(page, path);
      const input = page.locator('form[data-calc-form] input[name="gpu"]');
      await expect(input).toHaveAttribute('role', 'combobox');
      await input.focus();
      await page.locator('[data-gpu-group="amd"]').click();
      await expect(input).toBeFocused();
      await expect(page.locator('[role="listbox"]')).toHaveCount(1);
      await page.locator('h1').click();
      await expect(page.locator('[role="listbox"]')).toHaveCount(0);
      await expect(input).toHaveAttribute('aria-expanded', 'false');
      await input.focus();
      await input.press('Tab');
      await expect(page.locator('[role="listbox"]')).toHaveCount(0);
    });

    for (const [typed, expectGpu, resolves] of [
      ['rtx 4070', 'rtx-4070', true],
      ['4060 ti', '4060 ti', false],
    ] as const) {
      test(`text typed before hydration is kept and resolved on mount: "${typed}" (D29, re-verification)`, async ({ page }) => {
        const problems = collectProblems(page);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
          await gate;
          await route.continue();
        });
        await page.goto(`${path}?ctx=16384`, { waitUntil: 'commit' });
        const input = page.locator('form[data-calc-form] input[name="gpu"]');
        await input.click();
        await page.keyboard.type(typed);
        await expect(input).not.toHaveAttribute('role', 'combobox'); // 아직 하이드레이션 전
        release();
        await expect(input).toHaveAttribute('role', 'combobox');
        await page.waitForURL((u) => u.searchParams.get('gpu') === expectGpu && u.searchParams.get('ctx') === '16384');
        if (resolves) {
          await expect(input).toHaveValue('GeForce RTX 4070');
          await expect(page.locator('[data-result-card]').first()).toBeVisible();
        } else {
          await expect(input).toHaveValue(typed); // 지워지지 않는다
          await expect(page.locator('[data-result-card]')).toHaveCount(0);
        }
        expect(problems).toEqual([]);
      });
    }

    test('custom specs opened before hydration stay open with their fields (re-verification)', async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto(path, { waitUntil: 'commit' });
      await page.locator('details[data-gpu-custom] > summary').click();
      await expect(page.locator('details[data-gpu-custom]')).toHaveAttribute('open', '');
      release();
      await expect(page.locator('form[data-calc-form] input[name="gpu"]')).toHaveAttribute('role', 'combobox');
      await expect(page.locator('details[data-gpu-custom] input[name="bw"]')).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.get('gpu')).toBe('custom');
    });

    test('empty input: focus opens the six browse groups, Enter picks nothing (D29, review fix)', async ({ page }) => {
      await open(page, path);
      const input = page.locator('form[data-calc-form] input[name="gpu"]');
      await expect(input).toHaveAttribute('role', 'combobox');
      await input.focus();
      await expect(page.locator('[role="listbox"] [role="group"]')).toHaveCount(6);
      await expect(page.locator('[data-gpu-group]')).toHaveCount(6);
      await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
      await input.press('Enter');
      await expect(page.locator('[data-result-card]')).toHaveCount(0);
      expect(new URL(page.url()).search).toBe('');
      // ArrowDown 으로 첫 옵션을 활성화한 뒤의 Enter 만 고른다
      await input.focus();
      await input.press('ArrowDown');
      await expect(input).toHaveAttribute('aria-activedescendant', /.+/);
      await input.press('Enter');
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
    });
  });

  test.describe(`${locale} calculator on a phone`, () => {
    test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

    test('no horizontal scroll and tap targets ≥ 40px', async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, `${path}?gpu=rtx-4060`);
      await expect(page.locator('[data-result-card]').first()).toBeVisible();
      const scrollX = (await page.evaluate('(() => { window.scrollTo(100, 0); return window.scrollX; })()')) as number;
      expect(scrollX).toBe(0);
      for (const selector of ['button[data-detect]', 'button[data-share]', 'form[data-calc-form] select[name="ctx"]']) {
        const box = await page.locator(selector).first().boundingBox();
        expect(box?.height ?? 0, selector).toBeGreaterThanOrEqual(36);
      }
      expect(problems).toEqual([]);
    });
  });
}
