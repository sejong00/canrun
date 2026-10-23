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

/**
 * pp 기준값 = 계수 × FP16 TFLOPS(행렬 코어 값이 따로 있으면 `fp16MatrixTflops`) — Llama 2 7B Q4_0 pp512 상당(§3.5).
 * 모델별 pp 는 이 기준값을 실효 파라미터로 나눈다(`ppEstimate` — PP_FIXED_SHARE·PP_MOE·PP_KQUANT_FACTOR, 10-16 D91).
 * 10-16 D91 에 nvidia·amd·strix 를 지금 빌드(2026, llama-bench 기본 FA auto) 다모델 실측으로 다시 맞추고 dgx-spark 를 더했다 —
 * 클래스 점 전체(모델 크기·MoE·양자화가 다른 점과 7B Q4_0 스코어보드 점)의 최대 오차를 가장 작게 하는 값(minimax). Apple 은 D87 그대로.
 */
// source(nvidia, 30점 — 비 123.9~203.3, minimax 154.0 → 각 ±24.3%): https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995 (2026-05 master, 3090·4090·5090 × Llama 3.2 1B·Gemma 2B·Llama 3.1 8B Q4_0·Gemma 4 26B-A4B Q4_0) · https://github.com/ggml-org/llama.cpp/pull/25319 (b9867 pp2048 ub512, gpt-oss-20b·8B Q4_0) · https://github.com/ggml-org/llama.cpp/pull/19378 (4090 1~4장 -sm layer pp512 — 같은 PR 표에서 8B Q4_0 이 1~4장 12,731·12,837·12,285·12,023 으로 장수와 무관: Qwen3.5 27B Q4_0·Q8_0 · Gemma 4 31B Q4_K_M·Q8_0 · Llama 3.x 70B Q4_K_M · 1B·8B F16, https://github.com/ggml-org/llama.cpp/pull/19378#issuecomment-3897437729 1장 8B Q4_0) · 스코어보드 7B Q4_0 FA 켬 3090 b10809 5,973.72(https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-18332268)·b9011 5,992.10(https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-16797292) · 3060 12GB 2,407.93(https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-18108605) · 5060 Ti 4,613.86(https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-16020010) · 5060 3,799.47(https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-17364014). 옛 140 은 FA 끔·2025 빌드 표 값이었다. 4090 은 TFLOP 당 느리고(147~150) 5060 계열은 빠르다(195~198) — 카드 차이라 클래스 값 하나로는 ±24% 가 한계
// source(amd, 15점 — 행렬 TFLOPS 기준 비 20.0~31.6, minimax 24.53 → 24.5): RX 9060 XT ROCm https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995 (1B·2B·8B Q4_0·Gemma 4 26B-A4B) · https://github.com/ggml-org/llama.cpp/pull/25319 (gpt-oss-20b·8B) · Vulkan 7B Q4_0 3,228.15(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18709094) · RX 9070 XT Vulkan https://github.com/ggml-org/llama.cpp/pull/21024#issuecomment-4460661536 (gpt-oss-20b·8B Q4_0·Q8_0) · https://github.com/ggml-org/llama.cpp/pull/21751#issuecomment-4297412913 (13B Q5_K_M·8B Q4_K_S) · 7B Q4_0 5,505.31(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-16350652) · RX 7900 XTX Vulkan 7B Q4_0 b10868 3,889.54(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18386832) · Qwen3.8-27B IQ3_XXS b11065 914.90(https://github.com/ggml-org/llama.cpp/issues/28843#issuecomment-5772682741). 행렬 FP16 은 AMD 사양 "Peak Half Precision (FP16 Matrix) Performance" — RDNA4 는 카탈로그 fp16Tflops 의 2배(9070 XT 195 https://www.amd.com/en/products/graphics/desktops/radeon/9000-series/amd-radeon-rx-9070xt.html · 9060 XT 103 https://www.amd.com/en/products/graphics/desktops/radeon/9000-series/amd-radeon-rx-9060xt.html), RDNA3 는 같다(7900 XTX 123 https://www.amd.com/en/products/graphics/desktops/radeon/7000-series/amd-radeon-rx-7900xtx.html). 카탈로그 fp16Tflops 로는 7B Q4_0 이 RDNA3 32/TFLOP·RDNA4 57~63/TFLOP 로 갈려 옛 35 가 9060 XT 를 −44% 로 봤다(ROCm 도 같은 비 — https://github.com/ggml-org/llama.cpp/discussions/15021)
// source(strix, 4점 — 비 57.4~86.5, minimax 69.0, Vulkan 지금 빌드): 7B Q4_0 b11349 1,704.30(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18711544) · Qwen3.6-35B-A3B UD-Q5_K_M 1,501.2·gpt-oss-120b 1,132.7 b11223 ub512(https://github.com/ggml-org/llama.cpp/issues/29892#issuecomment-5981486905) · Qwen3.8-27B Q5_K_XL ub2048 311.0(https://github.com/ggml-org/llama.cpp/pull/27554#issuecomment-5414311828). dense K-quant 은 PP_KQUANT_FACTOR.strix. 8월 전 빌드 표(#19625 2026-02·#21751 2026-04 — 같은 기기 8B Q4_0 947)는 지금의 0.55~0.65배라 뺐다. 옛 35 는 출처 없는 값이었다(7B 로 −39%)
// source(dgx-spark, 8점 — 비 43.1~66.6, minimax 52.3 → 52, 새로 둔다): https://github.com/ggml-org/llama.cpp/pull/22522 (2026-04 master 열 pp512 — Llama 3.2 3B·Qwen3 4B·Qwen3.5 27B·Llama 3.x 70B Q4_K_M, gpt-oss-20b·Qwen3.5-35B-A3B·Nemotron 3 Nano·Super). 이전에는 계수가 없어 DGX Spark 의 pp 를 보이지 않았다
// source(intel-arc 35, 그대로 — 지금 빌드 표준 모델 실측 없음): B580 Vulkan 2025 빌드 7B Q4_0 b6527 621(data/benchmarks.json s4-b580-l27b) 로는 −35%. 2026-10 빌드는 Gemma 4 E4B Q4_0 pp512 3,286(https://github.com/ggml-org/llama.cpp/issues/30009) 로 훨씬 빨라졌다 — 표준 모델 값이 나오면 다시 맞춘다
// source(apple·apple-ultra, 10-16 D86 → D87): https://github.com/ggml-org/llama.cpp/discussions/4167 Llama 2 7B Q4_0 pp512 ÷ 카탈로그 fp16Tflops. Apple 의 fp16Tflops 는 위키백과 표의 FP32 이론값(https://en.wikipedia.org/w/index.php?title=Apple_silicon&oldid=1380050693 — 애플은 TFLOPS 미공개, 애플 GPU 는 FP16 FMA 처리량이 FP32 와 같다 https://github.com/philipturner/metal-benchmarks). D86 의 27 은 시드 값(FP32×2)에 맞춘 것이라 값이 절반쯤으로 바뀐 D87 에서 다시 맞췄다. M5 가 아닌 칩의 새 빌드 값 — M2 Ultra 76코어 c1d0e7a00+FA 1,488.81 ÷ 27.2 = 54.7(본문 빌드별 표) · M4 Max 32코어 b5440 762.81 ÷ 12.92 = 59.0(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-13218715) → minimax 56.8 → 57(내림 56 이면 M4 Max 32코어 −5.2% 로 회귀 9 의 ±5% 밖 — 각 +4.1%·−3.5%). 요약 표의 b1550(2023) 값 M4 221.29 · M4 Pro 20코어 439.78 · M4 Max 40코어 885.68 · M3 Ultra 80코어 1,471.24 · M2 Ultra 1,238.48 은 57 로 −3~+25% — ±40% 안. 카탈로그 밖 칩도 같은 수준 — M1 Ultra 64코어 b10621 1,179.89 ÷ 21.233 = 55.6(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18191340)
// source: https://github.com/ggml-org/llama.cpp/discussions/15013 · https://github.com/ggml-org/llama.cpp/discussions/10879 · https://github.com/ggml-org/llama.cpp/discussions/4167 · https://github.com/ggml-org/llama.cpp/pull/22522 (클래스별 근거는 위 source(클래스) 줄 — docs/02 §3.5·§7)
export const PP_COEF: Readonly<Partial<Record<EffClass, number>>> = Object.freeze({
  nvidia: 154,
  apple: 57,
  'apple-ultra': 57,
  amd: 24.5, // 행렬 FP16 TFLOPS(fp16MatrixTflops) 기준
  'intel-arc': 35,
  strix: 69,
  'dgx-spark': 52,
});

