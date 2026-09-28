/**
 * Playwright 스모크 (docs/05 §6 — 대표 페이지 3종 × 2언어, P1-1).
 * 대상은 `pnpm build` 산출물을 scripts/serve-out.ts 로 띄운 정적 사이트 — 빌드가 먼저다.
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const isCI = Boolean(process.env.CI);

export default defineConfig({
  // 기본값(루트)이면 vitest 의 *.test.ts 까지 집어간다
  testDir: './e2e',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm serve-out',
    url: `${BASE_URL}/`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
