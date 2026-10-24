/**
 * 실측 대조 픽스처 — verify_engine.py (2026-08-09 검증) 의 표를 1:1 이식.
 * 값 출처: docs/02-engine-spec.md §7, docs/03-data-spec.md §3(모델 arch·fileGB)·§4(실측 표).
 *
 * 주의: 여기 수치는 "실측"이므로 임의 수정 금지 — 바꾸려면 출처 URL 과 함께
 * docs/02 §7 갱신이 선행되어야 한다 (CLAUDE.md 규칙 1).
 */

import type { PpModel } from '../src/speed';
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
  // 10-21 D112 — KV 공유 층: 저장 KV 는 앞 `층 수 − num_kv_shared_layers` 층 안의 전체 어텐션 층만(layers = 그 층 수, head_dim = global_head_dim)
  { name: 'Gemma-4-E4B (full attn 4 in the first 42 − 18 layers)', layers: 4, kvHeads: 2, headDim: 512, expectKiB: 16 },
  { name: 'Gemma-4-E2B (full attn 3 in the first 35 − 20 layers)', layers: 3, kvHeads: 1, headDim: 512, expectKiB: 6 },
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

// Strix Halo(Radeon 8060S, 256GB/s) dense — Vulkan(RADV) 지금 빌드, FA 켬(llama-bench 기본 auto). 10-16 D90. 크기는 llama-bench 표의 GiB,
// KV 는 아키텍처 값(Llama 2 13B 는 MHA 40층 → 800 KiB/tok, Qwen3.5·3.8 27B 는 전체 어텐션 16층 → 64 KiB/tok)
const STRIX: Hardware = { ...unified(128, 256, 'strix'), os: 'linux' };
const STRIX_PR = (n: number, comment: string) => `https://github.com/ggml-org/llama.cpp/pull/${n}#issuecomment-${comment}`;
const L31_8B_Q40 = dense(4.33 * GIB, 128, 8.03);
const L31_8B_Q4KS = dense(4.36 * GIB, 128, 8.03);
const L2_13B_Q5KM = dense(8.6 * GIB, 800, 13.02);
const Q35_27B_Q6: ModelQuant = { ...dense(21.62 * GIB, 64, 26.9), attnType: 'hybrid' };
// https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-Q4_K_M.gguf (17.67GiB — MTP 블록은 따로 낸 파일)
const Q38_27B_Q4_GGML: ModelQuant = { ...dense(17.66 * GIB, 64, 26.9), attnType: 'hybrid' };

/**
 * AMD dense(Vulkan no-FA 표 4점, ±12%) · DGX Spark(b7941 llama-bench, 깊이 0 은 ctx 2048·깊이 8192 는 ctx 8192, ±20%) ·
 * Apple dense(토론 #4167 새 빌드 9점, ±20% — 10-15 D83) · Strix Halo dense(Vulkan 지금 빌드 6점, ±20% — 10-16 D90).
 * 계수는 이 점들이 모두 밴드 안에 들도록 정했다 — constants.ts EFF 주석.
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
  // Strix Halo dense — Vulkan 지금 빌드 6점(10-16 D90). 같은 제출의 FA 끔 51.81 · ROCm 51.33 등은 STRIX_SLOWER_DENSE_CASES(회귀 밖 참고)
  { label: 'Strix Halo dense L2-7B Q4_0 Vulkan FA (b11349)', hw: STRIX, mq: L2_7B, ctx: 512, measuredTg: 54.38, band: 0.2, source: `${VULKAN_COMMENT}18711544` },
  { label: 'Strix Halo dense Llama 3.1 8B Q4_0 Vulkan (#24966 master)', hw: STRIX, mq: L31_8B_Q40, ctx: 512, measuredTg: 44.52, band: 0.2, source: STRIX_PR(24966, '4787851707') },
  { label: 'Strix Halo dense Llama 3.1 8B Q4_K_S Vulkan (#24966 master)', hw: STRIX, mq: L31_8B_Q4KS, ctx: 512, measuredTg: 44.21, band: 0.2, source: STRIX_PR(24966, '4787851707') },
  { label: 'Strix Halo dense Llama 2 13B Q5_K_M Vulkan (#21751)', hw: STRIX, mq: L2_13B_Q5KM, ctx: 512, measuredTg: 22.48, band: 0.2, source: STRIX_PR(21751, '4297412913') },
  { label: 'Strix Halo dense Qwen3.5 27B Q6_K Vulkan (#24966 master)', hw: STRIX, mq: Q35_27B_Q6, ctx: 512, measuredTg: 8.93, band: 0.2, source: STRIX_PR(24966, '4787851707') },
  { label: 'Strix Halo dense Qwen3.8 27B Q4_K_M Vulkan tg32 (b10940)', hw: STRIX, mq: Q38_27B_Q4_GGML, ctx: 512, measuredTg: 11.29, band: 0.2, source: STRIX_PR(28494, '5652740372') },
];

/**
 * 회귀 밖 참고 — Strix Halo 의 ROCm(HIP)·FA 끔 dense 값(10-16 D90). 계수 0.82 는 Vulkan FA 켬(llama-bench 기본) 값으로 정했고,
 * 같은 기기·같은 빌드에서 ROCm 과 FA 끔은 0~14% 느려 추정이 그만큼 높다 — 모두 ±20% 밴드 안.
 */
