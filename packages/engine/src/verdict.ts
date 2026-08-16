/** 판정·신뢰 밴드 — docs/02-engine-spec.md §4·§5. */

import { BANDS, PARTIAL_OFFLOAD_B_CAP_GPU_FRAC, VERDICT_THRESHOLDS } from './constants';
import type { Confidence, EffClass, Mode, Verdict } from './types';

export type VerdictInput = {
  mode: Mode;
  tgTokS: number;
  /** partial-offload 절벽 경고용 (§3.4) */
  gpuFrac?: number;
  /** 리즈닝 모델: 임계 ×1.5 (§5) */
  reasoning?: boolean;
  /** 모든 quant 미탑재 → 무조건 F */
  fitsAnyQuant?: boolean;
};

/** §5 등급표 + §3.4 부분 오프로드 B 상한. */
export function verdictOf(input: VerdictInput): Verdict {
  if (input.fitsAnyQuant === false) return 'F';

  const mult = input.reasoning ? VERDICT_THRESHOLDS.reasoningMultiplier : 1;
  const sMin = VERDICT_THRESHOLDS.sMinTg * mult;
  const aMin = VERDICT_THRESHOLDS.aMinTg * mult;
  const fBelow = VERDICT_THRESHOLDS.fBelowTg * mult;
  const tg = input.tgTokS;

  if (tg < fBelow) return 'F';

  // §3.4: dense 부분 오프로드 gpuFrac < 0.9 는 B 상한 (속도 절벽)
  if (
    input.mode === 'partial-offload' &&
    (input.gpuFrac ?? 0) < PARTIAL_OFFLOAD_B_CAP_GPU_FRAC
  ) {
    return 'B';
  }

  switch (input.mode) {
    case 'full-gpu':
      if (tg >= sMin) return 'S';
      if (tg >= aMin) return 'A';
      return 'B';
    case 'cpu-moe':
      if (tg >= sMin) return 'A'; // §5: cpu-moe ≥20 은 A (S 는 full-gpu 전용)
      return 'B'; // 2~20
    case 'partial-offload':
      // gpuFrac ≥ 0.9: full-gpu 에 준하되 S 는 불가 (§5 S 조건 = full-gpu)
      if (tg >= aMin) return 'A';
      return 'B';
    case 'cpu-only':
      return 'B'; // 2 이상은 B, S/A 불가 (§5)
  }
}

/** §4 calibrated 밴드: NVIDIA·AMD dGPU dense ±12% / 그 외·모든 MoE·부분 오프로드 ±20%. */
export function calibratedBand(effClass: EffClass, mode: Mode, moe: boolean): number {
  const dgpuDense =
    (effClass === 'nvidia' || effClass === 'amd') && mode === 'full-gpu' && !moe;
  return dgpuDense ? BANDS.calibratedDgpuDense : BANDS.calibratedOther;
}

/** 신뢰 라벨별 밴드 (measured 는 실측 분포에서 별도 산출, §4). */
export function bandFor(
  confidence: Confidence,
  effClass: EffClass,
  mode: Mode,
  moe: boolean,
): number {
  if (confidence === 'theoretical') return BANDS.theoretical;
  return calibratedBand(effClass, mode, moe);
}
