/** 메모리 모델 — docs/02-engine-spec.md §2. */

import {
  COMPUTE_BUFFER_BASE_GB,
  COMPUTE_BUFFER_PER_32K_CTX_GB,
  CPU_OS_RESERVE_GB,
  KV_BYTES_PER_EL,
  NATIVE_QUANTS,
  OS_RESERVE_GB,
  QUANT_BPW,
  UNIFIED_USABLE_FRACTION,
} from './constants';
import type { GpuUnit, Hardware, KvQuant, ModelQuant, QuantId } from './types';

/**
 * 가중치 크기 GB — 1순위 fileGB(실제 GGUF), 2순위 paramsB × bpw / 8 (§2.1).
 * 네이티브 quant(MXFP4 등)는 bpw 환산 금지 — fileGB 없으면 명시적 실패 (외부 리뷰 반영).
 */
export function weightsGB(mq: Pick<ModelQuant, 'paramsB' | 'quant' | 'fileGB'>): number {
  if (mq.fileGB !== undefined) return mq.fileGB;
  return weightsGBFromBpw(mq.paramsB, mq.quant);
}

/** bpw 폴백만으로 가중치 GB (bestQuant 탐색 등 fileGB 가 없는 quant 용). 네이티브 quant 거부. */
export function weightsGBFromBpw(paramsB: number, quant: QuantId): number {
  if (NATIVE_QUANTS.includes(quant)) {
    throw new Error(
      `${quant} is a native quantization — bpw conversion is forbidden, actual fileGB is required (docs/02 §2.1)`,
    );
  }
  return (paramsB * QUANT_BPW[quant]) / 8;
}

/** GQA 기본식: 2 × layers × kvHeads × headDim × bytesPerEl (§2.2). 커스텀 입력 모드용. */
export function kvBytesPerToken(
  arch: { layers: number; kvHeads: number; headDim: number },
  kvQuant: KvQuant = 'f16',
): number {
  return 2 * arch.layers * arch.kvHeads * arch.headDim * KV_BYTES_PER_EL[kvQuant];
}

/** ctx 만큼의 KV 캐시 GB — f16 기준 사전 계산값에 KV quant 스케일 적용 (§2.2). */
export function kvGB(kvBytesPerTokenF16: number, ctx: number, kvQuant: KvQuant = 'f16'): number {
  const scale = KV_BYTES_PER_EL[kvQuant] / KV_BYTES_PER_EL.f16;
  return (kvBytesPerTokenF16 * scale * ctx) / 1e9;
}

/** llama.cpp 그래프·스크래치 근사 (§2.3). */
export function computeBufferGB(ctx: number): number {
  return COMPUTE_BUFFER_BASE_GB + COMPUTE_BUFFER_PER_32K_CTX_GB * (ctx / 32768);
}

/** OS 예약 GB (§2.3). macOS 는 unified 규칙(×0.70)에 흡수 → 0. */
export function osReserveGB(hw: Pick<Hardware, 'kind' | 'os' | 'isDisplayGpu'>): number {
  if (hw.kind !== 'dgpu' || !hw.isDisplayGpu) return OS_RESERVE_GB.headless;
  if (hw.os === 'windows') return OS_RESERVE_GB.windowsDisplay;
  if (hw.os === 'linux') return OS_RESERVE_GB.linuxDisplay;
  return OS_RESERVE_GB.headless;
}

/** 카드 목록(`Hardware.gpus`, 10-03 D67)이 있는 dGPU 인가 */
function hasGpuList(hw: Pick<Hardware, 'kind' | 'gpus'>): hw is Pick<Hardware, 'kind'> & { gpus: readonly GpuUnit[] } {
  return hw.kind === 'dgpu' && hw.gpus !== undefined && hw.gpus.length > 0;
}

