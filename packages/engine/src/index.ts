/**
 * CanRun 계산 엔진 — 공개 진입점. 명세: docs/02-engine-spec.md.
 *
 * 불변식 (CLAUDE.md 규칙 1·6, purity.test.ts 가 강제):
 *  - 런타임 의존성 0, 순수 함수만 — Date/random/네트워크/파일 접근 금지
 *  - 상수는 전부 `// source:` 주석 동반 (constants.ts)
 *  - 포맷팅(단위·소수점·로케일)은 UI 레이어 책임 — 숫자만 반환
 *  - 결정론: 같은 입력 → 같은 출력
 */

import type { EvaluateOptions, Hardware, ModelQuant, Result } from './types';

export * from './types';
export * from './constants';
export * from './memory';
export * from './fit';
export * from './speed';
export * from './verdict';

/** 엔진 스펙 버전 — docs/02-engine-spec.md 개정 시 함께 올린다. */
export const ENGINE_SPEC_VERSION = '0.2.0';

/**
 * 종합 평가: fit(§2.4) → speed(§3) → confidence/밴드(§4) → verdict(§5) 조립.
 * 기본값: ctx 8192, kvQuant 'f16' (§5 판정 기준 조건).
 */
export function evaluate(_hw: Hardware, _mq: ModelQuant, _opts?: EvaluateOptions): Result {
  throw new Error('not implemented');
}
