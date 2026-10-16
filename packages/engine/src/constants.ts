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
 * 클래스별 효율 계수 (dense: tg = eff × BW / bytesPerToken).
 * MoE 는 10-16 D88 부터 같은 dense 계수로 실제 읽는 바이트를 읽고 토큰당 고정 시간(`MOE_SLICE_US`)을 더한다 —
 * GPU 클래스의 옛 MoE 계수(nvidia 0.45·amd 0.5·apple 0.44·apple-ultra 0.29·strix 0.53·dgx-spark 0.68)는 없앴다.
 * `moe` 는 CPU 경로(cpu-only)의 MoE 계수만 남는다.
 */
// source(strix, 10-16 D90): Radeon 8060S(Strix Halo, 256GB/s) Vulkan 지금 빌드 dense 6점(FA 켬 — llama-bench 기본 auto) — Llama 2 7B Q4_0 b11349 54.38(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18711544) · Llama 3.1 8B Q4_0 44.52 · Q4_K_S 44.21 · Qwen3.5 27B Q6_K 8.93(https://github.com/ggml-org/llama.cpp/pull/24966#issuecomment-4787851707 master 열, 2026-06) · Llama 2 13B Q5_K_M 22.48(https://github.com/ggml-org/llama.cpp/pull/21751#issuecomment-4297412913 머지 열) · Qwen3.8 27B Q4_K_M(ggml-org 17.66GiB) b10940 tg32 11.29(https://github.com/ggml-org/llama.cpp/pull/28494#issuecomment-5652740372)이 같은 식에서 0.81~0.85 → minimax 0.829 를 내림한 0.82(각 ±3.3% 안). 옛 0.65("ROCm7/Vulkan")는 출처 없는 값이었다. 같은 기기 ROCm 은 dense 가 0~14% 느리다 — b11349 FA 켬 51.33·끔 47.36, ROCm 7.14 b10376 49.10(https://github.com/ggml-org/llama.cpp/discussions/15021#discussioncomment-17979194), Qwen3.8 27B 11.01 은 0.82 로 +0.4~+13.7%(±20% 안)
// source: https://github.com/ggml-org/llama.cpp/discussions/15013 · https://github.com/ggml-org/llama.cpp/discussions/15396 · https://www.localscore.ai · https://www.hardware-corner.net/gpu-ranking-local-llm/ — 실측 70여 점 도출 (docs/02 §3.2, research/hardware.md §6)
// source(amd, 10-15 D79·D80): https://github.com/ggml-org/llama.cpp/discussions/10879 Vulkan 스코어보드 no-FA 4점, 값은 제출 댓글 fa 0 줄 — 7900 XTX b10868 182.63(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18386832)·9070 XT b7825 131.54(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-15594467)·9070 b6188 119.71(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-14129066)·7800 XT b7875 118.27(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-15642964)이 같은 식에서 0.72~0.79 → 최대 오차를 가장 작게 하는 값(minimax) 0.76. D79 의 0.77 은 표가 9070 XT 의 FA 켬 줄(137.11)을 no-FA 칸에 넣은 값으로 구했었다(0.72~0.83)
// source(dgx-spark, 10-15 D79): https://github.com/ggml-org/llama.cpp/blob/3795cc1e89e16fbc145f8a5457ea30abd86e0d1d/benches/dgx-spark/dgx-spark.md (b7941 llama-bench, 깊이 0·8192) — dense 2모델 0.72~0.89 → 각 점이 ±20% 밴드 안에 드는 범위에서 dense 0.78 (옛 0.4 는 출처와 맞지 않던 tg 35 한 점에 맞춘 값). 같은 파일의 MoE 3모델로 정했던 MoE 0.68 은 10-16 D88 에 MOE_SLICE_US 로 대체
// (옛 apple MoE 0.44 의 근거였던 #15396 gpt-oss 가이드 2025-08 빌드 5점은 10-16 D88 에 회귀 밖 참고점이 됐다 — test/fixtures.ts MOE_OLD_BUILD_CASES)
// source(apple·apple-ultra dense, 10-15 D83): https://github.com/ggml-org/llama.cpp/discussions/4167 Apple 스코어보드의 Llama 2 7B Q4_0 tg128. 요약 표의 M1~M4 행은 토론 기준 빌드 b1550(2023-11, FA 없음)이라 지금 빌드보다 느리다(같은 M2 Ultra 94.27 → 2026-08 c1d0e7a00+FA 125.21, 본문 빌드별 표). 지금 빌드(llama-bench 기본 FA auto 인 b9754 이후) 값 — M5 10코어 b10621 31.88(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18210351)·M5 Pro 20코어 66.33(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18213344)·M5 Pro 16코어 b11046 67.59(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18583406)·M5 Max 40코어 b10621 119.92(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18152504)·b9754 119.08(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-17386908) — 과 M4 계열의 유일한 새 빌드 값 M4 Max 32코어 b5440(FA 끔) 72.26(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-13218715)이 같은 식에서 0.69~0.85 → minimax 0.768 을 내림한 apple 0.76. Ultra 는 M2 Ultra c1d0e7a00+FA 125.21(본문)·M1 Ultra b10621 113.79(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18191340)·M5 Ultra b10621 179.10(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18683605)이 0.55~0.61 → minimax 0.580 을 내림한 apple-ultra 0.57. 옛 0.60·0.44 는 b1550 값(M4 Max 40코어 0.59·M4 Pro 0.72, Ultra 0.44~0.46)에 맞춘 값이었다. M4 칩은 지금 빌드 값이 없다 — 같은 칩의 b1550 → 지금 빌드는 M5 가 1.08배·M5 Pro 1.13배·M5 Max 1.17배, Ultra 1.33~1.36배라 b1550 에서 비포화가 컸던 칩일수록 많이 빨라졌다
// source(cpu moe): https://www.hardware-corner.net/guides/qwen3-hardware-requirements/ ("Dual-channel DDR5 5600 MHz · Qwen3 Q4 · 18–20" — 컨텍스트·CPU·백엔드 미기재라 10-15 D79 에 실측 레코드에서 뺐다, 값은 유지). 같은 쪽의 조건이 밝혀진 근거는 CPU_MOE_RAM_EFF 0.5(전문가를 RAM 에서 읽는 효율) — 0.43 은 그보다 낮은 보수값
export const EFF: Readonly<Record<EffClass, { dense: number; moe?: number }>> = Object.freeze({
  nvidia: { dense: 0.7 }, // 0.62~0.80, 대역폭 클수록↓ (5090은 0.62, 3060은 0.80 → effOverride)
  amd: { dense: 0.76 }, // Vulkan no-FA 4점 minimax — 10-15 D80
  'intel-arc': { dense: 0.59 }, // B580 실측
  apple: { dense: 0.76 }, // #4167 새 빌드 6점 minimax — 10-15 D83
  'apple-ultra': { dense: 0.57 }, // #4167 새 빌드 3점 minimax — 10-15 D83
  strix: { dense: 0.82 }, // Vulkan 지금 빌드 6점 minimax — 10-16 D90 (ROCm 은 0~14% 느리다)
  'dgx-spark': { dense: 0.78 }, // 개발진 결과 파일 b7941 (mmap 끔) — 10-15 D79
  cpu: { dense: 0.5, moe: 0.43 }, // ≥8코어 전제, 코어 부족 시 ×0.7 은 UI 안내 · moe 는 cpu-only 경로 전용
});

