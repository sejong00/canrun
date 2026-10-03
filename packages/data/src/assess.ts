/**
 * 허브·콤보 판정 조립 — 엔진(`@canrun/engine`) 위의 데이터 레이어 (docs/01 §3 허브 판정 규칙).
 *
 * 엔진은 (하드웨어 1개, 모델×quant 1개) 를 평가할 뿐이다. 여기서는 카탈로그 레코드를
 * 엔진 입력으로 바꾸고, 등록 quant 전체를 평가해 "기준 판정·추천 quant·실측 조인·신뢰 라벨"을
 * 결정한다. 엔진 상수는 건드리지 않는다(CLAUDE.md 규칙 1) — 여기의 값은 전부 정책이다.
 *
 * 순수·브라우저 안전: fs·Date·random 없음. 포맷팅(단위·반올림·로케일)은 UI 레이어 몫(규칙 6).
 */

import {
  computeBufferGB,
  EFF,
  evaluate,
  fit,
  gpuResidentGBFor,
  kvGB,
  usableGB,
  usableRamGB,
  VERDICT_THRESHOLDS,
  verdictOf,
  weightsGB,
  type FitResult,
  type Hardware,
  type KvQuant,
  type Mode,
  type ModelQuant,
  type Os,
  type QuantId,
  type Result,
  type Verdict,
} from '@canrun/engine';
import type {
  BenchPointCore,
  CatalogCore,
  GpuCore,
  ModelCore,
  ModelQuantCore,
  QuantDefCore,
} from './core';
import type { BenchPoint, Gpu, Model, ModelQuantRecord, QuantDef } from './schema';

/**
 * 허브 판정 정책 — 한 곳에 모은다 (docs/01 §3, 계획 단계 결정 D2·D4 — docs/PROGRESS.md §4).
 */
// source: docs/01 §3 (policy)
const DGPU_RAM_GB = 32;
// source: docs/01 §3 (policy)
const RAM_HINT_GB = [64, 96, 128] as const;
// source: docs/01 §3 (policy)
export const HUB_POLICY = Object.freeze({
  /** dGPU 허브의 시스템 RAM 가정 (GB) */
  dgpuRamGB: DGPU_RAM_GB,
  /** dGPU 시스템 RAM 대역폭은 이 CPU 프로필(gpus.json)에서 조회 — 매직넘버 금지 */
  dgpuRamProfileId: 'cpu-ddr5-5600-2ch',
  /** dGPU 는 Windows 디스플레이 GPU 가정 (osReserve 0.6GB, docs/02 §2.3) */
  dgpuOs: 'windows' as const,
  /** RAM 업그레이드 힌트 후보 (GB, 오름차순) */
  ramHintGB: RAM_HINT_GB,
  /**
   * dGPU 콤보 페이지 "시스템 RAM 용량별 판정" 계단 (GB, 오름차순 — 10-03 D64): 가장 흔한 저사양 16GB(실측 리그도 16GB)
   * + 가정값 + RAM 힌트 후보. 따로 적지 않고 유도해 가정값·힌트와 어긋나지 않게 한다
   */
  comboRamGB: [16, DGPU_RAM_GB, ...RAM_HINT_GB] as readonly number[],
  /** 판정 기준 컨텍스트 (docs/02 §5) */
  referenceCtx: 8192,
  /** "최대 컨텍스트" 계단 — 기준 8k 부터 */
  ctxLadder: [8192, 16384, 32768, 65536, 131072, 262144] as const,
  /** 모델 허브 quant × ctx 메모리 행렬의 열 */
  matrixCtx: [4096, 8192, 16384, 32768, 65536, 131072, 262144] as const,
  /** 기준 quant 우선순위 — 없으면 Q4_K_M bpw 최근접 등록 quant */
  baselineOrder: ['Q4_K_M', 'MXFP4'] as readonly QuantId[],
  /** GGUF 출처 "llama.cpp 팀" 으로 분류하는 HF org (결정 D3) */
  llamaCppOrgs: ['ggml-org'] as readonly string[],
  /**
   * 추정을 theoretical 로 고정하는 모델 — llama.cpp 구동이 검증되지 않은 커스텀 아키텍처(PROGRESS §5), 또는 구동은 되지만
   * 속도 모델(대역폭 계수)이 검증되지 않은 상수 상태 층 하이브리드(Mamba2·short-conv·KDA+MLA — 10-03 D63, 실측이 생기면 뺀다)
   */
  unverifiedArchModelIds: [
    'hyperclovax-seed-think-14b',
    'nemotron-3.5-lightning-30b-a3b',
    'lfm2.5-2.6b',
    'ling-3.0-tiny',
    'ling-3.0-flash',
  ] as readonly string[],
  /** FP16 크리플 GPU(GTX 10 등, docs/01 §9) — 클래스 계수 검증 범위 밖이라 theoretical */
  fp16CrippledBelowTflops: 1,
  /** GPU 허브 FAQ 의 "70B급" 대표 모델 */
  referenceLargeModelId: 'llama-3.3-70b',
  /** 모델 허브 FAQ 의 VRAM 대표 카드 (8 / 16 / 24 GB) */
  referenceGpuIds: ['rtx-4060', 'rtx-5060-ti-16gb', 'rtx-3090'] as readonly string[],
  /**
   * 손실이 더 큰 양자화 파일이 더 나은 양자화 파일 크기의 이 비율 이상이면 모델 허브가 더 나은 쪽을 받으라고 안내한다
   * (`sameSizeQuant` — 10-03 D63 후속: Nemotron 3.5 Lightning Q2_K 18.91GB = IQ4_XS 18.92GB. 행을 지우면 sync 가 다시 넣는다)
   */
  sameSizeQuantRatio: 0.95,
});

export type QuantTier = QuantDefCore['tier'];

/** 양자화 품질 등급 서열: desperate < degraded < ok < safe */
const TIER_RANK: Readonly<Record<QuantTier, number>> = Object.freeze({ desperate: 0, degraded: 1, ok: 2, safe: 3 });

/** 판정 서열: F < B < A < S */
const VERDICT_RANK: Readonly<Record<Verdict, number>> = Object.freeze({ F: 0, B: 1, A: 2, S: 3 });

export function verdictRank(verdict: Verdict): number {
  return VERDICT_RANK[verdict];
}

export type SeedCatalog = {
  gpus: readonly Gpu[];
  models: readonly Model[];
  modelQuants: readonly ModelQuantRecord[];
  quantDefs: readonly QuantDef[];
  benchmarks: readonly BenchPoint[];
};

