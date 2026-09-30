/** fit 판정 — docs/02-engine-spec.md §2.4. */

import { QUANT_BPW, QUANT_LADDER } from './constants';
import {
  computeBufferGB,
  kvGB,
  osReserveGB,
  usableGB,
  usableRamGB,
  weightsGB,
  weightsGBFromBpw,
  nonExpertGBFor,
} from './memory';
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

const DEFAULT_CTX = 8192; // §5 판정 기준 컨텍스트

function isMoe(mq: ModelQuant): boolean {
  return mq.activeParamsB !== undefined && mq.nonExpertGB !== undefined;
}

function breakdown(
  residentWeights: number,
  kv: number,
  buffer: number,
  osReserve: number,
  limit: number,
): VramBreakdown {
  return {
    weights: residentWeights,
    kv,
    buffer,
    osReserve,
    total: residentWeights + kv + buffer + osReserve,
    limit,
  };
}

/** bestQuant 탐색을 제외한 §2.4 판정 본체. */
function fitOnce(hw: Hardware, mq: ModelQuant, weights: number, opts?: FitOptions): FitResult {
  const ctx = opts?.ctx ?? DEFAULT_CTX;
  const kv = kvGB(mq.kvBytesPerToken, ctx, opts?.kvQuant);
  const buffer = computeBufferGB(ctx);
  const osReserve = osReserveGB(hw);
  const need = weights + kv + buffer;

  // cpu 단독 하드웨어는 곧바로 4번 경로
  if (hw.kind === 'cpu') {
    const usable = usableRamGB(hw);
    const fits = weights + kv <= usable;
    return {
      fits,
      mode: 'cpu-only',
      vram: breakdown(fits ? weights : 0, fits ? kv : 0, 0, 0, hw.ramGB),
    };
  }

  const pool = usableGB(hw); // dgpu: vram−osReserve, unified: ram×0.70
  const limit = hw.kind === 'dgpu' ? (hw.vramGB ?? 0) : hw.ramGB;

  // 1. full-gpu (unified 포함 — 통합 풀에 전량 탑재)
  if (need <= pool) {
    return { fits: true, mode: 'full-gpu', vram: breakdown(weights, kv, buffer, osReserve, limit) };
  }

  const usableRam = usableRamGB(hw);

  // 2. cpu-moe (MoE 전용, dgpu): nonExpert+kv+buffer ≤ vram && expert ≤ RAM
  if (hw.kind === 'dgpu' && isMoe(mq)) {
    const nonExpert = nonExpertGBFor(mq)!;
    const expert = weights - nonExpert;
    if (nonExpert + kv + buffer <= pool && expert <= usableRam) {
      return {
        fits: true,
        mode: 'cpu-moe',
        vram: breakdown(nonExpert, kv, buffer, osReserve, limit),
      };
    }
  }

  // 3. partial-offload (dense, dgpu): kv+buffer 는 GPU 상주, 가중치만 분할.
  //    CPU측 가중치 = weights − max(0, usableVram − kv − buffer) — 외부 리뷰 반영(2026-08):
  //    기존 need 비례식은 kv/buffer 까지 오프로드된다고 가정해 CPU측 부담을 과소평가했다.
  if (hw.kind === 'dgpu' && !isMoe(mq) && pool > 0) {
    const gpuWeights = Math.max(0, Math.min(weights, pool - kv - buffer));
    const cpuWeights = weights - gpuWeights;
    if (gpuWeights > 0 && cpuWeights <= usableRam) {
      return {
        fits: true,
        mode: 'partial-offload',
        gpuFrac: gpuWeights / weights,
        vram: breakdown(gpuWeights, kv, buffer, osReserve, limit),
      };
    }
  }

  // 4. cpu-only: 시스템 RAM 에 전량
  if (weights + kv <= usableRam) {
    return {
      fits: true,
      mode: 'cpu-only',
      vram: breakdown(0, 0, 0, osReserve, limit),
    };
  }

  // 5. 실패
  return { fits: false, mode: 'cpu-only', vram: breakdown(0, 0, 0, osReserve, limit) };
}

/** §2.4 순서: full-gpu → cpu-moe(MoE만) → partial-offload(dense) → cpu-only → 실패+bestQuant. */
export function fit(hw: Hardware, mq: ModelQuant, opts?: FitOptions): FitResult {
  const result = fitOnce(hw, mq, weightsGB(mq), opts);
  if (result.fits) return result;

  // §2.4-5: 더 낮은 quant 루프 (bpw 폴백 — 다른 quant 의 실제 파일 크기는 데이터 레이어 몫)
  const requestedBpw = QUANT_BPW[mq.quant];
  const candidates = [...QUANT_LADDER].filter((q) => QUANT_BPW[q] < requestedBpw).reverse(); // 높은 품질부터
  for (const quant of candidates) {
    const w = weightsGBFromBpw(mq.paramsB, quant);
    // MoE 는 nonExpert 도 quant 에 비례 축소된다고 근사
    const scaled: ModelQuant = {
      ...mq,
      quant,
      fileGB: undefined,
      nonExpertGB:
        mq.nonExpertGB === undefined ? undefined : mq.nonExpertGB * (w / weightsGB(mq)),
    };
    if (fitOnce(hw, scaled, w, opts).fits) {
      return { ...result, bestQuant: quant };
    }
  }
  return result;
}
