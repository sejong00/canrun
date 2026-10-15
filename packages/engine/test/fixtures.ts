/**
 * 실측 대조 픽스처 — verify_engine.py (2026-08-09 검증) 의 표를 1:1 이식.
 * 값 출처: docs/02-engine-spec.md §7, docs/03-data-spec.md §3(모델 arch·fileGB)·§4(실측 표).
 *
 * 주의: 여기 수치는 "실측"이므로 임의 수정 금지 — 바꾸려면 출처 URL 과 함께
 * docs/02 §7 갱신이 선행되어야 한다 (CLAUDE.md 규칙 1).
 */

import type { EffClass, GpuUnit, Hardware, ModelQuant, QuantId } from '../src/types';

// ---------- 1) 가중치: params × bpw/8 vs 실제 GGUF 크기 (11종, HF 실측) ----------
export type WeightsCase = {
  name: string;
  paramsB: number;
  quant: QuantId;
  /** HF 저장소의 실제 파일 크기 (decimal GB) */
  actualGB: number;
};

export const WEIGHTS_CASES: readonly WeightsCase[] = [
  { name: 'Llama-3.1-8B', paramsB: 8.03, quant: 'Q4_K_M', actualGB: 4.92 },
  { name: 'Llama-3.1-8B', paramsB: 8.03, quant: 'Q8_0', actualGB: 8.54 },
  { name: 'Llama-3.1-8B', paramsB: 8.03, quant: 'Q2_K', actualGB: 3.18 },
  { name: 'Llama-3.1-8B', paramsB: 8.03, quant: 'IQ4_XS', actualGB: 4.45 },
  { name: 'Qwen3-8B', paramsB: 8.2, quant: 'Q4_K_M', actualGB: 5.03 },
  { name: 'Qwen3-14B', paramsB: 14.8, quant: 'Q4_K_M', actualGB: 9.0 },
  { name: 'Qwen3-32B', paramsB: 32.8, quant: 'Q4_K_M', actualGB: 19.76 },
  { name: 'Gemma3-27B', paramsB: 27.4, quant: 'Q4_K_M', actualGB: 16.55 },
  { name: 'Llama-3.3-70B', paramsB: 70.6, quant: 'Q4_K_M', actualGB: 42.52 },
  { name: 'Mistral-Small-3.2-24B', paramsB: 23.6, quant: 'Q4_K_M', actualGB: 14.33 },
  { name: 'Phi-4-14.7B', paramsB: 14.7, quant: 'Q4_K_M', actualGB: 9.05 },
];

// ---------- 2) KV 캐시: 2·L·kvHeads·headDim·2B vs 공식 KiB/tok (7종) ----------
export type KvCase = {
  name: string;
  layers: number;
  kvHeads: number;
  headDim: number;
  /** 알려진 값 (KiB/tok, f16) */
  expectKiB: number;
};

export const KV_CASES: readonly KvCase[] = [
  { name: 'Llama-3.1-8B', layers: 32, kvHeads: 8, headDim: 128, expectKiB: 128 },
  { name: 'Qwen3-8B', layers: 36, kvHeads: 8, headDim: 128, expectKiB: 144 },
  { name: 'Qwen3-14B', layers: 40, kvHeads: 8, headDim: 128, expectKiB: 160 },
  { name: 'Qwen3-32B', layers: 64, kvHeads: 8, headDim: 128, expectKiB: 256 },
  { name: 'Llama-3.3-70B', layers: 80, kvHeads: 8, headDim: 128, expectKiB: 320 },
  { name: 'Phi-4', layers: 40, kvHeads: 10, headDim: 128, expectKiB: 200 },
  { name: 'Qwen3-30B-A3B', layers: 48, kvHeads: 4, headDim: 128, expectKiB: 96 },
];

// ---------- 3) 속도 12점: tg = eff × BW / (weights + kvRead) vs llama.cpp 실측 ----------
/**
 * effOverride 는 §3.2 주석("대역폭 클수록↓: 5090은 0.62, 3060은 0.80")의 기기별 실측 계수.
 * 미지정 케이스는 클래스 기본값(EFF 표)이 그대로 재현해야 한다.
 */
export type SpeedCase = {
  label: string;
  hw: Hardware;
  mq: ModelQuant;
  ctx: number;
  /** llama.cpp 실측 tg tok/s (출처: docs/03 §4 실측 표) */
  measuredTg: number;
  /** §4 클래스 밴드: NVIDIA·AMD dGPU dense 0.12, 그 외·MoE·CPU 0.20 */
  band: number;
};

const dgpu = (
  vramGB: number,
  memBandwidthGBs: number,
  effClass: EffClass,
  effOverride?: number,
): Hardware => ({
  kind: 'dgpu',
  os: 'linux',
  vramGB,
  memBandwidthGBs,
  ramGB: 64,
  ramBandwidthGBs: 89.6,
  effClass,
  effOverride,
  isDisplayGpu: false,
});

const unified = (
  ramGB: number,
  memBandwidthGBs: number,
  effClass: EffClass,
  effOverride?: number,
): Hardware => ({
  kind: 'unified',
  os: 'macos',
  memBandwidthGBs,
  ramGB,
  ramBandwidthGBs: memBandwidthGBs,
  effClass,
  effOverride,
});

/** dense 모델 축약 생성 (fileGB·kvBytesPerToken 은 실측/공식값) */
const dense = (fileGB: number, kvKiB: number, paramsB: number): ModelQuant => ({
  paramsB,
  fileGB,
  quant: 'Q4_K_M',
  kvBytesPerToken: kvKiB * 1024,
  attnType: 'full',
  maxContext: 131072,
});

// llama-2-7b Q4_0: 3.83GB / 128 KiB — llama.cpp 공식 벤치 스레드의 표준 케이스
const L2_7B = dense(3.83, 128, 6.74);
// 같은 모델의 ggml-org/Llama-2-7B-GGUF Q4_0 — 토론 #4167 의 2026-08-25 안내(-hf)로 받는 파일, llama-bench 표기 3.53 GiB (10-15 D83)
const L2_7B_HF = dense(3.53 * 1.073741824, 128, 6.74);
const QWEN3_8B = dense(5.03, 144, 8.2);
const MISTRAL_7B = dense(4.37, 128, 7.25);

// gpt-oss-20b: MXFP4 12.11GB, 20.9B(3.6B active), KV 24 KiB (SWA 반영 사전 계산값) — docs/03 §3.
// 10-16 D88: 카탈로그 행과 같은 GGUF 헤더 분할(전문가 10.18 · 비전문가 1.30)과 24층 32E top-4 — MoE 속도식이 읽는 바이트·고정 시간에 쓴다
// source: https://huggingface.co/ggml-org/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-mxfp4.gguf
export const GPT_OSS_20B: ModelQuant = {
  paramsB: 20.9,
  activeParamsB: 3.6,
  fileGB: 12.11,
  quant: 'MXFP4',
  kvBytesPerToken: 24 * 1024,
  attnType: 'swa',
  nonExpertGB: 1.3,
  expertGB: 10.18,
  activeExpertFrac: 4 / 32,
  moeLayers: 24,
  topK: 4,
  maxContext: 131072,
};

// gpt-oss-120b: MXFP4 63.39GB, 116.8B(5.1B active), KV 36 KiB — docs/03 §3. 헤더 분할(전문가 61.07 · 비전문가 1.69), 36층 128E top-4 (10-16 D88)
// source: https://huggingface.co/ggml-org/gpt-oss-120b-GGUF
export const GPT_OSS_120B: ModelQuant = {
  paramsB: 116.8,
  activeParamsB: 5.1,
  fileGB: 63.39,
  quant: 'MXFP4',
  kvBytesPerToken: 36 * 1024,
  attnType: 'swa',
  nonExpertGB: 1.69,
  expertGB: 61.07,
  activeExpertFrac: 4 / 128,
  moeLayers: 36,
  topK: 4,
  maxContext: 131072,
};

