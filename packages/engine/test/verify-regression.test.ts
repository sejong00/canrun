/**
 * 실측 대조 회귀 — verify_engine.py (2026-08-09) 의 vitest 이식 (docs/02 §7).
 * print 스크립트가 아닌 assertion: §7 수치가 곧 기대값. `pnpm run verify-engine` 로 단독 실행.
 *
 * AC (docs/06 P0-2):
 *  1) 가중치 11종: MAE < 1% (검증값 0.7%), 케이스별 |err| ≤ 1.6%
 *  2) KV 7종: 공식값 전수 일치 (±0.5 KiB)
 *  3) 속도 12점: 각 점이 클래스 밴드(±12%/±20%) 이내 + MAE < 7% (검증값 6.3%)
 *  4) 판정 새너티: 4060 8GB 통념 일치
 *  5) cpu-moe(전문가 RAM) 3점: 각 ±20% 이내 + MAE < 12% (09-30 보정 — 이전 식은 ~2.5× 과소)
 *  6) 같은 GPU 여러 장 10점(D58) · 7) 서로 다른 GPU 섞기 3점(D67)
 *  8) 클래스 계수 재보정 22점(10-15 D79·D81): AMD Vulkan 4점 각 ±12% · DGX Spark 10점·Apple MoE 8점 각 ±20%
 */
import { describe, expect, it } from 'vitest';
import { fit } from '../src/fit';
import { evaluate } from '../src/index';
import { kvBytesPerToken, kvGB, weightsGBFromBpw } from '../src/memory';
import { tgEstimate } from '../src/speed';
import {
  CPU_MOE_CASES,
  RECAL_1015_CASES,
  HETERO_GPU_CASES,
  MULTI_GPU_CASES,
  GPT_OSS_20B,
  KV_CASES,
  LLAMA31_8B_Q4,
  LLAMA31_8B_Q4_RESIDENT,
  QWEN3_14B_Q4,
  QWEN3_30B_A3B_Q4,
  QWEN3_8B_Q4,
  RTX_4060_8GB,
  RTX_4090,
  SPEED_CASES,
  WEIGHTS_CASES,
} from './fixtures';

describe('1) weights: paramsB × bpw / 8 vs actual GGUF size (11 cases)', () => {
  const errors = WEIGHTS_CASES.map(({ paramsB, quant, actualGB }) => {
    const pred = weightsGBFromBpw(paramsB, quant);
    return Math.abs(pred - actualGB) / actualGB;
  });

  it.each(WEIGHTS_CASES.map((c) => [c.name, c.quant, c] as const))(
    '%s %s within ±1.6%%',
    (_name, _quant, c) => {
      const pred = weightsGBFromBpw(c.paramsB, c.quant);
      expect(Math.abs(pred - c.actualGB) / c.actualGB).toBeLessThanOrEqual(0.016);
    },
  );

  it('MAE < 1% (verified 0.7%)', () => {
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mae).toBeLessThan(0.01);
  });
});

describe('2) KV cache: 2·layers·kvHeads·headDim·2B vs known KiB/tok (7 cases)', () => {
  // 정확값 일치 (외부 리뷰 반영 — 근사 허용 오차 제거, 공식이므로 toBe)
  it.each(KV_CASES.map((c) => [c.name, c] as const))('%s exact match', (_name, c) => {
    expect(kvBytesPerToken({ layers: c.layers, kvHeads: c.kvHeads, headDim: c.headDim })).toBe(
      c.expectKiB * 1024,
    );
  });

  it('Llama-3.1-8B @16k ctx: f16 exactly 2^31 bytes = 2.147483648 GB, q8_0 = ×0.535', () => {
    const f16 = kvGB(128 * 1024, 16384, 'f16');
    expect(f16).toBe((128 * 1024 * 16384) / 1e9); // 2.147483648
    expect(kvGB(128 * 1024, 16384, 'q8_0')).toBeCloseTo(f16 * 0.535, 9);
  });
});