/**
 * GPU 코어마다 행렬곱 가속기가 있는 칩(Apple M5 계열 — `Hardware.neuralAccel`)의 pp 계수 (§3.5, 10-16 D86 → D87).
 * 같은 Apple 클래스라도 M5 는 프롬프트 처리가 TFLOP 당 M4 의 약 3배라 클래스 계수로는 ±40% 밴드 위로 벗어난다.
 */
// source: https://github.com/ggml-org/llama.cpp/discussions/4167 지금 빌드(b9754 이후, llama-bench FA auto) Llama 2 7B Q4_0 pp512 ÷ 카탈로그 fp16Tflops(위키백과 표의 FP32 이론값 — https://en.wikipedia.org/w/index.php?title=Apple_silicon&oldid=1380050693, D87. D86 의 78 은 시드 값 FP32×2 기준) — M5 10코어 b10621 722.79 ÷ 4.15 = 174.2(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18210351) · M5 Pro 16코어 b11046 1,340.44 ÷ 8.29 = 161.7(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18583406) · M5 Pro 20코어 1,620.64 ÷ 8.29 = 195.5(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18213344, 카탈로그 M5 Pro 는 두 구성을 한 행 — 20코어 값 8.29 로 둔다) · M5 Max 40코어 b10621 3,219.99 ÷ 16.59 = 194.1(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18152504) · b9754 3,347.44 ÷ 16.59 = 201.8(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-17386908) → minimax 179.5 를 내림한 179(각 ±12% 안, MAE 8.2%). M5 Ultra 80코어 b10621 4,944.66 ÷ 33.18 = 149.0(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18683605) 은 179 로 +20% — ±40% 안(계수 근거 밖). 출시 직후 빌드 M5 b6817 FA 켬 650.65(https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-14821709)도 +14% 로 밴드 안 — 빌드가 아니라 칩 차이다. 가속기: https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/ · https://www.apple.com/newsroom/2026/03/apple-debuts-m5-pro-and-m5-max-to-supercharge-the-most-demanding-pro-workflows/ ("a Neural Accelerator in each GPU core")
export const PP_COEF_NEURAL_ACCEL = 179;

