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
const OSS120: MoeBase = { paramsB: 116.8, activeParamsB: 5.1, quant: 'MXFP4', kvBytesPerToken: 36 * 1024, attnType: 'swa', activeExpertFrac: 4 / 128, moeLayers: 36, maxContext: 131072 };
const OSS20: MoeBase = { paramsB: 20.9, activeParamsB: 3.6, quant: 'MXFP4', kvBytesPerToken: 24 * 1024, attnType: 'swa', activeExpertFrac: 4 / 32, moeLayers: 24, maxContext: 131072 };
const Q30: MoeBase = { paramsB: 30.5, activeParamsB: 3.3, quant: 'Q4_K_M', kvBytesPerToken: 96 * 1024, attnType: 'full', activeExpertFrac: 8 / 128, moeLayers: 48, maxContext: 262144 };
const Q35: MoeBase = { paramsB: 35.95, activeParamsB: 3, quant: 'Q4_K_M', kvBytesPerToken: 20 * 1024, attnType: 'hybrid', activeExpertFrac: 8 / 256, moeLayers: 40, maxContext: 262144 };

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