describe('3) speed: tg = eff × BW / (weightsRead + kvRead) vs measured (12 points)', () => {
  const errors = SPEED_CASES.map(({ hw, mq, ctx, measuredTg }) => {
    const pred = tgEstimate(hw, mq, { mode: 'full-gpu' }, { ctx });
    return (pred - measuredTg) / measuredTg;
  });

  it.each(SPEED_CASES.map((c, i) => [c.label, c, i] as const))(
    '%s within class band',
    (_label, c, i) => {
      expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(c.band);
    },
  );

  it('MAE < 7% (verified 6.3%)', () => {
    const mae = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
    expect(mae).toBeLessThan(0.07);
  });

  it('§8 seed: tg(4090, qwen3-8b Q4, 16k) ∈ [88, 115] (measured 104.3)', () => {
    const { tgTokS, mode } = evaluate(RTX_4090, QWEN3_8B_Q4, { ctx: 16384 });
    expect(mode).toBe('full-gpu');
    expect(tgTokS.est).toBeGreaterThanOrEqual(88);
    expect(tgTokS.est).toBeLessThanOrEqual(115);
  });
});

describe('4) verdict sanity: RTX 4060 8GB (windows display, usable ≈ 7.4GB)', () => {
  it('Llama-3.1-8B Q4_K_M runs full-gpu (measured 38~42 tok/s → S)', () => {
    const r = evaluate(RTX_4060_8GB, LLAMA31_8B_Q4);
    expect(r.mode).toBe('full-gpu');
    expect(r.verdict).toBe('S');
  });

  it.each([
    ['Qwen3-14B Q4_K_M', QWEN3_14B_Q4],
    ['Qwen3-30B-A3B Q4_K_M', QWEN3_30B_A3B_Q4],
    ['gpt-oss-20b MXFP4', GPT_OSS_20B],
  ] as const)('%s: no full offload', (_name, mq) => {
    expect(evaluate(RTX_4060_8GB, mq).mode).not.toBe('full-gpu');
  });

  it('Qwen3-14B Q4_K_M stays off full offload with the header-measured GPU share (10-03 D62: 9.00 − 0.44 = 8.56GB)', () => {
    // 입력 임베딩 0.44GB 를 빼도 8.56 + KV 1.31 + 버퍼 0.575 = 10.45 > 7.4 — 판정 새너티는 그대로
    expect(evaluate(RTX_4060_8GB, { ...QWEN3_14B_Q4, offGpuGB: 0.44 }).mode).not.toBe('full-gpu');
    expect(evaluate(RTX_4060_8GB, LLAMA31_8B_Q4_RESIDENT)).toMatchObject({ mode: 'full-gpu', verdict: 'S' });
  });
});

describe('5) cpu-moe: 전문가 일부 GPU 배치까지 공개 실측 대조 (09-30 → 10-01 D56, docs/02 §3.3·§7)', () => {
  const errors = CPU_MOE_CASES.map(
    ({ hw, mq, ctx, nCpuMoe, measuredTg }) =>
      (tgEstimate(hw, mq, { mode: 'cpu-moe', cpuMoeLayers: nCpuMoe }, { ctx }) - measuredTg) / measuredTg,
  );
  const abs = errors.map(Math.abs);

  it.each(CPU_MOE_CASES.flatMap((c, i) => (c.strict ? [[c.label, i] as const] : [])))('%s within ±20%% (09-30 strict)', (_label, i) => {
    expect(abs[i]!).toBeLessThanOrEqual(0.2);
  });

  it('MAE < 12% over every public point', () => {
    expect(abs.reduce((a, b) => a + b, 0) / abs.length).toBeLessThan(0.12);
  });

  it('≥ 80% of points within ±20%, every point within ±40%', () => {
    expect(abs.filter((e) => e <= 0.2).length / abs.length).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...abs)).toBeLessThan(0.4);
  });

  it('표시 범위(이론 추정 est×0.7~1.3) 밖은 과소 추정뿐 — 실제가 범위보다 느린 점은 없다 (docs/02 §4 ②)', () => {
    CPU_MOE_CASES.forEach((c, i) => {
      const est = c.measuredTg * (1 + errors[i]!);
      expect(c.measuredTg, c.label).toBeGreaterThanOrEqual(est * 0.7);
    });
  });

  it('has enough points to mean something', () => {
    expect(CPU_MOE_CASES.length).toBeGreaterThanOrEqual(35);
  });
});

