import { defineConfig } from 'vitest/config';

// 빌드 산출물(apps/web/out) 불변식 검증 — `pnpm build` 이후에만 유효하다.
export default defineConfig({
  test: {
    include: ['test/export-invariants.spec.ts'],
    // 콤보 포함 ~3,300 페이지: beforeAll 의 페이지 facts 추출(D17)과 전수 불변식이 기본 5s/10s 를 넘는다
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