/** dGPU 장수 (§6) — 정수 1 이상, dGPU 가 아니면 1. 카드 목록이 있으면 그 길이 */
export function gpuCountOf(hw: Pick<Hardware, 'kind' | 'gpuCount' | 'gpus'>): number {
  if (hasGpuList(hw)) return hw.gpus.length;
  if (hw.kind !== 'dgpu' || hw.gpuCount === undefined) return 1;
  return Math.max(1, Math.floor(hw.gpuCount));
}

/**
 * dGPU 카드 목록 (§6, 10-03 D67) — `gpus` 가 있으면 그대로, 없으면 위 필드로 `gpuCount` 장을 만든다(화면 출력은 1번 카드만).
 * dGPU 가 아니면 빈 목록
 */
export function gpuUnitsOf(hw: Hardware): GpuUnit[] {
  if (hw.kind !== 'dgpu') return [];
  if (hasGpuList(hw)) return [...hw.gpus];
  return Array.from({ length: gpuCountOf(hw) }, (_, i) => ({
    vramGB: hw.vramGB ?? 0,
    memBandwidthGBs: hw.memBandwidthGBs,
    effClass: hw.effClass,
    ...(hw.effOverride !== undefined ? { effOverride: hw.effOverride } : {}),
    ...(i === 0 && hw.isDisplayGpu ? { isDisplayGpu: true } : {}),
  }));
}

/** 카드가 전부 같은가 (VRAM·대역폭·효율 — 화면 출력 여부는 보지 않는다). 같으면 같은 GPU N 장(D58)과 같은 식을 탄다 */
export function isUniformGpus(units: readonly GpuUnit[]): boolean {
  const [first] = units;
  return units.every(
    (u) =>
      u.vramGB === first!.vramGB &&
      u.memBandwidthGBs === first!.memBandwidthGBs &&
      u.effClass === first!.effClass &&
      u.effOverride === first!.effOverride,
  );
}

/** 카드 한 장의 OS 예약 GB — 화면 출력 카드만 (§2.3) */
function unitReserveGB(os: Hardware['os'], unit: GpuUnit): number {
  return osReserveGB({ kind: 'dgpu', os, isDisplayGpu: unit.isDisplayGpu });
}

/** 하드웨어 전체의 OS 예약 GB — 카드 목록이 있으면 화면 출력 카드의 예약 합, 아니면 `osReserveGB` (§2.3·§6) */
export function gpuOsReserveGB(hw: Hardware): number {
  if (!hasGpuList(hw)) return osReserveGB(hw);
  return hw.gpus.reduce((sum, u) => sum + unitReserveGB(hw.os, u), 0);
}

/** dGPU VRAM 합 GB (물리 한도, §2.4) — 같은 카드면 vram × N (D58 과 같은 연산), 서로 다른 카드면 카드별 합 */
export function vramTotalGB(hw: Hardware): number {
  if (!hasGpuList(hw)) return (hw.vramGB ?? 0) * gpuCountOf(hw);
  if (isUniformGpus(hw.gpus)) return hw.gpus[0]!.vramGB * hw.gpus.length;
  return hw.gpus.reduce((sum, u) => sum + u.vramGB, 0);
}

/**
 * 카드마다 층을 나눠 받는 몫 (§6, 10-03 D67) — llama.cpp 는 `-ts` 가 없으면 장치마다 남은 메모리 비율로 층을 나눈다.
 * 남은 메모리 = VRAM − 화면 출력 예약(음수는 0). 합이 0 이면 똑같이 나눈다. 합은 1
 */
export function gpuSharesOf(hw: Hardware): number[] {
  const units = gpuUnitsOf(hw);
  const caps = units.map((u) => Math.max(0, u.vramGB - unitReserveGB(hw.os, u)));
  const pool = caps.reduce((a, b) => a + b, 0);
  return caps.map((cap) => (pool > 0 ? cap / pool : 1 / units.length));
}

