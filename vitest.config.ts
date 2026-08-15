import { defineConfig } from 'vitest/config';

// 유닛 테스트 (packages/*, scripts). 빌드 산출물 검증은 vitest.export.config.ts.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
