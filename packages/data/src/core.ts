/**
 * 코어 타입 + 카탈로그 요약(lite) — 조립 함수(assess·combo·snippet)가 실제로 읽는 필드만 (P1-3 결정 D27).
 *
 * 서버는 zod 로 검증한 전체 레코드(`schema.ts`)를 쓰고, 계산기 아일랜드는 `toCatalogLite()` 결과를
 * props 로 받는다 — `sources`·`note` 같은 문서용 필드는 브라우저로 나가지 않는다(예외로 보내는 공개 값: `hfId` D57, `msrpUSD` D65, `hfDownloads30d`·`hfDownloadsAsOf` D68).
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
  // 구성별 대역폭(10-20 — Apple M6 16GB) — 계산기도 `hardwareConfigs` 로 같은 값을 쓴다
  'memBandwidthByRam',
  // 구성별 GPU 사용 가능 메모리(10-23 D117 — DGX Spark) — 계산기도 `hardwareConfigs` 로 같은 값을 쓴다
  'usableGBByRam',
  // 여러 대 연결(10-23 D118 — DGX Spark) — 계산기의 대수 선택. lite 에는 문서용 sources 를 빼고 보낸다(`toCatalogLite`)
  'cluster',
  // 대표 메모리 구성(10-23 D120 — DGX Spark 128GB) — 계산기 '상세' 링크·모델 모드 목록이 콤보 페이지와 같은 구성을 고른다(`pickConfigCombo`)
  'primaryRamGB',
  'fp16Tflops',
  // pp 추정의 행렬 FP16(10-16 D91 — AMD)
  'fp16MatrixTflops',
  'effClass',
  // 계산기의 pp 추정(10-16 D86 — M5 계열 Neural Accelerator 계수)
  'neuralAccelerators',
  'popular',
  'streetUSD',
  'priceAsOf',
  // 계산기 모델 모드(10-03 D65)가 모델 허브 표처럼 "출시가"를 보인다 — 공개 가격(허브 HTML 에도 나온다), 순위·예산에는 쓰지 않는다
  'msrpUSD',
] as const satisfies readonly (keyof Gpu)[];

export const MODEL_CORE_KEYS = [
  'id',
  'name',
  // 계산기 "목록에 없는 모델"(D57)이 HF 주소가 카탈로그 모델이면 그 카드로 안내한다
  'hfId',
  'paramsB',
  'activeParamsB',
  'arch',
  'maxContext',
  'license',
  'moe',
  'nonExpertGB',
  'category',
  'thinking',
  'korean',
  'popularity',
  // 계산기 "다운로드 많은 순" 정렬·카드 줄(10-06 D68) — HF 공개 수치와 그 기준일(공개 값, 문서 필드 아님)
  'hfDownloads30d',
  'hfDownloadsAsOf',
] as const satisfies readonly (keyof Model)[];

/**
 * expertGB·nonExpertGB — MoE 헤더 실측 분할(10-01), valueExpertGB — 값 전문가(MoVA, 10-21 D113), offGpuGB — dense 헤더 실측 GPU 밖 몫(10-03 D62),
 * pleGB — 층별 임베딩 표(10-21 D112), mtpGB — MTP 블록 크기(안내문), loopGB — 반복 층 모델의 반복 블록(10-22 D114). 계산기 아일랜드의 fit·속도 판정이 읽는다
 */
export const MODEL_QUANT_CORE_KEYS = ['modelId', 'quant', 'fileGB', 'expertGB', 'nonExpertGB', 'valueExpertGB', 'offGpuGB', 'pleGB', 'mtpGB', 'loopGB', 'ggufRepo', 'fileName'] as const satisfies readonly (keyof ModelQuantRecord)[];

export const QUANT_DEF_CORE_KEYS = ['id', 'bpw', 'tier'] as const satisfies readonly (keyof QuantDef)[];

export const BENCH_CORE_KEYS = ['gpuId', 'modelId', 'quant', 'ctx', 'tgTokS'] as const satisfies readonly (keyof BenchPoint)[];

/** 여러 대 연결 정보 중 조립 함수가 읽는 몫 (10-23 D118) — 전체 레코드의 `cluster` 는 sources 가 더 있어 이 타입에 대입된다 */
export type ClusterCore = Omit<NonNullable<Gpu['cluster']>, 'sources'>;
export type GpuCore = Omit<Pick<Gpu, (typeof GPU_CORE_KEYS)[number]>, 'cluster'> & { cluster?: ClusterCore };
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
 * 전체 카탈로그 → 요약. 서버(빌드)에서 1회. 조인할 수 없는 실측은 버린다 — 카탈로그 밖 캘리브레이션 실측(gpuId 없음)과,
 * (모델, quant)가 model-quants 행에 없는 실측(Q4_K_XL 등 — `measuredPoints` 는 행의 quant 와 정확 일치만 붙인다).
 * 그런 실측은 서버가 그리는 실측 표에만 쓰인다 (10-16 D92 — 실측 92건 추가로 9 KiB 예산을 넘지 않게).
 * 키 순서가 입력 순서·상수 순서로 결정되므로 직렬화 결과도 결정적이다 (D21 빌드 결정성).
 */
export function toCatalogLite(seed: CatalogCore): CatalogLite {
  const rowKeys = new Set(seed.modelQuants.map((r) => `${r.modelId}\u0000${r.quant}`));
  return {
    gpus: seed.gpus.map((g) => {
      const core = pick(g, GPU_CORE_KEYS);
      if (!g.cluster) return core;
      // 문서용 sources 는 브라우저로 보내지 않는다(위 머리 주석) — 키 순서는 상수 순서 그대로
      const { maxNodes, directMaxNodes, linkGbps } = g.cluster;
      return { ...core, cluster: { maxNodes, directMaxNodes, linkGbps } };
    }),
    models: seed.models.map((m) => pick(m, MODEL_CORE_KEYS)),
    modelQuants: seed.modelQuants.map((r) => pick(r, MODEL_QUANT_CORE_KEYS)),
    quantDefs: seed.quantDefs.map((q) => pick(q, QUANT_DEF_CORE_KEYS)),
    benchmarks: seed.benchmarks
      .filter((b) => b.gpuId !== undefined && rowKeys.has(`${b.modelId}\u0000${b.quant}`))
      .map((b) => pick(b, BENCH_CORE_KEYS)),
  };
}