/** 모드별 사용 가능 메모리 GB (§2.3). */
export function usableGB(hw: Hardware): number {
  switch (hw.kind) {
    case 'dgpu':
      // 카드 목록이 없으면 vram × N − 예약 1장분(D58 식 그대로), 있으면 Σ VRAM − Σ 화면 출력 예약 (D67)
      return vramTotalGB(hw) - gpuOsReserveGB(hw);
    case 'unified':
      return hw.ramGB * UNIFIED_USABLE_FRACTION;
    case 'cpu':
      return usableRamGB(hw);
  }
}

/** cpu-moe/오프로드에서 CPU 쪽 사용 가능 RAM GB (§2.3 usable(cpu)). */
export function usableRamGB(hw: Pick<Hardware, 'ramGB'>): number {
  return hw.ramGB - CPU_OS_RESERVE_GB;
}

/**
 * 이 양자화의 비전문가(어텐션·공유 텐서) 크기 GB (09-30). `nonExpertGB` 는 기준 양자화(Q4_K_M·MXFP4) 파일에서
 * 균등 bpw 로 유도한 값이라(packages/data/src/derive.ts), **더 큰** 양자화(Q8_0 등)는 bpw 비율로 키운다.
 * 더 작은 양자화는 줄이지 않는다 — Q2_K·UD 파일은 어텐션·공유 텐서를 평균보다 높은 정밀도로 두는 경우가 많아
 * 줄이면 VRAM 을 과소 계산한다(--n-cpu-moe 명령이 OOM — PROGRESS §4 D23 과 같은 방향). 기준 양자화는 원값 그대로.
 */
export function nonExpertGBFor(
  mq: Pick<ModelQuant, 'quant' | 'nonExpertGB' | 'expertGB'>,
): number | undefined {
  if (mq.nonExpertGB === undefined) return undefined;
  // GGUF 헤더 실측 행(expertGB 동반)은 그 파일의 값 그대로 (10-01, PROGRESS §4 D56)
  if (mq.expertGB !== undefined) return mq.nonExpertGB;
  if (mq.quant === 'Q4_K_M' || mq.quant === 'MXFP4') return mq.nonExpertGB;
  return mq.nonExpertGB * Math.max(1, QUANT_BPW[mq.quant] / QUANT_BPW.Q4_K_M);
}

/**
 * dGPU 에 전량 올릴 때 그래픽카드에 상주하는 가중치 GB (§2.4-1, 10-03 D62) — llama.cpp 는 입력 임베딩을 시스템 RAM 에 두고
 * MTP 블록은 켜지 않으면 불러오지 않는다. 우선순위: `offGpuGB`(dense 헤더 실측) → MoE 실측 분할(expertGB + nonExpertGB)
 * → 파일 전체. 결과는 [0, weights] 로 묶는다(나쁜 데이터가 필요량을 파일보다 키우거나 음수로 만들지 않게).
 * 통합 메모리·CPU 는 쓰지 않는다 — Metal 은 mmap 범위째 GPU 버퍼로 감싸 이 바이트가 그 안에 들어갈 수 있다.
 */
export function gpuResidentGBFor(
  mq: Pick<ModelQuant, 'paramsB' | 'quant' | 'fileGB' | 'offGpuGB' | 'expertGB' | 'nonExpertGB'>,
  weights: number = weightsGB(mq),
): number {
  let resident = weights;
  if (mq.offGpuGB !== undefined) resident = weights - mq.offGpuGB;
  else if (mq.expertGB !== undefined && mq.nonExpertGB !== undefined) resident = mq.expertGB + mq.nonExpertGB;
  return Math.min(weights, Math.max(0, resident));
}

/**
 * 파일 중 층별 임베딩 표(PLE, `pleGB` — 10-21 D112)를 뺀 GB — dense 의 토큰당 가중치 읽기(§3.1)와 부분 오프로드 gpuFrac 의 분모(§2.4-3).
 * llama.cpp 는 이 표를 입력층으로 늘 시스템 RAM 에 두고 토큰마다 한 줄만 읽는다. `pleGB` 가 없으면 weights 그대로(기존 모델은 바뀌지 않는다).
 * [0, weights] 로 묶는다(나쁜 데이터가 음수를 만들지 않게).
 */
