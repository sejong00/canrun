/** 판정·신뢰 밴드 — docs/02-engine-spec.md §4·§5. */

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
export function verdictOf(_input: VerdictInput): Verdict {
  throw new Error('not implemented');
}

/** §4 calibrated 밴드: NVIDIA·AMD dGPU dense ±12% / 그 외·모든 MoE·부분 오프로드 ±20%. */
export function calibratedBand(_effClass: EffClass, _mode: Mode, _isMoe: boolean): number {
  throw new Error('not implemented');
}

/** 신뢰 라벨별 밴드 (measured 는 실측 분포에서 별도 산출, §4). */
export function bandFor(
  _confidence: Confidence,
  _effClass: EffClass,
  _mode: Mode,
  _isMoe: boolean,
): number {
  throw new Error('not implemented');
}
