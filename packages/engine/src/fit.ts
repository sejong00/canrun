/** fit 판정 — docs/02-engine-spec.md §2.4. */

import type { Hardware, KvQuant, Mode, ModelQuant, QuantId, VramBreakdown } from './types';

export type FitResult = {
  /** 어떤 모드로든 탑재 가능한가 (false = F 후보) */
  fits: boolean;
  mode: Mode;
  vram: VramBreakdown;
  /** partial-offload 에서 GPU 상주 비율 (0~1) */
  gpuFrac?: number;
  /** fits=false 일 때 더 낮은 quant 탐색 결과 (§2.4-5, IQ2_M 까지) */
  bestQuant?: QuantId;
};

export type FitOptions = { ctx?: number; kvQuant?: KvQuant };

/** §2.4 순서: full-gpu → cpu-moe(MoE만) → partial-offload(dense) → cpu-only → 실패+bestQuant. */
export function fit(_hw: Hardware, _mq: ModelQuant, _opts?: FitOptions): FitResult {
  throw new Error('not implemented');
}