export function withoutPleGB(mq: Pick<ModelQuant, 'pleGB'>, weights: number): number {
  return Math.min(weights, Math.max(0, weights - (mq.pleGB ?? 0)));
}

/**
 * 반복 층(looped — `loops` ≥ 2, Nanbeige4.2 — 10-22 D114) dense 모델이 토큰마다 더 읽는 GB = (loops − 1) × 반복 블록 — dense 읽기 바이트(§3.1)에
 * 더한다. llama.cpp 는 물리 층 텐서를 논리 층 loops 배가 함께 가리키게 하고(`layers[i + j*n_phys] = layers[i]`) 그래프가 논리 층을 차례로 돈다 —
 * 반복 블록은 토큰마다 loops 번(사이에 다른 층이 있어 캐시로 다시 쓰지 못한다), 입력 임베딩(get_rows 한 줄)·출력층은 한 번.
 * 반복 블록 = 행의 헤더 실측 `loopGB`(트렁크 blk.N.* 합), 없으면 dense 읽기 바이트 전체(보수 — 실측 1점 기준 −16%, 낮게 본다).
 * loops 가 없거나 1 이하면 0(기존 모델은 바뀌지 않는다). 블록은 [0, 파일 − 층별 임베딩 표] 로 묶는다(나쁜 데이터가 읽기를 키우거나 음수로 만들지 않게)
 */
export function loopExtraGB(mq: Pick<ModelQuant, 'loops' | 'loopGB' | 'pleGB'>, weights: number): number {
  if (mq.loops === undefined || mq.loops <= 1) return 0;
  const read = withoutPleGB(mq, weights);
  const block = Math.min(read, Math.max(0, mq.loopGB ?? read));
  return (mq.loops - 1) * block;
}

/**
 * 값 전문가(MoVA, `valueExpertGB` — 10-21 D113) 중 토큰마다 읽지 않는 GB = valueExpertGB × (1 − valueExpertFrac).
 * 값 전문가는 비전문가 안에 있어(그래픽카드 상주) 배치·VRAM 은 그대로 두고 MoE 읽기 바이트(§3.1)에서만 뺀다 — llama.cpp 는 토큰마다
 * 값 전문가 valueTopK 개를 골라(ggml_argsort_top_k) 그것만 곱한다(build_lora_mm_id → ggml_mul_mat_id — 라우팅 FFN 전문가와 같은 연산).
 * 둘 중 하나라도 없으면 0(값 전문가가 없는 모델은 바뀌지 않는다). [0, nonExpert] 로 묶는다(나쁜 데이터가 비전문가 읽기를 음수로 만들지 않게).
 */
export function unreadValueExpertGB(mq: Pick<ModelQuant, 'valueExpertGB' | 'valueExpertFrac'>, nonExpert: number): number {
  if (mq.valueExpertGB === undefined || mq.valueExpertFrac === undefined) return 0;
  const frac = Math.min(1, Math.max(0, mq.valueExpertFrac));
  return Math.min(nonExpert, Math.max(0, mq.valueExpertGB * (1 - frac)));
}

/**
 * 라우팅 전문가 텐서 GB — 실측 행은 `expertGB`, 아니면 파일 − 비전문가(유도 경로: token_embd·MTP 가 전문가 쪽에 섞여
 * 층당 전문가 크기를 약간 크게 본다 = `--n-cpu-moe` 가 보수적).
 */
export function expertGBFor(mq: ModelQuant): number | undefined {
  if (mq.expertGB !== undefined) return mq.expertGB;
  const nonExpert = nonExpertGBFor(mq);
  return nonExpert === undefined ? undefined : Math.max(0, weightsGB(mq) - nonExpert);
}
