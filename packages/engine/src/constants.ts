/**
 * 엔진 상수 — docs/02-engine-spec.md 가 명세, 여기 값이 구현.
 *
 * CLAUDE.md 규칙 1: 모든 상수에 `// source:` 주석 필수. 출처 없는 변경 금지.
 * 변경 시 verify-regression 테스트(§7 실측 대조) 통과 필수 — 테스트 기대값이 곧 스펙.
 * purity.test.ts 가 이 파일의 모든 `export const` 블록에 source 주석 존재를 강제한다.
 */

import type { EffClass, KvQuant, QuantId } from './types';

/**
 * 양자화별 bits-per-weight. 가중치 크기 폴백: paramsB × bpw / 8 (decimal GB).
 * MXFP4 등 네이티브 양자화는 flat bpw 이탈 — 반드시 실제 파일 크기(fileGB) 사용 (§2.1 주의).
 */
// source: https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md (Llama-3.1-8B 공식 실측표)
// 검증: 실제 GGUF 11종 대조 MAE 0.7% / max 1.6% (docs/02 §7, verify-regression.test.ts)
export const QUANT_BPW: Readonly<Record<QuantId, number>> = Object.freeze({
  IQ2_M: 2.9294,
  Q2_K: 3.1593,
  IQ3_XS: 3.4977,
  Q3_K_M: 3.996,
  IQ4_XS: 4.4597,
  Q4_K_M: 4.8944, // 기본 추천값·Ollama 기본
  Q5_K_M: 5.7036,
  Q6_K: 6.5633,
  Q8_0: 8.5008,
  MXFP4: 4.25, // gpt-oss/Kimi K3 네이티브 — bpw 환산 금지, fileGB 필수
  F16: 16.0005,
});

/**
 * 네이티브 양자화 — flat bpw 에서 이탈하므로 bpw 환산 금지, 실제 fileGB 필수 (§2.1 주의).
 * weightsGB()/weightsGBFromBpw() 가 명시적으로 실패시킨다.
 */
// source: docs/02 §2.1 (policy)
export const NATIVE_QUANTS: readonly QuantId[] = Object.freeze(['MXFP4']);

/** bestQuant 탐색 사다리 — bpw 오름차순, IQ2_M 이 바닥 (§2.4-5). MXFP4/F16 은 네이티브라 제외. */
// source: docs/02 §2.1 (policy)
export const QUANT_LADDER: readonly QuantId[] = Object.freeze([
  'IQ2_M',
  'Q2_K',
  'IQ3_XS',
  'Q3_K_M',
  'IQ4_XS',
  'Q4_K_M',
  'Q5_K_M',
  'Q6_K',
  'Q8_0',
]);

/**
 * KV 캐시 요소당 바이트 — kvBytesPerToken(f16 기준)에 (bytesPerEl/2) 곱해 스케일.
 * V-cache quant 는 Flash Attention 필요 (2026 llama.cpp 기본 on).
 */
// source: https://github.com/ggml-org/llama.cpp (cache-type-k/v 크기; q8_0=1.0625+블록 오버헤드, q4_0 동일 방식) — docs/02 §2.2 검증값
export const KV_BYTES_PER_EL: Readonly<Record<KvQuant, number>> = Object.freeze({
  f16: 2,
  q8_0: 1.07,
  q4_0: 0.57,
});

/** llama.cpp 그래프·스크래치 근사: 0.5GB + 0.3GB × (ctx/32k) (§2.3, compute buffer 로그 관찰 근사) */
// source: docs/02 §2.3 (policy)
export const COMPUTE_BUFFER_BASE_GB = 0.5;
// source: docs/02 §2.3 (policy)
export const COMPUTE_BUFFER_PER_32K_CTX_GB = 0.3;

/** OS 예약 (디스플레이 출력 GPU만, §2.3). macOS 는 unified 규칙에 흡수. */
// source: docs/02 §2.3 (policy)
export const OS_RESERVE_GB = Object.freeze({
  windowsDisplay: 0.6,
  linuxDisplay: 0.3,
  headless: 0,
});

/** macOS 통합 메모리 GPU 가용 비율 (wired limit 기본값). sysctl 상향은 UI 툴팁. */
// source: https://github.com/ggml-org/llama.cpp/discussions/2182 (macOS recommendedMaxWorkingSetSize ≈ 램의 ~70%)
export const UNIFIED_USABLE_FRACTION = 0.7;

