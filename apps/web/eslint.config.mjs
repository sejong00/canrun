// eslint-config-next 16 은 flat config 를 직접 제공한다 (FlatCompat 불필요).
import { fixupConfigRules } from '@eslint/compat';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * 클라이언트 청크에 실리는 파일 (P1-3 결정 D26·D27·D36). 값 import 로 끌어오면 안 되는 것:
 * next-intl(프로바이더 없음)·`@canrun/data` 배럴(zod)·서버 전용 lib·tailwind-merge(`cn`)·next 라우터.
 * 타입 import 는 허용(빌드에서 지워진다). 전이적 그래프는 apps/web/test/client-graph.test.ts 가 검사한다.
 */
const CLIENT_FILES = [
  'components/islands/**/*.{ts,tsx}',
  'components/verdict-chip.tsx',
  'components/pill.tsx',
  'components/speed-text.tsx',
  'components/ui/button-variants.ts',
  'lib/calc/**/*.ts',
  'lib/i18n-lite.ts',
  'lib/hydration.ts',
  'lib/phrases.ts',
  'lib/format.ts',
];

const config = [
  {
    ignores: ['.next/**', 'out/**', 'next-env.d.ts'],
  },
  // eslint 10 은 context.getFilename 등 옛 API 를 없앴다 — 아직 그걸 쓰는 플러그인(react·import·jsx-a11y)을 공식 호환 래퍼로 감싼다
  ...fixupConfigRules(nextCoreWebVitals),
  ...fixupConfigRules(nextTypescript),
  {
    files: CLIENT_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'next-intl', allowTypeImports: true, message: '클라이언트엔 프로바이더가 없다 — lib/i18n-lite makeT (D6·D27)' },
            { name: 'next-intl/server', message: '서버 전용' },
            { name: '@canrun/data', allowTypeImports: true, message: 'zod 배럴 — @canrun/data/client 를 쓴다 (D26)' },
            { name: '@/lib/utils', message: 'tailwind-merge 106KB — 클래스는 문자열로 (D36)' },
            { name: 'tailwind-merge', message: 'D36' },
            { name: 'zod', message: 'D26' },
            { name: '@/lib/catalog', message: '서버 전용 (전체 시드 JSON)' },
            { name: '@/lib/hubs', message: '서버 전용' },
            { name: '@/lib/combos', message: '서버 전용' },
            { name: '@/lib/publish', message: '서버 전용' },
            { name: '@/lib/client-messages', message: '서버 전용' },
            { name: '@/components/badges', message: '훅 사용 — @/components/pill' },
            { name: '@/components/verdict', message: '훅 사용 — @/components/verdict-chip' },
            { name: '@/components/estimate', message: '훅 사용 — @/components/speed-text' },
            { name: '@/components/hub-table', message: '훅·cn 사용' },
            { name: '@/components/ui/button', message: 'cn 사용 — @/components/ui/button-variants' },
            { name: '@/i18n/navigation', message: 'createNavigation 은 intl-messageformat 을 끌어온다 (D6)' },
            { name: 'next/link', message: 'RSC 페이로드는 postbuild 가 지운다 (D18)' },
            { name: 'next/navigation', message: 'D18 — history.replaceState / popstate 만' },
            { name: 'next/dynamic', message: '서버 컴포넌트에서 ssr:false 불가 — 아일랜드 안 import()' },
          ],
          patterns: [
            { group: ['next-intl/*'], allowTypeImports: true, message: 'D6' },
            { group: ['node:*'], message: '브라우저 코드' },
          ],
        },
      ],
    },
  },
  {
    // 마운트 시 URL → 상태 복원 1곳 (D36) — 나머지 react-hooks 7 규칙은 그대로 error
    files: ['components/islands/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
