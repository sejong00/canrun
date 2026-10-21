/** fit 판정 유닛 — docs/02 §2.4 + §8 시드. */
import { describe, expect, it } from 'vitest';
import { CPU_MOE_GPU_LAYER_MARGIN, PLE_TOKEN_OVERHEAD_MS } from '../src/constants';
import { fit } from '../src/fit';
import { evaluate } from '../src/index';
import { computeBufferGB, gpuUnitsOf, kvGB, osReserveGB, usableGB, usableRamGB } from '../src/memory';
import { tgEstimate } from '../src/speed';
import type { Hardware, ModelQuant } from '../src/types';
import {
  GEMMA4_E2B_Q4,
  GEMMA4_E4B_Q4,
  GEMMA4_E4B_Q8,
  GPT_OSS_120B,
  HETERO_GPU_CASES,
  LLAMA31_8B_Q4,
  LLAMA31_8B_Q4_RESIDENT,
  LLAMA33_70B_Q4,
  M4_MAX_128,
  MULTI_GPU_CASES,
  NANBEIGE42_Q4,
  QWEN3_14B_Q4,
  QWEN35_35B_A3B_Q4,
  QWEN36_35B_A3B_Q4_SPLIT,
  QWEN3_8B_Q4,
  RTX_3060_12GB,
  RTX_4060_8GB,
  RTX_4090,
} from './fixtures';