export const SPEED_CASES: readonly SpeedCase[] = [
  // NVIDIA dGPU dense — 밴드 ±12%
  { label: '4090 L2-7B Q4_0 short', hw: dgpu(24, 1008, 'nvidia'), mq: L2_7B, ctx: 512, measuredTg: 186.2, band: 0.12 },
  { label: '3090 L2-7B Q4_0 short', hw: dgpu(24, 936, 'nvidia'), mq: L2_7B, ctx: 512, measuredTg: 158.2, band: 0.12 },
  { label: '3060 L2-7B Q4_0 short', hw: dgpu(12, 360, 'nvidia', 0.8), mq: L2_7B, ctx: 512, measuredTg: 75.6, band: 0.12 },
  { label: '5090 Qwen3-8B Q4 @16k', hw: dgpu(32, 1792, 'nvidia', 0.62), mq: QWEN3_8B, ctx: 16384, measuredTg: 145.3, band: 0.12 },
  { label: '4090 Qwen3-8B Q4 @16k', hw: dgpu(24, 1008, 'nvidia'), mq: QWEN3_8B, ctx: 16384, measuredTg: 104.3, band: 0.12 },
  { label: '3090 Qwen3-8B Q4 @16k', hw: dgpu(24, 936, 'nvidia'), mq: QWEN3_8B, ctx: 16384, measuredTg: 87.5, band: 0.12 },
  // Apple unified — 밴드 ±20%. 10-15 D83: 옛 2점(M4 Max 40코어 83.1·M4 Pro 50.7)은 토론 #4167 기준 빌드 b1550(2023-11)의 값이라
  // 지금 빌드 값으로 바꿨다. M4 는 지금 빌드 값이 없어 같은 자리(Max·Pro)의 M5 — 회귀 8 의 Apple dense 점과 같은 값
  { label: 'M5 Max 40c 7B Q4_0 (b10621)', hw: unified(128, 614, 'apple'), mq: L2_7B_HF, ctx: 512, measuredTg: 119.92, band: 0.2 },
  { label: 'M5 Pro 16c 7B Q4_0 (b11046)', hw: unified(64, 307, 'apple'), mq: L2_7B_HF, ctx: 512, measuredTg: 67.59, band: 0.2 },
  // CPU — 밴드 ±20%
  {
    label: 'CPU DDR5-5600 Mistral-7B Q4',
    hw: { kind: 'cpu', os: 'linux', memBandwidthGBs: 89.6, ramGB: 64, ramBandwidthGBs: 89.6, effClass: 'cpu' },
    mq: MISTRAL_7B,
    ctx: 512,
    measuredTg: 11.2,
    band: 0.2,
  },
  // MoE — 밴드 ±20%
  { label: '4090 gpt-oss-20b MoE', hw: dgpu(24, 1008, 'nvidia'), mq: GPT_OSS_20B, ctx: 2048, measuredTg: 225.2, band: 0.2 },
  { label: '5060Ti gpt-oss-20b MoE', hw: dgpu(16, 448, 'nvidia'), mq: GPT_OSS_20B, ctx: 2048, measuredTg: 111.6, band: 0.2 },
  // quozul.dev llama-bench 기본 pp512/tg128 (ROCm 7.0.2, mmap 끔) — 10-15 D80 에 ctx 2048 → 512 (출처와 맞춤).
  // 10-16 D88: 옛 effOverride 0.54(이 기기의 MoE 계수)를 뗐다 — MoE 도 클래스 dense 계수 + 토큰당 고정 시간
  { label: 'StrixHalo gpt-oss-120b MoE', hw: { ...unified(128, 256, 'strix'), os: 'linux' }, mq: GPT_OSS_120B, ctx: 512, measuredTg: 50.2, band: 0.2 },
];

// ---------- 4) 판정 새너티 (verify_engine.py §4 + docs/02 §8 시드) ----------
export const RTX_4060_8GB = dgpu(8, 272, 'nvidia');
RTX_4060_8GB.os = 'windows';
RTX_4060_8GB.isDisplayGpu = true;
RTX_4060_8GB.ramGB = 32;

export const RTX_3060_12GB: Hardware = { ...dgpu(12, 360, 'nvidia', 0.8), ramGB: 32 };
export const RTX_4090: Hardware = dgpu(24, 1008, 'nvidia');
export const M4_MAX_128: Hardware = unified(128, 546, 'apple');

export const LLAMA31_8B_Q4 = dense(4.92, 128, 8.03);
// 같은 파일 + GGUF 헤더 실측 offGpuGB(10-03 D62): token_embd(Q4_K, 4096×128256) 0.30GB 는 llama.cpp 가 시스템 RAM 에 둔다
// source: https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf
export const LLAMA31_8B_Q4_RESIDENT: ModelQuant = { ...LLAMA31_8B_Q4, offGpuGB: 0.3 };
export const QWEN3_8B_Q4 = QWEN3_8B;
export const QWEN3_14B_Q4 = dense(9.0, 160, 14.8);
export const LLAMA33_70B_Q4 = dense(42.52, 320, 70.6);

// qwen3-30b-a3b-2507: 30.5B(3.3 active), Q4 18.6GB, KV 96 KiB — docs/03 §3
export const QWEN3_30B_A3B_Q4: ModelQuant = {
  paramsB: 30.5,
  activeParamsB: 3.3,
  fileGB: 18.6,
  quant: 'Q4_K_M',
  kvBytesPerToken: 96 * 1024,
  attnType: 'full',
  nonExpertGB: 0.91, // P0-3 확정 — 128E top-8 유도 (packages/data/src/derive.ts)
  maxContext: 262144,
};

// qwen3.5-35b-a3b: 35.95B(~3 active), Q4 22.63GB, KV 20 KiB(hybrid)+state — docs/03 §3
export const QWEN35_35B_A3B_Q4: ModelQuant = {
  paramsB: 35.95,
  activeParamsB: 3,
  fileGB: 22.63,
  quant: 'Q4_K_M',
  kvBytesPerToken: 20 * 1024,
  attnType: 'hybrid',
  nonExpertGB: 1.22, // P0-3 확정 — 256E top-8+1shared 유도 (3060 12GB cpu-moe 실증: openclawdc 2026-07)
  maxContext: 262144,
};

// qwen3.6-35b-a3b Q4_K_M (bartowski) — GGUF 헤더 실측 분할(10-01): 트렁크 전문가 19.50GB, GPU 상주 비전문가 1.59GB
// (token_embd 0.29GB 는 CPU, MTP 블록 0.90GB 는 미로드), 40층, 256E top-8
// source: https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf
export const QWEN36_35B_A3B_Q4_SPLIT: ModelQuant = {
  paramsB: 35.95,
  activeParamsB: 3,
  fileGB: 22.27,
  quant: 'Q4_K_M',
  kvBytesPerToken: 20 * 1024,
  attnType: 'hybrid',
  nonExpertGB: 1.59,
  expertGB: 19.5,
  activeExpertFrac: 8 / 256,
  moeLayers: 40,
  topK: 8,
  maxContext: 262144,
};

// ---------- 5) cpu-moe 보정 (09-30 → 10-01, docs/02 §3.3·§7) — 공개 실측 ----------
// 09-30: 전문가 전부 RAM 3점(strict, 각 ±20%). 10-01(D56): 전문가 일부 GPU 배치(--n-cpu-moe N < 층 수)까지 넣은
// NVIDIA(CUDA)·AMD(ROCm) 공개 실측 — RAM 사양이 적혀 있고 GGUF 파일을 특정할 수 있는 것만(Vulkan·8채널 서버·32k 이상
// 깊은 컨텍스트·ik_llama.cpp·파인튜닝 파일 제외). 전 점 원문 재대조(10-01). 성분값 = 각 GGUF 헤더 실측(트렁크 전문가·GPU 상주
// 비전문가, token_embd·MTP 제외 — docs/02 §3.3), 파일 URL 은 각 상수 위 주석.
export type CpuMoeCase = {
  label: string;
  hw: Hardware;
  mq: ModelQuant;
  ctx: number;
  /** CPU 에 둔 전문가 층 수 (실측 글에 적힌 --n-cpu-moe / -ot 범위) */
  nCpuMoe: number;
  measuredTg: number;
  source: string;
  /** 09-30 회귀 3점 — 각 ±20% */
  strict?: boolean;
};

const withRam = (hw: Hardware, ramGB: number, ramBandwidthGBs: number): Hardware => ({ ...hw, ramGB, ramBandwidthGBs });

/** 모델 공통값 + 파일별 헤더 실측 분할 */
const moeFile = (
  base: Omit<ModelQuant, 'fileGB' | 'expertGB' | 'nonExpertGB'>,
  fileGB: number,
  expertGB: number,
  nonExpertGB: number,
): ModelQuant => ({ ...base, fileGB, expertGB, nonExpertGB });

type MoeBase = Omit<ModelQuant, 'fileGB' | 'expertGB' | 'nonExpertGB'>;
const OSS120: MoeBase = { paramsB: 116.8, activeParamsB: 5.1, quant: 'MXFP4', kvBytesPerToken: 36 * 1024, attnType: 'swa', activeExpertFrac: 4 / 128, moeLayers: 36, topK: 4, maxContext: 131072 };
const OSS20: MoeBase = { paramsB: 20.9, activeParamsB: 3.6, quant: 'MXFP4', kvBytesPerToken: 24 * 1024, attnType: 'swa', activeExpertFrac: 4 / 32, moeLayers: 24, topK: 4, maxContext: 131072 };
const Q30: MoeBase = { paramsB: 30.5, activeParamsB: 3.3, quant: 'Q4_K_M', kvBytesPerToken: 96 * 1024, attnType: 'full', activeExpertFrac: 8 / 128, moeLayers: 48, topK: 8, maxContext: 262144 };
const Q35: MoeBase = { paramsB: 35.95, activeParamsB: 3, quant: 'Q4_K_M', kvBytesPerToken: 20 * 1024, attnType: 'hybrid', activeExpertFrac: 8 / 256, moeLayers: 40, topK: 8, maxContext: 262144 };