/** pp ≈ ppCoef × fp16Tflops (±40% "대략" 표기 전용, §3.5 — NVIDIA 140/TFLOP, Apple 57(M5 계열은 PP_COEF_NEURAL_ACCEL), AMD/Intel 30~40) */
// source: https://github.com/ggml-org/llama.cpp/discussions/15013 (CUDA pp512) · https://github.com/ggml-org/llama.cpp/discussions/10879 (7900 XTX Vulkan — 10-15 D79 재확인: 현재 표 pp512 3727 = 30/TFLOP, 옛 3532 = 29. 같은 표 9070 XT 52·9070 44·7800 XT 27, 15396 의 7900 XT ROCm pp2048 41(직접 변환한 BF16 파일 — 10-15 D81) → AMD 35 유지, ±40% "대략" 밴드 안)
// source(apple·apple-ultra, 10-16 D86 → D87): https://github.com/ggml-org/llama.cpp/discussions/4167 Llama 2 7B Q4_0 pp512 ÷ 카탈로그 fp16Tflops. Apple 의 fp16Tflops 는 위키백과 표의 FP32 이론값(https://en.wikipedia.org/w/index.php?title=Apple_silicon&oldid=1380050693 — 애플은 TFLOPS 미공개, 애플 GPU 는 FP16 FMA 처리량이 FP32 와 같다 https://github.com/philipturner/metal-benchmarks). D86 의 27 은 시드 값(FP32×2)에 맞춘 것이라 값이 절반쯤으로 바뀐 D87 에서 다시 맞췄다. M5 가 아닌 칩의 새 빌드 값 — M2 Ultra 76코어 c1d0e7a00+FA 1,488.81 ÷ 27.2 = 54.7(본문 빌드별 표) · M4 Max 32코어 b5440 762.81 ÷ 12.92 = 59.0(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-13218715) → minimax 56.8 → 57(내림 56 이면 M4 Max 32코어 −5.2% 로 회귀 9 의 ±5% 밖 — 각 +4.1%·−3.5%). 요약 표의 b1550(2023) 값 M4 221.29 · M4 Pro 20코어 439.78 · M4 Max 40코어 885.68 · M3 Ultra 80코어 1,471.24 · M2 Ultra 1,238.48 은 57 로 −3~+25% — ±40% 안. 카탈로그 밖 칩도 같은 수준 — M1 Ultra 64코어 b10621 1,179.89 ÷ 21.233 = 55.6(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18191340)
export const PP_COEF: Readonly<Partial<Record<EffClass, number>>> = Object.freeze({
  nvidia: 140,
  apple: 57,
  'apple-ultra': 57,
  amd: 35,
  'intel-arc': 35,
  strix: 35,
});