describe('§2.4 mode ordering', () => {
  it('1. full-gpu when weights+kv+buffer ≤ usable vram', () => {
    const r = fit(RTX_4060_8GB, LLAMA31_8B_Q4);
    expect(r.fits).toBe(true);
    expect(r.mode).toBe('full-gpu');
    // vram 분해: weights 전량 + kv + buffer + osReserve, limit = 물리 VRAM
    expect(r.vram.weights).toBeCloseTo(4.92, 2);
    expect(r.vram.osReserve).toBeCloseTo(0.6, 6);
    expect(r.vram.limit).toBe(8);
    expect(r.vram.total).toBeCloseTo(4.92 + r.vram.kv + r.vram.buffer + 0.6, 6);
  });

  it('§8 seed: fit(rtx4060_8gb, qwen3_14b_q4).mode !== full-gpu', () => {
    expect(fit(RTX_4060_8GB, QWEN3_14B_Q4).mode).not.toBe('full-gpu');
  });

  it('§8 seed: fit(rtx3060_12gb, qwen35_35b_a3b_q4).mode === cpu-moe', () => {
    const r = fit(RTX_3060_12GB, QWEN35_35B_A3B_Q4);
    expect(r.fits).toBe(true);
    expect(r.mode).toBe('cpu-moe');
    // cpu-moe VRAM 상주분은 nonExpert + kv + buffer
    expect(r.vram.weights).toBeCloseTo(QWEN35_35B_A3B_Q4.nonExpertGB!, 6);
  });

  it('2. cpu-moe with moeLayers: fills spare VRAM with expert layers, minus the margin (10-01 D56)', () => {
    const mq = QWEN36_35B_A3B_Q4_SPLIT;
    const r = fit(RTX_3060_12GB, mq);
    expect(r.mode).toBe('cpu-moe');
    const n = r.cpuMoeLayers!;
    const perLayer = mq.expertGB! / mq.moeLayers!;
    const fixed = mq.nonExpertGB! + kvGB(mq.kvBytesPerToken, 8192) + computeBufferGB(8192);
    const usable = usableGB(RTX_3060_12GB);
    // GPU 에 남긴 전문가 층은 VRAM 에 들어가고, 여유층(MARGIN)을 빼기 전 한 층 더는 넘친다
    expect(fixed + perLayer * (mq.moeLayers! - n)).toBeLessThanOrEqual(usable);
    expect(fixed + perLayer * (mq.moeLayers! - n + CPU_MOE_GPU_LAYER_MARGIN + 1)).toBeGreaterThan(usable);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(mq.moeLayers!);
    expect(r.vram.weights).toBeCloseTo(mq.nonExpertGB! + perLayer * (mq.moeLayers! - n), 6);
  });

  it('2. cpu-moe without moeLayers keeps every expert in RAM (09-30 assumption)', () => {
    const r = fit(RTX_3060_12GB, { ...QWEN36_35B_A3B_Q4_SPLIT, moeLayers: undefined });
    expect(r.mode).toBe('cpu-moe');
    expect(r.cpuMoeLayers).toBeUndefined();
    expect(r.vram.weights).toBeCloseTo(QWEN36_35B_A3B_Q4_SPLIT.nonExpertGB!, 6);
  });

  it('2. cpu-moe RAM check counts only the CPU-side experts and token_embd', () => {
    const mq = QWEN36_35B_A3B_Q4_SPLIT;
    const n = fit(RTX_3060_12GB, mq).cpuMoeLayers!;
    const cpuSide = (mq.expertGB! / mq.moeLayers!) * n + (mq.fileGB! - mq.expertGB! - mq.nonExpertGB!);
    // 전문가 전량(19.5GB)은 못 담지만 CPU 몫은 담는 RAM
    const ramGB = Math.ceil(cpuSide) + 4;
    const hw: Hardware = { ...RTX_3060_12GB, ramGB };
    expect(usableRamGB(hw)).toBeLessThan(mq.expertGB!);
    expect(fit(hw, mq).mode).toBe('cpu-moe');
    expect(fit({ ...hw, ramGB: ramGB - 2 }, mq).mode).not.toBe('cpu-moe');
  });

  it('2. cpu-moe requires expert weights to fit in usable RAM', () => {
    const lowRam: Hardware = { ...RTX_3060_12GB, ramGB: 8 }; // usable 4GB < expert ~20GB
    const r = fit(lowRam, QWEN35_35B_A3B_Q4);
    expect(r.mode).not.toBe('cpu-moe');
  });

  it('3. partial-offload for dense that exceeds vram but fits vram+ram', () => {
    const r = fit(RTX_4060_8GB, QWEN3_14B_Q4); // 10.9GB 필요 > 7.4 usable, RAM 32GB
    expect(r.fits).toBe(true);
    expect(r.mode).toBe('partial-offload');
    expect(r.gpuFrac).toBeGreaterThan(0);
    expect(r.gpuFrac).toBeLessThan(1);
    // gpuFrac = GPU 상주 가중치 / 전체 가중치 — kv+buffer 는 GPU 몫에서 선차감
    const gpuWeights = 7.4 - r.vram.kv - r.vram.buffer;
    expect(r.gpuFrac).toBeCloseTo(gpuWeights / 9.0, 6);
    expect(r.vram.weights).toBeCloseTo(gpuWeights, 6);
  });

  it('3-회귀(외부 리뷰): Qwen3-14B Q4 · 8GB GPU · RAM 7GB → 탑재 불가', () => {
    // usableRam 3GB. 구식(need 비례): cpu측 9.0×(1−7.4/10.885)=2.88 ≤ 3 → 오탑재 판정.
    // 정정식: cpu측 = 9.0 − (7.4−1.31−0.575) = 3.49 > 3 → 불가가 정답.
    const lowRam: Hardware = { ...RTX_4060_8GB, ramGB: 7 };
    const r = fit(lowRam, QWEN3_14B_Q4);
    expect(r.fits).toBe(false);
    expect(r.mode).not.toBe('partial-offload');
    // 더 낮은 quant 는 가능해야 함 (IQ4_XS 8.25GB → cpu측 2.73 ≤ 3)
    expect(r.bestQuant).toBe('IQ4_XS');
  });

  it('4. dgpu falls through to cpu-only when MoE cannot fit VRAM but RAM holds all', () => {
    // nonExpert 가 VRAM 을 넘는 MoE: full·cpu-moe 실패, dense 아님 → partial 스킵, RAM 전량 탑재
    const bigNonExpert: ModelQuant = { ...QWEN35_35B_A3B_Q4, nonExpertGB: 20 };
    const hw: Hardware = { ...RTX_3060_12GB, ramGB: 48 };
    const r = fit(hw, bigNonExpert);
    expect(r.fits).toBe(true);
    expect(r.mode).toBe('cpu-only');
  });

  it('4. cpu-only when there is no GPU', () => {
    const cpuOnly: Hardware = {
      kind: 'cpu',
      os: 'linux',
      memBandwidthGBs: 89.6,
      ramGB: 32,
      ramBandwidthGBs: 89.6,
      effClass: 'cpu',
    };
    const r = fit(cpuOnly, LLAMA31_8B_Q4);
    expect(r.fits).toBe(true);
    expect(r.mode).toBe('cpu-only');
  });

  it('unified pool counts as full-gpu when it fits (M4 Max 128GB + 70B Q4)', () => {
    const r = fit(M4_MAX_128, LLAMA33_70B_Q4);
    expect(r.fits).toBe(true);
    expect(r.mode).toBe('full-gpu');
    expect(r.vram.limit).toBe(128);
  });
});