// https://huggingface.co/ggml-org/gpt-oss-120b-GGUF (카탈로그 행과 같은 MXFP4 파일)
const OSS120_MX = moeFile(OSS120, 63.39, 61.07, 1.69);
// https://huggingface.co/unsloth/gpt-oss-120b-GGUF/resolve/main/gpt-oss-120b-F16.gguf (전문가 MXFP4, 나머지 F16)
const OSS120_F16 = moeFile({ ...OSS120, quant: 'F16' }, 65.37, 61.07, 3.12);
// https://huggingface.co/ggml-org/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-MXFP4.gguf
const OSS20_MX = moeFile(OSS20, 12.11, 10.18, 1.3);
// https://huggingface.co/unsloth/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-F16.gguf (convert_hf_to_gguf 자체 변환 12.83GiB 와 같은 구성)
const OSS20_F16 = moeFile({ ...OSS20, quant: 'F16' }, 13.79, 10.18, 2.44);
// https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf
const Q30_Q4 = moeFile(Q30, 18.56, 17.55, 0.82);
// https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-UD-Q4_K_XL.gguf
const Q30_UDXL = moeFile(Q30, 17.72, 16.68, 0.85);
// https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf
const Q35_Q4 = moeFile(Q35, 22.02, 19.46, 2.0);
// https://huggingface.co/unsloth/Qwen3.5-35B-A3B-MTP-GGUF/resolve/main/Qwen3.5-35B-A3B-Q8_0.gguf (트렁크 분할 — 실측 글의 36.9GB 는 MTP 블록이 없는 판)
const Q35_Q8 = moeFile({ ...Q35, quant: 'Q8_0' }, 36.9, 34.23, 2.13);
// https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-MXFP4_MOE.gguf
const Q35_MXMOE = moeFile(Q35, 21.59, 18.91, 2.13);
// https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
const Q36_UD4 = moeFile(Q35, 22.13, 19.57, 2.01);
// https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-Q6_K.gguf
const Q36_UD6 = moeFile({ ...Q35, quant: 'Q6_K' }, 29.31, 26.62, 2.14);
// https://huggingface.co/localweights/Qwen3.6-35B-A3B-MTP-IQ4_XS-GGUF/resolve/main/Qwen3.6-35B-A3B-MTP-IQ4_XS.gguf
const Q36_MTP_IQ4 = moeFile({ ...Q35, quant: 'IQ4_XS' }, 19.39, 17.32, 1.34);

const nv = (bw: number, ramBw: number) => withRam(dgpu(16, bw, 'nvidia'), 64, ramBw);
const amd = (bw: number, ramBw: number) => withRam(dgpu(16, bw, 'amd'), 64, ramBw);
const DDR4_3200 = 51.2;
const DDR4_3600 = 57.6;
const DDR5_4800 = 76.8;
const DDR5_5200 = 83.2;
const DDR5_5600 = 89.6;
const DDR5_6000 = 96;
const DDR5_6400 = 102.4;
const DDR5_6800 = 108.8;

const S15396_LAPTOP = 'https://github.com/ggml-org/llama.cpp/discussions/15396#discussioncomment-14923651';
const S15396_3090 = 'https://github.com/ggml-org/llama.cpp/discussions/15396#discussioncomment-15552439';
const S15396_7900XT = 'https://github.com/ggml-org/llama.cpp/discussions/15396#discussioncomment-14143427';
const S16548 = 'https://github.com/ggml-org/llama.cpp/pull/16548#issuecomment-3409152005';
const S1N4V76J = 'https://www.reddit.com/r/LocalLLaMA/comments/1n4v76j/gptoss_120b_on_a_3060ti_25ts_vs_3090/';
const S1REI65V = 'https://www.reddit.com/r/LocalLLaMA/comments/1rei65v/qwen3535ba3b_quantization_quality_speed/';
const S1NDIT0A = 'https://www.reddit.com/r/LocalLLaMA/comments/1ndit0a/1631_toksec_on_gpt_oss_120b/';
const S1PBZUSN = 'https://www.reddit.com/r/LocalLLaMA/comments/1pbzusn/wth_when_did_rocm_become_actually_good_and_viable/';
const S1SOR55Y = 'https://www.reddit.com/r/LocalLLaMA/comments/1sor55y/rtx_5070_ti_9800x3d_running_qwen3635ba3b_at_79_ts/';
const S1T7L56A = 'https://www.reddit.com/r/LocalLLaMA/comments/1t7l56a/qwen_35ba3b_is_very_usable_with_12gb_of_vram/';
const CARTEAKEY = 'https://carteakey.dev/blog/optimizing-gpt-oss-120b-local-inference/';

const c = (
  label: string,
  hw: Hardware,
  mq: ModelQuant,
  nCpuMoe: number,
  measuredTg: number,
  source: string,
  extra: { ctx?: number; strict?: boolean } = {},
): CpuMoeCase => ({ label, hw, mq, ctx: extra.ctx ?? 512, nCpuMoe, measuredTg, source, ...(extra.strict ? { strict: true } : {}) });

