import { defineConfig } from 'vitest/config';

// 유닛 테스트 (packages/*, scripts). 빌드 산출물 검증은 vitest.export.config.ts.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'scripts/**/*.test.ts'],
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