describe('§2.4-1 dGPU full-gpu counts only GPU-resident weights (10-03 D62)', () => {
  // 화면 출력 없는 7.6GB 카드: 16k 에서 파일 기준 필요량(4.92 + KV + 버퍼 ≈ 7.72)은 넘고, 상주량 기준(4.62 + … ≈ 7.42)은 들어간다
  const card76: Hardware = { ...RTX_4060_8GB, vramGB: 7.6, isDisplayGpu: false };
  const ctx16k = { ctx: 16384 };

  it('uses fileGB − offGpuGB for the full-gpu need and the resident weights', () => {
    const r = fit(RTX_4060_8GB, LLAMA31_8B_Q4_RESIDENT);
    expect(r.mode).toBe('full-gpu');
    expect(r.vram.weights).toBeCloseTo(4.62, 6);
    expect(r.vram.total).toBeCloseTo(4.62 + r.vram.kv + r.vram.buffer + r.vram.osReserve, 6);
  });

  it('flips partial-offload to full-gpu only when the resident need fits', () => {
    expect(fit(card76, LLAMA31_8B_Q4, ctx16k).mode).toBe('partial-offload');
    const r = fit(card76, LLAMA31_8B_Q4_RESIDENT, ctx16k);
    expect(r.mode).toBe('full-gpu');
    expect(r.vram.weights + r.vram.kv + r.vram.buffer).toBeLessThanOrEqual(usableGB(card76));
  });

  it('leaves partial-offload unchanged: same GPU share and gpuFrac (denominator = whole file)', () => {
    // 4060 × Llama 3.1 8B @16k: 상주량 기준 7.417 > 7.40 이라 여전히 부분 오프로드
    const withField = fit(RTX_4060_8GB, LLAMA31_8B_Q4_RESIDENT, ctx16k);
    const without = fit(RTX_4060_8GB, LLAMA31_8B_Q4, ctx16k);
    expect(withField.mode).toBe('partial-offload');
    expect(withField.gpuFrac).toBeCloseTo(without.gpuFrac!, 12);
    expect(withField.vram.weights).toBeCloseTo(without.vram.weights, 12);
  });

  it('ignores offGpuGB on unified memory and CPU (Metal maps the whole mmap range)', () => {
    expect(fit(M4_MAX_128, LLAMA31_8B_Q4_RESIDENT).vram.weights).toBeCloseTo(4.92, 6);
    const cpu: Hardware = { kind: 'cpu', os: 'linux', memBandwidthGBs: 89.6, ramGB: 32, ramBandwidthGBs: 89.6, effClass: 'cpu' };
    expect(fit(cpu, LLAMA31_8B_Q4_RESIDENT).vram.weights).toBeCloseTo(4.92, 6);
  });

  it('derives the resident weights of a MoE row from its measured split (expertGB + nonExpertGB)', () => {
    // QWEN36 split 픽스처는 유도 경로를 탄다: 22.27 − (19.5 + 1.59) = 1.18GB(token_embd 0.29 + MTP 0.90)는 GPU 밖.
    // 24GB 화면 출력 카드(사용 가능 23.4) × 32k: 파일 기준 23.74 는 넘치고 상주량 기준 22.56 은 들어간다
    const card: Hardware = { ...RTX_4090, os: 'windows', isDisplayGpu: true };
    const r = fit(card, QWEN36_35B_A3B_Q4_SPLIT, { ctx: 32768 });
    expect(r.mode).toBe('full-gpu');
    expect(r.vram.weights).toBeCloseTo(21.09, 6);
    expect(fit(card, { ...QWEN36_35B_A3B_Q4_SPLIT, expertGB: undefined, nonExpertGB: 1.59 }, { ctx: 32768 }).mode).not.toBe(
      'full-gpu',
    );
  });

  it('pins the known cliff: just outside the new boundary gpuFrac ≤ resident/file < 0.9, so S drops straight to B (§3.4 note)', () => {
    // Qwen3.5-9B Q8_0 (unsloth MTP-GGUF): 파일 9.79, GPU 밖 1.35(입력 임베딩 1.08 + MTP 0.26 + 헤더) → 상주 8.44, 상주/파일 0.862
    const q35: ModelQuant = { paramsB: 9.65, fileGB: 9.79, offGpuGB: 1.35, quant: 'Q8_0', kvBytesPerToken: 32768, attnType: 'hybrid', maxContext: 262144 };
    const card = (vramGB: number): Hardware => ({ ...RTX_4060_8GB, vramGB, isDisplayGpu: false, memBandwidthGBs: 448 });
    const inside = evaluate(card(9.3), q35);
    expect(inside).toMatchObject({ mode: 'full-gpu', verdict: 'S' });
    const outside = fit(card(9.2), q35);
    expect(outside.mode).toBe('partial-offload');
    expect(outside.gpuFrac!).toBeLessThan(8.44 / 9.79);
    expect(evaluate(card(9.2), q35).verdict).toBe('B');
  });

  it('bestQuant search drops the measured offGpuGB of the requested file', () => {
    // RAM 4GB(사용 가능 0) — full-gpu 만 가능. 옛 offGpuGB 2GB 가 남으면 Q5_K_M 이 거짓으로 들어간다
    const tight: Hardware = { kind: 'dgpu', os: 'linux', vramGB: 6, memBandwidthGBs: 272, ramGB: 4, ramBandwidthGBs: 51.2, effClass: 'nvidia' };
    const q8: ModelQuant = { ...QWEN3_14B_Q4, paramsB: 8.2, fileGB: 8.71, quant: 'Q8_0', kvBytesPerToken: 144 * 1024 };
    const plain = fit(tight, q8);
    const stale = fit(tight, { ...q8, offGpuGB: 2 });
    expect(stale.fits).toBe(false);
    expect(plain.bestQuant).toBe('Q3_K_M');
    expect(stale.bestQuant).toBe(plain.bestQuant);
  });
});