export const CPU_MOE_CASES: readonly CpuMoeCase[] = [
  // 09-30 strict 3점 (전문가 전부 RAM)
  c('3060 Ti + DDR5-6800, gpt-oss-120b MXFP4 (--n-cpu-moe 999)', nv(448, DDR5_6800), OSS120_MX, 36, 24.85, S1N4V76J, { strict: true }),
  c('5080 + DDR5-4800, Qwen3.5-35B-A3B Q4_K_M (exps=CPU)', nv(960, DDR5_4800), Q35_Q4, 40, 51.0, S1REI65V, { strict: true, ctx: 2048 }),
  c('5080 + DDR5-4800, Qwen3.5-35B-A3B Q8_0 (exps=CPU)', nv(960, DDR5_4800), Q35_Q8, 40, 35.7, S1REI65V, { strict: true, ctx: 2048 }),
  // gpt-oss-120b MXFP4
  c('4070 + DDR5@2000MT/s, gpt-oss-120b --n-cpu-moe 31', nv(504, 32), OSS120_MX, 31, 9.72, CARTEAKEY),
  c('4070 + DDR5-6000, gpt-oss-120b --n-cpu-moe 31', nv(504, DDR5_6000), OSS120_MX, 31, 23.85, CARTEAKEY),
  c('4060 Laptop + DDR5-5200, gpt-oss-120b --n-cpu-moe 34', nv(256, DDR5_5200), OSS120_MX, 34, 18.85, S15396_LAPTOP),
  c('3090 + DDR5-5200, gpt-oss-120b --n-cpu-moe 24', nv(936, DDR5_5200), OSS120_MX, 24, 27.53, S15396_3090),
  c('3090 + DDR5-5200, gpt-oss-120b --n-cpu-moe 25', nv(936, DDR5_5200), OSS120_MX, 25, 26.9, S15396_3090),
  c('3090 + DDR5-5200, gpt-oss-120b --n-cpu-moe 26', nv(936, DDR5_5200), OSS120_MX, 26, 26.18, S15396_3090),
  c('3090 + DDR5-5200, gpt-oss-120b --n-cpu-moe 28', nv(936, DDR5_5200), OSS120_MX, 28, 24.37, S15396_3090),
  c('3090 + DDR5-5200, gpt-oss-120b --n-cpu-moe 32', nv(936, DDR5_5200), OSS120_MX, 32, 20.26, S15396_3090),
  c('3090 + DDR5-6400, gpt-oss-120b --n-cpu-moe 28 (server)', nv(936, DDR5_6400), OSS120_MX, 28, 30, 'https://github.com/ggml-org/llama.cpp/discussions/18049#discussioncomment-15397989', { ctx: 2048 }),
  c('5090 + DDR5-6400, gpt-oss-120b -ncmoe 24', nv(1792, DDR5_6400), OSS120_MX, 24, 37.59, S16548),
  c('5090 + DDR5-6400, gpt-oss-120b -ncmoe 99', nv(1792, DDR5_6400), OSS120_MX, 36, 28.58, S16548),
  c('3090 + DDR5-6800, gpt-oss-120b --n-cpu-moe 999', nv(936, DDR5_6800), OSS120_MX, 36, 26.08, S1N4V76J),
  c('3090 + DDR5-6800, gpt-oss-120b --n-cpu-moe 28', nv(936, DDR5_6800), OSS120_MX, 28, 30.44, S1N4V76J),
  c('RX 6900 XT ROCm + DDR5-5600, gpt-oss-120b --n-cpu-moe 28', amd(512, DDR5_5600), OSS120_MX, 28, 19.14, 'https://www.reddit.com/r/LocalLLaMA/comments/1ofxt6s/optimizing_gptoss120b_on_amd_rx_6900_xt_16gb/', { ctx: 2048 }),
  c('RX 9060 XT ROCm + DDR4-3600, gpt-oss-120b -ncmoe 33', amd(320, DDR4_3600), OSS120_MX, 33, 19.09, S1PBZUSN),
  c('RX 9060 XT ROCm + DDR4-3600, gpt-oss-120b -ncmoe 32', amd(320, DDR4_3600), OSS120_MX, 32, 19.46, S1PBZUSN),
  // gpt-oss-120b F16 (전문가 MXFP4)
  c('4060 Laptop + DDR5-5200, gpt-oss-120b F16 --n-cpu-moe 35', nv(256, DDR5_5200), OSS120_F16, 35, 17.41, S15396_LAPTOP),
  c('3060 12GB + DDR4-3200, gpt-oss-120b F16 --n-cpu-moe 31', nv(360, DDR4_3200), OSS120_F16, 31, 12.5, 'https://www.reddit.com/r/LocalLLaMA/comments/1n4v76j/gptoss_120b_on_a_3060ti_25ts_vs_3090/nbp799d/', { ctx: 2048 }),
  c('5090 + DDR5-6000, gpt-oss-120b F16 --n-cpu-moe 22', nv(1792, DDR5_6000), OSS120_F16, 22, 32.23, S1NDIT0A, { ctx: 2048 }),
  c('5090 + DDR4-3600, gpt-oss-120b F16 --n-cpu-moe 22', nv(1792, DDR4_3600), OSS120_F16, 22, 24, S1NDIT0A, { ctx: 2048 }),
  c('4090 (WSL2) + DDR5-5600, gpt-oss-120b F16 --n-cpu-moe 25', nv(1008, DDR5_5600), OSS120_F16, 25, 24.11, 'https://www.reddit.com/r/LocalLLaMA/comments/1nmhtsg/wsl2_windows_gaming_pc_benchmarks/'),
  // gpt-oss-20b
  c('4060 Laptop + DDR5-5200, gpt-oss-20b --n-cpu-moe 14', nv(256, DDR5_5200), OSS20_MX, 14, 42.32, S15396_LAPTOP),
  c('5090 + DDR5-6400, gpt-oss-20b -ncmoe 99', nv(1792, DDR5_6400), OSS20_MX, 24, 42.14, S16548),
  c('RX 7900 XT ROCm + DDR4-3200, gpt-oss-20b BF16 -cmoe', amd(800, DDR4_3200), OSS20_F16, 24, 20, S15396_7900XT, { ctx: 2048 }),
  c('RX 7900 XT ROCm + DDR4-3200, gpt-oss-20b BF16 --n-cpu-moe 4', amd(800, DDR4_3200), OSS20_F16, 4, 60, S15396_7900XT, { ctx: 2048 }),
  c('RX 7900 XT ROCm + DDR4-3200, gpt-oss-20b BF16 --n-cpu-moe 8', amd(800, DDR4_3200), OSS20_F16, 8, 38, S15396_7900XT, { ctx: 2048 }),
  c('RX 7900 XT ROCm + DDR4-3200, gpt-oss-20b BF16 --n-cpu-moe 16', amd(800, DDR4_3200), OSS20_F16, 16, 26, S15396_7900XT, { ctx: 2048 }),
  // Qwen3 30B-A3B
  c('5090 + DDR5-6400, Qwen3-30B-A3B Q4_K -ncmoe 99', nv(1792, DDR5_6400), Q30_Q4, 48, 37.18, S16548),
  c('4060 Laptop + DDR5-5600, Qwen3-30B-A3B UD-Q4_K_XL -ncmoe 29', nv(256, DDR5_5600), Q30_UDXL, 29, 33.73, 'https://www.reddit.com/r/LocalLLaMA/comments/1o7kkf0/poor_gpu_club_8gb_vram_moe_models_ts_with_llamacpp/'),
  c('5070 + DDR4-3200 (4 DIMM), Qwen3-30B-A3B UD-Q4_K_XL layers 24-47 exps=CPU', nv(672, DDR4_3200), Q30_UDXL, 24, 28, 'https://news.ycombinator.com/item?id=44656949', { ctx: 2048 }),
  // Qwen3.5 / 3.6 35B-A3B
  c('5080 + DDR5-4800, Qwen3.5-35B-A3B Q4_K_M --n-cpu-moe 24', nv(960, DDR5_4800), Q35_Q4, 24, 69.6, S1REI65V, { ctx: 2048 }),
  c('5060 Ti + DDR5-5600, Qwen3.5-35B-A3B MXFP4_MOE -ncmoe 40', nv(448, DDR5_5600), Q35_MXMOE, 40, 50.14, 'https://www.reddit.com/r/LocalLLaMA/comments/1sus1pt/memory_upgrade_is_it_worth_it/'),
  c('5070 Ti + DDR5-6000, Qwen3.6-35B-A3B UD-Q4_K_M (fit → 19 layers)', nv(896, DDR5_6000), Q36_UD4, 19, 91.5, S1SOR55Y),
  c('5070 Ti + DDR5-6000, Qwen3.6-35B-A3B UD-Q4_K_M (fit → 18 layers)', nv(896, DDR5_6000), Q36_UD4, 18, 96.3, S1SOR55Y),
  c('3060 Ti + DDR4-3200, Qwen3.6-35B-A3B UD-Q6_K --n-cpu-moe 38', nv(448, DDR4_3200), Q36_UD6, 38, 33, 'https://www.reddit.com/r/LocalLLaMA/comments/1srijdf/qwen36_35b_moe_on_8gb_vram_working_llamaserver/ohf91nj/', { ctx: 2048 }),
  c('3060 12GB + DDR4-3200, Qwen3.6-35B-A3B MTP-IQ4_XS -ncmoe 17', nv(360, DDR4_3200), Q36_MTP_IQ4, 17, 46.6, S1T7L56A),
  c('3060 12GB + DDR4-3200, Qwen3.6-35B-A3B MTP-IQ4_XS -ncmoe 18', nv(360, DDR4_3200), Q36_MTP_IQ4, 18, 46.8, S1T7L56A),
  c('3060 12GB + DDR4-3200, Qwen3.6-35B-A3B MTP-IQ4_XS -ncmoe 20', nv(360, DDR4_3200), Q36_MTP_IQ4, 20, 41.7, S1T7L56A),
  c('3060 12GB + DDR4-3200, Qwen3.6-35B-A3B MTP-IQ4_XS -ncmoe 22', nv(360, DDR4_3200), Q36_MTP_IQ4, 22, 41.6, S1T7L56A),
];

// ---------- 6) 멀티 GPU (§6 베타, 10-01 D58) — 같은 GPU N 장, 층 나눠 올리기(-sm layer), 모델 전부 VRAM ----------
export type MultiGpuCase = { label: string; hw: Hardware; mq: ModelQuant; ctx: number; measuredTg: number; source: string };

const multi = (count: number, vramGB: number, bw: number, cls: EffClass): Hardware => ({ ...dgpu(vramGB, bw, cls), gpuCount: count });
// Llama 3 70B Q4_K_M — 42.52GB(bartowski), 80층 × kv 8 × 128 → 320 KiB/tok
const L3_70B_Q4 = dense(42.52, 320, 70.6);
// Qwen2 72B Q4_0 — 38.53 GiB = 41.37GB, 80층 × kv 8 × 128 → 320 KiB/tok
const Q2_72B_Q40 = dense(41.37, 320, 72.7);
// Gemma 4 31B Q8_0 — 30.38 GiB = 32.62GB, swa (전역 10/60층 × kv 4 × 512) → 80 KiB/tok (카탈로그 gemma-4-31b)
const G4_31B_Q8 = { ...dense(32.62, 80, 30.7), quant: 'Q8_0' as const, attnType: 'swa' as const };
const XD = 'https://github.com/XiongjieDai/GPU-Benchmarks-on-LLM-Inference';

export const MULTI_GPU_CASES: readonly MultiGpuCase[] = [
  { label: '2×3090 Llama 3 70B Q4_K_M tg512', hw: multi(2, 24, 936, 'nvidia'), mq: L3_70B_Q4, ctx: 512, measuredTg: 16.57, source: XD },
  { label: '4×3090 Llama 3 70B Q4_K_M tg512', hw: multi(4, 24, 936, 'nvidia'), mq: L3_70B_Q4, ctx: 512, measuredTg: 17.07, source: XD },
  { label: '2×4090 Llama 3 70B Q4_K_M tg512', hw: multi(2, 24, 1008, 'nvidia'), mq: L3_70B_Q4, ctx: 512, measuredTg: 19.22, source: XD },
  { label: '4×4090 Llama 3 70B Q4_K_M tg512', hw: multi(4, 24, 1008, 'nvidia'), mq: L3_70B_Q4, ctx: 512, measuredTg: 19.8, source: XD },
  { label: '4×4090 Llama 70B Q4_K_M tg128 (2026, -sm layer)', hw: multi(4, 24, 1008, 'nvidia'), mq: L3_70B_Q4, ctx: 128, measuredTg: 21.25, source: 'https://github.com/ggml-org/llama.cpp/pull/19378' },
  { label: '4×A6000 Llama 3 70B Q4_K_M tg512', hw: multi(4, 48, 768, 'nvidia'), mq: L3_70B_Q4, ctx: 512, measuredTg: 14.44, source: XD },
  { label: '4×A40 Llama 3 70B Q4_K_M tg512', hw: multi(4, 48, 696, 'nvidia'), mq: L3_70B_Q4, ctx: 512, measuredTg: 11.99, source: XD },
  { label: '4×RTX 4000 Ada Llama 3 70B Q4_K_M tg512', hw: multi(4, 20, 360, 'nvidia'), mq: L3_70B_Q4, ctx: 512, measuredTg: 7.36, source: XD },
  { label: '2×V100 32GB Qwen2 72B Q4_0 tg128', hw: multi(2, 32, 900, 'nvidia'), mq: Q2_72B_Q40, ctx: 128, measuredTg: 17.22, source: 'https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-14472498' },
  { label: '2×7900 XTX ROCm Gemma 4 31B Q8_0 tg128', hw: multi(2, 24, 960, 'amd'), mq: G4_31B_Q8, ctx: 128, measuredTg: 22.97, source: 'https://github.com/ggml-org/llama.cpp/discussions/15021#discussioncomment-18122692' },
];

