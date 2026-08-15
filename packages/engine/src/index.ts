/**
 * CanRun 계산 엔진 — 공개 진입점.
 *
 * P0-1 스캐폴드 상태: 구조와 불변식만 고정하고, 실제 공식·상수는 P0-2에서 작성한다.
 * 구현 명세는 `docs/02-engine-spec.md`, 테스트 기대값이 곧 스펙(§7~8).
 *
 * 이 패키지의 불변식 (CLAUDE.md 규칙 1·6):
 *  - 런타임 의존성 0 (test/smoke.test.ts 가 강제)
 *  - 순수 함수만 — Date/random/네트워크/파일 접근 금지
 *  - 상수는 전부 `// source: URL` 주석 동반 (constants.ts, P0-2)
 *  - 포맷팅(단위·소수점·로케일)은 UI 레이어 책임
 *
 * P0-2에서 추가될 모듈:
 *  - src/constants.ts  출처 주석 달린 상수 (bpw, KV 오버헤드, 효율계수 …)
 *  - src/memory.ts     가중치·KV 캐시·버퍼 메모리 계산
 *  - src/fit.ts        VRAM/RAM 적재 판정, 부분 오프로드 레이어 수
 *  - src/speed.ts      pp/tg tok/s 추정 + 신뢰 밴드
 *  - src/verdict.ts    S/A/B/F 등급 산출 (docs/01 §3)
 */

/** 엔진 스펙 버전 — docs/02-engine-spec.md 개정 시 함께 올린다. */
export const ENGINE_SPEC_VERSION = '0.0.0-scaffold';

/**
 * 추정치 신뢰 라벨 (docs/01 §3, CLAUDE.md 규칙 3).
 * 모든 수치 결과는 이 라벨과 밴드를 동반해야 하며, 단정 표현은 금지한다.
 */
export type Confidence = 'measured' | 'calibrated' | 'theoretical';

/** 신뢰 라벨별 기본 오차 밴드(±비율). measured 는 실측이므로 밴드를 별도 산출한다. */
export const CONFIDENCE_BAND: Readonly<Record<Exclude<Confidence, 'measured'>, number>> = Object.freeze({
  calibrated: 0.15,
  theoretical: 0.3,
});

/** 판정 등급 (docs/01 §3). */
export type Verdict = 'S' | 'A' | 'B' | 'F';
