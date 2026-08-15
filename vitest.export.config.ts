import { defineConfig } from 'vitest/config';

// 빌드 산출물(apps/web/out) 불변식 검증 — `pnpm build` 이후에만 유효하다.
export default defineConfig({
  test: {
    include: ['test/export-invariants.spec.ts'],
  },
});