// ---------------------------------------------------------------------------
// 엔진 입력 어댑터
// ---------------------------------------------------------------------------

/** 허브가 평가하는 하드웨어 구성 1개 (dGPU = 가정 RAM 1개, 통합·CPU = RAM 옵션마다). */
export type HwConfig = {
  gpuId: string;
  /** 시스템 RAM (dGPU) 또는 통합/CPU 메모리 용량 (GB) */
  ramGB: number;
  /** dGPU 의 RAM 이 정책 가정값인지 (페이지에 가정을 명시해야 함) */
  assumedRam: boolean;
  hw: Hardware;
};

export function dgpuRamBandwidth(gpus: readonly GpuCore[]): number {
  const profile = gpus.find((gpu) => gpu.id === HUB_POLICY.dgpuRamProfileId);
  if (!profile) {
    throw new Error(`RAM profile '${HUB_POLICY.dgpuRamProfileId}' missing from gpus.json`);
  }
  return profile.memBandwidthGBs;
}

/** dGPU 구성 옵션 — 허브는 정책 기본값(D2), 계산기는 사용자 입력 (P1-3 D33). */
export type DgpuOptions = {
  os?: Os;
  /** 이 GPU 가 화면 출력을 담당하는가 (OS 예약 VRAM, docs/02 §2.3) */
  isDisplayGpu?: boolean;
  /** 같은 GPU 장수 — 계산기 멀티 GPU(docs/02 §6 베타, D58). 허브·콤보는 1장 */
  gpuCount?: number;
};

/** dGPU + 지정 시스템 RAM 의 엔진 하드웨어 (RAM 힌트 계산에도 쓴다). */
export function dgpuHardware(
  gpu: GpuCore,
  ramGB: number,
  ramBandwidthGBs: number,
  opts: DgpuOptions = {},
): Hardware {
  return {
    kind: 'dgpu',
    os: opts.os ?? HUB_POLICY.dgpuOs,
    vramGB: gpu.vramGB,
    memBandwidthGBs: gpu.memBandwidthGBs,
    fp16Tflops: gpu.fp16Tflops,
    ramGB,
    ramBandwidthGBs,
    effClass: gpu.effClass,
    isDisplayGpu: opts.isDisplayGpu ?? true,
    ...(opts.gpuCount !== undefined && opts.gpuCount > 1 ? { gpuCount: opts.gpuCount } : {}),
  };
}

export type HardwareConfigOptions = DgpuOptions & {
  /** 지정 시 그 RAM 1개 구성만 (dGPU: 사용자 RAM → assumedRam=false, 통합·CPU: 옵션 밖 값도 허용) */
  ramGB?: number;
  /** dGPU 시스템 RAM 대역폭 (계산기의 DDR 종류) — 기본은 정책 프로필 */
  ramBandwidthGBs?: number;
};

/** 카탈로그 GPU → 평가 구성들. 허브는 옵션 없이(D2·D4), 계산기는 사용자 선택을 넘긴다. */
export function hardwareConfigs(
  gpu: GpuCore,
  gpus: readonly GpuCore[],
  opts: HardwareConfigOptions = {},
): HwConfig[] {
  if (gpu.kind === 'dgpu') {
    const ramGB = opts.ramGB ?? HUB_POLICY.dgpuRamGB;
    const bandwidth = opts.ramBandwidthGBs ?? dgpuRamBandwidth(gpus);
    return [
      {
        gpuId: gpu.id,
        ramGB,
        assumedRam: opts.ramGB === undefined,
        hw: dgpuHardware(gpu, ramGB, bandwidth, opts),
      },
    ];
  }
  const ramOptions = opts.ramGB !== undefined ? [opts.ramGB] : (gpu.ramOptionsGB ?? []);
  // Apple 실리콘은 macOS 고정, 그 외 통합·CPU 는 기본 linux (계산기가 windows 를 고를 수 있다)
  const os: Os = gpu.vendor === 'apple' ? 'macos' : opts.os === 'windows' ? 'windows' : 'linux';
  return ramOptions.map((ramGB) => ({
    gpuId: gpu.id,
    ramGB,
    assumedRam: false,
    hw: {
      kind: gpu.kind,
      os,
      memBandwidthGBs: gpu.memBandwidthGBs,
      fp16Tflops: gpu.fp16Tflops,
      ramGB,
      // 통합 메모리·CPU 프로필은 시스템 RAM 이 곧 메모리 풀이다
      ramBandwidthGBs:
        gpu.kind === 'unified' ? unifiedCpuBandwidth(gpu) : gpu.memBandwidthGBs,
      effClass: gpu.effClass,
    },
  }));
}

/**
 * 통합 메모리 칩의 CPU 경로 실효 대역폭 — 엔진 cpu-only 는 `EFF.cpu × ramBandwidthGBs` 라서
 * 통합 대역폭 전체를 넣으면 CPU 계수(dense 0.5·MoE 0.43)가 같은 칩의 GPU 계수(apple MoE 0.30 등)보다
 * 커져, wired limit 를 넘어 CPU 로 떨어진 구성이 더 빠르게 추정되는 역전이 생긴다(P1-1 리뷰).
 * 같은 메모리에서 CPU 경로가 GPU 경로를 넘지 않도록 기존 계수 비율로 깎는다 — 새 상수 없음.
 */
export function unifiedCpuBandwidth(gpu: Pick<Gpu, 'effClass' | 'memBandwidthGBs'>): number {
  const cls = EFF[gpu.effClass];
  const cpu = EFF.cpu;
  const ratio = Math.min(1, cls.dense / cpu.dense, (cls.moe ?? cls.dense) / (cpu.moe ?? cpu.dense));
  return gpu.memBandwidthGBs * ratio;
}

/**
 * 엔진 입력으로 넘기는 quant 행 필드 — MoE 행은 GGUF 헤더 실측 분할(expertGB·nonExpertGB), dense 행은 헤더 실측
 * offGpuGB(그래픽카드에 안 올리는 몫, 10-03 D62)가 붙을 수 있다
 */
export type QuantRowInput = Pick<ModelQuantCore, 'quant' | 'fileGB'> &
  Partial<Pick<ModelQuantCore, 'expertGB' | 'nonExpertGB' | 'offGpuGB'>>;