describe('§2.4 per-layer embedding table (Gemma 4 E4B·E2B, 10-21 D112)', () => {
  const card = (vramGB: number, ramGB = 32): Hardware => ({ ...RTX_4060_8GB, vramGB, ramGB, isDisplayGpu: false });

  it('full-gpu needs only the GPU-resident weights; the table (offGpuGB) has to fit in usable system RAM', () => {
    // 상주 3.03 + KV 0.134 + 버퍼 0.575 = 3.74 — 4GB 카드(화면 출력 없음)에 전량
    expect(fit(card(4), GEMMA4_E4B_Q4)).toMatchObject({ fits: true, mode: 'full-gpu' });
    expect(fit(card(4), GEMMA4_E4B_Q4).vram.weights).toBeCloseTo(3.03, 6);
    // RAM 5GB(사용 가능 1GB) < GPU 밖 1.95GB → 전량 탑재 불가, 부분 오프로드·CPU 도 RAM 이 모자라 실패
    const noRam = fit(card(8, 5), GEMMA4_E4B_Q4);
    expect(noRam.fits).toBe(false);
    expect(fit(card(8, 6), GEMMA4_E4B_Q4).mode).toBe('full-gpu');
    // 통합 메모리는 파일 전체를 통합 풀로 센다(RAM 검사 없음 — GPU 밖 몫이 없다)
    expect(fit(M4_MAX_128, GEMMA4_E4B_Q4).vram.weights).toBeCloseTo(4.98, 6);
  });

  it('partial-offload: the GPU share is capped at the resident weights and gpuFrac counts against file − table', () => {
    // 3GB 카드 × E4B Q8_0: 상주 5.18 > 사용 가능 → GPU 몫 = 3 − 0.134 − 0.575 = 2.291, 분모 = 8.19 − 2.99 = 5.20
    const r = fit(card(3), GEMMA4_E4B_Q8);
    expect(r.mode).toBe('partial-offload');
    expect(r.vram.weights).toBeCloseTo(3 - kvGB(16_384, 8192) - computeBufferGB(8192), 6);
    expect(r.gpuFrac!).toBeCloseTo(r.vram.weights / (8.19 - 2.99), 6);
    // 표가 없는 모델은 분모가 파일 전체 그대로
    const plain = fit(card(3), { ...GEMMA4_E4B_Q8, pleGB: undefined });
    expect(plain.gpuFrac!).toBeCloseTo(plain.vram.weights / 8.19, 6);
  });

  it('E2B Q4_K_M fits a 2.5GB card in full (1.48 + 0.05 + 0.575 = 2.11GB) and its speed reads file − table + the PLE fixed time', () => {
    const r = evaluate(card(2.5), GEMMA4_E2B_Q4);
    expect(r.mode).toBe('full-gpu');
    const read = (3.11 - 1.61 + kvGB(6_144, 8192)) / (0.7 * 272);
    expect(r.tgTokS.est).toBeCloseTo(1 / (read + PLE_TOKEN_OVERHEAD_MS.cuda * 1e-3), 6);
  });

  it('the system RAM check is only for rows with a table — other off-GPU shares (MTP left unloaded, input embedding) are not RAM (10-21 D112 review)', () => {
    // RAM 5GB(사용 가능 1GB) — 표 없는 dense 행의 GPU 밖 3GB(MTP 꼴)는 예전처럼 막지 않는다
    const mtpLike: ModelQuant = { ...GEMMA4_E4B_Q4, pleGB: undefined, offGpuGB: 3 };
    expect(fit(card(8, 5), mtpLike)).toMatchObject({ fits: true, mode: 'full-gpu' });
    expect(fit(card(8, 5), { ...mtpLike, pleGB: 1.94 }).fits).toBe(false);
  });

  it('bestQuant ladder keeps the table structure (scaled pleGB) but counts the whole bpw file on the GPU — conservative', () => {
    // VRAM 2GB·RAM 4GB(사용 가능 0): Q4_K_M 은 GPU 밖 몫을 RAM 에 둘 수 없어 실패 → 사다리는 상주 = 파일 전체(bpw)로 본다
    const tight: Hardware = { ...card(2, 4) };
    const r = fit(tight, GEMMA4_E4B_Q4);
    expect(r.fits).toBe(false);
    expect(r.bestQuant).toBeUndefined(); // 8.0B × 2.93bpw/8 = 2.93GB 도 2GB 에 못 들어간다
    const roomy = fit({ ...card(4, 4) }, GEMMA4_E4B_Q4);
    expect(roomy.fits).toBe(false);
    expect(roomy.bestQuant).toBe('Q2_K'); // 8.0 × 3.16bpw/8 = 3.16 + 0.134 + 0.575 = 3.87 ≤ 4 (IQ3_XS 3.50 은 4.21 로 넘친다)
  });
});

