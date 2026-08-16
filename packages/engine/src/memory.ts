/** 메모리 모델 — docs/02-engine-spec.md §2. */

import type { Hardware, KvQuant, ModelQuant, QuantId } from './types';

/** 가중치 크기 GB — 1순위 fileGB(실제 GGUF), 2순위 paramsB × bpw / 8 (§2.1). */
export function weightsGB(_mq: Pick<ModelQuant, 'paramsB' | 'quant' | 'fileGB'>): number {
  throw new Error('not implemented');
}

/** bpw 폴백만으로 가중치 GB (bestQuant 탐색 등 fileGB 가 없는 quant 용). */
export function weightsGBFromBpw(_paramsB: number, _quant: QuantId): number {
  throw new Error('not implemented');
}

/** GQA 기본식: 2 × layers × kvHeads × headDim × bytesPerEl (§2.2). 커스텀 입력 모드용. */
export function kvBytesPerToken(
  _arch: { layers: number; kvHeads: number; headDim: number },
  _kvQuant?: KvQuant,
): number {
  throw new Error('not implemented');
}

/** ctx 만큼의 KV 캐시 GB — f16 기준 사전 계산값에 KV quant 스케일 적용 (§2.2). */
export function kvGB(_kvBytesPerTokenF16: number, _ctx: number, _kvQuant?: KvQuant): number {
  throw new Error('not implemented');
}

/** llama.cpp 그래프·스크래치 근사 (§2.3). */
export function computeBufferGB(_ctx: number): number {
  throw new Error('not implemented');
}

/** OS 예약 GB (§2.3). macOS 는 unified 규칙(×0.70)에 흡수 → 0. */
export function osReserveGB(_hw: Pick<Hardware, 'kind' | 'os' | 'isDisplayGpu'>): number {
  throw new Error('not implemented');
}

/** 모드별 사용 가능 메모리 GB (§2.3). */
export function usableGB(_hw: Hardware): number {
  throw new Error('not implemented');
}

/** cpu-moe/오프로드에서 CPU 쪽 사용 가능 RAM GB (§2.3 usable(cpu)). */
export function usableRamGB(_hw: Pick<Hardware, 'ramGB'>): number {
  throw new Error('not implemented');
}
