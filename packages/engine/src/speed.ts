/** 속도 모델 — docs/02-engine-spec.md §3. */

import { CPU_MOE_RAM_EFF, EFF, MOE_TG_CAP_TOKS, PP_COEF } from './constants';
import type { FitResult } from './fit';
import { kvGB, nonExpertGBFor, weightsGB } from './memory';
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
 * cpu-moe(§3.3, 09-30 보정): 토큰 시간 = RAM 몫 + GPU 몫(직렬).
 * - RAM 몫: **라우팅 전문가만** = 활성 슬라이스 − 비전문가(nonExpertGB, 균등 bpw — derive.ts 와 같은 가정) ÷ (CPU_MOE_RAM_EFF × RAM 대역폭)
 * - GPU 몫: 비전문가 + KV 읽기 ÷ (GPU 클래스 MoE 효율 × VRAM 대역폭)
 * 전문가를 **전부** RAM 에 둔다고 가정(보수적 — 일부를 GPU 에 남기면 더 빠르다). 상한은 full-gpu 값.
 * (이전 식은 활성 슬라이스 전체를 RAM 속도로 읽어 ~2.5× 과소 — PROGRESS §4 09-30)
 */
function tgCpuMoe(hw: Hardware, mq: ModelQuant, bytes: number): number {
  const activeGB = weightsGB(mq) * (mq.activeParamsB! / mq.paramsB);
  const nonExpert = Math.min(nonExpertGBFor(mq) ?? 0, activeGB);
  const routedGB = activeGB - nonExpert;
  const gpuGB = bytes - routedGB; // = 비전문가 + KV 읽기
  const seconds = routedGB / (CPU_MOE_RAM_EFF * hw.ramBandwidthGBs) + gpuGB / (resolveEff(hw, true) * hw.memBandwidthGBs);
  return Math.min(1 / seconds, tgFullGpu(hw, mq, bytes));
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
