/**
 * 실측 대조 회귀 — verify_engine.py (2026-08-09) 의 vitest 이식 (docs/02 §7).
 * print 스크립트가 아닌 assertion: §7 수치가 곧 기대값. `pnpm run verify-engine` 로 단독 실행.
 *
 * AC (docs/06 P0-2):
 *  1) 가중치 11종: MAE < 1% (검증값 0.7%), 케이스별 |err| ≤ 1.6%
 *  2) KV 7종: 공식값 전수 일치 (±0.5 KiB)
 *  3) 속도 12점: 각 점이 클래스 밴드(±12%/±20%) 이내 + MAE < 7% (검증값 6.3% → 10-15 D83 Apple 2점을 지금 빌드 값으로 바꿔 5.6%
 *     → 10-16 D88 MoE 고정 시간으로 4.7% → 10-16 D90 strix 재보정으로 4.2%)
 *  4) 판정 새너티: 4060 8GB 통념 일치
 *  5) cpu-moe(전문가 RAM) 3점: 각 ±20% 이내 + MAE < 12% (09-30 보정 — 이전 식은 ~2.5× 과소)
 *  6) 같은 GPU 여러 장 10점(D58) · 7) 서로 다른 GPU 섞기 3점(D67)
 *  8) 클래스 계수 재보정 29점(10-15 D79·D83, 10-16 D90): AMD Vulkan 4점 각 ±12% · DGX Spark 10점·Apple dense 9점·Strix Halo dense 6점 각 ±20%
 *     (Apple MoE 8점(#15396 2025-08 빌드)은 10-16 D88 에 회귀 밖 참고점 — 10 의 MOE_OLD_BUILD_CASES)
 *  9) pp(§3.5) Apple 12점(10-16 D86): 각 ±40%(PP_BAND) · M5 계열 5점 각 ±12% · 그 밖의 칩 새 빌드 2점 각 ±5%
 * 10) MoE 토큰당 고정 시간(§3.1, 10-16 D88): 2026 빌드 49점(10-16 D90 에 Strix Halo 4점 추가) 각 ±20% · MAE < 10%(검증값 8.9% → 8.3%) · 클래스별 MAE < 12%
 * 11) pp 모델 크기(§3.5, 10-16 D91): 2026 빌드 다모델 91점(dense 61·MoE 30) 각 ±40%(PP_BAND) · MAE < 13%(검증값 11.6%) · 클래스별 MAE < 15%
 *     · ±30% 밖 2점 이하 — 옛 식(GPU 마다 값 하나)은 같은 점에서 MAE 92%·최대 +733%
 */
