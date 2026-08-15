/**
 * CanRun 데이터 계층 — `data/*.json` 의 zod 스키마와 로더.
 *
 * P0-1 스캐폴드 상태: 레지스트리 배선만 두고, 실제 스키마·시드는 P0-3에서 작성한다.
 * 스키마 명세는 `docs/03-data-spec.md` §1~4.
 *
 * 불변식 (CLAUDE.md 규칙 2):
 *  - 모든 데이터 레코드는 `sources[]` 필수 — zod 가 강제한다.
 *  - 실거래가는 `priceAsOf` 없이 표시 금지.
 *  - 미출시(rumor) 하드웨어 레코드 등록 금지.
 */

import type { ZodType } from 'zod';

/** 저장소 루트 기준 데이터 디렉터리. */
export const DATA_DIR = 'data';

/**
 * `data/<파일명>` → 해당 파일 전체(보통 레코드 배열)를 검증하는 스키마.
 *
 * P0-3 에서 gpus / models / model-quants / quants / benchmarks / prices / aliases 를 등록한다.
 * `scripts/validate-data.ts` 가 이 레지스트리를 순회하므로, 스키마를 등록하는 순간
 * CI 데이터 검증 게이트가 자동으로 동작한다(출처 없는 레코드 = 빌드 실패).
 */
export const schemaRegistry: Readonly<Record<string, ZodType>> = Object.freeze({});

/** 레지스트리에 등록된 데이터 파일명 목록. */
export function registeredDataFiles(): readonly string[] {
  return Object.keys(schemaRegistry);
}