export const STRIX_SLOWER_DENSE_CASES: readonly SourcedSpeedCase[] = [
  { label: 'Strix Halo L2-7B Q4_0 Vulkan FA 끔 (b11349)', hw: STRIX, mq: L2_7B, ctx: 512, measuredTg: 51.81, band: 0.2, source: `${VULKAN_COMMENT}18711544` },
  { label: 'Strix Halo L2-7B Q4_0 ROCm FA (b11349)', hw: STRIX, mq: L2_7B, ctx: 512, measuredTg: 51.33, band: 0.2, source: `${VULKAN_COMMENT}18711544` },
  { label: 'Strix Halo L2-7B Q4_0 ROCm FA 끔 (b11349)', hw: STRIX, mq: L2_7B, ctx: 512, measuredTg: 47.36, band: 0.2, source: `${VULKAN_COMMENT}18711544` },
  { label: 'Strix Halo L2-7B Q4_0 ROCm 7.14 FA (b10376)', hw: STRIX, mq: L2_7B, ctx: 512, measuredTg: 49.1, band: 0.2, source: 'https://github.com/ggml-org/llama.cpp/discussions/15021#discussioncomment-17979194' },
  { label: 'Strix Halo Qwen3.8 27B Q4_K_M ROCm tg32 (b10940)', hw: STRIX, mq: Q38_27B_Q4_GGML, ctx: 512, measuredTg: 11.01, band: 0.2, source: STRIX_PR(28494, '5652740372') },
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
// Strix Halo 의 새 점(10-16 D90) — 헤더 분할은 카탈로그 행. Qwen3-30B-A3B Q2_K 는 10.48GiB(unsloth 2507 판과 같은 크기)
// https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF/resolve/main/Qwen3-30B-A3B-Instruct-2507-Q2_K.gguf
const Q30_Q2K = moeFile({ ...Q30, quant: 'Q2_K' }, 11.26, 10.49, 0.66);
// Qwen3.5-122B-A10B Q4_K_M — 출처 파일 73.23GiB 와 크기가 같은 공개 파일이 없어 가장 가까운 카탈로그 행(unsloth MTP 판 78.26GB, 비전문가 5.70)으로
// 근사. 비전문가가 작은 판(bartowski 4.28·lmstudio 3.56GB, 파일도 더 작다)이면 이 점의 추정은 +23~+35% 로 오른다
// https://huggingface.co/unsloth/Qwen3.5-122B-A10B-MTP-GGUF
const Q122: MoeBase = { paramsB: 125.09, activeParamsB: 10, quant: 'Q4_K_M', kvBytesPerToken: 24 * 1024, attnType: 'hybrid', activeExpertFrac: 8 / 256, moeLayers: 48, topK: 8, maxContext: 262144 };
const Q122_Q4 = moeFile(Q122, 73.23 * GIB, 70.17, 5.7);

/**
 * 2026 빌드 43점(10-16 D90 에 Strix Halo 4점 추가) + 회귀 8 의 DGX Spark MoE 6점(MOE_OVERHEAD_SPARK_B7941) = 49점. 클래스 값은 클래스별로 점의 최대 오차를 가장 작게 하는
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
  moeCase('RTX PRO 6000 Blackwell Max-Q gpt-oss-20b tg128 (#19053)', NV(1792), OSS20_MX, 353.16, PR(19053)),
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
  // Strix Halo (Radeon 8060S) — Q8_0 파일은 35.80GiB(카탈로그 Q8_0 34.37GiB 보다 크다 — 같은 분할로 근사). 10-16 D90 에 dense 0.82 로 다시 맞추며
  // Vulkan 4점을 더했다(#24438 은 34.36GiB = Q35_Q8 과 같은 파일, FA 끔 — 같은 글타래 AMD 재현 b9592 는 52.2~52.4)
  moeCase('Strix Halo Vulkan Qwen3.5-35B-A3B Q8_0 tg128', STRIX, Q35_Q8, 46.17, 'https://github.com/ggml-org/llama.cpp/issues/22375#issuecomment-4321102370'),
  moeCase('Strix Halo Vulkan Qwen3.5-35B-A3B Q6_K tg128 (#24966 master)', STRIX, Q35_Q6, 53.77, PR(24966, '4787851707')),
  moeCase('Strix Halo ROCm gpt-oss-120b tg128', STRIX, OSS120_MX, 50.2, QUOZUL),
  moeCase('Strix Halo Vulkan Qwen3.6-35B-A3B Q8_0 tg128 (b9586)', STRIX, Q35_Q8, 50.57, 'https://github.com/ggml-org/llama.cpp/issues/24438'),
  moeCase('Strix Halo Vulkan gpt-oss-20b tg128 (#19625)', STRIX, OSS20_MX, 72.68, PR(19625)),
  moeCase('Strix Halo Vulkan Qwen3-30B-A3B Q2_K tg128 (#19625)', STRIX, Q30_Q2K, 91.6, PR(19625)),
  moeCase('Strix Halo Vulkan Qwen3.5-122B-A10B Q4_K_M tg128', STRIX, Q122_Q4, 22.4, 'https://github.com/ggml-org/llama.cpp/issues/25207#issuecomment-4863716589'),
];

/** 회귀 8 의 DGX Spark MoE 6점(b7941) — 위 43점과 합쳐 49점으로 집계한다 */
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

/** pp 대조점 — Llama 2 7B Q4_0 pp512(llama-bench 기본), 토론 #4167. hw 는 카탈로그 행의 fp16Tflops(위키백과 FP32 이론값 — 10-16 D87)·neuralAccel 그대로 (10-16 D86) */
export type PpCase = {
  label: string;
  hw: Pick<Hardware, 'effClass' | 'fp16Tflops' | 'neuralAccel'>;
  measuredPp: number;
  /** m5: Neural Accelerator 칩 지금 빌드(계수 근거) · current: 그 밖의 칩 새 빌드(계수 근거) · b1550: 요약 표의 2023 빌드(밴드 확인만) · ultra-accel: 계수 근거 밖 M5 Ultra(밴드 확인만) */
  group: 'm5' | 'current' | 'b1550' | 'ultra-accel';
  source: string;
};

const M5_HW = (fp16Tflops: number, effClass: EffClass = 'apple') => ({ effClass, fp16Tflops, neuralAccel: true });
const APPLE_HW = (fp16Tflops: number, effClass: EffClass = 'apple') => ({ effClass, fp16Tflops });

export const APPLE_PP_CASES: readonly PpCase[] = [
  { label: 'M5 10c (b10621)', hw: M5_HW(4.15), measuredPp: 722.79, group: 'm5', source: `${APPLE_4167_COMMENT}18210351` },
  // 카탈로그 M5 Pro 는 16·20코어를 한 행(20코어 8.29 TFLOPS)으로 둔다
  { label: 'M5 Pro 16c (b11046)', hw: M5_HW(8.29), measuredPp: 1340.44, group: 'm5', source: `${APPLE_4167_COMMENT}18583406` },
  { label: 'M5 Pro 20c (c1d0e7a)', hw: M5_HW(8.29), measuredPp: 1620.64, group: 'm5', source: `${APPLE_4167_COMMENT}18213344` },
  { label: 'M5 Max 40c (b10621)', hw: M5_HW(16.59), measuredPp: 3219.99, group: 'm5', source: `${APPLE_4167_COMMENT}18152504` },
  { label: 'M5 Max 40c (b9754)', hw: M5_HW(16.59), measuredPp: 3347.44, group: 'm5', source: `${APPLE_4167_COMMENT}17386908` },
  { label: 'M2 Ultra 76c (c1d0e7a00+FA)', hw: APPLE_HW(27.2, 'apple-ultra'), measuredPp: 1488.81, group: 'current', source: APPLE_4167 },
  { label: 'M4 Max 32c (b5440, FA 끔)', hw: APPLE_HW(12.92), measuredPp: 762.81, group: 'current', source: `${APPLE_4167_COMMENT}13218715` },
  { label: 'M4 10c (b1550)', hw: APPLE_HW(3.76), measuredPp: 221.29, group: 'b1550', source: APPLE_4167 },
  { label: 'M4 Pro 20c (b1550)', hw: APPLE_HW(8.08), measuredPp: 439.78, group: 'b1550', source: APPLE_4167 },
  { label: 'M4 Max 40c (b1550)', hw: APPLE_HW(16.16), measuredPp: 885.68, group: 'b1550', source: APPLE_4167 },
  { label: 'M3 Ultra 80c (b1550)', hw: APPLE_HW(28.26, 'apple-ultra'), measuredPp: 1471.24, group: 'b1550', source: APPLE_4167 },
  { label: 'M2 Ultra 76c (b1550)', hw: APPLE_HW(27.2, 'apple-ultra'), measuredPp: 1238.48, group: 'b1550', source: APPLE_4167 },
  // D85 때 fp16Tflops 가 비어 계수 근거에서 빠졌던 칩 — 두 다이라 M5 계열 계수보다 TFLOP 당 느리다(+20%)
  { label: 'M5 Ultra 80c (b10621)', hw: M5_HW(33.18, 'apple-ultra'), measuredPp: 4944.66, group: 'ultra-accel', source: `${APPLE_4167_COMMENT}18683605` },
];

/** pp 기준 모델 — Llama 2 7B Q4_0(스코어보드 llama-bench params 6.74 B). 이 모델에서 ppEstimate = 계수 × TFLOPS (10-16 D91) */
export const LLAMA2_7B_Q4_0: PpModel = { paramsB: 6.74, quant: 'Q4_0' };

/**
 * pp 모델 크기 대조점(§3.5·§7, 10-16 D91) — 같은 기기·같은 빌드 표에서 모델 크기·MoE·양자화가 다른 llama-bench pp 실측.
 * 2026 빌드(llama-bench 기본 FA auto)만 — CUDA MoE 는 2026-05 이후(그 전 빌드는 MoE pp 가 지금의 0.7배 안팎: 4090 gpt-oss-20b
 * 2026-02 9,371 → 07 13,127), Strix Halo 는 2026-08 이후(그 전은 0.55~0.65배). 카탈로그 밖 구조(초기 qwen3next·MLA deepseek2)는 뺐다.
 * Apple 의 7B Q4_0 점은 9) APPLE_PP_CASES 에 있다.
 * - hw 는 카탈로그 행 값(fp16Tflops·AMD 행렬 FP16·neuralAccel). 4090 의 27B·31B·70B·F16 행은 2~4장 -sm layer 표 — pp512 는 장수와 무관
 *   (같은 PR 의 8B Q4_0 1~4장 12,731·12,837·12,285·12,023)이라 1장 값으로 본다.
 * - mq.paramsB 는 llama-bench params 열(B), MoE 활성·전문가 비율은 모델 카드(gemma4 26B-A4B 3.8B·128·top-8, Nemotron 3 Super 512·top-22 등).
 * - ubatch: 표의 -ub. 명령이 없는 ggerganov 표는 같은 사람의 다른 표(#20962·#16991·benches 의 -ub 2048)처럼 2048 로 본다(ubatchAssumed).
 */
export type PpSizeCase = {
  label: string;
  hw: Pick<Hardware, 'effClass' | 'fp16Tflops' | 'fp16MatrixTflops' | 'neuralAccel'>;
  mq: PpModel;
  ubatch: number;
  ubatchAssumed?: true;
  measuredPp: number;
  source: string;
};

export const PP_SIZE_CASES: readonly PpSizeCase[] = [
  { label: "RTX 3090 llama 1B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 35.6 }, mq: { paramsB: 1.24, quant: 'Q4_0' }, ubatch: 512, measuredPp: 24218.15, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 3090 gemma 2B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 35.6 }, mq: { paramsB: 2.51, quant: 'Q4_0' }, ubatch: 512, measuredPp: 15062.79, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 3090 llama 8B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 35.6 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 5340.53, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 3090 gemma4 26B.A4B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 35.6 }, mq: { paramsB: 25.23, activeParamsB: 3.8, activeExpertFrac: 8/128, quant: 'Q4_0' }, ubatch: 512, measuredPp: 4375.72, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 4090 llama 1B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 1.24, quant: 'Q4_0' }, ubatch: 512, measuredPp: 45541.02, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 4090 gemma 2B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 2.51, quant: 'Q4_0' }, ubatch: 512, measuredPp: 30312.75, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 4090 llama 8B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 12592.45, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 4090 gemma4 26B.A4B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 25.23, activeParamsB: 3.8, activeExpertFrac: 8/128, quant: 'Q4_0' }, ubatch: 512, measuredPp: 9722.05, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 5090 gemma 2B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 104.8 }, mq: { paramsB: 2.51, quant: 'Q4_0' }, ubatch: 512, measuredPp: 37668.66, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 5090 llama 8B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 104.8 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 15788.55, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 5090 gemma4 26B.A4B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'nvidia', fp16Tflops: 104.8 }, mq: { paramsB: 25.23, activeParamsB: 3.8, activeExpertFrac: 8/128, quant: 'Q4_0' }, ubatch: 512, measuredPp: 11911.24, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RTX 3090 gpt-oss 20B MXFP4 pp2048 (2026-07-05 b9867)", hw: { effClass: 'nvidia', fp16Tflops: 35.6 }, mq: { paramsB: 20.91, activeParamsB: 3.6, activeExpertFrac: 4/32, quant: 'MXFP4' }, ubatch: 512, measuredPp: 5824.05, source: "https://github.com/ggml-org/llama.cpp/pull/25319" },
  { label: "RTX 3090 llama 8B Q4_0 pp2048 (2026-07-05 b9867)", hw: { effClass: 'nvidia', fp16Tflops: 35.6 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 5262.11, source: "https://github.com/ggml-org/llama.cpp/pull/25319" },
  { label: "RTX 4090 gpt-oss 20B MXFP4 pp2048 (2026-07-05 b9867)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 20.91, activeParamsB: 3.6, activeExpertFrac: 4/32, quant: 'MXFP4' }, ubatch: 512, measuredPp: 13126.94, source: "https://github.com/ggml-org/llama.cpp/pull/25319" },
  { label: "RTX 4090 llama 8B Q4_0 pp2048 (2026-07-05 b9867)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 12904.81, source: "https://github.com/ggml-org/llama.cpp/pull/25319" },
  { label: "RTX 5090 gpt-oss 20B MXFP4 pp2048 (2026-07-05 b9867)", hw: { effClass: 'nvidia', fp16Tflops: 104.8 }, mq: { paramsB: 20.91, activeParamsB: 3.6, activeExpertFrac: 4/32, quant: 'MXFP4' }, ubatch: 512, measuredPp: 21011.15, source: "https://github.com/ggml-org/llama.cpp/pull/25319" },
  { label: "RTX 5090 llama 8B Q4_0 pp2048 (2026-07-05 b9867)", hw: { effClass: 'nvidia', fp16Tflops: 104.8 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 16324.41, source: "https://github.com/ggml-org/llama.cpp/pull/25319" },
  { label: "RTX 4090 qwen35 27B Q4_0 pp512 (2026-02-05 ?)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 26.9, quant: 'Q4_0' }, ubatch: 512, measuredPp: 3221.77, source: "https://github.com/ggml-org/llama.cpp/pull/19378" },
  { label: "RTX 4090 qwen35 27B Q8_0 pp512 (2026-02-05 ?)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 26.9, quant: 'Q8_0' }, ubatch: 512, measuredPp: 2767.4, source: "https://github.com/ggml-org/llama.cpp/pull/19378" },
  { label: "RTX 4090 gemma4 31B Q4_K_M pp512 (2026-02-05 ?)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 30.7, quant: 'Q4_K_M' }, ubatch: 512, measuredPp: 2998.02, source: "https://github.com/ggml-org/llama.cpp/pull/19378" },
  { label: "RTX 4090 gemma4 31B Q8_0 pp512 (2026-02-05 ?)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 30.7, quant: 'Q8_0' }, ubatch: 512, measuredPp: 2736.66, source: "https://github.com/ggml-org/llama.cpp/pull/19378" },
  { label: "RTX 4090 llama 1B F16 pp512 (2026-02-05 ?)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 1.24, quant: 'F16' }, ubatch: 512, measuredPp: 47450.84, source: "https://github.com/ggml-org/llama.cpp/pull/19378" },
  { label: "RTX 4090 llama 8B F16 pp512 (2026-02-05 ?)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 8.03, quant: 'F16' }, ubatch: 512, measuredPp: 10624.32, source: "https://github.com/ggml-org/llama.cpp/pull/19378" },
  { label: "RTX 4090 llama 70B Q4_K_M pp512 (2026-02-05 ?)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 70.55, quant: 'Q4_K_M' }, ubatch: 512, measuredPp: 1439.14, source: "https://github.com/ggml-org/llama.cpp/pull/19378" },
  { label: "RTX 4090 llama 8B Q4_0 pp512 (2026-02-13 ?)", hw: { effClass: 'nvidia', fp16Tflops: 82.6 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 12731.18, source: "https://github.com/ggml-org/llama.cpp/pull/19378#issuecomment-3897437729" },
  { label: "RTX 3090 llama 7B Q4_0 pp512 (2026-09-07 b10809)", hw: { effClass: 'nvidia', fp16Tflops: 35.6 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 5973.72, source: "https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-18332268" },
  { label: "RTX 3090 llama 7B Q4_0 pp512 (2026-05-03 b9011)", hw: { effClass: 'nvidia', fp16Tflops: 35.6 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 5992.1, source: "https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-16797292" },
  { label: "RTX 3060 12GB llama 7B Q4_0 pp512 (2026-08-21 ?)", hw: { effClass: 'nvidia', fp16Tflops: 12.7 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 2407.93, source: "https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-18108605" },
  { label: "RTX 5060 Ti 16GB llama 7B Q4_0 pp512 (2026-03-06 b8214)", hw: { effClass: 'nvidia', fp16Tflops: 23.7 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 4613.86, source: "https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-16020010" },
  { label: "RTX 5060 llama 7B Q4_0 pp512 (2026-06-19 b9715)", hw: { effClass: 'nvidia', fp16Tflops: 19.2 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 3799.47, source: "https://github.com/ggml-org/llama.cpp/discussions/15013#discussioncomment-17364014" },
  { label: "DGX Spark llama 3B Q4_K_M pp512 (2026-04-29 master)", hw: { effClass: 'dgx-spark', fp16Tflops: 62.5 }, mq: { paramsB: 3.21, quant: 'Q4_K_M' }, ubatch: 512, measuredPp: 7441.01, source: "https://github.com/ggml-org/llama.cpp/pull/22522" },
  { label: "DGX Spark qwen3 4B Q4_K_M pp512 (2026-04-29 master)", hw: { effClass: 'dgx-spark', fp16Tflops: 62.5 }, mq: { paramsB: 4.02, quant: 'Q4_K_M' }, ubatch: 512, measuredPp: 5470.71, source: "https://github.com/ggml-org/llama.cpp/pull/22522" },
  { label: "DGX Spark qwen35 27B Q4_K_M pp512 (2026-04-29 master)", hw: { effClass: 'dgx-spark', fp16Tflops: 62.5 }, mq: { paramsB: 26.9, quant: 'Q4_K_M' }, ubatch: 512, measuredPp: 801.7, source: "https://github.com/ggml-org/llama.cpp/pull/22522" },
  { label: "DGX Spark llama 70B Q4_K_M pp512 (2026-04-29 master)", hw: { effClass: 'dgx-spark', fp16Tflops: 62.5 }, mq: { paramsB: 70.55, quant: 'Q4_K_M' }, ubatch: 512, measuredPp: 315.86, source: "https://github.com/ggml-org/llama.cpp/pull/22522" },
  { label: "DGX Spark gpt-oss 20B MXFP4 pp512 (2026-04-29 master)", hw: { effClass: 'dgx-spark', fp16Tflops: 62.5 }, mq: { paramsB: 20.91, activeParamsB: 3.6, activeExpertFrac: 4/32, quant: 'MXFP4' }, ubatch: 512, measuredPp: 4102.32, source: "https://github.com/ggml-org/llama.cpp/pull/22522" },
  { label: "DGX Spark qwen35moe 35B.A3B Q4_K_M pp512 (2026-04-29 master)", hw: { effClass: 'dgx-spark', fp16Tflops: 62.5 }, mq: { paramsB: 34.66, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'Q4_K_M' }, ubatch: 512, measuredPp: 2312.35, source: "https://github.com/ggml-org/llama.cpp/pull/22522" },
  { label: "DGX Spark nemotron_h_moe 31B.A3.5B Q4_K_M pp512 (2026-04-29 master)", hw: { effClass: 'dgx-spark', fp16Tflops: 62.5 }, mq: { paramsB: 31.58, activeParamsB: 3.5, activeExpertFrac: 6/128, quant: 'Q4_K_M' }, ubatch: 512, measuredPp: 2188.27, source: "https://github.com/ggml-org/llama.cpp/pull/22522" },
  { label: "DGX Spark nemotron_h_moe 120B.A12B MXFP4 pp512 (2026-04-29 master)", hw: { effClass: 'dgx-spark', fp16Tflops: 62.5 }, mq: { paramsB: 120.67, activeParamsB: 12.0, activeExpertFrac: 22/512, quant: 'MXFP4' }, ubatch: 512, measuredPp: 571.02, source: "https://github.com/ggml-org/llama.cpp/pull/22522" },
  { label: "M2 Ultra 76c gemma3 1B Q4_0 pp512 (2026-02-12 master)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 1.0, quant: 'Q4_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 11154.61, source: "https://github.com/ggml-org/llama.cpp/pull/19555" },
  { label: "M2 Ultra 76c gemma3 4B Q4_0 pp512 (2026-02-12 master)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 3.88, quant: 'Q4_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 2816.49, source: "https://github.com/ggml-org/llama.cpp/pull/19555" },
  { label: "M2 Ultra 76c qwen3 0.6B Q4_0 pp512 (2026-02-12 master)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 0.6, quant: 'Q4_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 14416.27, source: "https://github.com/ggml-org/llama.cpp/pull/19555" },
  { label: "M2 Ultra 76c qwen3 4B Q8_0 pp512 (2026-02-12 master)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 4.02, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 2479.97, source: "https://github.com/ggml-org/llama.cpp/pull/19555" },
  { label: "M2 Ultra 76c gpt-oss 20B MXFP4 pp512 (2026-02-12 master)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 20.91, activeParamsB: 3.6, activeExpertFrac: 4/32, quant: 'MXFP4' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 2415.52, source: "https://github.com/ggml-org/llama.cpp/pull/19555" },
  { label: "M2 Ultra 76c gpt-oss 120B MXFP4 pp512 (2026-02-12 master)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 116.83, activeParamsB: 5.1, activeExpertFrac: 4/128, quant: 'MXFP4' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 1221.94, source: "https://github.com/ggml-org/llama.cpp/pull/19555" },
  { label: "M2 Ultra 76c qwen3moe 30B.A3B Q4_0 pp512 (2026-02-12 master)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 30.53, activeParamsB: 3.3, activeExpertFrac: 8/128, quant: 'Q4_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 2158.07, source: "https://github.com/ggml-org/llama.cpp/pull/19555" },
  { label: "M2 Ultra 76c gemma4 26B.A4B Q4_0 pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 25.23, activeParamsB: 3.8, activeExpertFrac: 8/128, quant: 'Q4_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 2159.89, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M2 Ultra 76c qwen35 0.8B Q8_0 pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 0.75, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 11945.8, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M2 Ultra 76c qwen35 27B Q4_K_M pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 26.9, quant: 'Q4_K_M' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 366.64, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M2 Ultra 76c qwen35 27B Q8_0 pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 26.9, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 393.47, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M2 Ultra 76c qwen35moe 35B.A3B Q4_K_M pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 34.66, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'Q4_K_M' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 2309.46, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M2 Ultra 76c qwen35moe 35B.A3B Q8_0 pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple-ultra', fp16Tflops: 27.2 }, mq: { paramsB: 34.66, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 2401.91, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M5 Max 40c qwen35 27B Q4_0 pp512 (2026-04-25 pr)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 26.9, quant: 'Q4_0' }, ubatch: 2048, measuredPp: 838.46, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646" },
  { label: "M5 Max 40c qwen35 27B Q8_0 pp512 (2026-04-25 pr)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 26.9, quant: 'Q8_0' }, ubatch: 2048, measuredPp: 811.19, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646" },
  { label: "M5 Max 40c gemma4 31B Q4_0 pp512 (2026-04-25 pr)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 30.7, quant: 'Q4_0' }, ubatch: 2048, measuredPp: 711.68, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646" },
  { label: "M5 Max 40c gemma4 31B Q8_0 pp512 (2026-04-25 pr)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 30.7, quant: 'Q8_0' }, ubatch: 2048, measuredPp: 705.05, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646" },
  { label: "M5 Max 40c gemma4 26B.A4B Q4_0 pp512 (2026-04-25 pr)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 25.23, activeParamsB: 3.8, activeExpertFrac: 8/128, quant: 'Q4_0' }, ubatch: 2048, measuredPp: 3963.35, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646" },
  { label: "M5 Max 40c gemma4 26B.A4B Q8_0 pp512 (2026-04-25 pr)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 25.23, activeParamsB: 3.8, activeExpertFrac: 8/128, quant: 'Q8_0' }, ubatch: 2048, measuredPp: 3398.86, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646" },
  { label: "M5 Max 40c qwen35moe 35B.A3B Q4_0 pp512 (2026-04-25 pr)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 34.66, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'Q4_0' }, ubatch: 2048, measuredPp: 3523.32, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646" },
  { label: "M5 Max 40c qwen35moe 35B.A3B Q8_0 pp512 (2026-04-25 pr)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 34.66, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'Q8_0' }, ubatch: 2048, measuredPp: 3065.51, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319496646" },
  { label: "M5 Max 40c mistral3 8B Q8_0 pp2048 (2026-04-25 b8936)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 8.49, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 2694.79, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319584107" },
  { label: "M5 Max 40c gemma3 4B Q4_0 pp2048 (2026-04-25 b8936)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 3.88, quant: 'Q4_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 6043.62, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319584107" },
  { label: "M5 Max 40c qwen35 0.8B Q8_0 pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 0.75, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 16298.6, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M5 Max 40c qwen35 27B Q4_K_M pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 26.9, quant: 'Q4_K_M' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 356.52, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M5 Max 40c qwen35 27B Q8_0 pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 26.9, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 721.19, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M5 Max 40c qwen35moe 35B.A3B Q4_K_M pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 34.66, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'Q4_K_M' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 3651.57, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M5 Max 40c qwen35moe 35B.A3B Q8_0 pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 34.66, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 3563.4, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M5 Max 40c gemma4 26B.A4B Q8_0 pp2048 (2026-09-15 b10809)", hw: { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true }, mq: { paramsB: 25.23, activeParamsB: 3.8, activeExpertFrac: 8/128, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 3581.64, source: "https://github.com/ggml-org/llama.cpp/pull/28948" },
  { label: "M4 Max 32c mistral3 8B Q8_0 pp2048 (2026-04-25 b8936)", hw: { effClass: 'apple', fp16Tflops: 12.92 }, mq: { paramsB: 8.49, quant: 'Q8_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 631.07, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319584107" },
  { label: "M4 Max 32c gemma3 4B Q4_0 pp2048 (2026-04-25 b8936)", hw: { effClass: 'apple', fp16Tflops: 12.92 }, mq: { paramsB: 3.88, quant: 'Q4_0' }, ubatch: 2048, ubatchAssumed: true, measuredPp: 1571.53, source: "https://github.com/ggml-org/llama.cpp/pull/20962#issuecomment-4319584107" },
  { label: "M5 10c qwen35 9B Q4_K_M pp2048 (2026-09-26 81bc6b83f)", hw: { effClass: 'apple', fp16Tflops: 4.15, neuralAccel: true }, mq: { paramsB: 9.65, quant: 'Q4_K_M' }, ubatch: 2048, measuredPp: 375.6, source: "https://github.com/ggml-org/llama.cpp/pull/28439#issuecomment-5847308681" },
  { label: "M5 10c gpt-oss 20B MXFP4 pp2048 (2026-09-26 81bc6b83f)", hw: { effClass: 'apple', fp16Tflops: 4.15, neuralAccel: true }, mq: { paramsB: 20.91, activeParamsB: 3.6, activeExpertFrac: 4/32, quant: 'MXFP4' }, ubatch: 2048, measuredPp: 855.6, source: "https://github.com/ggml-org/llama.cpp/pull/28439#issuecomment-5847308681" },
  { label: "M5 10c Tiel 35B.A3B IQ3_XXS pp2048 (2026-09-26 81bc6b83f)", hw: { effClass: 'apple', fp16Tflops: 4.15, neuralAccel: true }, mq: { paramsB: 35.0, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'IQ3_XXS' }, ubatch: 2048, measuredPp: 771.7, source: "https://github.com/ggml-org/llama.cpp/pull/28439#issuecomment-5847308681" },
  { label: "RX 9060 XT 16GB llama 1B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'amd', fp16Tflops: 51.3, fp16MatrixTflops: 103 }, mq: { paramsB: 1.24, quant: 'Q4_0' }, ubatch: 512, measuredPp: 11331.98, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RX 9060 XT 16GB gemma 2B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'amd', fp16Tflops: 51.3, fp16MatrixTflops: 103 }, mq: { paramsB: 2.51, quant: 'Q4_0' }, ubatch: 512, measuredPp: 7159.41, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RX 9060 XT 16GB llama 8B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'amd', fp16Tflops: 51.3, fp16MatrixTflops: 103 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 2556.26, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RX 9060 XT 16GB gemma4 26B.A4B Q4_0 pp512 (2026-05-25 5d246a792)", hw: { effClass: 'amd', fp16Tflops: 51.3, fp16MatrixTflops: 103 }, mq: { paramsB: 25.23, activeParamsB: 3.8, activeExpertFrac: 8/128, quant: 'Q4_0' }, ubatch: 512, measuredPp: 2035.16, source: "https://github.com/ggml-org/llama.cpp/pull/23615#issuecomment-4534473995" },
  { label: "RX 9060 XT 16GB gpt-oss 20B MXFP4 pp2048 (2026-07-05 b9867)", hw: { effClass: 'amd', fp16Tflops: 51.3, fp16MatrixTflops: 103 }, mq: { paramsB: 20.91, activeParamsB: 3.6, activeExpertFrac: 4/32, quant: 'MXFP4' }, ubatch: 512, measuredPp: 2914.98, source: "https://github.com/ggml-org/llama.cpp/pull/25319" },
  { label: "RX 9060 XT 16GB llama 8B Q4_0 pp2048 (2026-07-05 b9867)", hw: { effClass: 'amd', fp16Tflops: 51.3, fp16MatrixTflops: 103 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 2622.87, source: "https://github.com/ggml-org/llama.cpp/pull/25319" },
  { label: "RX 9060 XT 16GB llama 7B Q4_0 pp512 (2026-10-02 ?)", hw: { effClass: 'amd', fp16Tflops: 51.3, fp16MatrixTflops: 103 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 3228.15, source: "https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18709094" },
  { label: "RX 9070 XT gpt-oss 20B MXFP4 pp512 (2026-05-15 master)", hw: { effClass: 'amd', fp16Tflops: 97.3, fp16MatrixTflops: 195 }, mq: { paramsB: 20.91, activeParamsB: 3.6, activeExpertFrac: 4/32, quant: 'MXFP4' }, ubatch: 512, measuredPp: 4545.1, source: "https://github.com/ggml-org/llama.cpp/pull/21024#issuecomment-4460661536" },
  { label: "RX 9070 XT llama 8B Q4_0 pp512 (2026-05-15 master)", hw: { effClass: 'amd', fp16Tflops: 97.3, fp16MatrixTflops: 195 }, mq: { paramsB: 8.03, quant: 'Q4_0' }, ubatch: 512, measuredPp: 4922.26, source: "https://github.com/ggml-org/llama.cpp/pull/21024#issuecomment-4460661536" },
  { label: "RX 9070 XT llama 8B Q8_0 pp512 (2026-05-15 master)", hw: { effClass: 'amd', fp16Tflops: 97.3, fp16MatrixTflops: 195 }, mq: { paramsB: 8.03, quant: 'Q8_0' }, ubatch: 512, measuredPp: 4409.39, source: "https://github.com/ggml-org/llama.cpp/pull/21024#issuecomment-4460661536" },
  { label: "RX 9070 XT llama 13B Q5_K_M pp512 (2026-04-22 master)", hw: { effClass: 'amd', fp16Tflops: 97.3, fp16MatrixTflops: 195 }, mq: { paramsB: 13.02, quant: 'Q5_K_M' }, ubatch: 512, measuredPp: 2073.2, source: "https://github.com/ggml-org/llama.cpp/pull/21751#issuecomment-4297412913" },
  { label: "RX 9070 XT llama 8B Q4_K_S pp512 (2026-04-22 master)", hw: { effClass: 'amd', fp16Tflops: 97.3, fp16MatrixTflops: 195 }, mq: { paramsB: 8.03, quant: 'Q4_K_S' }, ubatch: 512, measuredPp: 3954.47, source: "https://github.com/ggml-org/llama.cpp/pull/21751#issuecomment-4297412913" },
  { label: "RX 9070 XT llama 7B Q4_0 pp512 (2026-03-27 ?)", hw: { effClass: 'amd', fp16Tflops: 97.3, fp16MatrixTflops: 195 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 5505.31, source: "https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-16350652" },
  { label: "RX 7900 XTX llama 7B Q4_0 pp512 (2026-09-10 b10868)", hw: { effClass: 'amd', fp16Tflops: 122.8, fp16MatrixTflops: 123 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 3889.54, source: "https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18386832" },
  { label: "Strix Halo 8060S llama 7B Q4_0 pp512 (2026-10-02 b11349)", hw: { effClass: 'strix', fp16Tflops: 29.7 }, mq: { paramsB: 6.74, quant: 'Q4_0' }, ubatch: 512, measuredPp: 1704.3, source: "https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18711544" },
  { label: "Strix Halo 8060S Qwen3.6-35B-A3B UD-Q5_K_M pp512 (2026-10-04 b11223)", hw: { effClass: 'strix', fp16Tflops: 29.7 }, mq: { paramsB: 34.66, activeParamsB: 3.0, activeExpertFrac: 8/256, quant: 'Q5_K_M' }, ubatch: 512, measuredPp: 1501.2, source: "https://github.com/ggml-org/llama.cpp/issues/29892#issuecomment-5981486905" },
  { label: "Strix Halo 8060S gpt-oss 120B MXFP4 pp512 (2026-10-04 b11223)", hw: { effClass: 'strix', fp16Tflops: 29.7 }, mq: { paramsB: 116.83, activeParamsB: 5.1, activeExpertFrac: 4/128, quant: 'MXFP4' }, ubatch: 512, measuredPp: 1132.7, source: "https://github.com/ggml-org/llama.cpp/issues/29892#issuecomment-5981486905" },
  { label: "Strix Halo 8060S Qwen3.8-27B UD-Q5_K_XL pp512 ub2048 (2026-08-25 parent)", hw: { effClass: 'strix', fp16Tflops: 29.7 }, mq: { paramsB: 27.32, quant: 'UD-Q5_K_XL' }, ubatch: 2048, measuredPp: 311.0, source: "https://github.com/ggml-org/llama.cpp/pull/27554#issuecomment-5414311828" },
  { label: "RX 7900 XTX Qwen3.8-27B IQ3_XXS pp512 (2026-09-22 b11065)", hw: { effClass: 'amd', fp16Tflops: 122.8, fp16MatrixTflops: 123 }, mq: { paramsB: 27.32, quant: 'IQ3_XXS' }, ubatch: 512, measuredPp: 914.9, source: "https://github.com/ggml-org/llama.cpp/issues/28843#issuecomment-5772682741" },
];

// ---------- 12) Gemma 4 E4B·E2B — 층별 임베딩 표(PLE)·KV 공유 층 (10-21 D112, docs/02 §2.2·§2.4·§3.1) ----------
/**
 * 파일별 GGUF 헤더 실측(Range 읽기, 10-20~21): fileGB · offGpuGB(파일 − GPU 상주 = 층별 임베딩 표 + 헤더) · pleGB(`per_layer_token_embd`).
 * 임베딩 공유라 token_embd 는 출력층 사본으로 GPU 상주에 들어 있다. paramsB 는 카탈로그 값(HF safetensors — 비전·오디오 인코더 포함).
 * KV 는 저장 KV — E4B 앞 24층 안의 전체 어텐션 4층 × kv 2 × 512 × 4 = 16,384 B/tok, E2B 앞 15층 안의 3층 × 1 × 512 × 4 = 6,144 B/tok
 * (llama.cpp n_layer_kv_from_start — https://github.com/ggml-org/llama.cpp/blob/9a3b91c6801e68f412fcf1b6f8e153aa562b8536/src/models/gemma4.cpp#L8-L11)
 */
const gemma4E = (paramsB: number, kvBytesPerToken: number, fileGB: number, offGpuGB: number, pleGB: number, quant: QuantId): ModelQuant => ({
  paramsB, fileGB, quant, kvBytesPerToken, attnType: 'swa', offGpuGB, pleGB, maxContext: 131072,
});
// https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf — PLE Q5_K 1,937,768,448 B (카탈로그 행)
export const GEMMA4_E4B_Q4: ModelQuant = gemma4E(8.0, 16_384, 4.98, 1.95, 1.94, 'Q4_K_M');
// https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q8_0.gguf — PLE Q8_0 2,994,733,056 B (카탈로그 행)
export const GEMMA4_E4B_Q8: ModelQuant = gemma4E(8.0, 16_384, 8.19, 3.01, 2.99, 'Q8_0');
// https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf — PLE Q5_K (B580 점, 4.49 GiB 텐서).
// Q4_0 은 QuantId 밖이라 표기만 Q4_K_M — 속도식은 fileGB·pleGB 만 읽는다(아래 E2B Q4_0 도 같다)
const GEMMA4_E4B_Q40_UNSLOTH = gemma4E(8.0, 16_384, 4.84, 1.95, 1.94, 'Q4_K_M');
// https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF/resolve/main/google_gemma-4-E4B-it-Q4_K_M.gguf — PLE Q6_K 2,312,110,080 B (A770 점, 5.02 GiB 텐서)
const GEMMA4_E4B_Q4_BARTOWSKI = gemma4E(8.0, 16_384, 5.41, 2.33, 2.31, 'Q4_K_M');
// https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q8_0.gguf — PLE Q8_0 (3080 Ti 점, 7.48 GiB)
const GEMMA4_E4B_Q8_GGML = gemma4E(8.0, 16_384, 8.03, 3.01, 2.99, 'Q8_0');
// https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf — PLE Q5_K 1,614,807,040 B (카탈로그 행)
export const GEMMA4_E2B_Q4: ModelQuant = gemma4E(5.12, 6_144, 3.11, 1.63, 1.61, 'Q4_K_M');
// https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf — PLE Q4_0 1,321,205,760 B (#29152 점 — 출처에 파일이 없어 llama-quantize 기본 Q4_0 인 이 파일로 본다)
const GEMMA4_E2B_Q40_GGML = gemma4E(5.12, 6_144, 2.84, 1.34, 1.32, 'Q4_K_M');
// 같은 파일의 token_embd Q8_0 1536 × 262,144 = 427,819,008 B — 임베딩 공유라 출력층이 이 텐서의 GPU 사본이다(헤더 실측 10-21)
const GEMMA4_E2B_Q40_GGML_OUTPUT_GB = 0.427819008;

export type PleSpeedCase = SourcedSpeedCase & {
  /**
   * 잰 백엔드가 엔진의 클래스 기본(nvidia·dgx-spark = cuda, 그 밖 = vulkan — `PLE_CUDA_CLASSES`)과 다를 때만 — 5090 Vulkan 점.
   * 테스트는 `pleOverheadSeconds(hw, mq, backend)` 로 그 백엔드 값을 쓴다
   */
  backend?: 'cuda' | 'vulkan';
  /**
   * ubatch 1 pp 점: 마지막 토큰에서만 계산하는 출력층 GB — 읽기 바이트에서 × (n − 1)/n 을 뺀다(llama-bench pp 는 출력 지정 없는 배치라
   * 마지막 토큰만 출력: https://github.com/ggml-org/llama.cpp/blob/e13469a323147aed0c93f5b4efde10fcc379e977/tools/llama-bench/llama-bench.cpp#L2154 ·
   * src/llama-batch.cpp#L120-L130). tg 는 토큰마다 출력층을 읽으므로 같은 카드의 tg 는 이 점보다 느리다
   */
  skippedOutputGB?: number;
  /** 상수 근거가 아닌 참고점(다른 백엔드·클래스 계수 문제) — 오차만 고정한다 */
  reference?: true;
  /** 회귀 대조 시 기록한 오차(추정 ÷ 실측 − 1, 10-21) — 식이 바뀌면 테스트가 알린다 */
  recordedErr: number;
};
const pleCase = (
  label: string,
  hw: Hardware,
  mq: ModelQuant,
  ctx: number,
  measuredTg: number,
  source: string,
  recordedErr: number,
  extra: Pick<PleSpeedCase, 'backend' | 'skippedOutputGB' | 'reference'> = {},
): PleSpeedCase => ({ label, hw, mq, ctx, measuredTg, band: 0.3, source, recordedErr, ...extra });
const ARC_A770: Hardware = dgpu(16, 560, 'intel-arc');
const ARC_B580: Hardware = dgpu(12, 456, 'intel-arc');
const UB1_PP256 = { skippedOutputGB: GEMMA4_E2B_Q40_GGML_OUTPUT_GB * (255 / 256) };

/**
 * 공개 실측(빌드·파일 확인, 10-21 재확인) — 클래스 계수 + 층별 임베딩 표 고정 시간(`PLE_TOKEN_OVERHEAD_MS`, 10-21 D112 리뷰 반영)의 추정과
 * 비교한다(사이트가 보이는 값 — 5090 Vulkan 점만 Vulkan 값). ctx: tg128 은 512(관례), ubatch 1 pp256 은 256, 4k 프롬프트 뒤 생성은 4224.
 * 고정 시간이 없던 식은 빠른 카드에서 작은 모델일수록 높게 봤다(3090~5090 CUDA E2B +30~+75%, 5090 Vulkan E4B +76%·E2B +144%). 같은 5090
 * Vulkan 표의 다른 dense 모델은 실측 − 대역폭 시간이 0.14~0.72ms 인데 E 계열은 1.73~1.84ms 라 E 계열 고유의 지연이다(#28618: 층별 입력을
 * 토큰마다 CPU→GPU 로 올리며 동기화). 상수 근거: CUDA 6점(ubatch 1 4점은 출력층을 뺀 읽기 — 그러면 DGX Spark 도 1.0ms 가 남아 다른 CUDA 점과
 * 같은 무리가 된다) minimax 1.35ms, Vulkan 2점 minimax 1.75ms(0.05ms 격자). 참고점: B580 SYCL(클래스 기본 vulkan 값) −3.3%, A770 Vulkan +78%(intel-arc 계수 —
 * B580 에서 정함 — 가 A770 에 맞지 않는 몫). 라벨은 그대로 이론 추정(데이터 레이어 isTheoretical, PROGRESS §4 D112)
 */
export const PLE_SPEED_CASES: readonly PleSpeedCase[] = [
  // RTX 5090 Vulkan(FA, -p 0 -n 128) — PR 의 수정 후 표, 파일은 명령의 unsloth 경로(4.62·2.88 GiB). NVIDIA 카드지만 백엔드가 Vulkan
  pleCase('RTX 5090 Vulkan Gemma 4 E4B Q4_K_M tg128 (#28618 after)', NV(1792), GEMMA4_E4B_Q4, 512, 233.96, PR(28618), 0.023, { backend: 'vulkan' }),
  pleCase('RTX 5090 Vulkan Gemma 4 E2B Q4_K_M tg128 (#28618 after)', NV(1792), GEMMA4_E2B_Q4, 512, 341.76, PR(28618), -0.008, { backend: 'vulkan' }),
  // CUDA FA 튜닝 PR 의 master 열 — ubatch 1 pp256 깊이 0(출력층은 마지막 토큰만)
  pleCase('RTX 3090 CUDA Gemma 4 E2B Q4_0 ub1 pp256 (#29152 master)', NV(936), GEMMA4_E2B_Q40_GGML, 256, 298.02, PR(29152), 0.11, UB1_PP256),
  pleCase('RTX 4090 CUDA Gemma 4 E2B Q4_0 ub1 pp256 (#29152 master)', NV(1008), GEMMA4_E2B_Q40_GGML, 256, 356.15, PR(29152), -0.033, UB1_PP256),
  pleCase('RTX 5090 CUDA Gemma 4 E2B Q4_0 ub1 pp256 (#29152 master)', NV(1792), GEMMA4_E2B_Q40_GGML, 256, 470.11, PR(29152), -0.043, UB1_PP256),
  // 같은 PR 의 리뷰(ynankani) DGX Spark 표 master 열
  pleCase('DGX Spark CUDA Gemma 4 E2B Q4_0 ub1 pp256 (#29152 review)', SPARK, GEMMA4_E2B_Q40_GGML, 256, 162.3, 'https://github.com/ggml-org/llama.cpp/pull/29152#pullrequestreview-5260306593', -0.051, UB1_PP256),
  // NVIDIA CUDA Q8_0 — 3080 Ti(b10988, ggml-org 7.48 GiB, 4,096 토큰 프롬프트 뒤 생성) · 4070 Ti(5208e2d5b (8641), unsloth 7.62 GiB, -ngl 999)
  pleCase('RTX 3080 Ti CUDA Gemma 4 E4B Q8_0 gen after 4k prompt (b10988)', dgpu(12, 912, 'nvidia'), GEMMA4_E4B_Q8_GGML, 4224, 112.9, 'https://atomic.chat/blog/guides/best-local-llm-12gb', -0.053),
  pleCase('RTX 4070 Ti CUDA Gemma 4 E4B Q8_0 tg128 (b8641)', dgpu(12, 504, 'nvidia'), GEMMA4_E4B_Q8, 512, 69.66, 'https://alfonsofortunato.com/blog/gemma-4-e4b-vs-26b-local-benchmarks/', -0.109),
  // 참고점 — Intel Arc: B580 SYCL(FA 0, unsloth Q4_0 4.49 GiB, 빌드 표기 없음 2026-06-13) · A770 Vulkan(b10068 571d0d540, bartowski 5.02 GiB)
  pleCase('Arc B580 SYCL Gemma 4 E4B Q4_0 tg128', ARC_B580, GEMMA4_E4B_Q40_UNSLOTH, 512, 82.3, 'https://github.com/ggml-org/llama.cpp/discussions/23313#discussioncomment-17291611', -0.033, { reference: true }),
  pleCase('Arc A770 Vulkan Gemma 4 E4B Q4_K_M tg128 (b10068)', ARC_A770, GEMMA4_E4B_Q4_BARTOWSKI, 512, 50.31, 'https://github.com/ggml-org/llama.cpp/discussions/26823', 0.781, { reference: true }),
];

// ---------- 13) K2-Horizon MoVA 36B-A4B — 값 전문가(MoVA, 10-21 D113, docs/02 §3.1·§3.3) ----------
/**
 * 카탈로그 행과 같은 GGUF 헤더 실측: 파일 22.37 · FFN 전문가 15.99 · 비전문가 6.0(값 전문가 attn_v_exps 4.25 포함 — llama.cpp `--n-cpu-moe`·`--fit` 은
 * FFN 전문가만 옮긴다) · FFN 100 × top-8 · MoE 45층(앞 dense 3층 뒤) · 값 전문가 64 × top-4 · KV 48 × 8 × 128 × 4 = 196,608 B/tok.
 * 엔진 0.11.0 은 값 전문가 중 고른 4/64 몫만 읽는다(top-k 선택 → mul_mat_id —
 * https://github.com/ggml-org/llama.cpp/blob/4625240437c6821ee5c2da99e12d4817c6a8f07f/src/models/k2-horizon.cpp#L161 · #L186)
 */
// source: https://huggingface.co/IFM/K2-Horizon-MoVA-36B-A4B-GGUF/resolve/main/K2-Horizon-MoVA-36B-A4B-Q4_K_M.gguf
export const K2_MOVA_Q4: ModelQuant = {
  paramsB: 37.44,
  activeParamsB: 4,
  fileGB: 22.37,
  quant: 'Q4_K_M',
  kvBytesPerToken: 196_608,
  attnType: 'full',
  nonExpertGB: 6.0,
  expertGB: 15.99,
  activeExpertFrac: 8 / 100,
  moeLayers: 45,
  topK: 8,
  valueExpertGB: 4.25,
  valueExpertFrac: 4 / 64,
  maxContext: 524_288,
};

// ---------- 14) 반복 층 — Nanbeige4.2-3B (10-22 D114, docs/02 §2.2·§3.1·§7) ----------
/**
 * Nanbeige4.2-3B: 물리 22층 × `num_loops` 2 — llama.cpp 는 논리 층 44개를 차례로 돌며 물리 층 가중치를 다시 쓴다(같은 텐서) —
 * https://github.com/ggml-org/llama.cpp/blob/0a1ef309cdbb9f2024f58a38fb4c42352c5db569/src/models/nanbeige.cpp#L19-L32 · #L66-L73 · #L105.
 * KV 는 논리 층마다(KV 캐시가 n_layer_all 을 돈다 — src/llama-kv-cache.cpp#L102 · #L165-L171) 44 × 8 × 128 × 4 = 180,224 B/tok.
 * 행은 GGUF 헤더 실측(Range 읽기, 10-22): fileGB · loopGB(트렁크 blk.N.* 합) · offGpuGB(token_embd — 입력층은 CPU). paramsB 4.17 = safetensors 총계
 */
const nanbeige42 = (fileGB: number, loopGB: number, offGpuGB: number, quant: QuantId): ModelQuant => ({
  paramsB: 4.17, fileGB, quant, kvBytesPerToken: 180_224, attnType: 'full', offGpuGB, loops: 2, loopGB, maxContext: 262_144,
});
// https://huggingface.co/bartowski/Nanbeige_Nanbeige4.2-3B-GGUF/resolve/main/Nanbeige_Nanbeige4.2-3B-Q4_K_M.gguf — 블록 1,974,263,808 B · token_embd 287,096,832 B (카탈로그 행)
export const NANBEIGE42_Q4: ModelQuant = nanbeige42(2.68, 1.97, 0.29, 'Q4_K_M');
// https://huggingface.co/owao/Nanbeige4.2-3B-GGUF/resolve/main/Nanbeige4.2-3B-Q4_K_M.gguf — 블록 1,865,048,064 B, 텐서 합 2,570,840,064 B = llama-bench "2.39 GiB"
// (Steam Deck 점의 파일 — 출처 표의 파일 이름·크기로 특정: 2.39 GiB 는 bartowski 판 2.50 GiB 가 아니라 이 계열)
export const NANBEIGE42_Q4_OWAO: ModelQuant = nanbeige42(2.57, 1.87, 0.29, 'Q4_K_M');
/** 같은 기기의 Llama 2 7B Q4_0(출처 표는 합본 — 이 행은 b10360 48d22e295 단독 실행과 ± 까지 같다) — llama-bench 표기 3.56 GiB, MHA 32층 × kv 32 × 128 × 4 = 524,288 B/tok. Q4_0 은 QuantId 밖이라 표기만 Q4_K_M(속도식은 fileGB 만 읽는다) */
const LLAMA2_7B_Q40_DECK: ModelQuant = {
  paramsB: 6.74, fileGB: 3.56 * 1.073741824, quant: 'Q4_K_M', kvBytesPerToken: 524_288, attnType: 'full', maxContext: 4096,
};

export type LoopRatioCase = {
  label: string;
  /** llama-bench -fa */
  fa: 0 | 1;
  /** 같은 표(같은 기기)의 tg128 tok/s — 반복 모델 ÷ 기준 모델이 실측 비 */
  measured: { loop: number; reference: number };
  /** pp512 tok/s (참고 — rough ±40% 라벨 대조) */
  measuredPp: { loop: number; reference: number };
  /** 기록한 오차(추정 비 ÷ 실측 비 − 1, 10-22) — 지금 식 · 반복을 빼고 파일 한 번 · 파일 전체 × loops */
  recordedErr: { formula: number; noLoops: number; wholeFile: number };
};

/**
 * 같은 기기 비율 — Steam Deck(Van Gogh APU, RADV Vulkan) llama-bench(-ngl 100 -fa 0,1 — 빌드 b10360(48d22e295)은 Llama 2 단독 실행에만 적혀 있어 Nanbeige 행은 같은 빌드로 추정)에서 Llama 2 7B Q4_0 와 Nanbeige4.2-3B Q4_K_M 을
 * 함께 잰 결과를 모은 표(https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18099068, 2026-08-20 — 합본). 대역폭·클래스 계수가 비에서 지워져
 * 카탈로그 밖 기기라도 읽기 바이트 식만 대조된다(benchmarks.json 에는 넣지 않는다 — gpuId 가 없는 캘리브레이션 점이라 사이트에 조인되지 않고,
 * 비율 대조는 레코드 하나로 표현되지 않는다). tg128 은 깊이 0 에서 128 토큰 — KV 읽기는 평균 64 토큰
 */
export const LOOP_RATIO_REFERENCE = LLAMA2_7B_Q40_DECK;
export const LOOP_RATIO_CTX = 64;
export const LOOP_RATIO_SOURCE = 'https://github.com/ggml-org/llama.cpp/discussions/10879#discussioncomment-18099068';
export const LOOP_RATIO_CASES: readonly LoopRatioCase[] = [
  { label: 'Steam Deck Vulkan (b10360 추정) fa 1', fa: 1, measured: { loop: 16.36, reference: 18.40 }, measuredPp: { loop: 126.28, reference: 164.34 }, recordedErr: { formula: -0.026, noLoops: 0.68, wholeFile: -0.158 } },
  { label: 'Steam Deck Vulkan (b10360 추정) fa 0', fa: 0, measured: { loop: 15.27, reference: 17.52 }, measuredPp: { loop: 123.81, reference: 144.31 }, recordedErr: { formula: -0.006, noLoops: 0.714, wholeFile: -0.141 } },
];

/**
 * DeepSeek V4 Flash 0731 (10-22 D115) — 압축 어텐션(CSA·HCA) + 하이퍼 커넥션(mHC) + MoE 256 × top-6(43층 모두). ggml-org MXFP4(2분할) 헤더 실측: 전문가 147.17 ·
 * 비전문가 7.25GB(나머지 Q8_0), Q2_K 109.66 · 7.13GB. KV = 압축 캐시만 6,880 B/tok(데이터 계층 classifyArch — docs/02 §2.2).
 * https://huggingface.co/ggml-org/DeepSeek-V4-Flash-0731-GGUF
 */
const DSV4: MoeBase = { paramsB: 284.33, activeParamsB: 13.8, quant: 'MXFP4', kvBytesPerToken: 6880, attnType: 'compressed', activeExpertFrac: 6 / 256, moeLayers: 43, topK: 6, maxContext: 1048576 };
export const DSV4_FLASH_MXFP4: ModelQuant = moeFile(DSV4, 154.99, 147.17, 7.25);
export const DSV4_FLASH_Q2K: ModelQuant = moeFile({ ...DSV4, quant: 'Q2_K' }, 117.35, 109.66, 7.13);

/**
 * llama.cpp KV 캐시 로그(#27680 — RTX 4090, b10567·b10568, n_ctx 64000·n_ubatch 4096, bf16 캐시 = f16 과 같은 2B) — 압축 KV 산식 대조용.
 * CSA 16,128셀(= PAD(ceil(64000/4), 256)) × 21층 · 인덱서 같은 셀 × 21층 · HCA 512셀(= PAD(500, 256)) × 20층 · raw SWA 4,352셀(= PAD(128 + 4096, 256)) × 43층
 */
export const DSV4_KV_LOG = {
  source: 'https://github.com/ggml-org/llama.cpp/issues/27680',
  ctx: 64000,
  ubatch: 4096,
  swaWindow: 128,
  csa: { cells: 16128, layers: 21, mib: 330.75 },
  indexer: { cells: 16128, layers: 21, mib: 82.69 },
  hca: { cells: 512, layers: 20, mib: 10.0 },
  rawSwa: { cells: 4352, layers: 43, mib: 182.75 },
  /** 압축기 상태 csa·hca·lid (MiB) — 컨텍스트와 무관 */
  states: [1.31, 10.0, 0.33],
  /** 같은 로그의 CUDA0 연산 버퍼(MiB) — b10567 · b10568(회귀가 의심된 빌드) */
  computeBufferMib: [2366.28, 2570.28],
  /**
   * 슬롯 하나로 띄운 실행(명령에 `-np 1` — 로그 `1/1 seqs`·상태 `streams = 1`·`n_slots = 1`). DSV4 캐시는 통합 KV 여도 시퀀스마다 따로 잡혀
   * (https://github.com/ggml-org/llama.cpp/blob/0a1ef309cdbb9f2024f58a38fb4c42352c5db569/src/llama-kv-cache-dsv4.cpp#L1247-L1248) llama-server 기본
   * 4슬롯(https://github.com/ggml-org/llama.cpp/blob/0a1ef309cdbb9f2024f58a38fb4c42352c5db569/tools/server/server.cpp#L169-L173)이면 4배 — 스니펫이 `-np 1` 을 붙인다(10-22 D115 리뷰)
   */
  seqs: 1,
  stateStreams: 1,
  slots: 1,
  serverDefaultSlots: 4,
} as const;

/**
 * 공개 실측 참고점(회귀에 맞춘 값이 아니다 — 10-22 D115). M2 Ultra 192GB(메모리는 미기재 — 155GB 파일이라 192GB 구성, wired limit 을 올려 GPU 에 전부 실은 실행)
 * - #28948(09-19 머지) 비교 표의 PR 열(= 지금 master, b10809 열은 29.20) tg32 — 모델 줄은 "deepseek4 ?B MXFP4 MoE" 뿐이라 파일은 같은 작성자(ggerganov)가 08-03 에
 *   명시한 ggml-org 0731 MXFP4 로 본 가정(시기·작성자 추정)이다. pp2048 은 같은 PR 의 다른 점처럼 -ub 2048 가정
 * - #25893 브랜치(08-03 머지 전 — HC 융합 op 포함) ggml-org 0731 MXFP4 144.34 GiB 명시, -fa 1 -ub 2048, tg128 깊이 0 · 10k · 20k · 30k — 옛 빌드 참고와 문맥 감쇠
 * - DGX Spark(am17an, #27970 — 09-02 머지, CUDA sparse FA): llama-bench tg32 깊이 0·4,096·8,192·32,768 = sparse-fa 열(머지된 코드) 19.07·18.28·18.26·17.52 ·
 *   기준 빌드(dfc29b64e) 열 19.00·18.16·18.18·17.01. 모델 줄은 "deepseek4 ?B IQ2_XXS - 2.0625 bpw" 뿐이라, GLM 의 DGX Spark 점(#30640 — 같은 작성자, "IQ2_XXS")을
 *   unsloth UD-IQ2_XXS 로 본 것과 같은 방식으로 unsloth UD-IQ2_XXS 0731(아래 `DSV4_UD_IQ2XXS`)로 본 가정이다(10-23 D121 리뷰 — 그 전 D115 는 '파일 크기 없음'으로 뺐다).
 *   카탈로그 파일이 아니라 콤보로는 조인 안 됨. 131k~1M 은 긴 문맥 감쇠 대조용(§9 ②)
 * 깊이 0 의 tgN 은 ctx 512(위 MoE 회귀와 같은 관례), 깊이 d 는 d + N/2(tg128 → d + 64, tg32 → d + 16)
 */
export const DSV4_M2_ULTRA: Hardware = unified(192, 800, 'apple-ultra');
export const DSV4_SPARK: Hardware = { ...unified(128, 273, 'dgx-spark'), os: 'linux' };
/**
 * https://huggingface.co/unsloth/DeepSeek-V4-Flash-0731-GGUF UD-IQ2_XXS(3분할 합계 90,860,736,928 B = 90.86GB) — GGUF 헤더 실측(10-23, scripts/gguf-header.ts):
 * file_type 19(IQ2_XXS — #27970 모델 줄의 "IQ2_XXS - 2.0625 bpw" 와 같은 형식), 원소 284,334,567,511(카탈로그 paramsB 284.33 과 같다), 전문가 83.87 · GPU 상주 비전문가 6.69GB
 * (입력 임베딩 0.30GB 는 GPU 밖). quant 는 tg 산식이 읽지 않는 값이라 형식만 맞춘다(GLM53_UD_IQ2XXS 와 같은 관례)
 */
export const DSV4_UD_IQ2XXS: ModelQuant = moeFile({ ...DSV4, quant: 'Q2_K' }, 90.86, 83.87, 6.69);
export const DSV4_REFERENCE = {
  current: { label: 'M2 Ultra #28948 PR (master) tg32', source: PR(28948), ctx: 512, measuredTg: 29.45, masterTg: 29.2, measuredPp: 419.11, ubatch: 2048, recordedErr: 0.25 },
  oldBuild: {
    label: 'M2 Ultra #25893 branch tg128',
    source: PR(25893, '5162332599'),
    depths: [
      { ctx: 64, measuredTg: 27.6 },
      { ctx: 10064, measuredTg: 25.19 },
      { ctx: 20064, measuredTg: 23.44 },
      { ctx: 30064, measuredTg: 22.35 },
    ],
    measuredPp: 408.93,
    /** pp2048 @ 깊이 d(같은 표) — 인덱서·압축 경로가 깊이에 비례해 30k 에서 0.26배(엔진 pp 는 깊이와 무관 — docs/02 §9 압축 어텐션 ②) */
    ppDepths: [
      { depth: 0, measuredPp: 408.93 },
      { depth: 10000, measuredPp: 212.07 },
      { depth: 20000, measuredPp: 142.17 },
      { depth: 30000, measuredPp: 106.94 },
    ],
    ubatch: 2048,
    recordedErr: 0.334,
  },
  spark: {
    label: 'DGX Spark #27970 tg32 (sparse-fa · base dfc29b64e)',
    source: PR(27970),
    points: [
      { ctx: 512, measuredTg: 19.07, baseTg: 19.0 },
      { ctx: 4112, measuredTg: 18.28, baseTg: 18.16 },
      { ctx: 8208, measuredTg: 18.26, baseTg: 18.18 },
      { ctx: 32784, measuredTg: 17.52, baseTg: 17.01 },
    ],
    /** sparse-fa 열 · 기준 빌드 열의 과대(추정 ÷ 실측 − 1) */
    recordedErr: [0.215, 0.265, 0.262, 0.292],
    baseRecordedErr: [0.22, 0.273, 0.268, 0.331],
    /**
     * sparse-fa 열의 긴 문맥 — 감쇠 대조용. 과대가 더 커(+34~56%) 판정 할인(가장 작은 과대)에는 영향이 없다. 524k 부터는 표시 범위(추정 × 0.7) 밑이다.
     * 기준 빌드 열의 긴 문맥은 sparse FA 전이라 더 느려(1M 5.31) 넣지 않았다
     */
    longDepths: [
      { ctx: 131088, measuredTg: 15.73 },
      { ctx: 262160, measuredTg: 13.94 },
      { ctx: 524304, measuredTg: 11.32 },
      { ctx: 1048592, measuredTg: 8.3 },
    ],
  },
} as const;

/**
 * GLM-5.3-Flash (10-22 엔진 후속 ⑧-b) — KDA 선형 34층 + DSA(희소 MLA + 라이트닝 인덱서 k-pool) 11층 + 하이퍼 커넥션(mHC) + MoE 288 × top-8(앞 3층 dense 뒤 42층).
 * ggml-org "Q4_K"(헤더 file_type 15 = Q4_K_M — 2분할) 헤더 실측: 전문가 171.23 · 비전문가 9.46GB(나머지 Q8_0), Q2_K 123.66 · 9.46GB.
 * KV = DSA 층의 MLA 잠재 K + 인덱서 행 19,712 B/tok(데이터 계층 classifyArch — docs/02 §2.2). paramsB·activeParamsB 는 카드 값(320B·18B)
 * https://huggingface.co/ggml-org/GLM-5.3-Flash-GGUF
 */
const GLM53: MoeBase = { paramsB: 320, activeParamsB: 18, quant: 'Q4_K_M', kvBytesPerToken: 19712, attnType: 'hybrid', activeExpertFrac: 8 / 288, moeLayers: 42, topK: 8, maxContext: 1048576 };
export const GLM53_Q4K: ModelQuant = moeFile(GLM53, 181.37, 171.23, 9.46);
export const GLM53_Q2K: ModelQuant = moeFile({ ...GLM53, quant: 'Q2_K' }, 133.81, 123.66, 9.46);

/**
 * llama.cpp 메모리 로그(PR #30499 댓글 — DGX Spark 2대 RPC, n_ctx 262,144·`-np 1`·f16 캐시, ggml-org Q4_K) — KV·순환 상태 대조용.
 * MLA 캐시 262,144셀 × 11층 2,816 MiB(K 만 — V 0) · 인덱서 캐시 같은 셀 × 11층 2,112 MiB · 순환 상태 582.25 MiB(시퀀스 1 × (1 + rs_seq 3) 벌 —
 * 투기적 디코딩 되돌리기용 사본 3벌, R 38.25 · S 544 MiB). 로그 줄은 모두 `1/1 seqs`
 */
export const GLM53_KV_LOG = {
  source: 'https://github.com/ggml-org/llama.cpp/pull/30499#issuecomment-6234771665',
  ctx: 262144,
  mla: { cells: 262144, layers: 11, mib: 2816 },
  indexer: { cells: 262144, layers: 11, mib: 2112 },
  recurrent: { mib: 582.25, rMib: 38.25, sMib: 544, copies: 4, kdaLayers: 34 },
  /** KDA 층 하나의 상태 원소(f32): S = head_dim² × 헤드, R(conv) = 3 × (kernel − 1) × 헤드 × head_dim (src/llama-hparams.cpp n_embd_s·n_embd_r) */
  kda: { heads: 64, headDim: 128, convKernel: 4 },
  seqs: 1,
  /** llama-server 가 -np 없이 띄우는 슬롯 수(통합 KV) — 순환 상태는 슬롯마다 한 벌(recurrent_rs_size = n_seq_max) */
  serverDefaultSlots: 4,
} as const;

/**
 * 공개 실측 참고점(회귀에 맞춘 값이 아니다 — 10-22 ⑧-b). 카탈로그 기기·파일이 정확히 조인되는 지금 빌드 점은 없다:
 * - M2 Ultra(ggerganov, #29958 본문 — 10-05 머지, 희소 어텐션 최적화 #29928(10-07) 전 빌드): 2.5k·16k 문맥 TG 24.4·23.9. 파일은 같은 본문의 재현 명령
 *   (`-hf ggml-org/GLM-5.3-Flash-GGUF:Q2_K`)으로 본 가정, 192GB 의 기본 GPU 한도(70%)로는 카탈로그 콤보가 CPU 경로(필요 134.55 > 134.4)라 조인 안 됨.
 *   재현 명령이 `llama-batched-bench -npl 1,2` 인데 본문이 어느 npl 값인지 밝히지 않아 npl 1 로 읽었다(npl 2 합계라면 과대가 더 크다)
 * - DGX Spark(am17an, #30640 — 10-21 머지, 지금 빌드): tg64 깊이 0·16,384·65,536 = 20.4·19.6·18.4, pp2048(-ub 2048) 548.8. 파일은 "IQ2_XXS" 뿐이라
 *   unsloth UD-IQ2_XXS(101.84GB — 전문가 92.54·비전문가 6.15, MTP 2.79 포함)로 본 가정, 카탈로그 파일이 아니라 콤보로는 조인 안 됨(10-22 에는 엔진 GPU 몫 89.6 에도 안 들어갔다 — 10-23 D117 의 기기 근거 값 116.9 로는 들어간다, 회귀 16)
 * - RTX 3090 × 6(#29928 댓글 — PR 브랜치 헤드 1e24094d7 빌드(머지 전), 200W 전력 제한·-ts 9/7/7/7/7/9): avar6 Q2_K-Q3_K 128.26GB(전문가 110.19·비전문가 9.46·MTP 7.93) llama-bench
 *   tg128 깊이 0·8,192·32,768 = 37.24·36.14·35.50 — 계산기 최대 4장이라 카탈로그 밖 구성
 * 깊이 d 의 tgN 은 ctx d + N/2(위 관례), 깊이 0 은 ctx 512(tg64 — 위 MoE 회귀 관례)·64(tg128 평균)
 */
export const GLM53_M2_ULTRA: Hardware = unified(192, 800, 'apple-ultra');
export const GLM53_SPARK: Hardware = { ...unified(128, 273, 'dgx-spark'), os: 'linux' };
export const GLM53_3090X6: Hardware = multi(6, 24, 936, 'nvidia');
export const GLM53_UD_IQ2XXS: ModelQuant = moeFile({ ...GLM53, quant: 'Q2_K' }, 101.84, 92.54, 6.15);
export const GLM53_AVAR6_Q2Q3: ModelQuant = moeFile({ ...GLM53, quant: 'Q2_K' }, 128.26, 110.19, 9.46);
export const GLM53_REFERENCE = {
  m2Ultra: {
    label: 'M2 Ultra #29958 (pre-#29928) batched TG',
    source: PR(29958),
    points: [
      { ctx: 2532, measuredTg: 24.4 },
      { ctx: 16400, measuredTg: 23.9 },
    ],
    recordedErr: [0.235, 0.238],
  },
  spark: {
    label: 'DGX Spark #30640 tg64',
    source: PR(30640),
    points: [
      { ctx: 512, measuredTg: 20.4 },
      { ctx: 16448, measuredTg: 19.6 },
      { ctx: 65600, measuredTg: 18.4 },
    ],
    recordedErr: [0.108, 0.116, 0.082],
    measuredPp: 548.8,
    ubatch: 2048,
    fp16Tflops: 62.5,
  },
  rtx3090x6: {
    label: '6 × RTX 3090 #29928 tg128',
    source: PR(29928, '5983042076'),
    points: [
      { ctx: 64, measuredTg: 37.24 },
      { ctx: 8256, measuredTg: 36.14 },
      { ctx: 32832, measuredTg: 35.5 },
    ],
    recordedErr: [0.238, 0.261, 0.242],
  },
} as const;

/**
 * DGX Spark 가 GPU 에 올릴 수 있는 메모리 (10-23 D117, 엔진 0.13.0 `Hardware.unifiedUsableGB`) — 공개 실측 4점(1대):
 * - GLM-5.3-Flash UD-IQ2_XXS 101.84GB 를 1대에서 GPU 로 돌렸다(#30640 — tg64 깊이 65,536 까지, 위 GLM53_REFERENCE.spark)
 * - Qwen3-235B-A22B Q3_K_M 112.45GB — "At 105GB, it barely fits on a single unit."(Classmethod, llama.cpp b8012, pp2048·tg256 — 글의 GGUF 는 모두 unsloth).
 *   글의 105 는 GiB 다(llama-bench 크기 열 단위): unsloth/Qwen3-235B-A22B-GGUF Q3_K_M 3분할 합계 112,447,380,832 B = 112.45GB = 104.72GiB
 *   (HF API https://huggingface.co/api/models/unsloth/Qwen3-235B-A22B-GGUF/tree/main/Q3_K_M — 10-23 D117 리뷰). 필요량 112.45 + KV 0.44 + 버퍼 0.52 = 113.41
 *   KV = 2 × 94층 × KV 헤드 4 × head_dim 128 × 2B = 192,512 B/tok(https://huggingface.co/Qwen/Qwen3-235B-A22B/blob/main/config.json)
 * - DeepSeek V4 Flash 0731 UD-IQ3_S 116.1GB 는 1대에서 돌았고(글이 "1대 상한"이라 부른다) UD-Q3_K_XL 128.2GB 는 1대에 안 들어간다
 *   (Classmethod 2026-08-10 — 컨텍스트 2,048·생성 128). KV 는 위 DSV4 픽스처의 압축 KV
 * 값은 데이터 계층 `data/gpus.json` nvidia-dgx-spark `usableGBByRam` 128GB 116.9(DGX OS 7.5.0 부팅 가용 120.55GB − 데스크톱 기본 사용량 3.6GB — 엔진 패키지는
 * 데이터 계층을 읽지 않으므로 값으로 고정). 옛 규칙(× 0.70 = 89.6GB)으로는 앞의 셋이 GPU 에 안 들어간다
 */
export const SPARK_USABLE_128_GB = 116.9;
export const SPARK_128_USABLE: Hardware = { ...unified(128, 273, 'dgx-spark'), os: 'linux', unifiedUsableGB: SPARK_USABLE_128_GB };
const QWEN3_235B: Omit<ModelQuant, 'fileGB'> = { paramsB: 235.09, activeParamsB: 22, quant: 'Q3_K_M', kvBytesPerToken: 192512, attnType: 'full', maxContext: 40960 };
export const SPARK_FIT_CASES: ReadonlyArray<{ label: string; mq: ModelQuant; ctx: number; fits: boolean; source: string }> = [
  { label: 'GLM-5.3-Flash UD-IQ2_XXS 101.84GB tg64 @65,536 (#30640)', mq: GLM53_UD_IQ2XXS, ctx: 65600, fits: true, source: PR(30640) },
  {
    label: 'Qwen3-235B-A22B Q3_K_M 112.45GB ("105GB" in the article is GiB) pp2048 + tg256 (Classmethod b8012 — "barely fits")',
    mq: { ...QWEN3_235B, fileGB: 112.45 },
    ctx: 2304,
    fits: true,
    source: 'https://dev.classmethod.jp/en/articles/dgx-spark-two-node-clustering/',
  },
  {
    label: 'DeepSeek V4 Flash 0731 UD-IQ3_S 116.1GB ctx 2,048 + 128 (Classmethod — single-unit upper limit)',
    mq: { ...DSV4, quant: 'IQ3_XS', fileGB: 116.1 },
    ctx: 2176,
    fits: true,
    source: 'https://dev.classmethod.jp/en/articles/dgx-spark-2node-deepseek-v4-flash-0731/',
  },
  {
    label: 'DeepSeek V4 Flash 0731 UD-Q3_K_XL 128.2GB (Classmethod — does not fit one unit)',
    mq: { ...DSV4, quant: 'Q3_K_M', fileGB: 128.2 },
    ctx: 2176,
    fits: false,
    source: 'https://dev.classmethod.jp/en/articles/dgx-spark-2node-deepseek-v4-flash-0731/',
  },
];

/**
 * 통합 메모리 여러 대 — DGX Spark 2대 llama.cpp RPC 층 분할 (10-23 D118, 엔진 0.14.0 `Hardware.nodes`·`RPC_HOP_TG_MS`, docs/02 §6.2·§7).
 * 같은 사람·같은 빌드의 1대/2대 tg 쌍 — 1/2대 − 1/1대(ms). setup: 'tcp' = TCP 기본 설정(CPU 유휴 상태 켬), 'rdma' = RoCEv2,
 * 'tcp-idle-off' = **2대만** 같은 TCP 에 `cpupower idle-set -D 0` — 유휴 상태를 끈 1대 실측은 없어 1대 값은 기본 설정 실행(#15078806)의 것이다(`mixed`, D118 리뷰).
 * 조건이 다른 쌍이라 1/2대 − 1/1대 가 대 사이 이동 시간이 아니다(유휴 상태를 끄면 1대도 빨라질 수 있어 같은 조건의 이동 시간은 그보다 클 수 있다) —
 * 대 사이 이동 시간의 근거 범위는 조건이 같은 쌍만으로 잡고, `mixed` 쌍은 표시값(기본 설정 1대에서 낸 추정)과 그 설정의 2대 실측을 견주는 데에만 쓴다.
 * depth = llama-bench 깊이(엔진 ctx 와 같은 KV 길이).
 * - eugr(#16578): `--rpc 192.168.177.12:15001` 하나 — 첫 기기 GPU + 원격 1대, 장치 둘(엔진의 2대와 같은 배치)
 * - Classmethod: `--rpc <원격>:50052,127.0.0.1:50052` — 첫 기기도 RPC 서버로 넣어 장치가 셋(첫 기기 GPU 가 두 번 잡힌다 — 168GB 에서 첫 기기 116/119GB 를 썼다는
 *   글의 관찰이 층 2/3 몫과 맞는다, 우리 해석). 대 사이 이동은 한 번이지만 루프백 RPC 장치 경계가 한 번 더 있어(원격 → 첫 기기 → 루프백 서버 → 첫 기기 GPU —
 *   서로 다른 서버 사이 복사는 첫 기기를 거친다: https://github.com/ggml-org/llama.cpp/blob/184f6536024668e8908ab8c86033d56708e62b40/ggml/src/ggml-rpc/ggml-rpc.cpp#L930-L940)
 *   역산값에는 루프백 왕복 몫이 들어 있다(네트워크 한 번의 값보다 크다 — 상수 근거는 eugr, D118 리뷰). 메모리 대조(CLUSTER_FIT_CASES)에는 넣지 않는다
 * 4대 RPC 공개 실측은 없다 — 3·4대는 이동 횟수(대수 − 1)로 늘린 이론값이다
 */
export type ClusterPair = {
  label: string;
  single: number;
  cluster: number;
  setup: 'tcp' | 'tcp-idle-off' | 'rdma';
  depth: number;
  /** 1/2대 − 1/1대 (ms) — 출처 값으로 계산해 둔 기록값(테스트가 다시 계산해 맞춘다). `mixed` 쌍에서는 이동 시간이 아니다 */
  recordedMs: number;
  /** 1대와 2대의 실행 조건이 다르다(2대만 유휴 상태 끔 — 1대는 기본 설정 실행) — 이동 시간 근거 범위에서 뺀다(D118 리뷰) */
  mixed?: true;
  source: string;
};
const EUGR_TCP = 'https://github.com/ggml-org/llama.cpp/discussions/16578#discussioncomment-15078806';
const EUGR_IDLE = 'https://github.com/ggml-org/llama.cpp/discussions/16578#discussioncomment-15139580';
const CM_TWO = 'https://dev.classmethod.jp/en/articles/dgx-spark-two-node-clustering/';
const CM_DSV4 = 'https://dev.classmethod.jp/en/articles/dgx-spark-2node-deepseek-v4-flash-0731/';
export const CLUSTER_RPC_PAIRS: readonly ClusterPair[] = [
  { label: 'gpt-oss-120b MXFP4 tg32 d0 (b7157 TCP)', single: 60.36, cluster: 49.59, setup: 'tcp', depth: 0, recordedMs: 3.598, source: EUGR_TCP },
  { label: 'gpt-oss-120b MXFP4 tg32 d4096 (b7157 TCP)', single: 56.84, cluster: 46.61, setup: 'tcp', depth: 4096, recordedMs: 3.861, source: EUGR_TCP },
  { label: 'gpt-oss-120b MXFP4 tg32 d8192 (b7157 TCP)', single: 53.2, cluster: 42.15, setup: 'tcp', depth: 8192, recordedMs: 4.928, source: EUGR_TCP },
  { label: 'gpt-oss-120b MXFP4 tg32 d16384 (b7157 TCP)', single: 49.15, cluster: 38.82, setup: 'tcp', depth: 16384, recordedMs: 5.414, source: EUGR_TCP },
  { label: 'gpt-oss-120b MXFP4 tg32 d32768 (b7157 TCP)', single: 42.41, cluster: 31.72, setup: 'tcp', depth: 32768, recordedMs: 7.947, source: EUGR_TCP },
  { label: 'gpt-oss-120b MXFP4 tg32 d0 (b7157 TCP — 2 units idle states off, 1 unit default)', single: 60.36, cluster: 55.49, setup: 'tcp-idle-off', depth: 0, recordedMs: 1.454, mixed: true, source: EUGR_IDLE },
  { label: 'gpt-oss-120b MXFP4 tg32 d4096 (2 units idle states off, 1 unit default)', single: 56.84, cluster: 50.51, setup: 'tcp-idle-off', depth: 4096, recordedMs: 2.205, mixed: true, source: EUGR_IDLE },
  { label: 'gpt-oss-120b MXFP4 tg32 d8192 (2 units idle states off, 1 unit default)', single: 53.2, cluster: 45.99, setup: 'tcp-idle-off', depth: 8192, recordedMs: 2.947, mixed: true, source: EUGR_IDLE },
  { label: 'gpt-oss-120b MXFP4 tg32 d16384 (2 units idle states off, 1 unit default)', single: 49.15, cluster: 41.53, setup: 'tcp-idle-off', depth: 16384, recordedMs: 3.733, mixed: true, source: EUGR_IDLE },
  { label: 'gpt-oss-120b MXFP4 tg32 d32768 (2 units idle states off, 1 unit default)', single: 42.41, cluster: 33.15, setup: 'tcp-idle-off', depth: 32768, recordedMs: 6.587, mixed: true, source: EUGR_IDLE },
  { label: 'Qwen3-235B-A22B Q3_K_M tg256 (b8012, layer split + loopback RPC device)', single: 15.51, cluster: 14.57, setup: 'tcp', depth: 0, recordedMs: 4.16, source: CM_TWO },
  { label: 'Devstral 2 123B Q4_K_M tg256 (b8012, layer split + loopback RPC device)', single: 2.64, cluster: 2.64, setup: 'tcp', depth: 0, recordedMs: 0, source: CM_TWO },
  { label: 'DeepSeek V4 Flash 0731 UD-IQ2_M ctx 2,048 (RDMA, RTT 0.7ms, + loopback RPC device)', single: 20.13, cluster: 19.58, setup: 'rdma', depth: 2048, recordedMs: 1.395, source: CM_DSV4 },
  { label: 'DeepSeek V4 Flash 0731 UD-IQ3_S ctx 2,048 (RDMA, RTT 0.7ms, + loopback RPC device)', single: 18.02, cluster: 17.69, setup: 'rdma', depth: 2048, recordedMs: 1.035, source: CM_DSV4 },
];

/** DGX Spark 128GB 2대 (한 대 116.9GB — D117) */
export const SPARK_128_X2: Hardware = { ...SPARK_128_USABLE, nodes: 2 };

/**
 * 2대에서만 돈 공개 실측(eugr #16578 — `--rpc` 원격 1대, 장치 둘): 1대(116.9)에 안 들어가고 2대에 들어간다. llama-bench `-d 0,…,32768 -p 2048 -n 32` 라
 * 가장 긴 문맥 = 32,768 + 2,048 + 32. KV = 2 × 층 × KV 헤드 × head_dim × 2B(config.json)
 */
export const CLUSTER_FIT_CASES: ReadonlyArray<{ label: string; mq: ModelQuant; ctx: number; source: string }> = [
  {
    label: 'Qwen3-VL-235B-A22B UD-Q4_K_XL 124.91GiB (b7121) — 2 Sparks to 32k',
    // 124.91 GiB = 134.12 GB · 94층 × KV 4 × 128 (https://huggingface.co/Qwen/Qwen3-VL-235B-A22B-Instruct/blob/main/config.json)
    mq: { paramsB: 235.09, activeParamsB: 22, quant: 'Q4_K_M', fileGB: 134.12, kvBytesPerToken: 192512, attnType: 'full', layers: 94, maxContext: 262144 },
    ctx: 34848,
    source: 'https://github.com/ggml-org/llama.cpp/discussions/16578#discussioncomment-15033766',
  },
  {
    label: 'MiniMax-M2 UD-Q4_K_XL 122.58GiB (b7122) — 2 Sparks to 32k',
    // 122.58 GiB = 131.62 GB · 62층 × KV 8 × 128 (https://huggingface.co/MiniMaxAI/MiniMax-M2/blob/main/config.json)
    mq: { paramsB: 228.69, activeParamsB: 10, quant: 'Q4_K_M', fileGB: 131.62, kvBytesPerToken: 253952, attnType: 'full', layers: 62, maxContext: 196608 },
    ctx: 34848,
    source: 'https://github.com/ggml-org/llama.cpp/discussions/16578#discussioncomment-15049620',
  },
];

/** DGX Spark 64GB 한 대(GPU 가 쓸 수 있는 메모리 48.2GB — D117, 데이터 계층 usableGBByRam 64GB 값으로 고정) */
export const SPARK_64_USABLE: Hardware = { ...unified(64, 273, 'dgx-spark'), os: 'linux', unifiedUsableGB: 48.2 };

const GLM53_CLUSTER = { layers: 45, moeLayerIdx: Array.from({ length: 42 }, (_, i) => i + 3) } as const;
/** GLM-5.3-Flash 행 + 트렁크 층 수·전문가 층 번호(데이터 arch.layers 45·expertLayers 3~44 — 앞 3층 dense, 엔진 입력 `moeLayerIdx`, D118 리뷰) */
export const GLM53_Q4K_CLUSTER: ModelQuant = { ...GLM53_Q4K, ...GLM53_CLUSTER };
export const GLM53_Q2K_CLUSTER: ModelQuant = { ...GLM53_Q2K, ...GLM53_CLUSTER };
/**
 * Kolibri-1 Q4_K_M(bartowski — 모델별 텐서 배치, 헤더 실측 전문가 46.84 · 비전문가 2.57GB) — 50층 전부 MoE(384 × top-6), 전체 어텐션 10/50층
 * (https://huggingface.co/Aleph-Alpha/Kolibri-1/blob/main/config.json · https://huggingface.co/bartowski/Kolibri-1-GGUF)
 */
export const KOLIBRI1_Q4K: ModelQuant = moeFile(
  { paramsB: 78.1, activeParamsB: 3.46, quant: 'Q4_K_M', kvBytesPerToken: 20480, attnType: 'swa', activeExpertFrac: 6 / 384, moeLayers: 50, topK: 6, layers: 50, maxContext: 262144 },
  49.76,
  46.84,
  2.57,
);

/** DeepSeek V4 Flash 0731 행 + 트렁크 층 수(데이터 arch.layers 43 — 44칸이라 2·4대에서 나누어떨어진다, D118 리뷰 2차) */
export const DSV4_FLASH_MXFP4_CLUSTER: ModelQuant = { ...DSV4_FLASH_MXFP4, layers: 43 };
export const DSV4_FLASH_Q2K_CLUSTER: ModelQuant = { ...DSV4_FLASH_Q2K, layers: 43 };

/**
 * 가장 많이 맡는 대 — GGUF 헤더로 따라 한 llama.cpp 기본 층 분할(D118 리뷰 — 헤더는 10-23 에 HF 에서 받았다). 칸 il(0 ~ 블록 수)의 장치 = upper_bound(splits, il / (블록 수 + 1))
 * (splits = 장치별 남은 메모리의 누적 비율, float), RPC 장치가 앞·첫 기기 GPU 가 맨 뒤라 출력층(마지막 칸)은 첫 기기, 입력 임베딩은 첫 기기 CPU(같은 통합 메모리), MTP 블록은
 * 기본 미적재(https://github.com/ggml-org/llama.cpp/blob/184f6536024668e8908ab8c86033d56708e62b40/src/llama-model.cpp#L1641-L1699 ·
 * https://github.com/ggml-org/llama.cpp/blob/184f6536024668e8908ab8c86033d56708e62b40/src/llama.cpp#L275-L276). 값은 대마다 블록 텐서 바이트 합(+ 출력층·입력 임베딩)의
 * 최댓값 GB(2·3·4대) — `busiestGB` 는 남은 메모리가 같을 때(칸 il 의 장치 = 내림(il × 대수 / (블록 수 + 1))), `busiestFirstSmallerGB` 는 첫 기기의 남은 메모리만 0.1% 작을 때
 * (D118 리뷰 2차 — 경계가 앞 장치 쪽으로 밀려 칸 수가 대수로 나누어떨어지면 첫 RPC 장치가 한 칸 더 받는다: DeepSeek V4 Flash 44칸 2대 22·22 → 23·21, 4대 11·11·11·11 →
 * 12·11·11·10). `engineGB` 는 이 엔진의 가장 많이 맡는 대 가중치(`clusterNodeLoadGB` — 0.14.2 는 첫 기기와 원격 한 대 중 큰 쪽), `layerUniformGB` 는 전문가 층 위치를
 * 쓰지 않고 층마다 같다고 본 이 엔진의 값, `knownUnder` 는 엔진이 작게 보는 알려진 한계 행이다.
 * - GLM-5.3-Flash: 앞 3블록이 dense(0.313GB), MoE 블록은 4.27GB(Q4_K) — 층마다 같다고 본 0.14.0(첫 기기 몫만 — 93.033·64.925·48.864)은 2·4대가 실제보다
 *   작았다(−2.12·−2.30GB). 전문가를 그 층의 대로 세면(0.14.1) 두 경우 모두 실제 이상(+0.06 ~ +1.26GB). 64GB × 4대·1M·KV q4_0 의 Q2_K 는 0.14.0 이 '들어간다'
 *   (47.86 ≤ 48.2)로 봤지만 이 분할로는 가장 많이 맡는 대가 49.28GB 다(가중치 37.57 + KV 3/11 + 버퍼 10.1) — 지금은 '안 들어간다'(50.22)
 * - DeepSeek V4 Flash 0731(ggml-org): 블록 크기가 고르다 — 0.14.1(첫 기기 몫만)은 남은 메모리가 같으면 실제 이상(+0.66~+0.87GB)이지만 첫 기기가 0.1% 작으면
 *   2·4대 MXFP4 −2.72·−2.85GB(Q2_K −1.92·−2.02) 작았고, 64GB × 4대 · 524,288 · KV f16·q8_0·q4_0 이 '들어간다'(46.30·45.87·45.64 ≤ 48.2 — 분할로는 49.23·48.76·48.51)로
 *   뒤집혀 있었다. 0.14.2(원격 한 대 = 내림((층 + 1)/대수) + 1 칸)는 두 경우의 큰 쪽보다 +0.14 ~ +0.77GB 크다(남은 메모리가 같으면 2·4대는 한 칸만큼 더 커
 *   +2.82 ~ +3.89GB — 보수 쪽)
 * - Kolibri-1 Q4_K_M: 블록마다 양자화가 달라 0.894~1.649GB(앞쪽이 무겁고 가장 무거운 대가 첫 RPC 장치) — 엔진은 층마다 같다고 보는 근사라 2·3·4대
 *   −0.81·−1.92·−2.04GB(3대는 첫 기기가 0.1% 작을 때 — 같을 때 −1.02) 작다(카탈로그 큰 행 24개 중 가장 큰 과소 — docs/02 §6.2·§9 에 밝힌 한계, 값 고정)
 */
export const CLUSTER_SPLIT_SIM: ReadonlyArray<{
  label: string;
  mq: ModelQuant;
  busiestGB: readonly [number, number, number];
  busiestFirstSmallerGB: readonly [number, number, number];
  engineGB: readonly [number, number, number];
  layerUniformGB: readonly [number, number, number];
  knownUnder?: true;
  source: string;
}> = [
  {
    label: 'GLM-5.3-Flash Q4_K_M (ggml-org Q4_K 2 shards)',
    mq: GLM53_Q4K_CLUSTER,
    busiestGB: [95.151, 63.947, 51.163],
    busiestFirstSmallerGB: [90.881, 63.947, 51.163],
    engineGB: [95.207, 65.197, 52.126],
    layerUniformGB: [96.368, 64.925, 48.864],
    source: 'https://huggingface.co/ggml-org/GLM-5.3-Flash-GGUF/blob/main/GLM-5.3-Flash-Q4_K-00001-of-00002.gguf',
  },
  {
    label: 'GLM-5.3-Flash Q2_K (ggml-org 2 shards)',
    mq: GLM53_Q2K_CLUSTER,
    busiestGB: [70.237, 46.96, 37.573],
    busiestFirstSmallerGB: [67.099, 46.96, 37.573],
    engineGB: [70.299, 48.218, 38.544],
    layerUniformGB: [70.997, 48.022, 36.189],
    source: 'https://huggingface.co/ggml-org/GLM-5.3-Flash-GGUF/blob/main/GLM-5.3-Flash-Q2_K-00001-of-00002.gguf',
  },
  {
    label: 'DeepSeek V4 Flash 0731 MXFP4 (ggml-org 2 shards)',
    mq: DSV4_FLASH_MXFP4_CLUSTER,
    busiestGB: [78.708, 53.667, 39.37],
    busiestFirstSmallerGB: [82.294, 53.667, 42.924],
    engineGB: [82.597, 54.437, 43.094],
    layerUniformGB: [82.597, 54.437, 43.094],
    source: 'https://huggingface.co/ggml-org/DeepSeek-V4-Flash-0731-GGUF/blob/main/DeepSeek-V4-Flash-0731-MXFP4-00001-of-00002.gguf',
  },
  {
    label: 'DeepSeek V4 Flash 0731 Q2_K (ggml-org 2 shards)',
    mq: DSV4_FLASH_Q2K_CLUSTER,
    busiestGB: [59.515, 40.581, 29.773],
    busiestFirstSmallerGB: [62.229, 40.581, 32.456],
    engineGB: [62.469, 41.301, 32.593],
    layerUniformGB: [62.469, 41.301, 32.593],
    source: 'https://huggingface.co/ggml-org/DeepSeek-V4-Flash-0731-GGUF/blob/main/DeepSeek-V4-Flash-0731-Q2_K-00001-of-00002.gguf',
  },
  {
    label: 'Kolibri-1 Q4_K_M (bartowski)',
    mq: KOLIBRI1_Q4K,
    busiestGB: [26.854, 18.811, 15.236],
    busiestFirstSmallerGB: [26.854, 19.704, 15.236],
    engineGB: [26.043, 17.788, 13.197],
    layerUniformGB: [26.043, 17.788, 13.197],
    knownUnder: true,
    source: 'https://huggingface.co/bartowski/Kolibri-1-GGUF/blob/main/Kolibri-1-Q4_K_M.gguf',
  },
];