/**
 * GPU 코어마다 행렬곱 가속기가 있는 칩(Apple M5 계열 — `Hardware.neuralAccel`)의 pp 계수 (§3.5, 10-16 D86 → D87).
 * 같은 Apple 클래스라도 M5 는 프롬프트 처리가 TFLOP 당 M4 의 약 3배라 클래스 계수로는 ±40% 밴드 위로 벗어난다.
 */
// source: https://github.com/ggml-org/llama.cpp/discussions/4167 지금 빌드(b9754 이후, llama-bench FA auto) Llama 2 7B Q4_0 pp512 ÷ 카탈로그 fp16Tflops(위키백과 표의 FP32 이론값 — https://en.wikipedia.org/w/index.php?title=Apple_silicon&oldid=1380050693, D87. D86 의 78 은 시드 값 FP32×2 기준) — M5 10코어 b10621 722.79 ÷ 4.15 = 174.2(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18210351) · M5 Pro 16코어 b11046 1,340.44 ÷ 8.29 = 161.7(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18583406) · M5 Pro 20코어 1,620.64 ÷ 8.29 = 195.5(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18213344, 카탈로그 M5 Pro 는 두 구성을 한 행 — 20코어 값 8.29 로 둔다) · M5 Max 40코어 b10621 3,219.99 ÷ 16.59 = 194.1(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18152504) · b9754 3,347.44 ÷ 16.59 = 201.8(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-17386908) → minimax 179.5 를 내림한 179(각 ±12% 안, MAE 8.2%). M5 Ultra 80코어 b10621 4,944.66 ÷ 33.18 = 149.0(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18683605) 은 179 로 +20% — ±40% 안(계수 근거 밖). 출시 직후 빌드 M5 b6817 FA 켬 650.65(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-14821709)도 +14% 로 밴드 안 — 빌드가 아니라 칩 차이다. 가속기: https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/ · https://www.apple.com/newsroom/2026/03/apple-debuts-m5-pro-and-m5-max-to-supercharge-the-most-demanding-pro-workflows/ ("a Neural Accelerator in each GPU core")
export const PP_COEF_NEURAL_ACCEL = 179;

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

