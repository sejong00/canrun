/** 속도 모델 유닛 — docs/02 §3. */
import { describe, expect, it } from 'vitest';
import { MOE_TG_CAP_TOKS } from '../src/constants';
import { bytesPerTokenGB, ppEstimate, resolveEff, tgEstimate } from '../src/speed';
import type { Hardware } from '../src/types';
import { CPU_MOE_RAM_EFF, MULTI_GPU_TG_FACTOR } from '../src/constants';
import { GPT_OSS_20B, QWEN3_8B_Q4, QWEN35_35B_A3B_Q4, QWEN36_35B_A3B_Q4_SPLIT, RTX_3060_12GB, RTX_4090 } from './fixtures';

describe('resolveEff (§3.2)', () => {
  it('uses class defaults (nvidia dense 0.70, moe 0.45)', () => {
    expect(resolveEff({ effClass: 'nvidia' }, false)).toBe(0.7);
    expect(resolveEff({ effClass: 'nvidia' }, true)).toBe(0.45);
  });

  it('effOverride wins over class defaults', () => {
    expect(resolveEff({ effClass: 'nvidia', effOverride: 0.62 }, false)).toBe(0.62);
  });

  it('falls back to dense when class has no verified MoE coefficient (intel-arc)', () => {
    expect(resolveEff({ effClass: 'intel-arc' }, true)).toBe(0.59);
  });
});

describe('bytesPerTokenGB (§3.1)', () => {
  it('dense: fileGB + kvRead(ctx)', () => {
    const kvRead = (144 * 1024 * 16384) / 1e9;
    expect(bytesPerTokenGB(QWEN3_8B_Q4, 16384)).toBeCloseTo(5.03 + kvRead, 4);
  });

  it('MoE: weightsRead scaled by activeParamsB / paramsB', () => {
    const weightsRead = 12.11 * (3.6 / 20.9);
    const kvRead = (24 * 1024 * 2048) / 1e9;
    expect(bytesPerTokenGB(GPT_OSS_20B, 2048)).toBeCloseTo(weightsRead + kvRead, 4);
  });
});