/**
 * 카탈로그 모델 (+ 등록 quant 행) → 엔진 ModelQuant. 행이 없으면 bpw 폴백 경로.
 * MoE: 행 실측 분할이 있으면 그 값(모델 수준 유도값보다 우선), 토큰당 전문가 비율 = topK/experts,
 * 전문가 층 수 = arch.expertLayers 길이(전문가가 일부 층에만 있을 때 — 10-03 D63) 또는 arch.layers — 엔진이 VRAM 여유만큼
 * 전문가 층을 GPU 에 둔다 (10-01 D56). 엔진의 cpuMoeLayers 는 이 단위라 명령 값은 `cpuMoeFlagLayers`(snippet.ts)로 바꾼다.
 */
export function toModelQuant(model: ModelCore, row?: QuantRowInput): ModelQuant {
  const measured = row?.expertGB !== undefined && row.nonExpertGB !== undefined;
  const moe = model.activeParamsB !== undefined;
  const { experts, topK } = model.arch;
  return {
    paramsB: model.paramsB,
    activeParamsB: model.activeParamsB,
    kvBytesPerToken: model.arch.kvBytesPerTokenF16,
    attnType: model.arch.attnType,
    nonExpertGB: measured ? row.nonExpertGB : model.nonExpertGB,
    ...(measured ? { expertGB: row.expertGB } : {}),
    ...(moe && experts !== undefined && topK !== undefined ? { activeExpertFrac: topK / experts } : {}),
    ...(moe ? { moeLayers: model.arch.expertLayers?.length ?? model.arch.layers } : {}),
    maxContext: model.maxContext,
    quant: row?.quant ?? 'Q4_K_M',
    fileGB: row?.fileGB,
    ...(row?.offGpuGB !== undefined ? { offGpuGB: row.offGpuGB } : {}),
  };
}

/**
 * 판정이 비교하는 가중치 GB — dGPU 는 그래픽카드에 올라가는 몫(파일 − 입력 임베딩·MTP 블록, 행 실측이 있을 때 — 10-03 D62),
 * 통합 메모리·CPU 는 파일 전체. 필요량 문장·ctx 표·모델 허브 행렬·가이드 수치가 모두 이 규칙을 쓴다(엔진 fit 의 full-gpu 와 같다).
 */
export function needWeightsGB(kind: Hardware['kind'], mq: ModelQuant): number {
  return kind === 'dgpu' ? gpuResidentGBFor(mq) : weightsGB(mq);
}

/** 리즈닝 모델 → 판정 임계 ×1.5 (docs/02 §5). 운영 정의는 category (결정 D5). */
export function isReasoning(model: Pick<ModelCore, 'thinking'>): boolean {
  // 10-01 D59: 생각 모드가 있으면(늘·켜고 끄기·자동) — 켜면 답 하나에 기다리는 토큰이 크게 늘어난다. 전엔 category 의 reasoning(D5)
  return model.thinking !== undefined;
}

// ---------------------------------------------------------------------------
// quant 선택 규칙
// ---------------------------------------------------------------------------

/** 기준 quant: Q4_K_M → MXFP4 → Q4_K_M bpw 최근접 등록 quant (docs/01 §3 "Q4_K_M 기준"). */
export function baselineRow<R extends Pick<ModelQuantCore, 'quant' | 'fileGB'>>(
  rows: readonly R[],
  quantBpw: Readonly<Record<string, number>>,
): R | undefined {
  for (const quant of HUB_POLICY.baselineOrder) {
    const row = rows.find((r) => r.quant === quant);
    if (row) return row;
  }
  const target = quantBpw.Q4_K_M ?? 0;
  return [...rows].sort((a, b) => {
    const da = Math.abs((quantBpw[a.quant] ?? 0) - target);
    const db = Math.abs((quantBpw[b.quant] ?? 0) - target);
    // 동률이면 작은 파일 (보수적)
    return da - db || a.fileGB - b.fileGB;
  })[0];
}

/** 이론 추정(±30%) 판정 — docs/02 §4 "검증 밖 조합", 데이터 레이어 규칙 (결정 D4). */
export function isTheoretical(gpu: GpuCore, model: ModelCore, mode: Mode): boolean {
  // MoE 계수가 검증되지 않은 클래스 (constants.ts EFF: intel-arc)
  if (model.moe && EFF[gpu.effClass].moe === undefined) return true;
  // cpu-moe: 공개 실측(NVIDIA 35점) 평균 오차 10.3%·±20% 안 89% 지만 최대 40% — 보정 추정(±20%) 근거가 안 되어
  // 가장 넓은 라벨 ±30% 를 쓴다. 표시 범위 밖 4점은 모두 과소 추정(실제가 더 빠름, 회귀가 강제) (10-01 D56)
  if (mode === 'cpu-moe') return true;
  // 비전문가 크기(행 실측·모델 유도 둘 다)가 없는 MoE 는 엔진이 dense 부분 오프로드 경로로 계산한다
  if (model.moe && mode === 'partial-offload') return true;
  // llama.cpp 구동 미검증 커스텀 아키텍처 · 속도 모델 미검증 상수 상태 층 하이브리드(10-03 D63)
  if (HUB_POLICY.unverifiedArchModelIds.includes(model.id)) return true;
  // FP16 크리플 구형 GPU — 계수 도출 표본(RTX 30~50·RDNA3/4) 밖
  if (isFp16Crippled(gpu)) return true;
  // 통합 메모리 칩의 CPU 추론 — cpu 계수 검증점은 데스크톱 DDR5 뿐 (unifiedCpuBandwidth 는 상한 보정)
  if (gpu.kind === 'unified' && mode === 'cpu-only') return true;
  return false;
}

/** FP16 이 크리플된 구형 GPU (UI 주의 배지·theoretical 판정 공용). */
export function isFp16Crippled(gpu: Pick<Gpu, 'kind' | 'fp16Tflops'>): boolean {
  return (
    gpu.kind === 'dgpu' &&
    gpu.fp16Tflops !== undefined &&
    gpu.fp16Tflops < HUB_POLICY.fp16CrippledBelowTflops
  );
}

// ---------------------------------------------------------------------------
// quant 1개 평가
// ---------------------------------------------------------------------------

/** F 사유: 어떤 모드로도 안 들어감 / 들어가지만 너무 느림 */
export type FReason = 'no-fit' | 'too-slow';

/**
 * 판정이 속도만으로 정해졌는지, 모드 규칙에 걸렸는지 — "20 tok/s 이상인데 B" 를 설명한다.
 * 실제로 판정을 묶은 규칙만 붙는다 (docs/02 §5·§3.4, engine verdict.ts):
 *  - cap-full-gpu-only: A 에서 멈춤 — S 는 GPU 전량 탑재 전용 (cpu-moe ≥ S 임계, 부분 오프로드 gpuFrac ≥ 0.9)
 *  - cap-partial: B 상한 — 부분 오프로드 gpuFrac < 0.9 (§3.4 절벽)
 *  - cap-cpu-moe: B — cpu-moe 는 S 임계(20 tok/s, 리즈닝 30) 이상이어야 A (§5)
 *  - cap-cpu-only: B 상한 — CPU 추론 (§5)
 */
