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

/**
 * 엔진 스펙 버전 — docs/02-engine-spec.md 개정 시 함께 올린다. 줄 끝 주석은 `MM-DD 바뀐 내용 — 이전 버전 MM-DD …` (최신이 앞).
 * 버전을 올리면 아래 `ENGINE_SPEC_DATE` 도 그날로 바꾼다 — 주석 맨 앞 MM-DD 와 같아야 한다(packages/engine/test/spec-version.test.ts).
 */
export const ENGINE_SPEC_VERSION = '0.10.0'; // 10-21 층별 임베딩 표(PLE — Gemma 4 E2B·E4B): dense 읽기 바이트 = 파일 − pleGB(토큰마다 한 줄만 읽는다), dGPU full-gpu 는 표가 있는 행만 GPU 밖 몫이 사용 가능 시스템 RAM 에 들어가야, 부분 오프로드 GPU 몫 상한 = 상주 가중치·gpuFrac 분모 = 파일 − pleGB, 사다리는 pleGB 를 비례 축소, GPU 경로 토큰당 고정 시간 PLE_TOKEN_OVERHEAD_MS 신설(CUDA 1.35·Vulkan 1.75ms — 공개 실측 8점 minimax)(pleGB 없는 모델은 산식 그대로 — D112) — 0.9.0 10-16 pp 가 모델 크기를 반영 — 기준값(계수 × FP16 TFLOPS, AMD 는 행렬 FP16) ÷ (φ 0.05 + 0.95 × 실효 파라미터/6.74), MoE 실효 = 활성 × 1.9 × (64/전문가당 토큰)^0.35, M5·Strix dense K-quant × 0.6, PP_COEF nvidia 140 → 154 · amd 35 → 24.5(행렬) · strix 35 → 69 · dgx-spark 52 신설(2026 빌드 다모델 91점 — D91) — 0.8.1 10-16 strix dense 0.65 → 0.82 · MoE 고정 시간 2.1 → 14.3µs(Vulkan 지금 빌드 dense 6점·MoE 7점 — D90) — 0.8.0 10-16 MoE 속도식 — 읽는 바이트 = 비전문가 + 라우팅 전문가 × topK/experts(헤더 분할), 클래스 dense 계수 + 토큰당 고정 시간(MoE 층 × topK × MOE_EXPERT_OVERHEAD_US), GPU 클래스 MoE 계수·235 캡 폐지(2026 빌드 45점 — D88) — 0.7.6 10-16 Apple fp16Tflops 를 위키백과 FP32 이론값으로(시드 값은 FP32×2 — D87) → PP_COEF apple·apple-ultra 27 → 57 · PP_COEF_NEURAL_ACCEL 78 → 179 — 0.7.5 10-16 PP_COEF apple·apple-ultra 45 → 27 + M5 계열 PP_COEF_NEURAL_ACCEL 78(Hardware.neuralAccel — #4167 지금 빌드 pp512, D86) — 0.7.4 10-15 apple dense 0.60 → 0.76 · apple-ultra dense 0.44 → 0.57(#4167 의 지금 빌드 값 — D83) — 0.7.3 10-15 apple MoE 0.30 → 0.44(gpt-oss 가이드 Apple 5점 — D81) — 0.7.2 10-15 amd dense 0.77 → 0.76(9070 XT 실측을 제출 댓글의 no-FA 값으로 — D80) — 0.7.1 10-15 클래스 계수 재보정(dgx-spark dense 0.78·MoE 0.68, amd dense 0.77 — D79) — 0.7.0 10-03 서로 다른 dGPU 섞기(Hardware.gpus, §6 베타, D67) — 0.6.0 dGPU full-gpu 필요량 = 그래픽카드 상주 가중치(offGpuGB, D62), 0.5.0 멀티 GPU(gpuCount)
/**
 * 위 버전을 올린 날 (`YYYY-MM-DD`, 10-16 D93) — 사이트맵 lastmod 에 쓴다: 엔진 개정은 데이터가 그대로여도 계산기·허브·콤보의 수치를
 * 바꾸므로 그 페이지들의 lastmod = max(데이터 기준일, 이 날) (`scripts/build-sitemaps.ts`). 날짜 문자열일 뿐 시각을 읽지 않는다(규칙 6·D21).
 * 날짜 기준은 `content/updates.ts` 와 같다 — 사이트에 반영(main 푸시)되는 날의 UTC 날짜.
 */
export const ENGINE_SPEC_DATE = '2026-10-21';

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

  const pp = ppEstimate(hw, mq);

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