/**
 * MoE 토큰당 고정 시간(§3.1, 10-16 D88) — MoE 층마다 활성 전문가 하나당 µs. 토큰 시간 = 읽는 바이트 ÷ (dense 계수 × 대역폭)
 * + MoE 층 수 × topK × 이 값. 읽는 바이트는 비전문가 + 라우팅 전문가 × topK/experts(GGUF 헤더 분할)라 옛 "파일 × 활성/전체"
 * 근사가 놓친 공유 텐서 몫이 들어간다. 같은 모델의 Q4·Q8 처럼 바이트만 다른 실측에서 Q8 이 바이트 1.2~1.7배에 1.1~1.3배만 느린 것
 * (D86)과, 활성 파라미터가 작은 MoE 가 빠른 카드에서 대역폭 식 위로 못 가는 것(옛 235 tok/s 캡 — 지금 빌드 5090 gpt-oss-20b 412)을
 * 한 항으로 설명한다. 층 수만 곱한 꼴·상수 하나 꼴보다 층 × topK 꼴이 2026 빌드 45점에서 오차가 가장 작았다(평균 8.9%, 모두 ±20% 안 —
 * 옛 식은 17.2%·14점 밖). 값은 클래스별 점의 최대 오차를 가장 작게 하는 값(minimax, 0.1µs). 10-16 D90 에 strix 를 dense 0.82 로
 * 다시 맞추며 Strix Halo 4점을 더해 49점 — 평균 8.3%·최대 19.9%.
 * 클래스 값이 없는 intel-arc 는 가장 큰 클래스 값을 쓰고 이론 추정(±30%)으로 둔다 — B580 Vulkan gpt-oss-20b tg128 93.09
 * (https://github.com/ggml-org/llama.cpp/pull/18831) 이 그 값으로 −2%. 검증점은 test/fixtures.ts MOE_OVERHEAD_CASES.
 * (Apple 칩의 2025-08 빌드 값(#15396 gpt-oss 가이드)은 지금 빌드보다 느려 +10~+39% 과대 — 회귀 밖 참고점 MOE_OLD_BUILD_CASES)
 */