/** pp 기준 모델 — Llama 2 7B(스코어보드 #4167·#15013·#10879 의 llama-bench params 6.74 B). 실효 파라미터가 이 값이면 pp = 기준값 (§3.5) */
// source: https://github.com/ggml-org/llama.cpp/discussions/4167 (llama 7B Q4_0 | 3.56 GiB | 6.74 B)
export const PP_REF_PARAMS_B = 6.74;

/**
 * pp 의 토큰당 고정 몫(§3.5, 10-16 D91) — 기준(7B) 토큰 시간 중 모델 크기와 상관없는 비율 φ.
 * pp = 기준값 ÷ (φ + (1 − φ) × 실효 파라미터 / 6.74). 프롬프트 처리 연산량은 토큰당 약 2 × 파라미터라 큰 모델은 거의 반비례로
 * 느려지고(4090 8B → 70B 실측 1/8.8 · 파라미터 비 8.8), 작은 모델은 모델과 무관한 시간(어텐션·정규화·커널 실행) 때문에 비만큼 빨라지지 않는다
 * (4090 1B 는 8B 의 3.6배 — 파라미터 비 6.5). 빠른 GPU 일수록 이 몫이 크다(4090 0.17 · 3090 0.09 · Apple ≈ 0) — 하나로 둔 값은
 * 다모델 실측 97점(D91 회귀 11 + 회귀 9 의 Apple 7B 6점)에서 φ·MoE 계수·양자화 계수를 함께 격자로 골라 최대 오차가 가장 작은 조합의 값.
 */
// source: https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995 (같은 빌드 1B·2B·8B·26B-A4B, 3090·4090·5090·RX 9060 XT) · https://github.com/ggml-org/llama.cpp/pull/19378 (4090 1B~70B) · https://github.com/ggml-org/llama.cpp/pull/22522 (DGX Spark 3B~70B) — 근거 점은 test/fixtures.ts PP_SIZE_CASES
export const PP_FIXED_SHARE = 0.05;

