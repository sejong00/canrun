/**
 * 실측 대조 픽스처 — verify_engine.py (2026-08-09 검증) 의 표를 1:1 이식.
 * 값 출처: docs/02-engine-spec.md §7, docs/03-data-spec.md §3(모델 arch·fileGB)·§4(실측 표).
 *
 * 주의: 여기 수치는 "실측"이므로 임의 수정 금지 — 바꾸려면 출처 URL 과 함께
 * docs/02 §7 갱신이 선행되어야 한다 (CLAUDE.md 규칙 1).
 */

import type { EffClass, Hardware, ModelQuant, QuantId } from '../src/types';

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
const QWEN3_8B = dense(5.03, 144, 8.2);
const MISTRAL_7B = dense(4.37, 128, 7.25);

// gpt-oss-20b: MXFP4 12.11GB, 20.9B(3.6B active), KV 24 KiB (SWA 반영 사전 계산값) — docs/03 §3
export const GPT_OSS_20B: ModelQuant = {
  paramsB: 20.9,
  activeParamsB: 3.6,
  fileGB: 12.11,
  quant: 'MXFP4',
  kvBytesPerToken: 24 * 1024,
  attnType: 'swa',
  nonExpertGB: 0.65, // P0-3 확정 — 32E top-4 유도 (packages/data/src/derive.ts, data/models.json)
  maxContext: 131072,
};

// gpt-oss-120b: MXFP4 63.39GB, 116.8B(5.1B active), KV 36 KiB — docs/03 §3
export const GPT_OSS_120B: ModelQuant = {
  paramsB: 116.8,
  activeParamsB: 5.1,
  fileGB: 63.39,
  quant: 'MXFP4',
  kvBytesPerToken: 36 * 1024,
  attnType: 'swa',
  nonExpertGB: 0.81, // P0-3 확정 — 128E top-4 유도 (packages/data/src/derive.ts)
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
  // Apple unified — 밴드 ±20% (검증 max 17.1% 가 M4 Pro)
  { label: 'M4 Max 7B Q4_0 short', hw: unified(128, 546, 'apple'), mq: L2_7B, ctx: 512, measuredTg: 83.1, band: 0.2 },
  { label: 'M4 Pro 7B Q4_0 short', hw: unified(48, 273, 'apple'), mq: L2_7B, ctx: 512, measuredTg: 50.7, band: 0.2 },
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
  { label: 'StrixHalo gpt-oss-120b MoE', hw: { ...unified(128, 256, 'strix', 0.54), os: 'linux' }, mq: GPT_OSS_120B, ctx: 2048, measuredTg: 50.2, band: 0.2 },
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