// ---------- 7) 서로 다른 GPU 섞기 (§6 베타, 10-03 D67) — 층 나눠 올리기, `-ts` 없이 남은 메모리 비율 분할, 모델 전부 VRAM ----------
export type HeteroGpuCase = MultiGpuCase & {
  /** 'class' = 클래스 계수 그대로(카탈로그 계열 실측) · 'formula' = 카드별 단일 실측으로 effOverride 를 맞춰 식만 검증 */
  kind: 'class' | 'formula';
};

/** 카드 목록 하드웨어 — 위 필드는 1번 카드 값(타입 계약), 화면 출력 없음(헤드리스 벤치) */
export const hetero = (units: readonly GpuUnit[]): Hardware => ({
  ...dgpu(units[0]!.vramGB, units[0]!.memBandwidthGBs, units[0]!.effClass, units[0]!.effOverride),
  gpus: units,
});

// Gemma 4 31B Q4_K_M — 17.52 GiB = 18.81GB(실측 글의 파일), KV 80 KiB/tok (카탈로그 gemma-4-31b)
const G4_31B_Q4 = dense(18.81, 80, 30.7);
// Qwen3.5-9B Q4_K_M 5.681GB (https://huggingface.co/unsloth/Qwen3.5-9B-GGUF), KV 32 KiB/tok · Qwen3.8-27B 가중치 16.8GB, KV 64 KiB/tok (카탈로그)
const Q35_9B_Q4 = dense(5.681, 32, 9.65);
const Q38_27B_Q4 = dense(16.8, 64, 27.78);
const SPLIT_BENCH = 'https://github.com/kuraneko1/llama-split-bench/blob/272b0dee42afd60b823e769dd896630e6b13a402/examples/results-3060-p100.md';
// 카드별 단일 실측(깊이 0 디코드: 3060 단독 54.9 · P100 단독 33.5 tok/s, 9B)에서 역산한 effOverride — 그 카드 혼자면 실측과 같아지도록.
// 대역폭(3060 360 · P100 732 GB/s)은 effOverride × 대역폭으로 상쇄되어 결과에 영향이 없다
const Q35_9B_BYTES = 5.681 + (32 * 1024 * 128) / 1e9;
const RTX3060_FIT: GpuUnit = { vramGB: 12, memBandwidthGBs: 360, effClass: 'nvidia', effOverride: (54.9 * Q35_9B_BYTES) / 360 };
const P100_FIT: GpuUnit = { vramGB: 16, memBandwidthGBs: 732, effClass: 'nvidia', effOverride: (33.5 * Q35_9B_BYTES) / 732 };

/**
 * 공개 실측 3점. 반례(범위 밖, 회귀에 넣지 않음): RX 7800 XT + RX 580 Vulkan, Qwen3.6-35B-A3B Q4_K_M `-ts 28/15` tg128 48.59
 * (https://github.com/ggml-org/llama.cpp/discussions/22183) — 클래스 계수로는 약 112(+131%). 2017년 카드·Vulkan 은 계수 표본 밖이라
 * 섞기 자격(데이터 레이어 `canMixWith` — 같은 제조사 데스크톱·FP16 크리플 제외)으로 막는다.
 * P100 은 카탈로그 밖(FP16 은 되지만 Pascal) — 클래스 계수 0.70 대신 단일 실측으로 맞춘 effOverride 로 식만 검증한다.
 */
export const HETERO_GPU_CASES: readonly HeteroGpuCase[] = [
  {
    label: 'RTX 5070 Ti + RTX 3060 12GB, Gemma 4 31B Q4_K_M tg128 (CUDA, -ngl 99, -ts 없음)',
    kind: 'class',
    hw: hetero([
      { vramGB: 16, memBandwidthGBs: 896, effClass: 'nvidia' },
      { vramGB: 12, memBandwidthGBs: 360, effClass: 'nvidia' },
    ]),
    mq: G4_31B_Q4,
    ctx: 128,
    measuredTg: 21.8,
    source: 'https://github.com/ggml-org/llama.cpp/discussions/21112',
  },
  { label: 'RTX 3060 12GB + Tesla P100 16GB, Qwen3.5-9B Q4_K_M 층 분할', kind: 'formula', hw: hetero([RTX3060_FIT, P100_FIT]), mq: Q35_9B_Q4, ctx: 128, measuredTg: 39.2, source: SPLIT_BENCH },
  { label: 'RTX 3060 12GB + Tesla P100 16GB, Qwen3.8-27B Q4_K_M 층 분할', kind: 'formula', hw: hetero([RTX3060_FIT, P100_FIT]), mq: Q38_27B_Q4, ctx: 128, measuredTg: 13.81, source: SPLIT_BENCH },
];

// ---------- 8) 클래스 계수 재보정 (10-15 D79·D83): AMD Vulkan 스코어보드 · DGX Spark 개발진 결과 파일 · Apple #4167 ----------
export type SourcedSpeedCase = SpeedCase & { source: string };

// Vulkan 스코어보드(토론 #10879) no-FA 표 — 값은 각 제출 댓글의 fa 0 줄(10-15 D80 에 댓글로 고정)
const VULKAN_COMMENT = 'https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-';
// 7900 XTX 는 표의 현재 값(b10868, 2026-09-10 제출) — 옛 b6957 값 191.3 은 표에서 바뀌었다
const VULKAN_7900XTX = `${VULKAN_COMMENT}18386832`;
const SPARK_RESULTS = 'https://github.com/ggml-org/llama.cpp/blob/3795cc1e89e16fbc145f8a5457ea30abd86e0d1d/benches/dgx-spark/dgx-spark.md';
const SPARK: Hardware = { ...unified(128, 273, 'dgx-spark'), os: 'linux' };
const GIB = 1.073741824;
// 결과 파일의 모델(크기는 llama-bench 표의 GiB). Qwen3 30B-A3B Q8_0 은 카탈로그 행(32.48GB)과 같은 크기 — 10-16 D88 에 헤더 분할을 붙였다
// (Coder 판과 텐서 모양·양자화가 같다) https://huggingface.co/ggml-org/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q8_0.gguf
const Q30_Q8 = moeFile({ ...Q30, quant: 'Q8_0' }, 32.48, 30.8, 1.34);
// Qwen2.5-Coder-7B Q8_0: 28층 · KV 헤드 4 · head 128 → 56 KiB/tok
const QWEN25_7B_Q8: ModelQuant = { ...dense(7.54 * GIB, 56, 7.62), quant: 'Q8_0' };
// Gemma 3 4B QAT Q4_0: 34층 중 전체 어텐션 5층 · KV 헤드 4 · head 256 → 20 KiB/tok (카탈로그 Gemma 3 와 같은 SWA 사전 계산 방식)
const GEMMA3_4B_Q40: ModelQuant = { ...dense(2.35 * GIB, 20, 3.88), attnType: 'swa' }; // quant 표기는 속도식에 안 쓰인다(fileGB 사용)

// Apple 스코어보드 토론(#4167) — Llama 2 7B Q4_0 tg128(-p 512 -n 128 -ngl 99, ctx 512 는 s3 레코드 관례). 10-15 D83.
// 요약 표의 M1~M4 행은 기준 빌드 b1550(2023-11, FA 없음) 값이라 쓰지 않고, 새 빌드로 잰 값만 쓴다. llama-bench 기본 FA 는
// b9754(2026-06) 이후 auto(Metal 에선 켬), 그 전 빌드는 끔. 지금 빌드는 c1d0e7a00(b10621, 2026-08-25 안내)
const APPLE_4167 = 'https://github.com/ggml-org/llama.cpp/discussions/4167';
const APPLE_4167_COMMENT = `${APPLE_4167}#discussioncomment-`;

