/** 속도 모델 유닛 — docs/02 §3. */
import { describe, expect, it } from 'vitest';
import { fit } from '../src/fit';
import { gpuSharesOf, gpuUnitsOf } from '../src/memory';
import { bytesPerTokenGB, gpuThroughputGBs, moeOverheadSeconds, ppEffectiveParamsB, ppEstimate, resolveEff, tgEstimate } from '../src/speed';
import type { Hardware, ModelQuant } from '../src/types';
import {
  CPU_MOE_RAM_EFF,
  MOE_EXPERT_OVERHEAD_US,
  MULTI_GPU_TG_FACTOR,
  PP_COEF,
  PP_COEF_NEURAL_ACCEL,
  PP_FIXED_SHARE,
  PP_KQUANT_FACTOR,
  PP_MOE,
  PP_REF_PARAMS_B,
} from '../src/constants';
import { GPT_OSS_20B, LLAMA2_7B_Q4_0, LLAMA33_70B_Q4, QWEN3_8B_Q4, QWEN35_35B_A3B_Q4, QWEN36_35B_A3B_Q4_SPLIT, RTX_3060_12GB, RTX_4090 } from './fixtures';

describe('resolveEff (§3.2)', () => {
  it('uses class defaults — GPU classes have one (dense) value since 10-16 D88, MoE reads with it too', () => {
    expect(resolveEff({ effClass: 'nvidia' }, false)).toBe(0.7);
    expect(resolveEff({ effClass: 'nvidia' }, true)).toBe(0.7);
  });

  it('the cpu class keeps its MoE value (cpu-only path, 0.43)', () => {
    expect(resolveEff({ effClass: 'cpu' }, true)).toBe(0.43);
  });

  it('effOverride wins over class defaults', () => {
    expect(resolveEff({ effClass: 'nvidia', effOverride: 0.62 }, false)).toBe(0.62);
  });

  it('intel-arc reads MoE bytes with its dense value', () => {
    expect(resolveEff({ effClass: 'intel-arc' }, true)).toBe(0.59);
  });
});

