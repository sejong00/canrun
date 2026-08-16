/** 속도 모델 — docs/02-engine-spec.md §3. */

import { EFF, MOE_TG_CAP_TOKS, PP_COEF } from './constants';
import type { FitResult } from './fit';
import { kvGB, weightsGB } from './memory';
import type { Hardware, KvQuant, ModelQuant } from './types';

export type SpeedOptions = { ctx?: number; kvQuant?: KvQuant };

const DEFAULT_CTX = 8192;

function isMoe(mq: Pick<ModelQuant, 'activeParamsB'>): boolean {
  return mq.activeParamsB !== undefined;
}

/** 효율 계수 결정: effOverride > 클래스 표 (MoE 미검증 클래스는 dense 폴백, §3.2). */
export function resolveEff(
  hw: Pick<Hardware, 'effClass' | 'effOverride'>,
  moe: boolean,
): number {
  if (hw.effOverride !== undefined) return hw.effOverride;
  const cls = EFF[hw.effClass];
  return moe ? (cls.moe ?? cls.dense) : cls.dense;
}

/** 토큰당 읽기 바이트 GB: weightsRead(MoE 는 active 비율 스케일) + kvRead(ctx) (§3.1). */
export function bytesPerTokenGB(mq: ModelQuant, ctx: number, kvQuant?: KvQuant): number {
  const w = weightsGB(mq);
  const weightsRead = isMoe(mq) ? w * (mq.activeParamsB! / mq.paramsB) : w;
  return weightsRead + kvGB(mq.kvBytesPerToken, ctx, kvQuant);
}

/** full-gpu(§3.1) — MoE 는 §9 상한 캡. */
function tgFullGpu(hw: Hardware, mq: ModelQuant, bytes: number): number {
  const tg = (resolveEff(hw, isMoe(mq)) * hw.memBandwidthGBs) / bytes;
  return isMoe(mq) ? Math.min(tg, MOE_TG_CAP_TOKS) : tg;
}

/** cpu-only — RAM 대역폭 + cpu 클래스 계수 (§2.4-4 경로의 속도). */
function tgCpuOnly(hw: Hardware, mq: ModelQuant, bytes: number): number {
  const eff = resolveEff({ effClass: 'cpu' }, isMoe(mq));
  return (eff * hw.ramBandwidthGBs) / bytes;
}

/**
 * cpu-moe(§3.3): expert 읽기가 RAM 대역폭 지배, attention 은 GPU 라 병목 아님.
 * expertBytesPerToken ≈ MoE weightsRead 근사(공유 텐서 과소는 계수에 흡수 — §9).
 * 상한은 full-gpu 값.
 */
function tgCpuMoe(hw: Hardware, mq: ModelQuant, bytes: number): number {
  const expertBytes = weightsGB(mq) * (mq.activeParamsB! / mq.paramsB);
  const eff = resolveEff({ effClass: 'cpu' }, true);
  const tg = (eff * hw.ramBandwidthGBs) / expertBytes;
  return Math.min(tg, tgFullGpu(hw, mq, bytes));
}

/** partial-offload(§3.4): 조화 평균 — dense 절벽. */
function tgPartial(hw: Hardware, mq: ModelQuant, bytes: number, gpuFrac: number): number {
  const gpu = tgFullGpu(hw, mq, bytes);
  const cpu = tgCpuOnly(hw, mq, bytes);
  return 1 / (gpuFrac / gpu + (1 - gpuFrac) / cpu);
}

/** 모드별 tg 추정 tok/s (§3.1~3.4). 밴드 적용 전 원시 추정값. */
export function tgEstimate(
  hw: Hardware,
  mq: ModelQuant,
  fitResult: Pick<FitResult, 'mode' | 'gpuFrac'>,
  opts?: SpeedOptions,
): number {
  const ctx = opts?.ctx ?? DEFAULT_CTX;
  const bytes = bytesPerTokenGB(mq, ctx, opts?.kvQuant);
  switch (fitResult.mode) {
    case 'full-gpu':
      return tgFullGpu(hw, mq, bytes);
    case 'cpu-moe':
      return tgCpuMoe(hw, mq, bytes);
    case 'partial-offload':
      return tgPartial(hw, mq, bytes, fitResult.gpuFrac ?? 0);
    case 'cpu-only':
      return tgCpuOnly(hw, mq, bytes);
  }
}

/** pp ≈ ppCoef × fp16Tflops (§3.5). 계수 미정 클래스나 Tflops 미제공 시 undefined. */
export function ppEstimate(
  hw: Pick<Hardware, 'effClass' | 'fp16Tflops'>,
): number | undefined {
  const coef = PP_COEF[hw.effClass];
  if (coef === undefined || hw.fp16Tflops === undefined) return undefined;
  return coef * hw.fp16Tflops;
}