describe('6) multi-GPU layer split (§6 beta, D58): 공개 실측 10점', () => {
  const errors = MULTI_GPU_CASES.map(({ hw, mq, ctx, measuredTg }) => {
    const r = fit(hw, mq, { ctx });
    expect(r.mode).toBe('full-gpu');
    return (tgEstimate(hw, mq, r, { ctx }) - measuredTg) / measuredTg;
  });

  it('every point within ±30% (theoretical band) and never more than 5% optimistic', () => {
    for (const e of errors) {
      expect(Math.abs(e)).toBeLessThanOrEqual(0.3);
      expect(e).toBeLessThanOrEqual(0.05);
    }
  });

  it('MAE < 15%', () => {
    expect(errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length).toBeLessThan(0.15);
  });
});

describe('7) mixed GPUs layer split (§6 beta, 10-03 D67): 공개 실측 3점', () => {
  const rows = HETERO_GPU_CASES.map((c) => {
    const r = fit(c.hw, c.mq, { ctx: c.ctx });
    return { c, r, error: (tgEstimate(c.hw, c.mq, r, { ctx: c.ctx }) - c.measuredTg) / c.measuredTg };
  });

  it.each(rows.map((row) => [row.c.label, row] as const))('%s: 두 카드 모두에 전량 탑재(기본 층 분할)', (_, { r }) => {
    expect(r.mode).toBe('full-gpu');
  });

  it('class coefficients (5070 Ti + 3060): within ±30% and never more than 5% optimistic (≈ −7%)', () => {
    for (const { error } of rows.filter((row) => row.c.kind === 'class')) {
      expect(Math.abs(error)).toBeLessThanOrEqual(0.3);
      expect(error).toBeLessThanOrEqual(0.05);
      expect(error).toBeCloseTo(-0.068, 2);
    }
  });

  it('formula with per-card coefficients fitted to single-card runs (3060 + P100): each within ±10% (+2.6% · −1.5%)', () => {
    const formula = rows.filter((row) => row.c.kind === 'formula');
    expect(formula).toHaveLength(2);
    for (const { error } of formula) expect(Math.abs(error)).toBeLessThanOrEqual(0.1);
    expect(formula[0]!.error).toBeCloseTo(0.026, 2);
    expect(formula[1]!.error).toBeCloseTo(-0.015, 2);
  });
});

describe('8) class recalibration (10-15 D79·D81): AMD Vulkan 4점 · DGX Spark 10점 · Apple MoE 8점', () => {
  const errors = RECAL_1015_CASES.map(
    ({ hw, mq, ctx, measuredTg }) => (tgEstimate(hw, mq, { mode: 'full-gpu' }, { ctx }) - measuredTg) / measuredTg,
  );
  const group = (prefix: string) => errors.filter((_, i) => RECAL_1015_CASES[i]!.label.startsWith(prefix));

  it.each(RECAL_1015_CASES.map((c, i) => [c.label, c, i] as const))('%s within class band', (_label, c, i) => {
    expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(c.band);
  });

  it('AMD dense (Vulkan no-FA 표): MAE < 7%', () => {
    const amd = group('RX ');
    expect(amd).toHaveLength(4);
    expect(amd.reduce((a, b) => a + Math.abs(b), 0) / amd.length).toBeLessThan(0.07);
  });

  it('DGX Spark (b7941 결과 파일): MAE < 12%', () => {
    const spark = group('DGX Spark');
    expect(spark).toHaveLength(10);
    expect(spark.reduce((a, b) => a + Math.abs(b), 0) / spark.length).toBeLessThan(0.12);
  });

  it('Apple MoE (gpt-oss 가이드 #15396): base/Pro/Max 5점 MAE < 12% · Ultra 3점 MAE < 7%', () => {
    const base = [...group('Apple M4'), ...group('Apple M1')];
    const ultra = [...group('Apple M3 Ultra'), ...group('Apple M2 Ultra')];
    expect(base).toHaveLength(5);
    expect(ultra).toHaveLength(3);
    expect(base.reduce((a, b) => a + Math.abs(b), 0) / base.length).toBeLessThan(0.12);
    expect(ultra.reduce((a, b) => a + Math.abs(b), 0) / ultra.length).toBeLessThan(0.07);
  });
});
