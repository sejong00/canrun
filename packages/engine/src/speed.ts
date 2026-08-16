/** 속도 모델 — docs/02-engine-spec.md §3. */

import type { FitResult } from './fit';
import type { Hardware, KvQuant, ModelQuant } from './types';

export type SpeedOptions = { ctx?: number; kvQuant?: KvQuant };

/** 효율 계수 결정: effOverride > 클래스 표 (MoE 미검증 클래스는 dense 폴백, §3.2). */
export function resolveEff(
  _hw: Pick<Hardware, 'effClass' | 'effOverride'>,
  _isMoe: boolean,
): number {
  throw new Error('not implemented');
}

/** 토큰당 읽기 바이트 GB: weightsRead(MoE 는 active 비율 스케일) + kvRead(ctx) (§3.1). */
export function bytesPerTokenGB(_mq: ModelQuant, _ctx: number, _kvQuant?: KvQuant): number {
  throw new Error('not implemented');
}

/** 모드별 tg 추정 tok/s (§3.1~3.4). 밴드 적용 전 원시 추정값. */
export function tgEstimate(
  _hw: Hardware,
  _mq: ModelQuant,
  _fitResult: Pick<FitResult, 'mode' | 'gpuFrac'>,
  _opts?: SpeedOptions,
): number {
  throw new Error('not implemented');
}

/** pp ≈ ppCoef × fp16Tflops (§3.5). 계수 미정 클래스나 Tflops 미제공 시 undefined. */
export function ppEstimate(
  _hw: Pick<Hardware, 'effClass' | 'fp16Tflops'>,
): number | undefined {
  throw new Error('not implemented');
}
