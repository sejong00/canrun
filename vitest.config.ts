import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 유닛 테스트 (packages/*, scripts, apps/web/test). 빌드 산출물 검증은 vitest.export.config.ts,
// 브라우저 E2E(e2e/**)는 Playwright 담당 — 여기에 포함하지 않는다.
export default defineConfig({
  resolve: {
    // apps/web 의 tsconfig paths (`@/*` → apps/web/*) 와 동일
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'scripts/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 커버리지 게이트는 엔진 패키지 대상 (docs/06 P0-2 AC: 90%+)
      include: ['packages/engine/src/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 90,
      },
    },
  },
});
