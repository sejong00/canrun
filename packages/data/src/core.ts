/**
 * 코어 타입 + 카탈로그 요약(lite) — 조립 함수(assess·combo·snippet)가 실제로 읽는 필드만 (P1-3 결정 D27).
 *
 * 서버는 zod 로 검증한 전체 레코드(`schema.ts`)를 쓰고, 계산기 아일랜드는 `toCatalogLite()` 결과를
 * props 로 받는다 — `sources`·`note`·`hfId` 같은 문서용 필드는 브라우저로 나가지 않는다.
 * 전체 레코드는 코어 타입에 구조적으로 대입되므로 허브·콤보 호출부는 그대로다.
 * 순수·브라우저 안전 (zod 는 type-only 로만 참조).
 */

import type { BenchPoint, Gpu, Model, ModelQuantRecord, QuantDef } from './schema';

export const GPU_CORE_KEYS = [
  'id',
  'name',
  'aliases',
  'vendor',
  'kind',
  'form',
  'vramGB',
  'ramOptionsGB',
  'memBandwidthGBs',
  'fp16Tflops',
  'effClass',
  'popular',
  'streetUSD',
  'priceAsOf',
] as const satisfies readonly (keyof Gpu)[];

export const MODEL_CORE_KEYS = [
  'id',
  'name',
  'paramsB',
  'activeParamsB',
  'arch',
  'maxContext',
  'license',
  'moe',
  'nonExpertGB',
  'category',
  'korean',
  'popularity',
] as const satisfies readonly (keyof Model)[];

export const MODEL_QUANT_CORE_KEYS = ['modelId', 'quant', 'fileGB', 'ggufRepo', 'fileName'] as const satisfies readonly (keyof ModelQuantRecord)[];

export const QUANT_DEF_CORE_KEYS = ['id', 'bpw', 'tier'] as const satisfies readonly (keyof QuantDef)[];

export const BENCH_CORE_KEYS = ['gpuId', 'modelId', 'quant', 'ctx', 'tgTokS'] as const satisfies readonly (keyof BenchPoint)[];

export type GpuCore = Pick<Gpu, (typeof GPU_CORE_KEYS)[number]>;
export type ModelCore = Pick<Model, (typeof MODEL_CORE_KEYS)[number]>;
export type ModelQuantCore = Pick<ModelQuantRecord, (typeof MODEL_QUANT_CORE_KEYS)[number]>;
export type QuantDefCore = Pick<QuantDef, (typeof QUANT_DEF_CORE_KEYS)[number]>;
export type BenchPointCore = Pick<BenchPoint, (typeof BENCH_CORE_KEYS)[number]>;

/** 조립 함수가 받는 최소 카탈로그 — `SeedCatalog`(전체 레코드)는 이에 대입 가능하다. */
export type CatalogCore = {
  gpus: readonly GpuCore[];
  models: readonly ModelCore[];
  modelQuants: readonly ModelQuantCore[];
  quantDefs: readonly QuantDefCore[];
  benchmarks: readonly BenchPointCore[];
};

/** 계산기 아일랜드 props — 직렬화 가능한 평범한 객체 (Flight 인라인) */
export type CatalogLite = {
  gpus: GpuCore[];
  models: ModelCore[];
  modelQuants: ModelQuantCore[];
  quantDefs: QuantDefCore[];
  benchmarks: BenchPointCore[];
};

/** 값이 undefined 인 키는 생략 — Flight 는 undefined 를 "$undefined" 로 직렬화한다 */
function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * 전체 카탈로그 → 요약. 서버(빌드)에서 1회. 카탈로그 밖 캘리브레이션 실측(gpuId 없음)은 조인 불가라 버린다.
 * 키 순서가 입력 순서·상수 순서로 결정되므로 직렬화 결과도 결정적이다 (D21 빌드 결정성).
 */
export function toCatalogLite(seed: CatalogCore): CatalogLite {
  return {
    gpus: seed.gpus.map((g) => pick(g, GPU_CORE_KEYS)),
    models: seed.models.map((m) => pick(m, MODEL_CORE_KEYS)),
    modelQuants: seed.modelQuants.map((r) => pick(r, MODEL_QUANT_CORE_KEYS)),
    quantDefs: seed.quantDefs.map((q) => pick(q, QUANT_DEF_CORE_KEYS)),
    benchmarks: seed.benchmarks
      .filter((b) => b.gpuId !== undefined)
      .map((b) => pick(b, BENCH_CORE_KEYS)),
  };
}