export type VerdictReason =
  | 'speed'
  | 'no-fit'
  | 'cap-full-gpu-only'
  | 'cap-partial'
  | 'cap-cpu-moe'
  | 'cap-cpu-only';

export type MemoryNeed = {
  /** 가중치 + KV + 버퍼 (GB, OS 예약 제외) — 가중치는 `needWeightsGB`(dGPU 는 그래픽카드에 올라가는 몫) */
  totalNeedGB: number;
  /**
   * 엔진이 실제로 가용량과 비교하는 필요량 — CPU 경로(CPU 프로필, cpu-only 모드)는 가중치 + KV
   * (docs/02 §2.4 ④, 연산 버퍼는 OS 예약 4GB 가 흡수), GPU 경로는 totalNeedGB. 페이지의 "필요 vs 가용" 문장용.
   */
  needGB: number;
  /** GPU(통합 풀)에 올라가는 양 — OS 예약 포함, 엔진 breakdown.total */
  gpuGB: number;
  /** GPU(통합 풀) 사용 가능량 (dGPU: VRAM − OS 예약, 통합: RAM × 0.70) — CPU 프로필은 0 */
  gpuUsableGB: number;
  /** 시스템 RAM 에 올라가는 양 (cpu-moe·부분 오프로드·CPU 추론) */
  ramGB: number;
  /** 시스템 RAM 사용 가능량 (RAM − 4GB) */
  ramUsableGB: number;
  /**
   * dGPU 에 전량 올렸을 때(full-gpu) 파일 중 그래픽카드에 올리지 않는 GB — 입력 임베딩(시스템 RAM)·MTP 블록(미적재).
   * 그 밖의 모드·하드웨어는 0. 분해 바의 각주용 (10-03 D62)
   */
  offGpuGB: number;
};

export type MeasuredJoin = {
  values: number[];
  points: BenchPointCore[];
};

export type QuantAssessment = {
  quant: QuantId;
  fileGB: number;
  /** MoE 행의 GGUF 헤더 실측 분할 — ctx 계단·행렬(estimateAt)이 같은 값으로 다시 계산하도록 실어 나른다 */
  expertGB?: number;
  nonExpertGB?: number;
  /** dense 행의 헤더 실측 GPU 밖 몫 (10-03 D62) — 위와 같은 이유로 실어 나른다 */
  offGpuGB?: number;
  /** MTP 블록 GB (헤더 실측) — 분해 바의 "MTP 를 켜면" 안내 */
  mtpGB?: number;
  ggufRepo: string;
  tier: QuantTier;
  /** 표시 결과 — 실측이 조인되면 measured(중앙값), 아니면 estimate 와 동일 */
  result: Result;
  /** 순수 추정 (보정/이론 밴드) — measured 일 때 보조로 병기 (규칙 3) */
  estimate: Result;
  fits: boolean;
  gpuFrac?: number;
  fReason?: FReason;
  verdictReason: VerdictReason;
  /** cap-cpu-moe: A 가 되려면 필요한 tok/s (리즈닝 임계 반영) */
  capMinTokS?: number;
  measured?: MeasuredJoin;
  memory: MemoryNeed;
};

/** 평가 조건 — 허브·콤보는 기본값(8k·f16), 계산기는 사용자 선택 (P1-3 D33). */
export type AssessOptions = {
  ctx?: number;
  kvQuant?: KvQuant;
  /** 강제 theoretical (커스텀 하드웨어, D32) — 생략 시 `isTheoretical` 규칙 */
  theoretical?: boolean;
};

export type AssessQuantInput = AssessOptions & {
  gpu: GpuCore;
  config: HwConfig;
  model: ModelCore;
  row: ModelQuantCore;
  tier: QuantTier;
  benchmarks: readonly BenchPointCore[];
};

function memoryNeed(
  config: HwConfig,
  mq: ModelQuant,
  result: Result,
  fits: boolean,
  ctx: number,
  kvQuant: KvQuant,
): MemoryNeed {
  const weights = weightsGB(mq);
  const kv = kvGB(mq.kvBytesPerToken, ctx, kvQuant);
  const hw = config.hw;
  const cpuPath = hw.kind === 'cpu' || (fits && result.mode === 'cpu-only');
  const gpuNeed = needWeightsGB(hw.kind, mq) + kv + computeBufferGB(ctx);
  const base = {
    totalNeedGB: gpuNeed,
    needGB: cpuPath ? weights + kv : gpuNeed,
    gpuUsableGB: hw.kind === 'cpu' ? 0 : Math.max(0, usableGB(hw)),
    ramUsableGB: Math.max(0, usableRamGB(hw)),
    offGpuGB: 0,
  };
  if (!fits) return { ...base, gpuGB: 0, ramGB: 0 };
  switch (result.mode) {
    case 'full-gpu':
      // 입력 임베딩도 시스템 RAM 에 있지만 수백 MB 라 RAM 몫은 0 으로 두고, 분해 바 각주가 따로 알린다
      return {
        ...base,
        gpuGB: result.vram.total,
        ramGB: 0,
        offGpuGB: hw.kind === 'dgpu' ? Math.max(0, weights - result.vram.weights) : 0,
      };
    case 'cpu-moe':
    case 'partial-offload':
      return { ...base, gpuGB: result.vram.total, ramGB: weights - result.vram.weights };
    case 'cpu-only':
      return { ...base, gpuGB: 0, ramGB: weights + kv };
  }
}

/** (gpuId, modelId, quant) 정확 일치 실측 (`Q4_K_XL` ≠ `Q4_K_M`). */
export function measuredPoints<B extends BenchPointCore>(
  benchmarks: readonly B[],
  gpuId: string,
  modelId: string,
  quant: string,
): B[] {
  return benchmarks.filter(
    (bp) => bp.gpuId === gpuId && bp.modelId === modelId && bp.quant === quant,
  );
}

/**
 * quant 1개 평가. 실측 조인은 정확 일치 + 페이지 가정에서 fit 성립 + dGPU 는 full-gpu 일 때만
 * (호스트 RAM·오프로드 플래그가 조인 키에 없다 — 결정 D4) + **기준 조건(8k·f16)일 때만**
 * (실측 ctx 조건이 다르다 — P1-3 D33; 다른 조건은 순수 추정).
 */
