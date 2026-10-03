/** 속도 모델 — docs/02-engine-spec.md §3. */

import { CPU_MOE_RAM_EFF, EFF, MOE_TG_CAP_TOKS, MULTI_GPU_TG_FACTOR, PP_COEF } from './constants';
import type { FitResult } from './fit';
import { expertGBFor, gpuCountOf, gpuSharesOf, isUniformGpus, kvGB, nonExpertGBFor, weightsGB } from './memory';
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

/** GPU 쪽 효율 — 멀티 GPU(§6)는 층 나눠 올리기의 GPU 간 전달·동기화 몫만큼 낮춘다 */
function gpuEff(hw: Hardware, moe: boolean): number {
  return resolveEff(hw, moe) * (gpuCountOf(hw) > 1 ? MULTI_GPU_TG_FACTOR : 1);
}

/**
 * GPU 쪽 실효 처리량 GB/s — GPU 에 있는 바이트를 토큰마다 읽는 속도 (§3.1·§6).
 * 카드 1장·같은 카드 N 장(D58): eff × 대역폭 (× `MULTI_GPU_TG_FACTOR`). 같은 카드로만 된 목록도 같은 연산이라 출력이 바이트까지 같다.
 * 서로 다른 카드(10-03 D67): 층과 그 층의 KV 는 맡은 카드에만 있고 토큰은 카드를 차례로 지나므로, 바이트 1GB 를 읽는 시간은
 * 카드별 (몫 ÷ 그 카드의 eff × 대역폭)의 합이다 — 몫은 남은 메모리 비율(`gpuSharesOf`, llama.cpp 기본 층 분할).
 * 느린 카드에 올라간 몫만큼 전체가 느려진다(빠른 카드 한 장에 들어가는 모델도 기본 분할이면 두 카드에 나뉜다)
 */
export function gpuThroughputGBs(hw: Hardware, moe: boolean): number {
  const units = hw.kind === 'dgpu' ? hw.gpus : undefined;
  if (!units || units.length === 0) return gpuEff(hw, moe) * hw.memBandwidthGBs;
  const factor = units.length > 1 ? MULTI_GPU_TG_FACTOR : 1;
  if (isUniformGpus(units)) return resolveEff(units[0]!, moe) * factor * units[0]!.memBandwidthGBs;
  const shares = gpuSharesOf(hw);
  const secondsPerGB = units.reduce((sum, u, i) => sum + shares[i]! / (resolveEff(u, moe) * u.memBandwidthGBs), 0);
  return factor / secondsPerGB;
}

/** 토큰당 읽기 바이트 GB: weightsRead(MoE 는 active 비율 스케일) + kvRead(ctx) (§3.1). */
export function bytesPerTokenGB(mq: ModelQuant, ctx: number, kvQuant?: KvQuant): number {
  const w = weightsGB(mq);
  const weightsRead = isMoe(mq) ? w * (mq.activeParamsB! / mq.paramsB) : w;
  return weightsRead + kvGB(mq.kvBytesPerToken, ctx, kvQuant);
}

/** full-gpu(§3.1) — MoE 는 §9 상한 캡. */
function tgFullGpu(hw: Hardware, mq: ModelQuant, bytes: number): number {
  const tg = gpuThroughputGBs(hw, isMoe(mq)) / bytes;
  return isMoe(mq) ? Math.min(tg, MOE_TG_CAP_TOKS) : tg;
}

/** cpu-only — RAM 대역폭 + cpu 클래스 계수 (§2.4-4 경로의 속도). */
function tgCpuOnly(hw: Hardware, mq: ModelQuant, bytes: number): number {
  const eff = resolveEff({ effClass: 'cpu' }, isMoe(mq));
  return (eff * hw.ramBandwidthGBs) / bytes;
}

/**
 * cpu-moe(§3.3): 토큰 시간 = RAM 몫 + GPU 몫(직렬). 10-01 개정(D56) — 전문가 일부 GPU 배치.
 * - 전문가 읽기량 routed = expertGB × topK/experts (실측 행). 없으면 활성 슬라이스 − 비전문가(09-30 식).
 * - CPU 에 둔 층 비율 f = cpuMoeLayers / moeLayers (fit 이 VRAM 여유로 정한 `--n-cpu-moe`). 정보가 없으면 f = 1(전부 RAM).
 * - RAM 몫: routed × f ÷ (CPU_MOE_RAM_EFF × RAM 대역폭)
 * - GPU 몫: (비전문가 + routed × (1 − f) + KV 읽기) ÷ (GPU 클래스 MoE 효율 × VRAM 대역폭) — 카드가 여럿이면 `gpuThroughputGBs`(§6)
 * 상한은 full-gpu 값. (09-30 이전 식은 활성 파라미터 전체를 RAM 속도로 읽어 ~2.5× 과소 — PROGRESS §4 D55)
 */
function tgCpuMoe(
  hw: Hardware,
  mq: ModelQuant,
  bytes: number,
  kvRead: number,
  cpuMoeLayers?: number,
): number {
  const nonExpertGB = nonExpertGBFor(mq) ?? 0;
  let routed: number;
  let nonExpert: number;
  if (mq.activeExpertFrac !== undefined) {
    routed = (expertGBFor(mq) ?? 0) * mq.activeExpertFrac;
    nonExpert = nonExpertGB;
  } else {
    const activeGB = weightsGB(mq) * (mq.activeParamsB! / mq.paramsB);
    nonExpert = Math.min(nonExpertGB, activeGB);
    routed = activeGB - nonExpert;
  }
  const f =
    cpuMoeLayers !== undefined && mq.moeLayers !== undefined && mq.moeLayers > 0
      ? Math.min(1, cpuMoeLayers / mq.moeLayers)
      : 1;
  const ramGB = routed * f;
  const gpuGB = nonExpert + routed * (1 - f) + kvRead;
  const seconds = ramGB / (CPU_MOE_RAM_EFF * hw.ramBandwidthGBs) + gpuGB / gpuThroughputGBs(hw, true);
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
  fitResult: Pick<FitResult, 'mode' | 'gpuFrac' | 'cpuMoeLayers'>,
  opts?: SpeedOptions,
): number {
  const ctx = opts?.ctx ?? DEFAULT_CTX;
  const bytes = bytesPerTokenGB(mq, ctx, opts?.kvQuant);
  const kvRead = kvGB(mq.kvBytesPerToken, ctx, opts?.kvQuant);
  switch (fitResult.mode) {
    case 'full-gpu':
      return tgFullGpu(hw, mq, bytes);
    case 'cpu-moe':
      return tgCpuMoe(hw, mq, bytes, kvRead, fitResult.cpuMoeLayers);
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
