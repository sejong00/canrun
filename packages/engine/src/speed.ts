/** 속도 모델 — docs/02-engine-spec.md §3. */

import {
  CPU_MOE_RAM_EFF,
  EFF,
  MOE_EXPERT_OVERHEAD_US,
  MULTI_GPU_TG_FACTOR,
  PP_COEF,
  PP_COEF_NEURAL_ACCEL,
  PP_FIXED_SHARE,
  PP_KQUANT_FACTOR,
  PP_MOE,
  PP_REF_PARAMS_B,
  PP_UBATCH,
} from './constants';
import type { FitResult } from './fit';
import { expertGBFor, gpuCountOf, gpuSharesOf, isUniformGpus, kvGB, nonExpertGBFor, weightsGB } from './memory';
import type { Hardware, KvQuant, ModelQuant } from './types';

export type SpeedOptions = { ctx?: number; kvQuant?: KvQuant };

const DEFAULT_CTX = 8192;

function isMoe(mq: Pick<ModelQuant, 'activeParamsB'>): boolean {
  return mq.activeParamsB !== undefined;
}

/**
 * 효율 계수 결정: effOverride > 클래스 표 (§3.2). GPU 클래스는 dense 값 하나 — MoE 도 같은 값으로 읽고 고정 시간을 더한다(10-16 D88).
 * `moe` 는 CPU 경로(cpu 클래스의 MoE 계수)에서만 갈린다.
 */
export function resolveEff(
  hw: Pick<Hardware, 'effClass' | 'effOverride'>,
  moe: boolean,
): number {
  if (hw.effOverride !== undefined) return hw.effOverride;
  const cls = EFF[hw.effClass];
  return moe ? (cls.moe ?? cls.dense) : cls.dense;
}

/**
 * GPU 쪽 실효 처리량 GB/s — GPU 에 있는 바이트를 토큰마다 읽는 속도 (§3.1·§6).
 * 카드 1장·같은 카드 N 장(D58): eff × 대역폭 (× `MULTI_GPU_TG_FACTOR`). 같은 카드로만 된 목록도 같은 연산이라 출력이 바이트까지 같다.
 * 서로 다른 카드(10-03 D67): 층과 그 층의 KV 는 맡은 카드에만 있고 토큰은 카드를 차례로 지나므로, 바이트 1GB 를 읽는 시간은
 * 카드별 (몫 ÷ 그 카드의 eff × 대역폭)의 합이다 — 몫은 남은 메모리 비율(`gpuSharesOf`, llama.cpp 기본 층 분할).
 * 느린 카드에 올라간 몫만큼 전체가 느려진다(빠른 카드 한 장에 들어가는 모델도 기본 분할이면 두 카드에 나뉜다)
 */
export function gpuThroughputGBs(hw: Hardware): number {
  const units = hw.kind === 'dgpu' ? hw.gpus : undefined;
  if (!units || units.length === 0) {
    return resolveEff(hw, false) * (gpuCountOf(hw) > 1 ? MULTI_GPU_TG_FACTOR : 1) * hw.memBandwidthGBs;
  }
  const factor = units.length > 1 ? MULTI_GPU_TG_FACTOR : 1;
  if (isUniformGpus(units)) return resolveEff(units[0]!, false) * factor * units[0]!.memBandwidthGBs;
  const shares = gpuSharesOf(hw);
  const secondsPerGB = units.reduce((sum, u, i) => sum + shares[i]! / (resolveEff(u, false) * u.memBandwidthGBs), 0);
  return factor / secondsPerGB;
}

/** MoE 활성 슬라이스 GB = 파일 × 활성/전체 파라미터 — 10-16 D88 전의 MoE 바이트, 지금은 CPU 경로(cpu-only)와 분할 정보가 없을 때만 */
function activeSliceGB(mq: ModelQuant): number {
  return weightsGB(mq) * (mq.activeParamsB! / mq.paramsB);
}

/**
 * MoE 토큰당 가중치 읽기(§3.1·§3.3): 비전문가(어텐션·공유 전문가·라우터·출력층) + 라우팅 전문가 × topK/experts.
 * 비전문가·전문가 크기(행 실측 분할, 없으면 기준 양자화에서 유도한 값)와 전문가 비율이 있을 때. 하나라도 없으면
 * 활성 슬라이스를 비전문가와 나머지로 가른다.
 */
function moeActiveSplitGB(mq: ModelQuant): { nonExpert: number; routed: number } {
  const nonExpertGB = nonExpertGBFor(mq);
  const expertGB = expertGBFor(mq);
  if (mq.activeExpertFrac !== undefined && nonExpertGB !== undefined && expertGB !== undefined) {
    return { nonExpert: nonExpertGB, routed: expertGB * mq.activeExpertFrac };
  }
  const activeGB = activeSliceGB(mq);
  const nonExpert = Math.min(nonExpertGB ?? 0, activeGB);
  return { nonExpert, routed: activeGB - nonExpert };
}