export function assessQuant(input: AssessQuantInput): QuantAssessment {
  const { gpu, config, model, row, tier } = input;
  const ctx = input.ctx ?? HUB_POLICY.referenceCtx;
  const kvQuant = input.kvQuant ?? 'f16';
  const mq = toModelQuant(model, row);
  const reasoning = isReasoning(model);

  const fitResult = fit(config.hw, mq, { ctx, kvQuant });
  const theoretical = input.theoretical ?? isTheoretical(gpu, model, fitResult.mode);
  const estimate = evaluate(config.hw, mq, { ctx, kvQuant, reasoning, theoretical });

  const joinable =
    fitResult.fits &&
    (config.hw.kind !== 'dgpu' || fitResult.mode === 'full-gpu') &&
    // 실측은 1장 기준 — 멀티 GPU(D58) 구성에는 붙이지 않는다
    (config.hw.gpuCount ?? 1) === 1 &&
    ctx === HUB_POLICY.referenceCtx &&
    kvQuant === 'f16';
  const points = joinable ? measuredPoints(input.benchmarks, gpu.id, model.id, row.quant) : [];
  const values = points.map((bp) => bp.tgTokS);
  const result =
    values.length > 0
      ? evaluate(config.hw, mq, { ctx, kvQuant, reasoning, theoretical, measuredTgTokS: values })
      : estimate;

  let verdictReason: VerdictReason = 'speed';
  if (!fitResult.fits) {
    verdictReason = 'no-fit';
  } else {
    // 같은 속도를 full-gpu 로 냈다면 받을 등급과 비교 — 낮으면 모드 규칙에 걸린 것.
    // 어느 규칙인지는 실제 결과 등급으로 가른다 (A 에서 멈춤 = S 는 full-gpu 전용).
    const uncapped = verdictOf({ mode: 'full-gpu', tgTokS: result.tgTokS.est, reasoning });
    if (verdictRank(result.verdict) < verdictRank(uncapped)) {
      if (result.verdict === 'A') verdictReason = 'cap-full-gpu-only';
      else if (result.mode === 'partial-offload') verdictReason = 'cap-partial';
      else if (result.mode === 'cpu-moe') verdictReason = 'cap-cpu-moe';
      else if (result.mode === 'cpu-only') verdictReason = 'cap-cpu-only';
    }
  }
  const capMinTokS =
    verdictReason === 'cap-cpu-moe'
      ? VERDICT_THRESHOLDS.sMinTg * (reasoning ? VERDICT_THRESHOLDS.reasoningMultiplier : 1)
      : undefined;

  const fReason: FReason | undefined =
    result.verdict === 'F' ? (fitResult.fits ? 'too-slow' : 'no-fit') : undefined;

  return {
    quant: row.quant,
    fileGB: row.fileGB,
    ...(row.expertGB !== undefined ? { expertGB: row.expertGB } : {}),
    ...(row.nonExpertGB !== undefined ? { nonExpertGB: row.nonExpertGB } : {}),
    ...(row.offGpuGB !== undefined ? { offGpuGB: row.offGpuGB } : {}),
    ...(row.mtpGB !== undefined ? { mtpGB: row.mtpGB } : {}),
    ggufRepo: row.ggufRepo,
    tier,
    result,
    estimate,
    fits: fitResult.fits,
    ...(fitResult.gpuFrac !== undefined ? { gpuFrac: fitResult.gpuFrac } : {}),
    ...(fReason ? { fReason } : {}),
    verdictReason,
    ...(capMinTokS !== undefined ? { capMinTokS } : {}),
    ...(values.length > 0 ? { measured: { values, points } } : {}),
    memory: memoryNeed(config, mq, result, fitResult.fits, ctx, kvQuant),
  };
}

// ---------------------------------------------------------------------------
// (구성, 모델) 조합 평가
// ---------------------------------------------------------------------------

export type RamHint = {
  ramGB: number;
  verdict: Verdict;
  mode: Mode;
  result: Result;
  /** 힌트 구성 그 자체 — F 페이지의 스니펫·대안이 이 구성으로 생성된다 (P1-2) */
  config: HwConfig;
  q: QuantAssessment;
};

/**
 * (구성, 모델, quant) 를 임의 ctx·KV quant 에서 평가 — ctx 계단·ctx×KV 행렬 공용.
 * 실측 조인은 하지 않는다(실측 ctx 조건이 다름).
 */
export function estimateAt(
  gpu: GpuCore,
  config: HwConfig,
  model: ModelCore,
  row: QuantRowInput,
  opts: { ctx: number; kvQuant?: KvQuant; theoretical?: boolean },
): { fit: FitResult; result: Result } {
  const mq = toModelQuant(model, row);
  const fitResult = fit(config.hw, mq, { ctx: opts.ctx, kvQuant: opts.kvQuant });
  const result = evaluate(config.hw, mq, {
    ctx: opts.ctx,
    kvQuant: opts.kvQuant,
    reasoning: isReasoning(model),
    theoretical: opts.theoretical ?? isTheoretical(gpu, model, fitResult.mode),
  });
  return { fit: fitResult, result };
}

export type ComboAssessment = {
  gpuId: string;
  modelId: string;
  ramGB: number;
  reasoning: boolean;
  /** 판정 배지·카운트·정렬 기준 */
  baseline: QuantAssessment;
  /** "이 quant면 가능" — 기준이 이미 최선이면 기준 그대로, 전부 F 면 없음 */
  recommended?: QuantAssessment;
  /** desperate 티어가 추천보다 높은 판정을 낼 때의 최후 수단 힌트 */
  lastResort?: QuantAssessment;
  /** 등록 quant 전체 (fileGB 오름차순) */
  perQuant: QuantAssessment[];
  /** 표에 수치를 보여 주는 quant (기준, 기준이 F 면 추천) */
  display: QuantAssessment;
  /** display quant 가 같은 모드·같은 판정을 유지하는 최대 ctx (F 면 없음) */
  maxCtx?: number;
  /** dGPU: 기준 판정이 개선되는 최소 RAM (가정 32GB 대비) */
  ramHint?: RamHint;
};

function tierMap(quantDefs: readonly QuantDefCore[]): Map<string, QuantTier> {
  return new Map(quantDefs.map((q) => [q.id, q.tier]));
}

function bpwMap(quantDefs: readonly QuantDefCore[]): Record<string, number> {
  return Object.fromEntries(quantDefs.map((q) => [q.id, q.bpw]));
}