/**
 * AMD dense(Vulkan no-FA 표 4점, ±12%) · DGX Spark(b7941 llama-bench, 깊이 0 은 ctx 2048·깊이 8192 는 ctx 8192, ±20%) ·
 * Apple dense(토론 #4167 새 빌드 9점, ±20% — 10-15 D83). 계수는 이 점들이 모두 밴드 안에 들도록 정했다 — constants.ts EFF 주석.
 * DGX Spark 의 MoE 6점은 10-16 D88 부터 MoE 고정 시간(MOE_EXPERT_OVERHEAD_US) 근거이기도 하다. 옛 Apple MoE 8점(#15396 2025-08 빌드)은
 * 10-16 D88 에 MOE_OLD_BUILD_CASES(회귀 밖 참고)로 옮겼다.
 * Apple dense 회귀 밖 참고점: M3 Max 원글에 단 답글의 c1d0e7a00 값 81.57
 * (https://github.com/ggml-org/llama.cpp/discussions/4167#discussioncomment-18201257) — 기기 설명이 없어 원글의 40코어(400GB/s)로 보면
 * 계수 0.76 으로 −3.4%. 답글 쓴 사람이 직접 잰 b1550 값은 없다.
 */
export const RECAL_1015_CASES: readonly SourcedSpeedCase[] = [
  { label: 'RX 7900 XTX L2-7B Q4_0 Vulkan (b10868)', hw: dgpu(24, 960, 'amd'), mq: L2_7B, ctx: 512, measuredTg: 182.63, band: 0.12, source: VULKAN_7900XTX },
  // 9070 XT: 제출(-fa 1,0)의 fa 0 줄. 표는 fa 1 줄 137.11 을 no-FA 칸에 넣었다(D80)
  { label: 'RX 9070 XT L2-7B Q4_0 Vulkan (b7825)', hw: dgpu(16, 645, 'amd'), mq: L2_7B, ctx: 512, measuredTg: 131.54, band: 0.12, source: `${VULKAN_COMMENT}15594467` },
  { label: 'RX 9070 L2-7B Q4_0 Vulkan (b6188)', hw: dgpu(16, 645, 'amd'), mq: L2_7B, ctx: 512, measuredTg: 119.71, band: 0.12, source: `${VULKAN_COMMENT}14129066` },
  { label: 'RX 7800 XT L2-7B Q4_0 Vulkan (b7875)', hw: dgpu(16, 624, 'amd'), mq: L2_7B, ctx: 512, measuredTg: 118.27, band: 0.12, source: `${VULKAN_COMMENT}15642964` },
  { label: 'DGX Spark gpt-oss-120b tg32 d0', hw: SPARK, mq: GPT_OSS_120B, ctx: 2048, measuredTg: 58.72, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark gpt-oss-120b tg32 d8192', hw: SPARK, mq: GPT_OSS_120B, ctx: 8192, measuredTg: 52.87, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark gpt-oss-20b tg32 d0', hw: SPARK, mq: GPT_OSS_20B, ctx: 2048, measuredTg: 83.43, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark gpt-oss-20b tg32 d8192', hw: SPARK, mq: GPT_OSS_20B, ctx: 8192, measuredTg: 75.22, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark Qwen3-30B-A3B Q8_0 tg32 d0', hw: SPARK, mq: Q30_Q8, ctx: 2048, measuredTg: 61.06, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark Qwen3-30B-A3B Q8_0 tg32 d8192', hw: SPARK, mq: Q30_Q8, ctx: 8192, measuredTg: 48.02, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark Qwen2.5-Coder-7B Q8_0 tg32 d0', hw: SPARK, mq: QWEN25_7B_Q8, ctx: 2048, measuredTg: 29.43, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark Qwen2.5-Coder-7B Q8_0 tg32 d8192', hw: SPARK, mq: QWEN25_7B_Q8, ctx: 8192, measuredTg: 27.38, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark Gemma 3 4B QAT Q4_0 tg32 d0', hw: SPARK, mq: GEMMA3_4B_Q40, ctx: 2048, measuredTg: 81.05, band: 0.2, source: SPARK_RESULTS },
  { label: 'DGX Spark Gemma 3 4B QAT Q4_0 tg32 d8192', hw: SPARK, mq: GEMMA3_4B_Q40, ctx: 8192, measuredTg: 71.61, band: 0.2, source: SPARK_RESULTS },
  // Apple(base/Pro/Max) dense — 지금 빌드 5점 + M4 계열의 유일한 새 빌드 값(M4 Max 32코어 b5440, FA 끔). 10-15 D83
  { label: 'Apple dense M5 10c L2-7B Q4_0 (b10621)', hw: unified(16, 153.6, 'apple'), mq: L2_7B_HF, ctx: 512, measuredTg: 31.88, band: 0.2, source: `${APPLE_4167_COMMENT}18210351` },
  // 제출에 빌드 줄이 없다 — 3.53 GiB 파일(바뀐 안내)이고 요약 표는 c1d0e7a 로 적었다
  { label: 'Apple dense M5 Pro 20c L2-7B Q4_0 (c1d0e7a)', hw: unified(64, 307, 'apple'), mq: L2_7B_HF, ctx: 512, measuredTg: 66.33, band: 0.2, source: `${APPLE_4167_COMMENT}18213344` },
  { label: 'Apple dense M5 Pro 16c L2-7B Q4_0 (b11046)', hw: unified(64, 307, 'apple'), mq: L2_7B_HF, ctx: 512, measuredTg: 67.59, band: 0.2, source: `${APPLE_4167_COMMENT}18583406` },
  { label: 'Apple dense M5 Max 40c L2-7B Q4_0 (b10621)', hw: unified(128, 614, 'apple'), mq: L2_7B_HF, ctx: 512, measuredTg: 119.92, band: 0.2, source: `${APPLE_4167_COMMENT}18152504` },
  { label: 'Apple dense M5 Max 40c L2-7B Q4_0 (b9754)', hw: unified(128, 614, 'apple'), mq: L2_7B, ctx: 512, measuredTg: 119.08, band: 0.2, source: `${APPLE_4167_COMMENT}17386908` },
  // 같은 제출의 b1550 값은 69.24 — 1.04배
  { label: 'Apple dense M4 Max 32c L2-7B Q4_0 (b5440, FA 끔)', hw: unified(36, 410, 'apple'), mq: L2_7B, ctx: 512, measuredTg: 72.26, band: 0.2, source: `${APPLE_4167_COMMENT}13218715` },
  // Apple Ultra dense — M2 Ultra 는 본문 빌드별 표(ggerganov, 같은 기기 b1550 94.27 — 1.33배, 파일 크기 표기 없음 → 옛 파일)
  { label: 'Apple Ultra dense M2 Ultra 76c L2-7B Q4_0 (c1d0e7a00+FA)', hw: unified(192, 800, 'apple-ultra'), mq: L2_7B, ctx: 512, measuredTg: 125.21, band: 0.2, source: APPLE_4167 },
  { label: 'Apple Ultra dense M1 Ultra 64c L2-7B Q4_0 (b10621)', hw: unified(128, 800, 'apple-ultra'), mq: L2_7B_HF, ctx: 512, measuredTg: 113.79, band: 0.2, source: `${APPLE_4167_COMMENT}18191340` },
  { label: 'Apple Ultra dense M5 Ultra 80c L2-7B Q4_0 (b10621)', hw: unified(256, 1228, 'apple-ultra'), mq: L2_7B_HF, ctx: 512, measuredTg: 179.1, band: 0.2, source: `${APPLE_4167_COMMENT}18683605` },
];

// ---------- 10) MoE 토큰당 고정 시간 (§3.1, 10-16 D88) — 2026 llama.cpp 빌드 공개 실측 ----------
// 토큰 시간 = (비전문가 + 라우팅 전문가 × topK/experts + KV) ÷ (클래스 dense 계수 × 대역폭) + MoE 층 × topK × MOE_EXPERT_OVERHEAD_US.
// 행은 GGUF 헤더 분할(전문가·비전문가 GB) — 출처 글에 파일이 없는 행은 크기가 맞는 파일이나 기본 레시피 파일로 가정했다(행 주석).
// 깊이 0 의 tgN 은 ctx 512(s3 레코드 관례), DGX Spark b7941 결과 파일 6점은 회귀 8 과 같은 값(ctx 2048·8192)을 함께 쓴다.
// 머지된 PR 의 비교 표는 PR 열(= 지금 master), 머지 안 된 PR·이슈는 master 열.