describe('§2.4 looped dense (Nanbeige4.2 — 10-22 D114): placement is one copy of the weights', () => {
  it('fit ignores loops — the same mode, VRAM and gpuFrac as without loops (KV is already per logical layer in kvBytesPerToken)', () => {
    for (const ctx of [8192, 32768, 131072]) {
      const looped = fit(RTX_4060_8GB, NANBEIGE42_Q4, { ctx });
      const plain = fit(RTX_4060_8GB, { ...NANBEIGE42_Q4, loops: undefined, loopGB: undefined }, { ctx });
      expect(looped, String(ctx)).toEqual(plain);
    }
    expect(fit(RTX_4060_8GB, NANBEIGE42_Q4, { ctx: 32768 }).mode).toBe('partial-offload');
  });

  it('bestQuant ladder keeps the loop block structure (scaled loopGB) — fit itself never reads it', () => {
    const tiny: Hardware = { ...RTX_4060_8GB, vramGB: 2, ramGB: 6 };
    const r = fit(tiny, { ...NANBEIGE42_Q4, quant: 'Q8_0', fileGB: 4.43, loopGB: 3.35, offGpuGB: 0.55 }, { ctx: 8192 });
    expect(r.fits).toBe(false);
    expect(r.bestQuant).toBe(fit(tiny, { ...NANBEIGE42_Q4, quant: 'Q8_0', fileGB: 4.43, loops: undefined, loopGB: undefined, offGpuGB: 0.55 }, { ctx: 8192 }).bestQuant);
  });
});

