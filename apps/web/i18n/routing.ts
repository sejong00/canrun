import { defineRouting } from 'next-intl/routing';

/**
 * docs/04 §6 — en 은 루트(`/`), ko 는 `/ko/` 서브디렉터리.
 *
 * `localePrefix: 'as-needed'` 는 next-intl 이 링크를 생성할 때 기본 로케일(en)의
 * 프리픽스를 붙이지 않게 한다. next-intl 공식 가이드는 static export 에서
 * `'always'` 를 권장하지만(프리픽스 없는 URL을 middleware 가 처리해야 하므로),
 * CanRun 은 middleware 없이 **빌드 산출물을 평탄화**해 같은 결과를 만든다.
 * 근거·검증: docs/05 §1 "i18n 스파이크 결정 기록", scripts/postbuild.ts,
 * test/export-invariants.spec.ts.
 */
export const routing = defineRouting({
  locales: ['en', 'ko'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
