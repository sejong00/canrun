/** fit 판정 유닛 — docs/02 §2.4 + §8 시드. */
import { describe, expect, it } from 'vitest';
import { fit } from '../src/fit';
import type { Hardware, ModelQuant } from '../src/types';
import {
  LLAMA31_8B_Q4,
  LLAMA33_70B_Q4,
  M4_MAX_128,
  QWEN3_14B_Q4,
  QWEN35_35B_A3B_Q4,
  RTX_3060_12GB,
  RTX_4060_8GB,
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
