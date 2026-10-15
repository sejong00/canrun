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
  // unsloth Dynamic 2.0 — 모델별 bpw 가변(중요 레이어 상향), NATIVE 로 환산 차단. 아래는 명목치(대표 실측 역산).
  // source: https://huggingface.co/unsloth/Qwen3.5-27B-MTP-GGUF (UD-Q2_K_XL 12.04GB / 27.78B = 3.4672bpw, UD-IQ2_M 11.02GB = 3.1735bpw)
  'UD-Q2_K_XL': 3.4672,
  'UD-IQ2_M': 3.1735,
  F16: 16.0005,
});

/**
 * 네이티브 양자화 — flat bpw 에서 이탈하므로 bpw 환산 금지, 실제 fileGB 필수 (§2.1 주의).
 * weightsGB()/weightsGBFromBpw() 가 명시적으로 실패시킨다.
 */
// source: docs/02 §2.1 (policy) — UD 변형은 flat bpw 이탈 (§2.1 주의: Unsloth UD)
export const NATIVE_QUANTS: readonly QuantId[] = Object.freeze(['MXFP4', 'UD-Q2_K_XL', 'UD-IQ2_M']);

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
// source(amd, 10-15 D79): https://github.com/ggml-org/llama.cpp/discussions/10879 Vulkan 스코어보드 no-FA 표 — 7900 XTX(b10868, https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18386832)·9070 XT·9070·7800 XT 4점이 같은 식에서 0.72~0.83 → 최대 오차를 가장 작게 하는 값(minimax) 0.77. 7900 XTX 가 옛 b6957 값(191.3)이었을 때는 0.78
// source(dgx-spark, 10-15 D79): https://github.com/ggml-org/llama.cpp/blob/3795cc1e89e16fbc145f8a5457ea30abd86e0d1d/benches/dgx-spark/dgx-spark.md (b7941 llama-bench, 깊이 0·8192) — dense 2모델 0.72~0.89, MoE 3모델 0.60~0.83 → 각 점이 ±20% 밴드 안에 드는 범위에서 dense 0.78·MoE 0.68 (옛 0.4 는 출처와 맞지 않던 tg 35 한 점에 맞춘 값)
// source(cpu moe): https://www.hardware-corner.net/guides/qwen3-hardware-requirements/ ("Dual-channel DDR5 5600 MHz · Qwen3 Q4 · 18–20" — 컨텍스트·CPU·백엔드 미기재라 10-15 D79 에 실측 레코드에서 뺐다, 값은 유지). 같은 쪽의 조건이 밝혀진 근거는 CPU_MOE_RAM_EFF 0.5(전문가를 RAM 에서 읽는 효율) — 0.43 은 그보다 낮은 보수값
export const EFF: Readonly<Record<EffClass, { dense: number; moe?: number }>> = Object.freeze({
  nvidia: { dense: 0.7, moe: 0.45 }, // 0.62~0.80, 대역폭 클수록↓ (5090은 0.62, 3060은 0.80 → effOverride)
  amd: { dense: 0.77, moe: 0.5 },
  'intel-arc': { dense: 0.59 }, // MoE 미검증 (B580 실측)
  apple: { dense: 0.6, moe: 0.3 },
  'apple-ultra': { dense: 0.44, moe: 0.29 }, // 800GB/s급 비포화
  strix: { dense: 0.65, moe: 0.53 }, // ROCm7/Vulkan
  'dgx-spark': { dense: 0.78, moe: 0.68 }, // 개발진 결과 파일 b7941 (mmap 끔) — 10-15 D79
  cpu: { dense: 0.5, moe: 0.43 }, // ≥8코어 전제, 코어 부족 시 ×0.7 은 UI 안내
});

/** pp ≈ ppCoef × fp16Tflops (±40% "대략" 표기 전용, §3.5 — NVIDIA 140/TFLOP, Apple 45, AMD/Intel 30~40) */
// source: https://github.com/ggml-org/llama.cpp/discussions/15013 (CUDA pp512) · https://github.com/ggml-org/llama.cpp/discussions/10879 (7900 XTX Vulkan — 10-15 D79 재확인: 현재 표 pp512 3727 = 30/TFLOP, 옛 3532 = 29. 같은 표 9070 XT 52·9070 44·7800 XT 27, 15396 의 7900 XT ROCm pp2048 41 → AMD 35 유지, ±40% "대략" 밴드 안)
export const PP_COEF: Readonly<Partial<Record<EffClass, number>>> = Object.freeze({
  nvidia: 140,
  apple: 45,
  'apple-ultra': 45,
  amd: 35,
  'intel-arc': 35,
  strix: 35,
});

