// 루트 ESLint — 핵심은 packages/engine/src 순수성 게이트 (CLAUDE.md 규칙 6, docs/02 §8-4).
// 문자열 스캔 테스트를 AST 룰로 대체 (외부 리뷰 반영): 따옴표 변형·우회 표기에 견고.
// apps/web 은 자체 eslint.config.mjs (next 플러그인) 로 별도 실행된다.
import tseslint from 'typescript-eslint';

const config = [
  {
    ignores: [
      'apps/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/out/**',
      'coverage/**',
      'data/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: { parser: tseslint.parser },
  },
  {
    // ---- 엔진 순수성 게이트 ------------------------------------------------
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // 상대 경로('.'로 시작) 외 모든 import 금지 — 의존성 0 (규칙 6)
          selector: "ImportDeclaration[source.value=/^[^.]/]",
          message: 'engine src must only import relative modules (zero-dependency rule).',
        },
        {
          selector: 'ImportExpression',
          message: 'no dynamic import in engine src (purity/determinism).',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'no Date in engine src (determinism — docs/02 §8-4).',
        },
        {
          selector: "MemberExpression[object.name='Date']",
          message: 'no Date.* in engine src (determinism — docs/02 §8-4).',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'no Math.random in engine src (determinism — docs/02 §8-4).',
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: 'no require in engine src (zero-dependency rule).',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'crypto', message: 'no crypto in engine src (purity).' },
        { name: 'performance', message: 'no performance.now in engine src (determinism).' },
        { name: 'fetch', message: 'no network access in engine src (purity).' },
        { name: 'process', message: 'no process access in engine src (purity).' },
        { name: 'XMLHttpRequest', message: 'no network access in engine src (purity).' },
      ],
    },
  },
];

export default config;