describe('bytesPerTokenGB (§3.1)', () => {
  it('dense: fileGB + kvRead(ctx)', () => {
    const kvRead = (144 * 1024 * 16384) / 1e9;
    expect(bytesPerTokenGB(QWEN3_8B_Q4, 16384)).toBeCloseTo(5.03 + kvRead, 4);
  });

  it('MoE with a header split: non-expert + routed experts × topK/experts (10-16 D88)', () => {
    const kvRead = (24 * 1024 * 2048) / 1e9;
    expect(bytesPerTokenGB(GPT_OSS_20B, 2048)).toBeCloseTo(1.3 + 10.18 * (4 / 32) + kvRead, 6);
  });

  it('MoE without a split falls back to the active slice (file × active / total)', () => {
    const noSplit: ModelQuant = { ...GPT_OSS_20B, nonExpertGB: undefined, expertGB: undefined };
    const kvRead = (24 * 1024 * 2048) / 1e9;
    expect(bytesPerTokenGB(noSplit, 2048)).toBeCloseTo(12.11 * (3.6 / 20.9) + kvRead, 6);
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

  it('MoE full-gpu: read time at the dense value + MoE layers × topK × class overhead (10-16 D88)', () => {
    const read = bytesPerTokenGB(GPT_OSS_20B, 2048) / (0.7 * 1008);
    const overhead = 24 * 4 * MOE_EXPERT_OVERHEAD_US.nvidia! * 1e-6;
    expect(moeOverheadSeconds(RTX_4090, GPT_OSS_20B)).toBeCloseTo(overhead, 12);
    expect(tgEstimate(RTX_4090, GPT_OSS_20B, { mode: 'full-gpu' }, { ctx: 2048 })).toBeCloseTo(1 / (read + overhead), 6);
  });

  it('the fixed time sets a ceiling for small MoE on very fast cards (replaces the old 235 tok/s cap)', () => {
    const monster: Hardware = { ...RTX_4090, memBandwidthGBs: 1e9 };
    const ceiling = 1 / moeOverheadSeconds(RTX_4090, GPT_OSS_20B);
    expect(tgEstimate(monster, GPT_OSS_20B, { mode: 'full-gpu' }, { ctx: 2048 })).toBeLessThan(ceiling);
    expect(tgEstimate(monster, GPT_OSS_20B, { mode: 'full-gpu' }, { ctx: 2048 })).toBeGreaterThan(ceiling * 0.999);
  });

  it('a class without its own value (intel-arc) takes the largest class value; no structure → no fixed time', () => {
    const largest = Math.max(...Object.values(MOE_EXPERT_OVERHEAD_US));
    expect(moeOverheadSeconds({ effClass: 'intel-arc' }, GPT_OSS_20B)).toBeCloseTo(24 * 4 * largest * 1e-6, 12);
    expect(moeOverheadSeconds({ effClass: 'nvidia' }, { moeLayers: 24 })).toBe(0);
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
        (mq.nonExpertGB! + routed * (1 - f) + kv) / (resolveEff(RTX_3060_12GB, false) * RTX_3060_12GB.memBandwidthGBs) +
        moeOverheadSeconds(RTX_3060_12GB, mq);
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

describe('ppEstimate (§3.5, 10-16 D91 — 모델 크기 반영)', () => {
  const nv = { effClass: 'nvidia', fp16Tflops: 82.6 } as const;
  const scale = (paramsB: number) => 1 / (PP_FIXED_SHARE + (1 - PP_FIXED_SHARE) * (paramsB / PP_REF_PARAMS_B));

  it('기준 모델(Llama 2 7B Q4_0)에서는 계수 × fp16Tflops 그대로', () => {
    expect(ppEstimate(nv, LLAMA2_7B_Q4_0)).toBeCloseTo(PP_COEF.nvidia! * 82.6, 3);
    expect(ppEstimate({ effClass: 'apple', fp16Tflops: 34 }, LLAMA2_7B_Q4_0)).toBeCloseTo(PP_COEF.apple! * 34, 3);
  });

  it('dense 는 파라미터에 거의 반비례 — 70B 는 7B 의 약 1/10, 1B 는 비만큼 빨라지지 않는다(고정 몫 φ)', () => {
    const ref = ppEstimate(nv, LLAMA2_7B_Q4_0)!;
    const big = ppEstimate(nv, LLAMA33_70B_Q4)!;
    expect(big).toBeCloseTo(ref * scale(70.6), 3);
    expect(ref / big).toBeGreaterThan(9.5);
    expect(ref / big).toBeLessThan(10.5);
    const small = ppEstimate(nv, { paramsB: 1.24, quant: 'Q4_0' })!;
    expect(small / ref).toBeGreaterThan(4);
    expect(small / ref).toBeLessThan(PP_REF_PARAMS_B / 1.24);
  });

  it('MoE 는 활성 × 배수 — 전문가당 토큰(ubatch × topK/experts)이 적을수록 실효 파라미터가 크다', () => {
    // gpt-oss-20b: 32 전문가·top-4 → ub512 에서 64토큰 = 기준 → 활성 × activeFactor
    expect(ppEffectiveParamsB(GPT_OSS_20B)).toBeCloseTo(3.6 * PP_MOE.activeFactor, 6);
    // Qwen3.6-35B-A3B: 256·top-8 → 16토큰 → (64/16)^tokenExp 배
    expect(ppEffectiveParamsB(QWEN36_35B_A3B_Q4_SPLIT)).toBeCloseTo(3 * PP_MOE.activeFactor * 4 ** PP_MOE.tokenExp, 6);
    // ub 2048 이면 전문가당 토큰이 4배 → 실효 파라미터가 줄어 빨라진다
    expect(ppEffectiveParamsB(GPT_OSS_20B, { ubatch: 2048 })).toBeLessThan(ppEffectiveParamsB(GPT_OSS_20B));
    expect(ppEstimate(nv, GPT_OSS_20B, { ubatch: 2048 })!).toBeGreaterThan(ppEstimate(nv, GPT_OSS_20B)!);
    // 전문가 비율이 없으면 기준 비율(64토큰)
    expect(ppEffectiveParamsB({ paramsB: 30, activeParamsB: 3, quant: 'Q4_K_M' })).toBeCloseTo(3 * PP_MOE.activeFactor, 6);
    expect(ppEstimate(nv, GPT_OSS_20B)).toBeCloseTo(PP_COEF.nvidia! * 82.6 * scale(3.6 * PP_MOE.activeFactor), 3);
  });

  it('Neural Accelerator 칩(M5 계열)은 PP_COEF_NEURAL_ACCEL, dense K-quant 은 × PP_KQUANT_FACTOR (MoE·Q8_0 은 그대로)', () => {
    const m5 = { effClass: 'apple', fp16Tflops: 16.59, neuralAccel: true } as const;
    expect(ppEstimate(m5, LLAMA2_7B_Q4_0)).toBeCloseTo(PP_COEF_NEURAL_ACCEL * 16.59, 3);
    expect(ppEstimate({ ...m5, neuralAccel: false }, LLAMA2_7B_Q4_0)).toBeCloseTo(PP_COEF.apple! * 16.59, 3);
    const q8 = ppEstimate(m5, { paramsB: 26.9, quant: 'Q8_0' })!;
    expect(ppEstimate(m5, { paramsB: 26.9, quant: 'Q4_K_M' })).toBeCloseTo(q8 * PP_KQUANT_FACTOR.neuralAccel, 3);
    expect(ppEstimate(m5, { paramsB: 26.9, quant: 'IQ4_XS' })).toBeCloseTo(q8 * PP_KQUANT_FACTOR.neuralAccel, 3);
    expect(ppEstimate(m5, { ...QWEN36_35B_A3B_Q4_SPLIT, quant: 'Q4_K_M' })).toBeCloseTo(ppEstimate(m5, { ...QWEN36_35B_A3B_Q4_SPLIT, quant: 'Q8_0' })!, 6);
    const strix = { effClass: 'strix', fp16Tflops: 29.7 } as const;
    expect(ppEstimate(strix, { paramsB: 27.3, quant: 'UD-Q2_K_XL' })).toBeCloseTo(ppEstimate(strix, { paramsB: 27.3, quant: 'Q8_0' })! * PP_KQUANT_FACTOR.strix, 3);
    // 그 밖의 클래스는 양자화 계수 없음
    expect(ppEstimate(nv, { paramsB: 8, quant: 'Q4_K_M' })).toBeCloseTo(ppEstimate(nv, { paramsB: 8, quant: 'Q4_0' })!, 6);
    expect(ppEstimate({ effClass: 'apple', neuralAccel: true }, LLAMA2_7B_Q4_0)).toBeUndefined();
  });

  it('행렬 코어 FP16(fp16MatrixTflops — AMD RDNA4 는 벡터의 2배)이 있으면 그 값', () => {
    const rdna4 = { effClass: 'amd', fp16Tflops: 97.3, fp16MatrixTflops: 195 } as const;
    expect(ppEstimate(rdna4, LLAMA2_7B_Q4_0)).toBeCloseTo(PP_COEF.amd! * 195, 3);
  });

  it('undefined when Tflops missing or class unverified', () => {
    expect(ppEstimate({ effClass: 'nvidia' }, LLAMA2_7B_Q4_0)).toBeUndefined();
    expect(ppEstimate({ effClass: 'cpu', fp16Tflops: 1 }, LLAMA2_7B_Q4_0)).toBeUndefined();
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

describe('§6 mixed GPUs speed (beta, 10-03 D67)', () => {
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
  const one3090: Hardware = { ...mixed, gpus: undefined };

  it('identical cards: the throughput is eff × bandwidth exactly, list or gpuCount', () => {
    const two: Hardware = { ...RTX_4090, gpuCount: 2 };
    expect(gpuThroughputGBs({ ...two, gpus: gpuUnitsOf(two) })).toBe(0.7 * MULTI_GPU_TG_FACTOR * 1008);
    expect(gpuThroughputGBs(two)).toBe(0.7 * MULTI_GPU_TG_FACTOR * 1008);
    expect(gpuThroughputGBs(RTX_4090)).toBe(0.7 * 1008);
  });

  it('mixed cards: 1 GB takes Σ share_i ÷ (eff_i × BW_i) — the slower card drags the whole token', () => {
    const [a, b] = gpuSharesOf(mixed);
    const expected = MULTI_GPU_TG_FACTOR / (a! / (0.7 * 936) + b! / (0.7 * 360));
    expect(gpuThroughputGBs(mixed)).toBeCloseTo(expected, 9);
    expect(gpuThroughputGBs(mixed)).toBeLessThan(0.7 * 936);
    expect(gpuThroughputGBs(mixed)).toBeGreaterThan(0.7 * 360);
    // Qwen3 8B: 3090 한 장이면 약 105, 기본 분할로 두 카드에 나누면 약 68 tok/s
    const tgPair = tgEstimate(mixed, QWEN3_8B_Q4, fit(mixed, QWEN3_8B_Q4), { ctx: 8192 });
    const tgOne = tgEstimate(one3090, QWEN3_8B_Q4, fit(one3090, QWEN3_8B_Q4), { ctx: 8192 });
    expect(tgOne).toBeCloseTo(105, 0);
    expect(tgPair).toBeCloseTo(68, 0);
  });

  it('cpu-moe and partial offload read their GPU share at the mixed throughput; the MoE fixed time stays', () => {
    const r = { mode: 'cpu-moe' as const, cpuMoeLayers: 10 };
    const moe = { ...QWEN36_35B_A3B_Q4_SPLIT };
    const slowerPair = tgEstimate(mixed, moe, r, { ctx: 8192 });
    const fast = tgEstimate({ ...mixed, gpus: [mixed.gpus![0]!, { ...mixed.gpus![0]!, isDisplayGpu: false }] }, moe, r, { ctx: 8192 });
    expect(slowerPair).toBeLessThan(fast);
    const partial = { mode: 'partial-offload' as const, gpuFrac: 0.7 };
    expect(tgEstimate(mixed, QWEN3_8B_Q4, partial, { ctx: 8192 })).toBeLessThan(tgEstimate(one3090, QWEN3_8B_Q4, partial, { ctx: 8192 }));
    const tiny = { ...QWEN36_35B_A3B_Q4_SPLIT, fileGB: 0.5, expertGB: 0.4, nonExpertGB: 0.05 };
    const hugeBw: Hardware = { ...mixed, gpus: mixed.gpus!.map((u) => ({ ...u, memBandwidthGBs: 1e9 })) };
    const tg = tgEstimate({ ...hugeBw, gpus: [hugeBw.gpus![0]!, { ...hugeBw.gpus![1]!, vramGB: 48 }] }, tiny, { mode: 'full-gpu' }, { ctx: 512 });
    expect(tg).toBeCloseTo(1 / moeOverheadSeconds(mixed, tiny), 0);
  });
});