/** llama.cpp 기본 ubatch(llama-server·llama-bench, Ollama·LM Studio 도 512) — MoE 전문가당 토큰 수의 기준(§3.5) */
// source: https://github.com/ggml-org/llama.cpp/blob/a30fb4924dcfec81c1b2c20634bd47fa4403061a/common/common.h#L458-L459 (n_ubatch = 512) · https://github.com/ggml-org/llama.cpp/blob/a30fb4924dcfec81c1b2c20634bd47fa4403061a/tools/llama-bench/llama-bench.cpp#L392
export const PP_UBATCH = 512;

/**
 * MoE pp 의 실효 파라미터(§3.5, 10-16 D91) = 활성 × activeFactor × (refTokensPerExpert / 전문가당 토큰)^tokenExp,
 * 전문가당 토큰 = ubatch × topK/experts. ubatch 의 토큰이 전문가에 나뉘어 전문가마다 작은 행렬곱이 되므로 활성 파라미터만큼 빠르지 않고,
 * 전문가가 많고 topK 가 작을수록(전문가당 토큰이 적을수록) 더 느리다 — 같은 4090 에서 gpt-oss-20b(32·top-4, 전문가당 64토큰)는
 * 활성 3.6B 인데 8B dense 와 비슷하고, Qwen3.5-35B-A3B(256·top-8, 16토큰)는 활성 3B 인데 8B 의 0.6배.
 * refTokensPerExpert 64 는 gpt-oss-20b·ub512 를 1 로 두는 기준(정의). ub 2048 실측(Apple 표 대부분)도 이 식으로 같이 맞는다.
 */
// source: https://github.com/ggml-org/llama.cpp/pull/25319 (gpt-oss-20b·8B, 3090·4090·5090·RX 9060 XT) · https://github.com/ggml-org/llama.cpp/pull/22522 (DGX Spark MoE 4종) · https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646 · https://github.com/ggml-org/llama.cpp/pull/28948 (M5 Max·M2 Ultra Gemma 4 26B-A4B·Qwen3.5-35B-A3B) · https://github.com/ggml-org/llama.cpp/issues/29892#issuecomment-5981486905 (Strix Halo) — MoE 30점 MAE 10.3%·최대 34.9%(test/fixtures.ts PP_SIZE_CASES)
export const PP_MOE = Object.freeze({
  activeFactor: 1.9,
  tokenExp: 0.35,
  refTokensPerExpert: 64,
});

/**
 * dense K-quant·i-quant(Q2_K~Q6_K·IQ*·UD-*) pp 계수(§3.5, 10-16 D91) — 행렬곱이 빠른 칩은 역양자화가 병목이라 Q4_0·Q8_0 보다 느리다.
 * M5 계열: 같은 기기·같은 빌드에서 Qwen3.5 27B Q4_K_M 이 Q8_0 의 0.49배(M5 Max pp2048 356.52 vs 721.19), M5 Qwen3.5-9B Q4_K_M 은 식(Q4_0 기준)의 0.74배.
 * Strix Halo(Vulkan): Qwen3.8-27B Q5_K_XL 이 7B Q4_0 기준 식의 0.6배 안팎. MoE(mul_mat_id)는 같은 기기에서 Q4_K_M ≈ Q8_0(M5 Max 3,652 vs 3,563)이라 dense 만.
 * 그 밖의 클래스는 Q4_K_M 이 Q4_0 의 0.9~1.0배(4090 8B 11,680 vs 12,477 — #19378)라 계수를 두지 않는다
 */
