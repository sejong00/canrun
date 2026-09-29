/**
 * 브라우저 진입점 `@canrun/data/client` (P1-3 결정 D26) — `index.ts` 와 달리 zod·schemaRegistry·parse*·
 * validateAll 이 없다. 여기서 도달 가능한 모듈은 전부 순수(모듈 최상위 부수효과 0)여야 하며,
 * 외부 의존성은 `@canrun/engine` 뿐이다 — `test/client-entry.test.ts` 가 import 그래프로 강제한다.
 * 서버 코드는 계속 `@canrun/data` 를 쓴다(같은 함수·같은 타입).
 */

export * from './core';
export * from './assess';
export * from './combo';
export * from './snippet';
export * from './publish';
export * from './license';
export * from './derive';
export type {
  BenchPoint,
  Gpu,
  Model,
  ModelQuantRecord,
  PublishPlan,
  QuantDef,
} from './schema';