const G4: MoeBase = { paramsB: 26.54, activeParamsB: 4, quant: 'Q4_K_M', kvBytesPerToken: 20 * 1024, attnType: 'swa', activeExpertFrac: 8 / 128, moeLayers: 30, topK: 8, maxContext: 262144 };
const NEMO: MoeBase = { paramsB: 31.58, activeParamsB: 3, quant: 'Q4_K_M', kvBytesPerToken: 6 * 1024, attnType: 'hybrid', activeExpertFrac: 6 / 128, moeLayers: 23, topK: 6, maxContext: 262144 };
// https://huggingface.co/bartowski/Qwen_Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen_Qwen3.5-35B-A3B-Q4_K_M.gguf — 파일이 적히지 않은 Q4_K_M 의 가정
// (같은 기본 레시피 lmstudio-community 판 비전문가 1.37 · unsloth 판 2.00 사이)
const Q35_Q4_BART = moeFile(Q35, 22.27, 19.5, 1.59);
// https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q6_K.gguf (출처 파일 27.98GiB 와 크기가 달라 근사)
const Q35_Q6 = moeFile({ ...Q35, quant: 'Q6_K' }, 28.84, 26.42, 1.88);
// https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf (20.82GiB — 출처 20.81GiB)
const Q36_UDXL = moeFile(Q35, 22.35, 19.67, 2.14);
// https://huggingface.co/ggml-org/gemma-4-26B-A4B-it-GGUF (Q4_0 14.60 · Q8_0 26.86, 임베딩 공유 — 출력층 사본은 비전문가에 들어 있다)
const G4_Q40 = moeFile(G4, 14.6, 12.85, 1.76); // quant 표기는 속도식에 안 쓰인다(fileGB 사용)
const G4_Q80 = moeFile({ ...G4, quant: 'Q8_0' }, 26.86, 24.27, 2.58);
// https://huggingface.co/bartowski/google_gemma-4-26B-A4B-it-GGUF (Q4_K_M 15.87GiB — 출처 15.90GiB · Q6_K — 출처 파일 미기재)
const G4_Q4KM = moeFile(G4, 17.02, 15.13, 1.89);
const G4_Q6 = moeFile({ ...G4, quant: 'Q6_K' }, 22.85, 20.58, 2.27);
// https://huggingface.co/unsloth/Nemotron-3-Nano-30B-A3B-GGUF/resolve/main/Nemotron-3-Nano-30B-A3B-Q4_K_M.gguf (52층 중 MoE 23층, 128E top-6)
const NEMO_Q4 = moeFile(NEMO, 24.57, 22.83, 1.49);

const PR = (n: number, comment?: string) => `https://github.com/ggml-org/llama.cpp/pull/${n}${comment ? `#issuecomment-${comment}` : ''}`;
const M2_ULTRA_BENCH = 'https://github.com/ggml-org/llama.cpp/blob/3795cc1e89e16fbc145f8a5457ea30abd86e0d1d/benches/mac-m2-ultra/mac-m2-ultra.md';
const QUOZUL = 'https://quozul.dev/posts/2025-10-27-gpt-oss-120b-on-ryzen-ai-max-395/';
const moeCase = (label: string, hw: Hardware, mq: ModelQuant, measuredTg: number, source: string, ctx = 512): SourcedSpeedCase => ({
  label,
  hw,
  mq,
  ctx,
  measuredTg,
  band: 0.2,
  source,
});
const NV = (bw: number) => dgpu(32, bw, 'nvidia');
const AMD = (bw: number) => dgpu(32, bw, 'amd');
const STRIX: Hardware = { ...unified(128, 256, 'strix'), os: 'linux' };

/**
 * 2026 빌드 39점 + 회귀 8 의 DGX Spark MoE 6점(MOE_OVERHEAD_SPARK_B7941) = 45점. 클래스 값은 클래스별로 점의 최대 오차를 가장 작게 하는
 * 값(minimax) — 모두 ±20%(MoE 밴드) 안
 */
export const MOE_OVERHEAD_CASES: readonly SourcedSpeedCase[] = [
  // Apple base/Pro/Max (ggerganov M5 Max 40코어 128GB · forforever73 M4 Max 40코어)
  moeCase('Apple M5 Max 40c gpt-oss-20b tg32 (#29770)', unified(128, 614, 'apple'), OSS20_MX, 157.46, PR(29770)),
  moeCase('Apple M5 Max 40c Qwen3.5-35B-A3B Q4_K_M tg128 (#28948)', unified(128, 614, 'apple'), Q35_Q4_BART, 117.75, PR(28948)),
  moeCase('Apple M5 Max 40c Qwen3.5-35B-A3B Q8_0 tg128 (#28948)', unified(128, 614, 'apple'), Q35_Q8, 106.73, PR(28948)),
  moeCase('Apple M5 Max 40c Gemma 4 26B-A4B Q8_0 tg128 (#28948)', unified(128, 614, 'apple'), G4_Q80, 97.25, PR(28948)),
  moeCase('Apple M4 Max 40c Qwen3-30B-A3B-2507 Q4_K_M tg32 (#28439 master)', unified(128, 546, 'apple'), Q30_Q4, 116.69, PR(28439, '5585850026')),
  // Apple Ultra (ggerganov M2 Ultra 76코어)
  moeCase('Apple M2 Ultra gpt-oss-20b tg32 (#29770)', unified(192, 800, 'apple-ultra'), OSS20_MX, 126.59, PR(29770)),
  moeCase('Apple M2 Ultra Qwen3.5-35B-A3B Q4_K_M tg32 (#28948)', unified(192, 800, 'apple-ultra'), Q35_Q4_BART, 104.87, PR(28948)),
  moeCase('Apple M2 Ultra Qwen3.5-35B-A3B Q8_0 tg32 (#28948)', unified(192, 800, 'apple-ultra'), Q35_Q8, 96.62, PR(28948)),
  moeCase('Apple M2 Ultra Gemma 4 26B-A4B Q4_0 tg32 (#28948)', unified(192, 800, 'apple-ultra'), G4_Q40, 115.71, PR(28948)),
  moeCase('Apple M2 Ultra Gemma 4 26B-A4B Q8_0 tg32 (#28948)', unified(192, 800, 'apple-ultra'), G4_Q80, 92.19, PR(28948)),
  moeCase('Apple M2 Ultra Qwen3-30B-A3B Q8_0 tg32 (#28439 master)', unified(192, 800, 'apple-ultra'), Q30_Q8, 94.35, PR(28439, '5585270736')),
  moeCase('Apple M2 Ultra gpt-oss-120b tg32 (b7948)', unified(192, 800, 'apple-ultra'), OSS120_MX, 85.6, M2_ULTRA_BENCH),
  // DGX Spark — PDL(#22522, Hopper 이후 GPU 에서 기본 켬) 머지 열
  moeCase('DGX Spark gpt-oss-20b tg128 (#22522)', SPARK, OSS20_MX, 84.05, PR(22522)),
  moeCase('DGX Spark Nemotron 3 Nano Q4_K_M tg128 (#22522)', SPARK, NEMO_Q4, 76.68, PR(22522)),
  moeCase('DGX Spark Qwen3.5-35B-A3B Q4_K_M tg128 (#22522)', SPARK, Q35_Q4_BART, 62.98, PR(22522)),
  // NVIDIA CUDA
  moeCase('RTX 3090 gpt-oss-20b tg128 (b9867)', NV(936), OSS20_MX, 210.37, PR(25319)),
  moeCase('RTX 4090 gpt-oss-20b tg128 (b9867)', NV(1008), OSS20_MX, 264.26, PR(25319)),
  moeCase('RTX 5090 gpt-oss-20b tg128 (b9867)', NV(1792), OSS20_MX, 411.96, PR(25319)),
  moeCase('RTX PRO 6000 Blackwell gpt-oss-20b tg128 (#19053)', NV(1792), OSS20_MX, 353.16, PR(19053)),
  moeCase('RTX 6000 Ada gpt-oss-20b tg128 (#19053)', NV(960), OSS20_MX, 253.9, PR(19053)),
  moeCase('RTX PRO 6000 Blackwell gpt-oss-20b tg128 (#22522 PDL)', NV(1792), OSS20_MX, 376.31, PR(22522)),
  moeCase('RTX PRO 6000 Blackwell Nemotron 3 Nano Q4_K_M tg128 (#22522 PDL)', NV(1792), NEMO_Q4, 325.74, PR(22522)),
  moeCase('RTX PRO 6000 Blackwell Qwen3.5-35B-A3B Q4_K_M tg128 (#22522 PDL)', NV(1792), Q35_Q4_BART, 233.26, PR(22522)),
  moeCase('RTX PRO 6000 Max-Q Qwen3.6-35B-A3B UD-Q4_K_M tg128 (#24706)', NV(1792), Q36_UD4, 246.5, PR(24706, '4789353680')),
  moeCase('RTX PRO 6000 Max-Q Gemma 4 26B-A4B Q4_K_M tg128 (#24706)', NV(1792), G4_Q4KM, 214.47, PR(24706, '4789353680')),
  moeCase('RTX 3090 Gemma 4 26B-A4B Q4_0 tg128 (#23615)', NV(936), G4_Q40, 148.73, PR(23615, '4534473995')),
  moeCase('RTX 4090 Gemma 4 26B-A4B Q4_0 tg128 (#23615)', NV(1008), G4_Q40, 186.33, PR(23615, '4534473995')),
  moeCase('RTX 5090 Gemma 4 26B-A4B Q4_0 tg128 (#23615)', NV(1792), G4_Q40, 258.06, PR(23615, '4534473995')),
  moeCase('RTX 3090 Qwen3-30B-A3B UD-Q4_K_XL tg128 (#20831 master)', NV(936), Q30_UDXL, 202.26, PR(20831, '4285435222')),
  // AMD — ROCm(HIP)와 Vulkan 이 섞여 있다(클래스 dense 계수는 Vulkan no-FA 4점)
  moeCase('RX 7900 XTX ROCm gpt-oss-20b tg128 (#29478)', AMD(960), OSS20_MX, 172.41, PR(29478, '5854628298')),
  moeCase('RX 7900 XTX ROCm Gemma 4 26B-A4B Q6_K tg128 (#29478)', AMD(960), G4_Q6, 96.9, PR(29478, '5854628298')),
  moeCase('Radeon AI PRO R9700 ROCm gpt-oss-20b tg128 (#29478)', AMD(640), OSS20_MX, 150.79, PR(29478, '5854628298')),
  moeCase('Radeon AI PRO R9700 ROCm Gemma 4 26B-A4B Q6_K tg128 (#29478)', AMD(640), G4_Q6, 87.97, PR(29478, '5854628298')),
  moeCase('RX 9060 XT ROCm gpt-oss-20b tg128 (b9867)', AMD(322), OSS20_MX, 84.81, PR(25319)),
  moeCase('Radeon AI PRO R9700 Vulkan Qwen3.6-35B-A3B UD-Q4_K_XL tg128', AMD(640), Q36_UDXL, 117.34, 'https://github.com/ggml-org/llama.cpp/issues/26795#issuecomment-5247488002'),
  moeCase('RX 9070 XT Vulkan gpt-oss-20b tg128 (#21024 master)', AMD(645), OSS20_MX, 177.89, PR(21024, '4460661536')),
  // Strix Halo (Radeon 8060S) — Q8_0 파일은 35.80GiB(카탈로그 Q8_0 34.37GiB 보다 크다 — 같은 분할로 근사)
  moeCase('Strix Halo Vulkan Qwen3.5-35B-A3B Q8_0 tg128', STRIX, Q35_Q8, 46.17, 'https://github.com/ggml-org/llama.cpp/issues/22375#issuecomment-4321102370'),
  moeCase('Strix Halo Vulkan Qwen3.5-35B-A3B Q6_K tg128 (#24966 master)', STRIX, Q35_Q6, 53.77, PR(24966, '4787851707')),
  moeCase('Strix Halo ROCm gpt-oss-120b tg128', STRIX, OSS120_MX, 50.2, QUOZUL),
];

