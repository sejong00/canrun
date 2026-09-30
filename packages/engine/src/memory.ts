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
import type { Hardware, KvQuant, ModelQuant, QuantId } from './types';

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

/** 모드별 사용 가능 메모리 GB (§2.3). */
export function usableGB(hw: Hardware): number {
  switch (hw.kind) {
    case 'dgpu':
      return (hw.vramGB ?? 0) - osReserveGB(hw);
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
export function nonExpertGBFor(mq: Pick<ModelQuant, 'quant' | 'nonExpertGB'>): number | undefined {
  if (mq.nonExpertGB === undefined) return undefined;
  if (mq.quant === 'Q4_K_M' || mq.quant === 'MXFP4') return mq.nonExpertGB;
  return mq.nonExpertGB * Math.max(1, QUANT_BPW[mq.quant] / QUANT_BPW.Q4_K_M);
}