/** 토큰당 읽기 바이트 GB(GPU 경로): 가중치(MoE 는 비전문가 + 라우팅 전문가 몫) + kvRead(ctx) (§3.1). */
export function bytesPerTokenGB(mq: ModelQuant, ctx: number, kvQuant?: KvQuant): number {
  const kv = kvGB(mq.kvBytesPerToken, ctx, kvQuant);
  if (!isMoe(mq)) return weightsGB(mq) + kv;
  const { nonExpert, routed } = moeActiveSplitGB(mq);
  return nonExpert + routed + kv;
}

/** 클래스 값이 없는 클래스(intel-arc)의 MoE 고정 시간 — 가장 큰 클래스 값(보수, 이론 추정 ±30% — 10-16 D88) */
const MOE_EXPERT_OVERHEAD_US_FALLBACK = Math.max(...Object.values(MOE_EXPERT_OVERHEAD_US));

/**
 * MoE 토큰당 고정 시간 초 = MoE 층 수 × topK × 클래스 값 (§3.1, 10-16 D88). 라우팅과 전문가마다 도는 작은 행렬곱·합치기처럼
 * 읽는 바이트와 상관없이 토큰마다 드는 시간이다. 층 수·topK 가 없는 입력은 0(데이터 레이어는 늘 채운다).
 * 여러 카드(§6)는 1번 카드의 클래스 값.
 */
export function moeOverheadSeconds(hw: Pick<Hardware, 'effClass'>, mq: Pick<ModelQuant, 'moeLayers' | 'topK'>): number {
  if (mq.moeLayers === undefined || mq.topK === undefined) return 0;
  const us = MOE_EXPERT_OVERHEAD_US[hw.effClass] ?? MOE_EXPERT_OVERHEAD_US_FALLBACK;
  return mq.moeLayers * mq.topK * us * 1e-6;
}

/** full-gpu(§3.1) — 읽기 시간(클래스 dense 계수) + MoE 는 토큰당 고정 시간. */
function tgFullGpu(hw: Hardware, mq: ModelQuant, bytes: number): number {
  const read = bytes / gpuThroughputGBs(hw);
  return 1 / (isMoe(mq) ? read + moeOverheadSeconds(hw, mq) : read);
}

/**
 * cpu-only — RAM 대역폭 + cpu 클래스 계수 (§2.4-4 경로의 속도). MoE 바이트는 활성 슬라이스(cpu MoE 계수 0.43 이 이 바이트로
 * 정해졌다 — 10-16 D88 에도 그대로). 통합 메모리 칩은 같은 메모리를 GPU 로 읽는 full-gpu 추정을 넘지 않는다 — RAM 이 적어
 * CPU 로 떨어진 구성이 더 빠르게 나오는 역전 방지(데이터 레이어 `unifiedCpuBandwidth` 의 MoE 몫을 10-16 D88 에 여기로 옮겼다).
 */
function tgCpuOnly(hw: Hardware, mq: ModelQuant, ctx: number, kvQuant: KvQuant | undefined, gpuBytes: number): number {
  const kv = kvGB(mq.kvBytesPerToken, ctx, kvQuant);
  const bytes = (isMoe(mq) ? activeSliceGB(mq) : weightsGB(mq)) + kv;
  const cpu = (resolveEff({ effClass: 'cpu' }, isMoe(mq)) * hw.ramBandwidthGBs) / bytes;
  return hw.kind === 'unified' ? Math.min(cpu, tgFullGpu(hw, mq, gpuBytes)) : cpu;
}

/**
 * cpu-moe(§3.3): 토큰 시간 = RAM 몫 + GPU 몫 + MoE 고정 시간(직렬). 10-01 개정(D56) — 전문가 일부 GPU 배치.
 * - 전문가 읽기량 routed = expertGB × topK/experts (실측 행). 없으면 활성 슬라이스 − 비전문가(09-30 식).
 * - CPU 에 둔 층 비율 f = cpuMoeLayers / moeLayers (fit 이 VRAM 여유로 정한 `--n-cpu-moe`). 정보가 없으면 f = 1(전부 RAM).
 * - RAM 몫: routed × f ÷ (CPU_MOE_RAM_EFF × RAM 대역폭)
 * - GPU 몫: (비전문가 + routed × (1 − f) + KV 읽기) ÷ (GPU 클래스 dense 계수 × VRAM 대역폭) — 카드가 여럿이면 `gpuThroughputGBs`(§6)
 * - 고정 시간: full-gpu 와 같은 MoE 층 수 × topK × 클래스 값(10-16 D88 — 옛 GPU 몫 MoE 계수 대신. 공개 실측 42점 평균 오차 11.1% 그대로, 편향 −2.4 → +0.1%, 최대 39.7 → 34.0%)
 * 상한은 full-gpu 값. (09-30 이전 식은 활성 파라미터 전체를 RAM 속도로 읽어 ~2.5× 과소 — PROGRESS §4 D55)
 */