// source(apple, 9.8 — 5점 최대 7.9%): M5 Max 40코어 gpt-oss-20b tg32 157.46(https://github.com/ggml-org/llama.cpp/pull/29770 머지 열) · Qwen3.5-35B-A3B Q4_K_M tg128 117.75 · Q8_0 106.73 · Gemma 4 26B-A4B Q8_0 97.25(https://github.com/ggml-org/llama.cpp/pull/28948 머지 열) · M4 Max 40코어 Qwen3-30B-A3B-2507 Q4_K_M tg32 116.69(https://github.com/ggml-org/llama.cpp/pull/28439#issuecomment-5585850026)
// source(apple-ultra, 14.3 — 7점 최대 16.9%): M2 Ultra gpt-oss-20b tg32 126.59(https://github.com/ggml-org/llama.cpp/pull/29770) · Qwen3.5-35B-A3B Q4_K_M 104.87 · Q8_0 96.62 · Gemma 4 26B-A4B Q4_0 115.71 · Q8_0 92.19(https://github.com/ggml-org/llama.cpp/pull/28948) · Qwen3-30B-A3B Q8_0 94.35(https://github.com/ggml-org/llama.cpp/pull/28439#issuecomment-5585270736) · gpt-oss-120b b7948 85.60(https://github.com/ggml-org/llama.cpp/blob/3795cc1e89e16fbc145f8a5457ea30abd86e0d1d/benches/mac-m2-ultra/mac-m2-ultra.md)
// source(dgx-spark, 9.6 — 9점 최대 18.1%): 개발진 결과 파일 b7941 gpt-oss-20b·120b·Qwen3-Coder-30B-A3B Q8_0 × 깊이 0·8192(https://github.com/ggml-org/llama.cpp/blob/3795cc1e89e16fbc145f8a5457ea30abd86e0d1d/benches/dgx-spark/dgx-spark.md) · PDL 머지 열 tg128 gpt-oss-20b 84.05 · Nemotron 3 Nano 30B-A3B Q4_K_M 76.68 · Qwen3.5-35B-A3B Q4_K_M 62.98(https://github.com/ggml-org/llama.cpp/pull/22522)
// source(nvidia, 7.7 — 14점 최대 16.5%): gpt-oss-20b tg128 b9867 RTX 3090 210.37 · 4090 264.26 · 5090 411.96(https://github.com/ggml-org/llama.cpp/pull/25319) · RTX PRO 6000 Blackwell 353.16 · RTX 6000 Ada 253.90(https://github.com/ggml-org/llama.cpp/pull/19053) · PRO 6000 PDL 열 gpt-oss-20b 376.31 · Nemotron 3 Nano Q4_K_M 325.74 · Qwen3.5-35B-A3B Q4_K_M 233.26(https://github.com/ggml-org/llama.cpp/pull/22522) · PRO 6000 Max-Q Qwen3.6-35B-A3B UD-Q4_K_M 246.50 · Gemma 4 26B-A4B Q4_K_M 214.47(https://github.com/ggml-org/llama.cpp/pull/24706#issuecomment-4789353680) · Gemma 4 26B-A4B Q4_0 머지 열 3090 148.73 · 4090 186.33 · 5090 258.06(https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995) · 3090 Qwen3-30B-A3B UD-Q4_K_XL 202.26(https://github.com/ggml-org/llama.cpp/pull/20831#issuecomment-4285435222)
// source(amd, 15.5 — 7점 최대 19.9%): ROCm 머지 열 RX 7900 XTX gpt-oss-20b 172.41 · Gemma 4 26B-A4B Q6_K 96.90 · Radeon AI PRO R9700 150.79 · 87.97(https://github.com/ggml-org/llama.cpp/pull/29478#issuecomment-5854628298) · RX 9060 XT gpt-oss-20b 84.81(https://github.com/ggml-org/llama.cpp/pull/25319) · Vulkan R9700 Qwen3.6-35B-A3B UD-Q4_K_XL 117.34(https://github.com/ggml-org/llama.cpp/issues/26795#issuecomment-5247488002) · RX 9070 XT gpt-oss-20b 177.89(https://github.com/ggml-org/llama.cpp/pull/21024#issuecomment-4460661536)
// source(strix, 14.3 — 7점 최대 9.0%, 10-16 D90 에 dense 0.82 로 다시 맞춤): Radeon 8060S Vulkan Qwen3.5-35B-A3B Q8_0 46.17(https://github.com/ggml-org/llama.cpp/issues/22375#issuecomment-4321102370) · Q6_K 53.77(https://github.com/ggml-org/llama.cpp/pull/24966#issuecomment-4787851707) · Qwen3.6-35B-A3B Q8_0 b9586 50.57(https://github.com/ggml-org/llama.cpp/issues/24438) · gpt-oss-20b 72.68 · Qwen3-30B-A3B Q2_K 91.60(https://github.com/ggml-org/llama.cpp/pull/19625 머지 열) · Qwen3.5-122B-A10B Q4_K_M 22.40(https://github.com/ggml-org/llama.cpp/issues/25207#issuecomment-4863716589) · ROCm gpt-oss-120b 50.2(https://quozul.dev/posts/2025-10-27-gpt-oss-120b-on-ryzen-ai-max-395/). D88 의 2.1 은 dense 0.65 가 지금 Vulkan dense(0.82)보다 낮은 몫을 메우던 값이었다
// source(strix ROCm, 회귀 밖 참고): 같은 빌드 ROCm 은 MoE 가 Vulkan 보다 ~12% 느리다 — AMD 재현 b9592 Qwen3.6-35B-A3B Q8_0 Vulkan 52.2~52.4 vs ROCm 46.0~46.2(https://github.com/ggml-org/llama.cpp/issues/24438#issuecomment-4690618844, 14.3 으로 +9%) · ROCm 10.0 Qwen3-30B-A3B Q4_K_M 77.1(https://github.com/ggml-org/llama.cpp/pull/29450#issuecomment-5843050524, −13%)
// source: https://github.com/ggml-org/llama.cpp/pull/28948 · https://github.com/ggml-org/llama.cpp/pull/22522 · https://github.com/ggml-org/llama.cpp/pull/25319 외 — 클래스별 근거 점은 위 source(클래스) 줄 (docs/02 §3.1·§7, research/hardware.md §6)
export const MOE_EXPERT_OVERHEAD_US: Readonly<Partial<Record<EffClass, number>>> = Object.freeze({
  nvidia: 7.7,
  amd: 15.5,
  apple: 9.8,
  'apple-ultra': 14.3,
  strix: 14.3,
  'dgx-spark': 9.6,
});

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
 * 검증 최대 오차를 상회하도록 설정 — 밴드가 검증값보다 좁으면 안 됨. 속도 12점 최대 10.5%(M5 Pro — 10-16 D88 전에는 15.4% 5060 Ti MoE,
 * 10-15 D83 전에는 17.1% M4 Pro b1550) · MoE 2026 빌드 49점 최대 19.9%(±20% 안, 10-16 D88·D90).
 */
// source: docs/02 §4 (policy) — 검증 근거는 §7 (속도 12점 MAE 4.2% / max 10.5% · MoE 49점 MAE 8.3% / max 19.9%, verify-regression.test.ts)
export const BANDS = Object.freeze({
  calibratedDgpuDense: 0.12,
  calibratedOther: 0.2,
  theoretical: 0.3,
});