/** 판정 최고 → 같은 판정이면 fileGB 최대 (UD 명목 bpw 는 신뢰하지 않는다). */
function bestOf(candidates: readonly QuantAssessment[]): QuantAssessment | undefined {
  return [...candidates].sort(
    (a, b) =>
      verdictRank(b.result.verdict) - verdictRank(a.result.verdict) || b.fileGB - a.fileGB,
  )[0];
}

/** 추천 quant (결정 D4) — docs/01 §3 "이 quant면 가능". */
export function pickRecommended(
  baseline: QuantAssessment,
  perQuant: readonly QuantAssessment[],
): { recommended?: QuantAssessment; lastResort?: QuantAssessment } {
  const nonDesperate = perQuant.filter((q) => q.tier !== 'desperate');
  const desperate = perQuant.filter((q) => q.tier === 'desperate');
  const bestND = bestOf(nonDesperate);
  const bestD = bestOf(desperate);

  let recommended: QuantAssessment | undefined;
  if (bestND && bestND.result.verdict !== 'F') {
    const bestRank = verdictRank(bestND.result.verdict);
    recommended =
      baseline.tier !== 'desperate' && verdictRank(baseline.result.verdict) === bestRank
        ? baseline
        : bestND;
  } else if (bestD && bestD.result.verdict !== 'F') {
    // 비-desperate 가 전부 F 일 때만 desperate 를 추천으로 허용
    recommended = bestD;
  }

  let lastResort: QuantAssessment | undefined;
  if (bestD && (!recommended || recommended.tier !== 'desperate')) {
    const floor = recommended ? verdictRank(recommended.result.verdict) : 0;
    if (verdictRank(bestD.result.verdict) > floor) lastResort = bestD;
  }

  return {
    ...(recommended ? { recommended } : {}),
    ...(lastResort ? { lastResort } : {}),
  };
}

function maxCtxSameMode(
  gpu: GpuCore,
  config: HwConfig,
  model: ModelCore,
  display: QuantAssessment,
  opts: AssessOptions,
): number | undefined {
  if (display.estimate.verdict === 'F') return undefined;
  const from = opts.ctx ?? HUB_POLICY.referenceCtx;
  let best: number | undefined;
  for (const ctx of HUB_POLICY.ctxLadder) {
    if (ctx < from) continue;
    if (ctx > model.maxContext) break;
    const { fit: f, result: r } = estimateAt(gpu, config, model, display, {
      ctx,
      kvQuant: opts.kvQuant,
      theoretical: opts.theoretical,
    });
    if (!f.fits || f.mode !== display.estimate.mode) break;
    if (r.verdict !== display.estimate.verdict) break;
    best = ctx;
  }
  return best;
}

/**
 * RAM 업그레이드 힌트 — 후보(32/64/96/128) 중 현재 구성의 RAM 보다 큰 것을 작은 순으로, 힌트 구성은 현재 구성의
 * os·디스플레이·RAM 대역폭을 그대로 쓴다 (허브 = 정책 기본값 32GB → 64 부터, 계산기 = 사용자 선택 — 16GB 사용자에겐
 * 32GB 로 충분하면 32 를 권한다, D33).
 */
function ramHintFor(
  gpu: GpuCore,
  config: HwConfig,
  model: ModelCore,
  baseline: QuantAssessment,
  row: ModelQuantCore,
  benchmarks: readonly BenchPointCore[],
  opts: AssessOptions,
): RamHint | undefined {
  if (gpu.kind !== 'dgpu') return undefined;
  for (const ramGB of [HUB_POLICY.dgpuRamGB, ...HUB_POLICY.ramHintGB]) {
    if (ramGB <= config.ramGB) continue;
    const hintConfig: HwConfig = {
      gpuId: gpu.id,
      ramGB,
      assumedRam: false,
      hw: dgpuHardware(gpu, ramGB, config.hw.ramBandwidthGBs, {
        os: config.hw.os,
        isDisplayGpu: config.hw.isDisplayGpu,
        ...(config.hw.gpuCount !== undefined ? { gpuCount: config.hw.gpuCount } : {}),
      }),
    };
    const assessed = assessQuant({
      gpu,
      config: hintConfig,
      model,
      row,
      tier: baseline.tier,
      benchmarks,
      ...opts,
    });
    if (verdictRank(assessed.result.verdict) > verdictRank(baseline.result.verdict)) {
      return {
        ramGB,
        verdict: assessed.result.verdict,
        mode: assessed.result.mode,
        result: assessed.result,
        config: hintConfig,
        q: assessed,
      };
    }
  }
  return undefined;
}

export type AssessComboOptions = AssessOptions & {
  /** 가정 RAM 이 아니어도 RAM 힌트를 계산 (계산기: 사용자 RAM 보다 큰 후보만) */
  ramHint?: boolean;
};

export function assessCombo(
  catalog: CatalogCore,
  gpu: GpuCore,
  config: HwConfig,
  model: ModelCore,
  opts: AssessComboOptions = {},
): ComboAssessment {
  const rows = catalog.modelQuants.filter((mq) => mq.modelId === model.id);
  const baseRow = baselineRow(rows, bpwMap(catalog.quantDefs));
  if (!baseRow) throw new Error(`model '${model.id}' has no model-quants rows`);
  const tiers = tierMap(catalog.quantDefs);
  const conditions: AssessOptions = {
    ...(opts.ctx !== undefined ? { ctx: opts.ctx } : {}),
    ...(opts.kvQuant !== undefined ? { kvQuant: opts.kvQuant } : {}),
    ...(opts.theoretical !== undefined ? { theoretical: opts.theoretical } : {}),
  };

  const perQuant = [...rows]
    .sort((a, b) => a.fileGB - b.fileGB)
    .map((row) =>
      assessQuant({
        gpu,
        config,
        model,
        row,
        tier: tiers.get(row.quant) ?? 'ok',
        benchmarks: catalog.benchmarks,
        ...conditions,
      }),
    );
  const baseline = perQuant.find((q) => q.quant === baseRow.quant)!;
  const { recommended, lastResort } = pickRecommended(baseline, perQuant);
  const display = baseline.result.verdict === 'F' && recommended ? recommended : baseline;
  const maxCtx = maxCtxSameMode(gpu, config, model, display, conditions);
  const ramHint =
    config.assumedRam || opts.ramHint
      ? ramHintFor(gpu, config, model, baseline, baseRow, catalog.benchmarks, conditions)
      : undefined;

  return {
    gpuId: gpu.id,
    modelId: model.id,
    ramGB: config.ramGB,
    reasoning: isReasoning(model),
    baseline,
    ...(recommended ? { recommended } : {}),
    ...(lastResort ? { lastResort } : {}),
    perQuant,
    display,
    ...(maxCtx !== undefined ? { maxCtx } : {}),
    ...(ramHint ? { ramHint } : {}),
  };
}