describe('§2.4-5 bestQuant search (fail → lower quant loop down to IQ2_M)', () => {
  const tiny: Hardware = {
    kind: 'dgpu',
    os: 'linux',
    vramGB: 6,
    memBandwidthGBs: 272,
    ramGB: 6, // usable RAM 2GB — Q8_0 은 partial(CPU 몫 3.7GB)·cpu-only 도 실패
    ramBandwidthGBs: 51.2,
    effClass: 'nvidia',
  };

  it('returns a lower quant that fits when requested quant fails everywhere', () => {
    // Qwen3-8B Q8_0(bpw 폴백 ≈8.7GB)은 6GB 카드+8GB RAM에서 전 모드 실패,
    // 더 낮은 quant(예: Q4_K_M ≈5.0GB)는 full-gpu 가능해야 한다.
    const mq: ModelQuant = { ...QWEN3_14B_Q4, paramsB: 8.2, fileGB: 8.71, quant: 'Q8_0', kvBytesPerToken: 144 * 1024 };
    const r = fit(tiny, mq);
    expect(r.fits).toBe(false);
    expect(r.bestQuant).toBeDefined();
    // 탐색은 요청 quant 보다 낮은 것 중 가장 높은 품질부터
    expect(['Q6_K', 'Q5_K_M', 'Q4_K_M', 'IQ4_XS', 'Q3_K_M', 'IQ3_XS', 'Q2_K', 'IQ2_M']).toContain(r.bestQuant);
  });

  it('reports no bestQuant when even IQ2_M cannot fit', () => {
    const r = fit(tiny, { ...LLAMA33_70B_Q4, quant: 'Q4_K_M' }); // 70B: IQ2_M ≈25.9GB > 모든 경로
    expect(r.fits).toBe(false);
    expect(r.bestQuant).toBeUndefined();
  });
});

describe('§6 multi-GPU (beta): same GPU × N', () => {
  const two3090: Hardware = { ...RTX_4090, vramGB: 24, memBandwidthGBs: 936, gpuCount: 2 };
  const one3090: Hardware = { ...two3090, gpuCount: 1 };

  it('sums VRAM, keeps the display reserve once and a compute buffer per GPU', () => {
    expect(usableGB(two3090)).toBeCloseTo(48 - osReserveGB(two3090), 6);
    expect(usableGB(two3090) - usableGB(one3090)).toBeCloseTo(24, 6);
    const r = fit(two3090, LLAMA33_70B_Q4);
    expect(r.mode).toBe('full-gpu');
    expect(r.vram.limit).toBe(48);
    expect(r.vram.buffer).toBeCloseTo(2 * computeBufferGB(8192), 6);
    expect(fit(one3090, LLAMA33_70B_Q4).mode).not.toBe('full-gpu');
  });

  it('ignores gpuCount on non-dGPU hardware and treats < 1 as 1', () => {
    expect(usableGB({ ...M4_MAX_128, gpuCount: 4 })).toBeCloseTo(usableGB(M4_MAX_128), 6);
    expect(usableGB({ ...one3090, gpuCount: 0 })).toBeCloseTo(usableGB(one3090), 6);
  });
});