/** 회귀 8 의 DGX Spark MoE 6점(b7941) — 위 39점과 합쳐 45점으로 집계한다 */
export const MOE_OVERHEAD_SPARK_B7941: readonly SourcedSpeedCase[] = RECAL_1015_CASES.filter(
  (c) => c.label.startsWith('DGX Spark') && c.mq.activeParamsB !== undefined,
);

/**
 * 회귀 밖 참고점 — gpt-oss 가이드(#15396)의 Apple Metal 2025-08 빌드(b6123~b6310, -fa 1 -ub 2048 tg128, ctx 2048 은 s2 레코드 관례).
 * 10-15 D81 의 apple MoE 계수 0.44 근거였다. 지금 식은 2026 빌드에 맞춰 이 점들을 +10~+39% 높게 본다(같은 M2 Ultra gpt-oss-20b 가 b6123
 * 116.08 → 2026-09 126.59 — 빌드가 빨라졌다). 칩별 지금 빌드 값이 없어(M1·M3·M4 Pro) 참고로만 둔다.
 * 36GB M4 Max 는 32코어 GPU(410GB/s) 구성뿐(https://support.apple.com/en-us/121553).
 * 반례: MacBook Pro M3 Max 128GB(400GB/s) b6250 64.26(https://github.com/ggml-org/llama.cpp/discussions/15396#discussioncomment-14224424)은
 * 개발자가 열 스로틀링으로 봤다(#discussioncomment-14225207).
 */
const OSS_GUIDE = 'https://github.com/ggml-org/llama.cpp/discussions/15396';
const OSS_GUIDE_COMMENT = `${OSS_GUIDE}#discussioncomment-`;
export const MOE_OLD_BUILD_CASES: readonly SourcedSpeedCase[] = [
  moeCase('Apple M4 Max 32c 36GB gpt-oss-20b (b6123)', unified(36, 410, 'apple'), GPT_OSS_20B, 92.36, OSS_GUIDE, 2048),
  moeCase('Apple M4 Max 32c 36GB gpt-oss-20b (b6293)', unified(36, 410, 'apple'), GPT_OSS_20B, 95.88, `${OSS_GUIDE_COMMENT}14225207`, 2048),
  moeCase('Apple M4 Pro 64GB gpt-oss-20b (b6280)', unified(64, 273, 'apple'), GPT_OSS_20B, 63.34, `${OSS_GUIDE_COMMENT}14226807`, 2048),
  moeCase('Apple M1 Max 64GB gpt-oss-20b (b6180)', unified(64, 400, 'apple'), GPT_OSS_20B, 75.15, `${OSS_GUIDE_COMMENT}14146721`, 2048),
  moeCase('Apple M1 Pro 32GB gpt-oss-20b (b6123)', unified(32, 200, 'apple'), GPT_OSS_20B, 45.68, OSS_GUIDE, 2048),
  moeCase('Apple M3 Ultra 80c gpt-oss-20b (b6310)', unified(512, 819, 'apple-ultra'), GPT_OSS_20B, 115.52, `${OSS_GUIDE_COMMENT}14249698`, 2048),
  moeCase('Apple M2 Ultra 76c gpt-oss-20b (b6123)', unified(192, 800, 'apple-ultra'), GPT_OSS_20B, 116.08, OSS_GUIDE, 2048),
  moeCase('Apple M2 Ultra 76c gpt-oss-120b (b6123)', unified(192, 800, 'apple-ultra'), GPT_OSS_120B, 79.68, OSS_GUIDE, 2048),
];

/** pp 대조점 — Llama 2 7B Q4_0 pp512(llama-bench 기본), 토론 #4167. hw 는 카탈로그 행의 fp16Tflops·neuralAccel 그대로 (10-16 D86) */
export type PpCase = {
  label: string;
  hw: Pick<Hardware, 'effClass' | 'fp16Tflops' | 'neuralAccel'>;
  measuredPp: number;
  /** m5: Neural Accelerator 칩 지금 빌드(계수 근거) · current: 그 밖의 칩 새 빌드(계수 근거) · b1550: 요약 표의 2023 빌드(밴드 확인만) */
  group: 'm5' | 'current' | 'b1550';
  source: string;
};

const M5_HW = (fp16Tflops: number) => ({ effClass: 'apple' as const, fp16Tflops, neuralAccel: true });
const APPLE_HW = (fp16Tflops: number, effClass: EffClass = 'apple') => ({ effClass, fp16Tflops });

export const APPLE_PP_CASES: readonly PpCase[] = [
  { label: 'M5 10c (b10621)', hw: M5_HW(10), measuredPp: 722.79, group: 'm5', source: `${APPLE_4167_COMMENT}18210351` },
  // 카탈로그 M5 Pro 는 16·20코어를 한 행(19 TFLOPS)으로 둔다
  { label: 'M5 Pro 16c (b11046)', hw: M5_HW(19), measuredPp: 1340.44, group: 'm5', source: `${APPLE_4167_COMMENT}18583406` },
  { label: 'M5 Pro 20c (c1d0e7a)', hw: M5_HW(19), measuredPp: 1620.64, group: 'm5', source: `${APPLE_4167_COMMENT}18213344` },
  { label: 'M5 Max 40c (b10621)', hw: M5_HW(38), measuredPp: 3219.99, group: 'm5', source: `${APPLE_4167_COMMENT}18152504` },
  { label: 'M5 Max 40c (b9754)', hw: M5_HW(38), measuredPp: 3347.44, group: 'm5', source: `${APPLE_4167_COMMENT}17386908` },
  { label: 'M2 Ultra 76c (c1d0e7a00+FA)', hw: APPLE_HW(54, 'apple-ultra'), measuredPp: 1488.81, group: 'current', source: APPLE_4167 },
  { label: 'M4 Max 32c (b5440, FA 끔)', hw: APPLE_HW(27.2), measuredPp: 762.81, group: 'current', source: `${APPLE_4167_COMMENT}13218715` },
  { label: 'M4 10c (b1550)', hw: APPLE_HW(8.5), measuredPp: 221.29, group: 'b1550', source: APPLE_4167 },
  { label: 'M4 Pro 20c (b1550)', hw: APPLE_HW(17), measuredPp: 439.78, group: 'b1550', source: APPLE_4167 },
  { label: 'M4 Max 40c (b1550)', hw: APPLE_HW(34.1), measuredPp: 885.68, group: 'b1550', source: APPLE_4167 },
  { label: 'M3 Ultra 80c (b1550)', hw: APPLE_HW(57, 'apple-ultra'), measuredPp: 1471.24, group: 'b1550', source: APPLE_4167 },
  { label: 'M2 Ultra 76c (b1550)', hw: APPLE_HW(54, 'apple-ultra'), measuredPp: 1238.48, group: 'b1550', source: APPLE_4167 },
];