describe('tgEstimate (§3.1~3.4)', () => {
  it('context decay is monotonic (§3.6: 4090 Qwen3-8B 8k→16k→32k)', () => {
    const at = (ctx: number) => tgEstimate(RTX_4090, QWEN3_8B_Q4, { mode: 'full-gpu' }, { ctx });
    const [tg8k, tg16k, tg32k] = [at(8192), at(16384), at(32768)];
    expect(tg8k).toBeGreaterThan(tg16k);
    expect(tg16k).toBeGreaterThan(tg32k);
    // 예시 수치(118 → 95 → 68)와 대략 일치 (±15%)
    expect(tg16k).toBeGreaterThan(95 * 0.85);
    expect(tg16k).toBeLessThan(95 * 1.15);
  });

  it('caps fast small-MoE at the bandwidth-model ceiling (§9: 235 tok/s)', () => {
    const monster: Hardware = { ...RTX_4090, memBandwidthGBs: 3000 };
    expect(tgEstimate(monster, GPT_OSS_20B, { mode: 'full-gpu' }, { ctx: 2048 })).toBe(MOE_TG_CAP_TOKS);
  });

  it('cpu-moe: RAM bandwidth dominated, bounded above by full-gpu estimate (§3.3)', () => {
    const cpuMoe = tgEstimate(RTX_3060_12GB, QWEN35_35B_A3B_Q4, { mode: 'cpu-moe' }, { ctx: 8192 });
    const fullGpu = tgEstimate(RTX_3060_12GB, QWEN35_35B_A3B_Q4, { mode: 'full-gpu' }, { ctx: 8192 });
    expect(cpuMoe).toBeGreaterThan(0);
    expect(cpuMoe).toBeLessThanOrEqual(fullGpu);
  });

  it('cpu-moe with measured split: routed = expertGB × topK/experts, f = N/L (10-01 D56)', () => {
    const mq = QWEN36_35B_A3B_Q4_SPLIT;
    const ctx = 8192;
    const kv = (mq.kvBytesPerToken * ctx) / 1e9;
    const routed = mq.expertGB! * mq.activeExpertFrac!;
    const at = (n: number) => tgEstimate(RTX_3060_12GB, mq, { mode: 'cpu-moe', cpuMoeLayers: n }, { ctx });
    const manual = (n: number) => {
      const f = n / mq.moeLayers!;
      const t =
        (routed * f) / (CPU_MOE_RAM_EFF * RTX_3060_12GB.ramBandwidthGBs) +
        (mq.nonExpertGB! + routed * (1 - f) + kv) / (resolveEff(RTX_3060_12GB, true) * RTX_3060_12GB.memBandwidthGBs);
      return 1 / t;
    };
    expect(at(40)).toBeCloseTo(manual(40), 6);
    expect(at(24)).toBeCloseTo(manual(24), 6);
    // CPU 에 두는 층이 적을수록 빠르고, cpuMoeLayers 가 없으면 전부 RAM(= N = L)
    expect(at(24)).toBeGreaterThan(at(40));
    expect(tgEstimate(RTX_3060_12GB, mq, { mode: 'cpu-moe' }, { ctx })).toBeCloseTo(at(40), 6);
  });

  it('partial-offload: harmonic mean sits between cpu-only and full-gpu (§3.4)', () => {
    const opts = { ctx: 8192 } as const;
    const full = tgEstimate(RTX_3060_12GB, QWEN3_8B_Q4, { mode: 'full-gpu' }, opts);
    const cpu = tgEstimate(RTX_3060_12GB, QWEN3_8B_Q4, { mode: 'cpu-only' }, opts);
    const partial = tgEstimate(RTX_3060_12GB, QWEN3_8B_Q4, { mode: 'partial-offload', gpuFrac: 0.5 }, opts);
    expect(partial).toBeGreaterThan(cpu);
    expect(partial).toBeLessThan(full);
  });

  it('cpu-only MoE uses cpu MoE eff (0.43)', () => {
    const cpuHw: Hardware = {
      kind: 'cpu',
      os: 'linux',
      memBandwidthGBs: 89.6,
      ramGB: 64,
      ramBandwidthGBs: 89.6,
      effClass: 'cpu',
    };
    const bytes = 12.11 * (3.6 / 20.9) + (24 * 1024 * 2048) / 1e9;
    expect(tgEstimate(cpuHw, GPT_OSS_20B, { mode: 'cpu-only' }, { ctx: 2048 })).toBeCloseTo(
      (0.43 * 89.6) / bytes,
      1,
    );
  });

  it('partial-offload without gpuFrac degrades to cpu speed (defensive default 0)', () => {
    const opts = { ctx: 8192 } as const;
    const cpu = tgEstimate(RTX_3060_12GB, QWEN3_8B_Q4, { mode: 'cpu-only' }, opts);
    expect(tgEstimate(RTX_3060_12GB, QWEN3_8B_Q4, { mode: 'partial-offload' }, opts)).toBeCloseTo(cpu, 6);
  });

  it('cpu-only uses RAM bandwidth with cpu dense eff', () => {
    const cpuHw: Hardware = {
      kind: 'cpu',
      os: 'linux',
      memBandwidthGBs: 89.6,
      ramGB: 64,
      ramBandwidthGBs: 89.6,
      effClass: 'cpu',
    };
    const tg = tgEstimate(cpuHw, QWEN3_8B_Q4, { mode: 'cpu-only' }, { ctx: 512 });
    // 0.5 × 89.6 / (5.03 + 0.0755) ≈ 8.8
    expect(tg).toBeCloseTo((0.5 * 89.6) / (5.03 + (144 * 1024 * 512) / 1e9), 1);
  });
});

describe('ppEstimate (§3.5)', () => {
  it('ppCoef × fp16Tflops for known classes', () => {
    expect(ppEstimate({ effClass: 'nvidia', fp16Tflops: 82.6 })).toBeCloseTo(140 * 82.6, 3);
    expect(ppEstimate({ effClass: 'apple', fp16Tflops: 34 })).toBeCloseTo(45 * 34, 3);
  });

  it('undefined when Tflops missing or class unverified', () => {
    expect(ppEstimate({ effClass: 'nvidia' })).toBeUndefined();
    expect(ppEstimate({ effClass: 'cpu', fp16Tflops: 1 })).toBeUndefined();
  });
});

describe('§6 multi-GPU speed (beta)', () => {
  it('layer split: same bandwidth model as one big card, times MULTI_GPU_TG_FACTOR', () => {
    const one: Hardware = { ...RTX_4090, gpuCount: 1 };
    const two: Hardware = { ...RTX_4090, gpuCount: 2 };
    const a = tgEstimate(one, QWEN3_8B_Q4, { mode: 'full-gpu' }, { ctx: 8192 });
    const b = tgEstimate(two, QWEN3_8B_Q4, { mode: 'full-gpu' }, { ctx: 8192 });
    expect(b).toBeCloseTo(a * MULTI_GPU_TG_FACTOR, 6);
  });
});