import { describe, expect, it } from 'vitest';
import { fit } from '../src/fit';
import { evaluate } from '../src/index';
import { kvBytesPerToken, kvGB, weightsGBFromBpw } from '../src/memory';
import { ppEstimate, tgEstimate } from '../src/speed';
import {
  APPLE_PP_CASES,
  LLAMA2_7B_Q4_0,
  PP_SIZE_CASES,
  CPU_MOE_CASES,
  MOE_OLD_BUILD_CASES,
  MOE_OVERHEAD_CASES,
  MOE_OVERHEAD_SPARK_B7941,
  RECAL_1015_CASES,
  STRIX_SLOWER_DENSE_CASES,
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

  it('MAE < 7% (verified 6.3% → 5.6% after the 10-15 D83 Apple swap → 4.7% with the 10-16 D88 MoE fixed time → 4.2% with the 10-16 D90 strix recalibration)', () => {
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

describe('8) class recalibration (10-15 D79·D83, 10-16 D90): AMD Vulkan 4점 · DGX Spark 10점 · Apple dense 9점 · Strix Halo dense 6점', () => {
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

  it('Apple dense (#4167 새 빌드 — 10-15 D83): base/Pro/Max 6점 MAE < 7% · Ultra 3점 MAE < 5%', () => {
    const base = group('Apple dense');
    const ultra = group('Apple Ultra dense');
    expect(base).toHaveLength(6);
    expect(ultra).toHaveLength(3);
    expect(base.reduce((a, b) => a + Math.abs(b), 0) / base.length).toBeLessThan(0.07);
    expect(ultra.reduce((a, b) => a + Math.abs(b), 0) / ultra.length).toBeLessThan(0.05);
    // 가이드 mac-local-llm '얼마나 확실한가'의 "각 11% 안쪽" 문장을 고정한다
    expect(Math.max(...base.map(Math.abs))).toBeLessThan(0.11);
  });

  it('Strix Halo dense (Vulkan 지금 빌드 — 10-16 D90): 6점 MAE < 3% · 각 ±5%', () => {
    const strix = group('Strix Halo dense');
    expect(strix).toHaveLength(6);
    expect(strix.reduce((a, b) => a + Math.abs(b), 0) / strix.length).toBeLessThan(0.03);
    expect(Math.max(...strix.map(Math.abs))).toBeLessThan(0.05);
  });

  it('회귀 밖 참고: Strix Halo 의 ROCm·FA 끔 dense 5점은 추정이 높게(0~+14%) — 모두 ±20% 안', () => {
    for (const c of STRIX_SLOWER_DENSE_CASES) {
      const e = (tgEstimate(c.hw, c.mq, { mode: 'full-gpu' }, { ctx: c.ctx }) - c.measuredTg) / c.measuredTg;
      expect(e, c.label).toBeGreaterThanOrEqual(0);
      expect(e, c.label).toBeLessThanOrEqual(c.band);
    }
  });
});

describe('9) pp: Apple #4167 Llama 2 7B Q4_0 pp512 (10-16 D86·D87, docs/02 §3.5)', () => {
  // 표시 밴드 = 데이터 레이어 PP_BAND 0.4 (docs/02 §3.5 policy) — 엔진 테스트라 값으로 둔다
  const PP_BAND = 0.4;
  const errors = APPLE_PP_CASES.map(({ hw, measuredPp }) => (ppEstimate(hw, LLAMA2_7B_Q4_0)! - measuredPp) / measuredPp);
  const group = (g: (typeof APPLE_PP_CASES)[number]['group']) => errors.filter((_, i) => APPLE_PP_CASES[i]!.group === g);

  it.each(APPLE_PP_CASES.map((c, i) => [c.label, i] as const))('%s within ±40% rough band', (_label, i) => {
    expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(PP_BAND);
  });

  it('M5 계열(Neural Accelerator) 지금 빌드 5점: 각 ±12% · MAE < 10%', () => {
    const m5 = group('m5');
    expect(m5).toHaveLength(5);
    expect(Math.max(...m5.map(Math.abs))).toBeLessThan(0.12);
    expect(m5.reduce((a, b) => a + Math.abs(b), 0) / m5.length).toBeLessThan(0.1);
  });

  it('그 밖의 칩 새 빌드 2점(M2 Ultra·M4 Max 32코어): 각 ±5%', () => {
    const current = group('current');
    expect(current).toHaveLength(2);
    expect(Math.max(...current.map(Math.abs))).toBeLessThan(0.05);
  });
});

describe('10) MoE 토큰당 고정 시간 (§3.1, 10-16 D88·D90): 2026 llama.cpp 빌드 49점', () => {
  const cases = [...MOE_OVERHEAD_CASES, ...MOE_OVERHEAD_SPARK_B7941];
  const err = (c: (typeof cases)[number]) => (tgEstimate(c.hw, c.mq, { mode: 'full-gpu' }, { ctx: c.ctx }) - c.measuredTg) / c.measuredTg;
  const errors = cases.map(err);
  const mae = (xs: readonly number[]) => xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;

  it('has the 49 points the constants were fitted to', () => {
    expect(cases).toHaveLength(49);
    for (const c of cases) expect(c.source, c.label).toMatch(/^https:\/\//);
  });

  it.each(cases.map((c, i) => [c.label, i] as const))('%s within ±20% (MoE band)', (_label, i) => {
    expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(0.2);
  });

  it('MAE < 10% over all 49 (verified 8.9% on 45 → 8.3% with the 10-16 D90 Strix Halo points) and < 12% in every class', () => {
    expect(mae(errors)).toBeLessThan(0.1);
    for (const cls of ['apple', 'apple-ultra', 'dgx-spark', 'nvidia', 'amd', 'strix'] as const) {
      const xs = errors.filter((_, i) => cases[i]!.hw.effClass === cls);
      expect(xs.length, cls).toBeGreaterThanOrEqual(3);
      expect(mae(xs), cls).toBeLessThan(0.12);
    }
  });

  it('같은 모델의 Q4·Q8 비(바이트만 다른 쌍)를 옛 식보다 가깝게 낸다 — M5 Max·M2 Ultra Qwen3.5-35B-A3B, M2 Ultra Gemma 4 (D86 ①)', () => {
    const tg = (label: string) => {
      const c = cases.find((x) => x.label.startsWith(label))!;
      return { est: tgEstimate(c.hw, c.mq, { mode: 'full-gpu' }, { ctx: c.ctx }), meas: c.measuredTg };
    };
    for (const [q4, q8] of [
      ['Apple M5 Max 40c Qwen3.5-35B-A3B Q4_K_M', 'Apple M5 Max 40c Qwen3.5-35B-A3B Q8_0'],
      ['Apple M2 Ultra Qwen3.5-35B-A3B Q4_K_M', 'Apple M2 Ultra Qwen3.5-35B-A3B Q8_0'],
      ['Apple M2 Ultra Gemma 4 26B-A4B Q4_0', 'Apple M2 Ultra Gemma 4 26B-A4B Q8_0'],
    ] as const) {
      const a = tg(q4);
      const b = tg(q8);
      const measured = a.meas / b.meas; // 1.09 ~ 1.26
      const estimated = a.est / b.est;
      expect(Math.abs(estimated / measured - 1), q4).toBeLessThan(0.17);
    }
  });

  it('회귀 밖 참고: 2025-08 빌드(#15396) Apple 8점은 지금 식이 모두 높게 본다(+10~+40%, 빌드가 빨라졌다)', () => {
    for (const c of MOE_OLD_BUILD_CASES) {
      const e = err(c);
      expect(e, c.label).toBeGreaterThan(0.1);
      expect(e, c.label).toBeLessThan(0.4);
    }
  });
});

describe('11) pp 모델 크기 (§3.5, 10-16 D91): 2026 llama.cpp 빌드 다모델 91점', () => {
  // 표시 밴드 = 데이터 레이어 PP_BAND 0.4 (docs/02 §3.5 policy) — 엔진 테스트라 값으로 둔다
  const PP_BAND = 0.4;
  const err = (c: (typeof PP_SIZE_CASES)[number]) =>
    (ppEstimate(c.hw, c.mq, { ubatch: c.ubatch })! - c.measuredPp) / c.measuredPp;
  const errors = PP_SIZE_CASES.map(err);
  const mae = (xs: readonly number[]) => xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;
  const cls = (c: (typeof PP_SIZE_CASES)[number]) => (c.hw.neuralAccel ? 'neural-accel' : c.hw.effClass);

  it('has the 91 points the constants were fitted to (dense 61 · MoE 30), all with an https source', () => {
    expect(PP_SIZE_CASES).toHaveLength(91);
    expect(PP_SIZE_CASES.filter((c) => c.mq.activeParamsB !== undefined)).toHaveLength(30);
    for (const c of PP_SIZE_CASES) expect(c.source, c.label).toMatch(/^https:\/\//);
  });

  it.each(PP_SIZE_CASES.map((c, i) => [c.label, i] as const))('%s within ±40% rough band', (_label, i) => {
    expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(PP_BAND);
  });

  it('MAE < 13% (verified 11.6%), ±30% 밖 2점 이하, 클래스마다 MAE < 15%', () => {
    expect(mae(errors)).toBeLessThan(0.13);
    expect(errors.filter((e) => Math.abs(e) > 0.3).length).toBeLessThanOrEqual(2);
    for (const k of ['nvidia', 'dgx-spark', 'apple-ultra', 'neural-accel', 'amd', 'strix'] as const) {
      const xs = errors.filter((_, i) => cls(PP_SIZE_CASES[i]!) === k);
      expect(xs.length, k).toBeGreaterThanOrEqual(4);
      expect(mae(xs), k).toBeLessThan(0.15);
    }
  });

  it('같은 기기·같은 빌드에서 큰 모델이 느린 비율을 따라간다 — 4090 8B → 70B · DGX Spark 3B → 70B (±25%)', () => {
    const pair = (a: string, b: string) => {
      const ca = PP_SIZE_CASES.find((c) => c.label.startsWith(a))!;
      const cb = PP_SIZE_CASES.find((c) => c.label.startsWith(b))!;
      const est = ppEstimate(ca.hw, ca.mq, { ubatch: ca.ubatch })! / ppEstimate(cb.hw, cb.mq, { ubatch: cb.ubatch })!;
      return est / (ca.measuredPp / cb.measuredPp) - 1;
    };
    expect(Math.abs(pair('RTX 4090 llama 8B Q4_0 pp512 (2026-05-25', 'RTX 4090 llama 70B Q4_K_M'))).toBeLessThan(0.25);
    expect(Math.abs(pair('DGX Spark llama 3B Q4_K_M', 'DGX Spark llama 70B Q4_K_M'))).toBeLessThan(0.25);
    expect(Math.abs(pair('RTX 3090 llama 1B Q4_0', 'RTX 3090 llama 8B Q4_0 pp512'))).toBeLessThan(0.25);
  });
});