describe('§6 mixed GPUs (beta, 10-03 D67): RTX 3090 (display, Windows) + RTX 3060 12GB', () => {
  const mixed: Hardware = {
    ...RTX_4090,
    os: 'windows',
    vramGB: 24,
    memBandwidthGBs: 936,
    isDisplayGpu: true,
    gpus: [
      { vramGB: 24, memBandwidthGBs: 936, effClass: 'nvidia', isDisplayGpu: true },
      { vramGB: 12, memBandwidthGBs: 360, effClass: 'nvidia' },
    ],
  };
  const LLAMA33_70B_IQ2: ModelQuant = { ...LLAMA33_70B_Q4, quant: 'IQ2_M', fileGB: 24.12 };

  it('a small model still goes on both cards (llama.cpp default split) — limit 36, one compute buffer per card, display reserve once', () => {
    const r = fit(mixed, QWEN3_8B_Q4);
    expect(r.mode).toBe('full-gpu');
    expect(r.vram.limit).toBe(36);
    expect(r.vram.buffer).toBeCloseTo(2 * computeBufferGB(8192), 9);
    expect(r.vram.osReserve).toBeCloseTo(0.6, 9);
  });

  it('70B IQ2_M fits on the pair (need 27.95 ≤ 35.4), 70B Q4_K_M overflows into partial offload (gpuFrac ≈ 0.742)', () => {
    const iq2 = fit(mixed, LLAMA33_70B_IQ2);
    expect(iq2.mode).toBe('full-gpu');
    expect(iq2.vram.total - iq2.vram.osReserve).toBeCloseTo(27.95, 2);
    expect(usableGB(mixed)).toBeCloseTo(35.4, 9);
    const q4 = fit(mixed, LLAMA33_70B_Q4);
    expect(q4.mode).toBe('partial-offload');
    expect(q4.gpuFrac).toBeCloseTo(0.742, 3);
  });

  it('MoE cpu-moe fills the pooled VRAM like two same-size cards with the same total', () => {
    const pair: Hardware = { ...RTX_4090, os: 'windows', vramGB: 18, isDisplayGpu: true, gpuCount: 2 };
    const oss: ModelQuant = { ...GPT_OSS_120B, moeLayers: 36, activeExpertFrac: 4 / 128 };
    const a = fit(mixed, oss);
    const b = fit(pair, oss);
    expect(a.mode).toBe('cpu-moe');
    expect(a.cpuMoeLayers).toBeGreaterThan(0);
    expect(a.cpuMoeLayers).toBe(b.cpuMoeLayers);
    expect(a.vram).toEqual(b.vram);
  });

  it('a card list of identical cards is the same as gpuCount — fit and speed deep-equal for every same-GPU regression point', () => {
    const points = [...MULTI_GPU_CASES.map((c) => ({ hw: c.hw, mq: c.mq, ctx: c.ctx })), { hw: RTX_4090, mq: QWEN3_8B_Q4, ctx: 8192 }];
    for (const { hw, mq, ctx } of points) {
      const asList: Hardware = { ...hw, gpus: gpuUnitsOf(hw) };
      const r = fit(hw, mq, { ctx });
      expect(fit(asList, mq, { ctx })).toEqual(r);
      expect(tgEstimate(asList, mq, r, { ctx })).toBe(tgEstimate(hw, mq, r, { ctx }));
      expect(evaluate(asList, mq, { ctx })).toEqual(evaluate(hw, mq, { ctx }));
    }
  });

  it('the regression points all land in full-gpu on both cards', () => {
    for (const c of HETERO_GPU_CASES) expect(fit(c.hw, c.mq, { ctx: c.ctx }).mode).toBe('full-gpu');
  });
});