// source: https://github.com/ggml-org/llama.cpp/pull/28948 (M5 Max·M2 Ultra Qwen3.5 27B Q4_K_M·Q8_0 같은 빌드) · https://github.com/ggml-org/llama.cpp/pull/28439#issuecomment-5847308681 (M5 Qwen3.5-9B Q4_K_M) · https://github.com/ggml-org/llama.cpp/pull/27554#issuecomment-5414311828 (Strix Halo Qwen3.8-27B Q5_K_XL)
export const PP_KQUANT_FACTOR = Object.freeze({
  neuralAccel: 0.6,
  strix: 0.6,
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

/**
 * 통합 메모리 여러 대(§6.2 클러스터, 10-23 D118 — DGX Spark) llama.cpp RPC 층 분할의 토큰당 추가 시간 ms — 대 사이 이동(대수 − 1)마다 더한다.
 * 같은 사람·같은 빌드·같은 조건의 1대/2대 tg 쌍에서 1/2대 − 1/1대 로 역산했다. 값은 **TCP 기본 설정(CPU 유휴 상태 켬)** 의 판정 기준 깊이(8,192 — 엔진의 8k
 * 추정은 KV 를 ctx 만큼 읽는다)인 4.93ms 를 0.1ms 위로 올린 값이다 — 깊이 8k 이하의 TCP 기본 설정 점(3.60·3.86·4.93·4.16·0)은 모두 추정이 실측 이하(보수).
 * 근거 범위: TCP 기본 3.6~7.95ms(깊이 0~32k — 깊이가 깊을수록 커진다, 32k 는 이 값으로 +10.3% 과대) · CPU 유휴 상태 끔(cpupower idle-set -D 0) 1.45~6.59ms ·
 * RDMA(RoCEv2) 1.0~1.4ms(깊이 2k) — 이 둘은 추정보다 빠르다(최대 −16.4%). 2대 실측만 있다 — 3·4대는 이동 횟수로 늘린 이론값이고(4대 RPC 공개 실측 없음),
 * 회귀는 test/fixtures.ts CLUSTER_RPC_PAIRS(verify-regression 17)
 */
// source: https://github.com/ggml-org/llama.cpp/discussions/16578#discussioncomment-15078806 (DGX Spark 2대 RPC TCP 기본 설정, 같은 빌드 b7157 gpt-oss-120b MXFP4 tg32 — 1대 깊이 0·4096·8192·16384·32768 = 60.36·56.84·53.20·49.15·42.41, 2대 49.59·46.61·42.15·38.82·31.72 → 3.60·3.86·4.93·5.41·7.95ms)
// source: https://github.com/ggml-org/llama.cpp/discussions/16578#discussioncomment-15139580 (같은 사람·같은 빌드, CPU 유휴 상태 끔 — 2대 55.49·50.51·45.99·41.53·33.15 → 1.45·2.21·2.95·3.73·6.59ms, ping 1.010 → 0.030ms)
// source: https://dev.classmethod.jp/en/articles/dgx-spark-two-node-clustering/ (b8012 tg256 — Qwen3-235B-A22B Q3_K_M 15.51 → 14.57 = 4.16ms, Devstral 2 123B Q4_K_M 2.64 → 2.64 = 0ms(표시 자릿수 ±1.4ms))
// source: https://dev.classmethod.jp/en/articles/dgx-spark-2node-deepseek-v4-flash-0731/ (RDMA RTT 0.7ms, ctx 2,048 — DeepSeek V4 Flash 0731 UD-IQ2_M 20.13 → 19.58 = 1.40ms · UD-IQ3_S 18.02 → 17.69 = 1.04ms)
export const RPC_HOP_TG_MS = 5;

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

/**
 * 층별 임베딩 표(PLE — Gemma 4 E2B·E4B, `ModelQuant.pleGB`) 모델의 토큰당 고정 시간 ms (§3.1, 10-21 D112 리뷰 반영).
 * 토큰 시간 = 읽는 바이트(파일 − 표) ÷ (dense 계수 × 대역폭) + 이 값. 같은 카드의 다른 dense 모델은 실측 − 대역폭 시간이
 * 0.14~0.72ms 인데(5090 Vulkan — llama 8B Q4_K_M 0.14 · llama 3B Q5_K 0.56 · llama 1B Q2_K 0.62 · phi3 0.72) E 계열만 1.7~1.8ms 라
 * dense 공통 항(PROGRESS §2 엔진 후속 ⑭)으로는 메워지지 않는다 — 층마다 표의 행을 CPU 에서 꺼내 GPU 로 올리고 기다리는 시간
 * (#28618: 토큰마다 입력 2개를 CPU→GPU 로 보내며 매번 동기화)과 작은 층별 연산이다. 엔진은 백엔드를 입력받지 않아 클래스로 고른다 —
 * CUDA 로 도는 `PLE_CUDA_CLASSES` 는 `cuda`, 그 밖의 GPU 클래스(amd·intel-arc·strix 의 흔한 백엔드 Vulkan, 실측이 없는 Metal)는
 * 큰 쪽 `vulkan`(보수). CPU 경로에는 더하지 않는다(옮기는 일이 없다). 값은 백엔드별 점의 최대 오차를 가장 작게 하는 값(minimax, 0.05ms).
 * ubatch 1 pp256 점은 마지막 토큰만 출력층을 계산하므로(llama-bench pp 는 출력 지정 없는 배치 — 그때는 마지막 토큰만 출력:
 * https://github.com/ggml-org/llama.cpp/blob/e13469a323147aed0c93f5b4efde10fcc379e977/tools/llama-bench/llama-bench.cpp#L2154 ·
 * src/llama-batch.cpp#L120-L130) 읽기에서 출력층(임베딩 공유라 token_embd 사본)을 255/256 만큼 뺀 바이트로 맞췄다 — tg 는 출력층까지
 * 읽으므로 같은 카드의 실제 tg 는 그 점보다 느리다. 검증점은 test/fixtures.ts PLE_SPEED_CASES.
 */
// source(cuda, 1.35 — 6점 최대 11.0%): #29152 master 열 ubatch 1 pp256 Gemma 4 E2B Q4_0 — RTX 3090 298.02 · 4090 356.15 · 5090 470.11(https://github.com/ggml-org/llama.cpp/pull/29152) · DGX Spark 162.3(https://github.com/ggml-org/llama.cpp/pull/29152#pullrequestreview-5260306593) — 파일은 출처에 없어 llama-quantize Q4_0 인 ggml-org 파일로 본다(표 Q4_0 1.32GB · token_embd Q8_0 0.43GB, https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF) · RTX 3080 Ti E4B Q8_0 4k 프롬프트 뒤 생성 b10988 112.9(https://atomic.chat/blog/guides/best-local-llm-12gb) · RTX 4070 Ti E4B Q8_0 tg128 b8641 69.66(https://alfonsofortunato.com/blog/gemma-4-e4b-vs-26b-local-benchmarks/). 실측 − 대역폭 시간 −0.41(4070 Ti — 작은 대역폭 카드라 클래스 계수 0.70 이 낮다)~+1.68ms(3090), minimax 1.36 → 1.35(3090 +11.0% · 4070 Ti −10.9%)
// source(vulkan, 1.75 — 2점 최대 2.3%): RTX 5090 Vulkan tg128 수정 후 표 E4B Q4_K_M 233.96 · E2B Q4_K_M 341.76(https://github.com/ggml-org/llama.cpp/pull/28618, unsloth 파일) — 실측 − 대역폭 시간 1.84·1.73ms, minimax 1.78 → 0.05ms 격자에서 1.75(E4B +2.3% · E2B −0.7%, 1.8 이면 E2B −2.4%). 회귀 밖 참고: Arc B580 SYCL E4B Q4_0 82.3 은 −3.3%(https://github.com/ggml-org/llama.cpp/discussions/23313#discussioncomment-17291611), Arc A770 Vulkan +78%(https://github.com/ggml-org/llama.cpp/discussions/26823 — intel-arc 계수 문제)
// source: https://github.com/ggml-org/llama.cpp/pull/29152 · https://github.com/ggml-org/llama.cpp/pull/28618 외 — 백엔드별 근거 점은 위 source(백엔드) 줄 (docs/02 §3.1·§7)
export const PLE_TOKEN_OVERHEAD_MS = Object.freeze({
  cuda: 1.35,
  vulkan: 1.75,
});

/** `PLE_TOKEN_OVERHEAD_MS.cuda` 를 쓰는 클래스 — llama.cpp 를 CUDA 로 돌리는 NVIDIA 카드·DGX Spark (그 밖의 GPU 클래스는 vulkan 값) */
// source: docs/02 §3.1 (policy)
export const PLE_CUDA_CLASSES: readonly EffClass[] = Object.freeze(['nvidia', 'dgx-spark']);

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
