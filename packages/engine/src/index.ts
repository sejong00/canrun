/**
 * CanRun 계산 엔진 — 공개 진입점. 명세: docs/02-engine-spec.md.
 *
 * 불변식 (CLAUDE.md 규칙 1·6, purity.test.ts 가 강제):
 *  - 런타임 의존성 0, 순수 함수만 — Date/random/네트워크/파일 접근 금지
 *  - 상수는 전부 `// source:` 주석 동반 (constants.ts)
 *  - 포맷팅(단위·소수점·로케일)은 UI 레이어 책임 — 숫자만 반환
 *  - 결정론: 같은 입력 → 같은 출력
 */

import { fit } from './fit';
import { ppEstimate, tgEstimate } from './speed';
import type { Confidence, EvaluateOptions, Hardware, ModelQuant, Result } from './types';
import { bandFor, verdictOf } from './verdict';

export * from './types';
export * from './constants';
export * from './memory';
export * from './fit';
export * from './speed';
export * from './verdict';

/** 엔진 스펙 버전 — docs/02-engine-spec.md 개정 시 함께 올린다. */
export const ENGINE_SPEC_VERSION = '0.7.3'; // 10-15 apple MoE 0.30 → 0.44(gpt-oss 가이드 Apple 5점 — D81) — 0.7.2 10-15 amd dense 0.77 → 0.76(9070 XT 실측을 제출 댓글의 no-FA 값으로 — D80) — 0.7.1 10-15 클래스 계수 재보정(dgx-spark dense 0.78·MoE 0.68, amd dense 0.77 — D79) — 0.7.0 10-03 서로 다른 dGPU 섞기(Hardware.gpus, §6 베타, D67) — 0.6.0 dGPU full-gpu 필요량 = 그래픽카드 상주 가중치(offGpuGB, D62), 0.5.0 멀티 GPU(gpuCount)

/** 실측 중앙값 (§4 measured: 실측 중앙값 표시, 추정은 보조). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * 종합 평가: fit(§2.4) → speed(§3) → confidence/밴드(§4) → verdict(§5) 조립.
 * 기본값: ctx 8192, kvQuant 'f16' (§5 판정 기준 조건).
 */
export function evaluate(hw: Hardware, mq: ModelQuant, opts?: EvaluateOptions): Result {
  const fitResult = fit(hw, mq, { ctx: opts?.ctx, kvQuant: opts?.kvQuant });
  const moe = mq.activeParamsB !== undefined;

  const estimated = fitResult.fits
    ? tgEstimate(hw, mq, fitResult, { ctx: opts?.ctx, kvQuant: opts?.kvQuant })
    : 0;

  const measured = opts?.measuredTgTokS;
  const confidence: Confidence = measured?.length
    ? 'measured'
    : opts?.theoretical
      ? 'theoretical'
      : 'calibrated';

  const est = confidence === 'measured' ? median(measured!) : estimated;
  const band = bandFor(confidence, hw.effClass, fitResult.mode, moe);
  // measured 는 실측 분포로 밴드 산출 (n=1 이면 low=high=est)
  const low = confidence === 'measured' ? Math.min(...measured!) : est * (1 - band);
  const high = confidence === 'measured' ? Math.max(...measured!) : est * (1 + band);

  const pp = ppEstimate(hw);

  return {
    verdict: verdictOf({
      mode: fitResult.mode,
      tgTokS: est,
      gpuFrac: fitResult.gpuFrac,
      reasoning: opts?.reasoning,
      fitsAnyQuant: fitResult.fits,
    }),
    mode: fitResult.mode,
    vram: fitResult.vram,
    tgTokS: { est, low, high },
    ...(pp !== undefined ? { ppTokS: { est: pp } } : {}),
    confidence,
    ...(fitResult.cpuMoeLayers !== undefined ? { cpuMoeLayers: fitResult.cpuMoeLayers } : {}),
    ...(fitResult.bestQuant !== undefined ? { bestQuant: fitResult.bestQuant } : {}),
  };
}