function tgCpuMoe(
  hw: Hardware,
  mq: ModelQuant,
  bytes: number,
  kvRead: number,
  cpuMoeLayers?: number,
): number {
  const { nonExpert, routed } = moeActiveSplitGB(mq);
  const f =
    cpuMoeLayers !== undefined && mq.moeLayers !== undefined && mq.moeLayers > 0
      ? Math.min(1, cpuMoeLayers / mq.moeLayers)
      : 1;
  const ramGB = routed * f;
  const gpuGB = nonExpert + routed * (1 - f) + kvRead;
  const seconds =
    ramGB / (CPU_MOE_RAM_EFF * hw.ramBandwidthGBs) + gpuGB / gpuThroughputGBs(hw) + moeOverheadSeconds(hw, mq);
  return Math.min(1 / seconds, tgFullGpu(hw, mq, bytes));
}

/** partial-offload(§3.4): 조화 평균 — dense 절벽. */
function tgPartial(hw: Hardware, mq: ModelQuant, bytes: number, cpu: number, gpuFrac: number): number {
  const gpu = tgFullGpu(hw, mq, bytes);
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
      return tgPartial(hw, mq, bytes, tgCpuOnly(hw, mq, ctx, opts?.kvQuant, bytes), fitResult.gpuFrac ?? 0);
    case 'cpu-only':
      return tgCpuOnly(hw, mq, ctx, opts?.kvQuant, bytes);
  }
}

export type PpOptions = {
  /** llama.cpp 물리 배치(-ub). 기본 512 = llama-server·Ollama·LM Studio 기본값 — MoE 의 전문가당 토큰 수만 바꾼다 */
  ubatch?: number;
};

/** pp 추정에 쓰는 모델 정보 — 회귀 점은 카탈로그 밖 양자화(Q4_0·Q4_K_S 등)도 넣으므로 quant 는 문자열 */
export type PpModel = Pick<ModelQuant, 'paramsB' | 'activeParamsB' | 'activeExpertFrac'> & { quant: string };

/** K-quant·i-quant(Unsloth UD 포함) — 역양자화가 무거운 형식 (PP_KQUANT_FACTOR) */
function isKOrIQuant(quant: string): boolean {
  return quant.includes('_K') || quant.startsWith('IQ') || quant.startsWith('UD-');
}

/**
 * pp 실효 파라미터 B (§3.5, 10-16 D91) — dense 는 전체 파라미터, MoE 는 활성 × PP_MOE 배수(전문가당 토큰이 적을수록 크다).
 * 전문가 비율(topK/experts)이 없는 MoE 는 기준 비율(전문가당 64토큰 — gpt-oss-20b)로 둔다.
 */
export function ppEffectiveParamsB(mq: PpModel, opts?: PpOptions): number {
  if (mq.activeParamsB === undefined) return mq.paramsB;
  const ubatch = opts?.ubatch ?? PP_UBATCH;
  const tokensPerExpert = mq.activeExpertFrac !== undefined ? ubatch * mq.activeExpertFrac : PP_MOE.refTokensPerExpert;
  return mq.activeParamsB * PP_MOE.activeFactor * (PP_MOE.refTokensPerExpert / tokensPerExpert) ** PP_MOE.tokenExp;
}

/**
 * 프롬프트 처리 tok/s (§3.5, 10-16 D91): 기준값(계수 × FP16 TFLOPS = Llama 2 7B Q4_0 pp512 상당)을 모델 크기로 나눈다.
 *   pp = 기준값 × 양자화 계수 ÷ (φ + (1 − φ) × 실효 파라미터 / 6.74)
 * - 계수: 클래스 `PP_COEF`, GPU 코어마다 행렬곱 가속기가 있는 칩(Apple M5 계열)은 `PP_COEF_NEURAL_ACCEL`(10-16 D86)
 * - TFLOPS: 행렬 코어 값(`fp16MatrixTflops` — AMD)이 있으면 그 값
 * - 양자화 계수: M5 계열·Strix Halo 의 dense K-quant·i-quant 만 `PP_KQUANT_FACTOR`
 * 짧은 프롬프트(pp512) 기준이다 — 문맥이 길어지면 어텐션 몫이 커져 느려진다. 계수 미정 클래스나 TFLOPS 미제공 시 undefined.
 */
export function ppEstimate(
  hw: Pick<Hardware, 'effClass' | 'fp16Tflops' | 'fp16MatrixTflops' | 'neuralAccel'>,
  mq: PpModel,
  opts?: PpOptions,
): number | undefined {
  const coef = hw.neuralAccel ? PP_COEF_NEURAL_ACCEL : PP_COEF[hw.effClass];
  const tflops = hw.fp16MatrixTflops ?? hw.fp16Tflops;
  if (coef === undefined || tflops === undefined) return undefined;
  const ref = coef * tflops;
  const x = ppEffectiveParamsB(mq, opts) / PP_REF_PARAMS_B;
  const kq = !isMoe(mq) && isKOrIQuant(mq.quant) ? ppKQuantFactor(hw) : 1;
  return (ref * kq) / (PP_FIXED_SHARE + (1 - PP_FIXED_SHARE) * x);
}

function ppKQuantFactor(hw: Pick<Hardware, 'effClass' | 'neuralAccel'>): number {
  if (hw.neuralAccel) return PP_KQUANT_FACTOR.neuralAccel;
  return hw.effClass === 'strix' ? PP_KQUANT_FACTOR.strix : 1;
}