// ---------------------------------------------------------------------------
// 허브 요약
// ---------------------------------------------------------------------------

export type VerdictCounts = Record<Verdict, number> & {
  /** 기준(Q4_K_M) 판정은 F 지만 다른 quant 로는 돌아가는 모델 수 */
  otherQuant: number;
};

function countVerdicts(combos: readonly ComboAssessment[]): VerdictCounts {
  const counts: VerdictCounts = { S: 0, A: 0, B: 0, F: 0, otherQuant: 0 };
  for (const combo of combos) {
    counts[combo.baseline.result.verdict] += 1;
    if (combo.baseline.result.verdict === 'F' && combo.recommended) counts.otherQuant += 1;
  }
  return counts;
}

/** 판정 높은 순 → tok/s 높은 순 → 모델 id (결정론). 허브 행·계산기 카드 공용. */
export function compareCombos(a: ComboAssessment, b: ComboAssessment): number {
  return (
    verdictRank(b.baseline.result.verdict) - verdictRank(a.baseline.result.verdict) ||
    b.display.result.tgTokS.est - a.display.result.tgTokS.est ||
    a.modelId.localeCompare(b.modelId)
  );
}

export type GpuHubRow = {
  model: Model;
  /** configs 와 같은 순서 */
  combos: ComboAssessment[];
};

export type GpuHubData = {
  gpu: Gpu;
  configs: HwConfig[];
  /** 정렬 기준 구성 (dGPU = 유일 구성, 통합·CPU = 최대 RAM) */
  primaryIndex: number;
  rows: GpuHubRow[];
  /** configs 와 같은 순서 */
  counts: VerdictCounts[];
  benchmarks: BenchPoint[];
  faq: {
    /** primary 구성에서 full-gpu 로 도는 가장 큰 모델 (paramsB 기준) + 그 quant */
    largestFullGpu?: ComboPick;
    /** primary 구성에서 어떤 모드로든 도는(F 아님) 가장 큰 모델 — CPU 프로필용 */
    largestRunnable?: ComboPick;
    /** 70B급 대표 모델 조합 (primary 구성) */
    referenceLarge?: ComboAssessment;
  };
};

/** FAQ 가 인용하는 (조합, quant) — 기준 또는 비-desperate 추천 quant */
export type ComboPick = { combo: ComboAssessment; q: QuantAssessment };

/**
 * 조합에서 조건을 만족하는 quant 를 고른다 — 기준 우선, 없으면 등록 quant 중 파일이 가장 큰
 * 비-desperate quant. (추천 quant 만 보면 기준이 이미 같은 판정일 때 더 작은 full-GPU quant 를
 * 놓친다 — P1-1 재검증.) desperate(2비트)로만 되는 경우는 "가장 큰 모델" 답으로 쓰지 않는다.
 */
function pickQuant(
  combo: ComboAssessment,
  pred: (q: QuantAssessment) => boolean,
): QuantAssessment | undefined {
  const bySizeDesc = [...combo.perQuant].sort((a, b) => b.fileGB - a.fileGB);
  return [combo.baseline, ...bySizeDesc].find(
    (q) => q.tier !== 'desperate' && q.result.verdict !== 'F' && pred(q),
  );
}

export function summarizeGpu(catalog: SeedCatalog, gpu: Gpu): GpuHubData {
  const configs = hardwareConfigs(gpu, catalog.gpus);
  const primaryIndex = configs.length - 1;
  const rows: GpuHubRow[] = catalog.models.map((model) => ({
    model,
    combos: configs.map((config) => assessCombo(catalog, gpu, config, model)),
  }));
  rows.sort((a, b) => compareCombos(a.combos[primaryIndex]!, b.combos[primaryIndex]!));

  const counts = configs.map((_, i) => countVerdicts(rows.map((row) => row.combos[i]!)));

  const primary = rows.map((row) => row.combos[primaryIndex]!);
  const paramsOf = (combo: ComboAssessment) =>
    catalog.models.find((m) => m.id === combo.modelId)?.paramsB ?? 0;
  const largestBy = (pred: (q: QuantAssessment) => boolean): ComboPick | undefined =>
    primary
      .map((combo) => ({ combo, q: pickQuant(combo, pred) }))
      .filter((p): p is ComboPick => p.q !== undefined)
      .sort(
        (a, b) =>
          paramsOf(b.combo) - paramsOf(a.combo) || a.combo.modelId.localeCompare(b.combo.modelId),
      )[0];
  const largestFullGpu = largestBy((q) => q.result.mode === 'full-gpu');
  const largestRunnable = largestBy(() => true);
  const referenceLarge = primary.find((c) => c.modelId === HUB_POLICY.referenceLargeModelId);

  return {
    gpu,
    configs,
    primaryIndex,
    rows,
    counts,
    benchmarks: catalog.benchmarks.filter((bp) => bp.gpuId === gpu.id),
    faq: {
      ...(largestFullGpu ? { largestFullGpu } : {}),
      ...(largestRunnable ? { largestRunnable } : {}),
      ...(referenceLarge ? { referenceLarge } : {}),
    },
  };
}

export type MemoryMatrix = {
  ctxs: number[];
  /** gpuWeightsGB — 그래픽카드에 올라가는 가중치(dGPU 규칙, 10-03 D62). 셀 = 이 값 + KV f16 + 버퍼 */
  rows: Array<{ quant: QuantId; fileGB: number; gpuWeightsGB: number; cellsGB: number[] }>;
};

/**
 * quant × ctx 필요 메모리 (그래픽카드에 올라가는 가중치 + KV f16 + 버퍼, OS 예약 제외) — 등록 행만 (MXFP4 bpw 환산 금지).
 * dGPU 규칙이다: 맥(통합 메모리)은 파일 전체로 계산해 셀보다 입력 임베딩·MTP 블록만큼 더 든다(화면 각주).
 */
export function memoryMatrix(model: ModelCore, rows: readonly ModelQuantCore[]): MemoryMatrix {
  const ctxs = HUB_POLICY.matrixCtx.filter((ctx) => ctx <= model.maxContext);
  return {
    ctxs,
    rows: [...rows]
      .sort((a, b) => a.fileGB - b.fileGB)
      .map((row) => {
        const gpuWeightsGB = needWeightsGB('dgpu', toModelQuant(model, row));
        return {
          quant: row.quant,
          fileGB: row.fileGB,
          gpuWeightsGB,
          cellsGB: ctxs.map((ctx) => gpuWeightsGB + kvGB(model.arch.kvBytesPerTokenF16, ctx) + computeBufferGB(ctx)),
        };
      }),
  };
}