/** cpu-only 모드에서 OS 몫 차감 (§2.3, usable(cpu) = ram − 4GB) */
// source: docs/02 §2.3 (policy)
export const CPU_OS_RESERVE_GB = 4;

/**
 * 클래스별 효율 계수 (tg = eff × BW / bytesPerToken).
 * moe 미검증 클래스(intel-arc)는 undefined → dense 값 사용 + theoretical 처리.
 */
// source: https://github.com/ggml-org/llama.cpp/discussions/15013 · https://github.com/ggml-org/llama.cpp/discussions/15396 · https://www.localscore.ai · https://www.hardware-corner.net/gpu-ranking-local-llm/ — 실측 70여 점 도출 (docs/02 §3.2, research/hardware.md §6)
export const EFF: Readonly<Record<EffClass, { dense: number; moe?: number }>> = Object.freeze({
  nvidia: { dense: 0.7, moe: 0.45 }, // 0.62~0.80, 대역폭 클수록↓ (5090은 0.62, 3060은 0.80 → effOverride)
  amd: { dense: 0.78, moe: 0.5 },
  'intel-arc': { dense: 0.59 }, // MoE 미검증 (B580 실측)
  apple: { dense: 0.6, moe: 0.3 },
  'apple-ultra': { dense: 0.44, moe: 0.29 }, // 800GB/s급 비포화
  strix: { dense: 0.65, moe: 0.53 }, // ROCm7/Vulkan
  'dgx-spark': { dense: 0.4, moe: 0.4 },
  cpu: { dense: 0.5, moe: 0.43 }, // ≥8코어 전제, 코어 부족 시 ×0.7 은 UI 안내
});

/** pp ≈ ppCoef × fp16Tflops (±40% "대략" 표기 전용, §3.5 — NVIDIA 140/TFLOP, Apple 45, AMD/Intel 30~40) */
// source: https://github.com/ggml-org/llama.cpp/discussions/15013 (CUDA pp512) · https://github.com/ggml-org/llama.cpp/discussions/10879 (7900 XTX Vulkan)
export const PP_COEF: Readonly<Partial<Record<EffClass, number>>> = Object.freeze({
  nvidia: 140,
  apple: 45,
  'apple-ultra': 45,
  amd: 35,
  'intel-arc': 35,
  strix: 35,
});

/** 고속 소형 MoE 대역폭 모델 상한 이탈 캡 (§9: 5090에서 30B-A3B 오버헤드 지배, 실측 141.6 tok/s) */
// source: https://www.hardware-corner.net/gpu-ranking-local-llm/ (RTX 5090 Qwen3-30B-A3B) — 캡 값 자체는 docs/02 §9 (policy)
export const MOE_TG_CAP_TOKS = 235;

/** 판정 임계 (ctx 8k, Q4_K_M 기준, §5 — 20 ≈ 읽는 속도 상회, 8 ≈ 인내 가능, 2 미만 실사용 불가). */
// source: docs/02 §5 (policy)
export const VERDICT_THRESHOLDS = Object.freeze({
  sMinTg: 20,
  aMinTg: 8,
  fBelowTg: 2,
  reasoningMultiplier: 1.5,
});

/** dense 부분 오프로드에서 gpuFrac < 0.9 → B등급 상한 (§3.4 절벽 — gpt-oss-120b 5090 naive 3.4 vs cpu-moe 9.6) */
// source: https://www.hardware-corner.net/gpt-oss-offloading-moe-layers/ (절벽 실측) — 임계 0.9 는 docs/02 §3.4 (policy)
export const PARTIAL_OFFLOAD_B_CAP_GPU_FRAC = 0.9;

/**
 * 신뢰 밴드 (§4). calibrated 는 클래스 의존:
 * NVIDIA·AMD dGPU dense ±12% / 그 외 클래스·모든 MoE·부분 오프로드 ±20%.
 * 검증 최대 오차 17.1%(M4 Pro)를 상회하도록 설정 — 밴드가 검증값보다 좁으면 안 됨.
 */
// source: docs/02 §4 (policy) — 검증 근거는 §7 (속도 12점 MAE 6.3% / max 17.1%, verify-regression.test.ts)
export const BANDS = Object.freeze({
  calibratedDgpuDense: 0.12,
  calibratedOther: 0.2,
  theoretical: 0.3,
});
