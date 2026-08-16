/** 메모리 모델 — docs/02-engine-spec.md §2. */

import {
  COMPUTE_BUFFER_BASE_GB,
  COMPUTE_BUFFER_PER_32K_CTX_GB,
  CPU_OS_RESERVE_GB,
  KV_BYTES_PER_EL,
  OS_RESERVE_GB,
  QUANT_BPW,
  UNIFIED_USABLE_FRACTION,
} from './constants';
import type { Hardware, KvQuant, ModelQuant, QuantId } from './types';

/** 가중치 크기 GB — 1순위 fileGB(실제 GGUF), 2순위 paramsB × bpw / 8 (§2.1). */
export function weightsGB(mq: Pick<ModelQuant, 'paramsB' | 'quant' | 'fileGB'>): number {
  return mq.fileGB ?? weightsGBFromBpw(mq.paramsB, mq.quant);
}

/** bpw 폴백만으로 가중치 GB (bestQuant 탐색 등 fileGB 가 없는 quant 용). */
export function weightsGBFromBpw(paramsB: number, quant: QuantId): number {
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