export type GgufPublisherKind = 'official' | 'llamacpp' | 'community';

export type GgufPublisher = { kind: GgufPublisherKind; owner: string; repo: string };

/** GGUF 출처 3단 분류 (결정 D3): 모델 제작사 org / llama.cpp 팀 / 커뮤니티. */
export function ggufPublisher(
  model: Pick<Model, 'hfId'>,
  row: Pick<ModelQuantRecord, 'ggufRepo'>,
): GgufPublisher {
  const owner = row.ggufRepo.split('/')[0] ?? row.ggufRepo;
  const modelOwner = model.hfId.split('/')[0];
  const kind: GgufPublisherKind =
    owner === modelOwner
      ? 'official'
      : HUB_POLICY.llamaCppOrgs.includes(owner)
        ? 'llamacpp'
        : 'community';
  return { kind, owner, repo: row.ggufRepo };
}

export type ModelGpuRow = { gpu: Gpu; combo: ComboAssessment };

export type PricedOption = ModelGpuRow & { priceUSD: number; priceAsOf: string };

export type ModelHubData = {
  model: Model;
  baselineQuant: QuantId;
  quants: Array<{ row: ModelQuantRecord; tier: QuantTier; publisher: GgufPublisher }>;
  matrix: MemoryMatrix;
  /** 전 GPU (CPU 프로필 포함) — 통합·CPU 는 최고 기준 판정을 내는 최소 RAM 구성 1행 */
  gpuRows: ModelGpuRow[];
  /**
   * dGPU 실거래가(priceAsOf 동반)만 순위. great = 쾌적(S) 최저가, well = 그보다 싼 원활(A) 최저가
   * (S 가 없으면 A 최저가). 둘 다 없으면 빈 객체.
   */
  cheapest: { great?: PricedOption; well?: PricedOption };
  benchmarks: BenchPoint[];
  referenceRows: ModelGpuRow[];
  /** 손실이 더 큰데 크기는 거의 같은 양자화 쌍(`sameSizeQuant`) — 있으면 허브가 high 를 받으라고 안내 */
  sameSizeQuant?: { low: QuantId; high: QuantId };
};

/**
 * 손실이 더 큰데 크기는 거의 같은 양자화 파일(HUB_POLICY.sameSizeQuantRatio) — 가장 작은 파일부터 보고 첫 쌍만.
 * high 는 그 크기 범위 안에서 품질 등급이 더 높은 파일 가운데 가장 큰 파일(같은 크기면 더 많은 비트).
 */
export function sameSizeQuant(
  quants: ReadonlyArray<{ row: Pick<ModelQuantRecord, 'quant' | 'fileGB'>; tier: QuantTier }>,
): { low: QuantId; high: QuantId } | undefined {
  const sorted = [...quants].sort((a, b) => a.row.fileGB - b.row.fileGB);
  for (const low of sorted) {
    const high = sorted
      .filter(
        (q) =>
          TIER_RANK[q.tier] > TIER_RANK[low.tier] &&
          low.row.fileGB >= q.row.fileGB * HUB_POLICY.sameSizeQuantRatio,
      )
      .at(-1);
    if (high) return { low: low.row.quant, high: high.row.quant };
  }
  return undefined;
}

/** 통합·CPU: 최고 기준 판정의 최소 RAM 구성, 전부 F 면 최대 RAM (결정 D4). */
export function pickConfigCombo(combos: readonly ComboAssessment[]): ComboAssessment {
  const best = Math.max(...combos.map((c) => verdictRank(c.baseline.result.verdict)));
  if (best === 0) return combos[combos.length - 1]!;
  return combos.find((c) => verdictRank(c.baseline.result.verdict) === best)!;
}

export function summarizeModel(catalog: SeedCatalog, model: Model): ModelHubData {
  const rows = catalog.modelQuants.filter((mq) => mq.modelId === model.id);
  const tiers = tierMap(catalog.quantDefs);
  const baseRow = baselineRow(rows, bpwMap(catalog.quantDefs));
  if (!baseRow) throw new Error(`model '${model.id}' has no model-quants rows`);

  const gpuRows: ModelGpuRow[] = catalog.gpus.map((gpu) => {
    const combos = hardwareConfigs(gpu, catalog.gpus).map((config) =>
      assessCombo(catalog, gpu, config, model),
    );
    return { gpu, combo: pickConfigCombo(combos) };
  });
  gpuRows.sort((a, b) => compareCombos(a.combo, b.combo) || a.gpu.id.localeCompare(b.gpu.id));

  const cheapestAt = (target: Verdict): PricedOption | undefined => {
    const first = gpuRows
      .filter(
        (r) =>
          r.gpu.kind === 'dgpu' &&
          r.gpu.streetUSD !== undefined &&
          r.gpu.priceAsOf !== undefined &&
          r.combo.baseline.result.verdict === target,
      )
      .sort((a, b) => a.gpu.streetUSD! - b.gpu.streetUSD! || a.gpu.id.localeCompare(b.gpu.id))[0];
    return first && { ...first, priceUSD: first.gpu.streetUSD!, priceAsOf: first.gpu.priceAsOf! };
  };
  const great = cheapestAt('S');
  const wellCandidate = cheapestAt('A');
  const well =
    wellCandidate && (!great || wellCandidate.priceUSD < great.priceUSD) ? wellCandidate : undefined;
  const cheapest = { ...(great ? { great } : {}), ...(well ? { well } : {}) };

  const quants: ModelHubData['quants'] = [...rows]
    .sort((a, b) => a.fileGB - b.fileGB)
    .map((row) => ({
      row,
      tier: tiers.get(row.quant) ?? 'ok',
      publisher: ggufPublisher(model, row),
    }));
  const sameSize = sameSizeQuant(quants);

  return {
    model,
    baselineQuant: baseRow.quant,
    quants,
    matrix: memoryMatrix(model, rows),
    gpuRows,
    cheapest,
    benchmarks: catalog.benchmarks.filter((bp) => bp.modelId === model.id),
    referenceRows: HUB_POLICY.referenceGpuIds
      .map((id) => gpuRows.find((r) => r.gpu.id === id))
      .filter((r): r is ModelGpuRow => r !== undefined),
    ...(sameSize ? { sameSizeQuant: sameSize } : {}),
  };
}