/**
 * cpu-moe(§3.3) RAM 몫 효율 — CPU 에 둔 전문가의 토큰당 읽기 바이트 ÷ (이 값 × RAM 대역폭). 09-30 전문가 전부 RAM
 * 공개 실측 3점 역산(0.50~0.63) → 10-01 전문가 일부 GPU 배치까지 넣은 식으로 NVIDIA 공개 실측에 맞춰 재확인
 * (η 0.45 / 0.50 / 0.55 중 0.50 이 편향 최소 — 회귀 42점 평균 오차 11.1%, NVIDIA 35점 10.3%) — 검증점은 test/fixtures.ts CPU_MOE_CASES.
 */
// source: https://www.reddit.com/r/LocalLLaMA/comments/1n4v76j/ (3060 Ti + DDR5-6800, gpt-oss-120b --n-cpu-moe 999 24.85 tok/s) · https://www.reddit.com/r/LocalLLaMA/comments/1rei65v/ (5080 + DDR5-4800 2ch, Qwen3.5-35B-A3B 전문가 전부 CPU Q4_K_M 51.0 · Q8_0 35.7) · https://github.com/ggml-org/llama.cpp/discussions/15396 (3090 + DDR5-5200 gpt-oss-120b --n-cpu-moe 24~32 sweep) · https://carteakey.dev/blog/optimizing-gpt-oss-120b-local-inference/ (RAM 속도 2000→6000MT/s 대조 — 대역폭 비례)
export const CPU_MOE_RAM_EFF = 0.5;

/**
 * cpu-moe 층 배치 여유(§2.4-2) — VRAM 에 들어가는 전문가 층 수에서 이만큼 빼서 `--n-cpu-moe` 를 정한다.
 * `--n-cpu-moe N` 은 앞쪽 N 층을 CPU 로 보내므로 GPU 에 남는 뒤쪽 층은 Q4_K_M 레시피상 ffn_down 이 Q6_K 라
 * 평균보다 무겁다(GGUF 헤더 실측 층별 최대/최소 ~1.15×). D23(gpt-oss·UD 전용 +1층)을 일반화.
 */
// source: docs/02 §3.3 (policy)
export const CPU_MOE_GPU_LAYER_MARGIN = 1;

/**
 * 멀티 GPU(§6, 베타) tg 계수 — 같은 GPU N 장에 층을 나눠 올리면(-sm layer, 기본) 토큰마다 GPU 를 차례로 지나므로 시간은
 * 단일 카드에 전부 올린 것과 같다(대역폭 비합산). 공개 실측(10-01 수집)에서 70B급 2~4장의 실효 대역폭은 카드 1장 피크의
 * 75~90% 로 단일 카드 클래스 계수(0.70)보다 높고, 장수를 늘린 손실은 CUDA 최근 빌드 0~3% — 추가 감속 없음(1.0)이 공개 10점 전부
 * 보수 쪽(−22~0%)이다. 회귀는 test/fixtures.ts MULTI_GPU_CASES. (docs/02 §6 옛 표기 "×0.68" 은 근거 해석 오류 — 10-01 정정)
 * 10-03 D67(값 무변경): 서로 다른 카드도 같은 계수 — 카드별 시간 합(남은 메모리 비율로 층 분할)에 곱한다. 5070 Ti + 3060 공개 실측 1점
 * −6.8%(보수 쪽), 카드별 단일 실측으로 맞춘 3060 + P100 2점 +2.6%·−1.5% — 회귀는 test/fixtures.ts HETERO_GPU_CASES.
 */
// source: https://github.com/XiongjieDai/GPU-Benchmarks-on-LLM-Inference (2×/4× 3090·4090·A6000·A40·RTX 4000 Ada, Llama 3 70B Q4_K_M) · https://github.com/ggml-org/llama.cpp/pull/19378 (4×4090 70B layer 21.25) · https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-14472498 (2×V100 Qwen2 72B Q4_0) · https://github.com/ggml-org/llama.cpp/discussions/15021#discussioncomment-18122692 (2×7900 XTX ROCm Gemma 4 31B Q8_0) · https://github.com/ggml-org/llama.cpp/discussions/20252#discussioncomment-16080503 (A40 1→3장 동일 속도) · 서로 다른 카드(D67): https://github.com/ggml-org/llama.cpp/discussions/21112 (5070 Ti + 3060 Gemma 4 31B Q4_K_M 21.8) · https://github.com/kuraneko1/llama-split-bench/blob/272b0dee42afd60b823e769dd896630e6b13a402/examples/results-3060-p100.md (3060 + P100 층 분할) · https://github.com/ggml-org/llama.cpp/blob/99b95488cac0f00ce3f05af113a8c1e287753f87/src/llama-model.cpp#L1558-L1616 (남은 메모리 비율로 층 분할)
export const MULTI_GPU_TG_FACTOR = 1;

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
