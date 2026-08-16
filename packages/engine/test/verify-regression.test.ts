/**
 * 실측 대조 회귀 — verify_engine.py (2026-08-09) 의 vitest 이식 (docs/02 §7).
 * print 스크립트가 아닌 assertion: §7 수치가 곧 기대값. `pnpm run verify-engine` 로 단독 실행.
 *
 * AC (docs/06 P0-2):
 *  1) 가중치 11종: MAE < 1% (검증값 0.7%), 케이스별 |err| ≤ 1.6%
 *  2) KV 7종: 공식값 전수 일치 (±0.5 KiB)
 *  3) 속도 12점: 각 점이 클래스 밴드(±12%/±20%) 이내 + MAE < 7% (검증값 6.3%)
 *  4) 판정 새너티: 4060 8GB 통념 일치
 */
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index';
import { kvBytesPerToken, kvGB, weightsGBFromBpw } from '../src/memory';
import { tgEstimate } from '../src/speed';
import {
  GPT_OSS_20B,
  KV_CASES,
  LLAMA31_8B_Q4,
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
  it.each(KV_CASES.map((c) => [c.name, c] as const))('%s exact match', (_name, c) => {
    const kib = kvBytesPerToken({ layers: c.layers, kvHeads: c.kvHeads, headDim: c.headDim }) / 1024;
    expect(Math.abs(kib - c.expectKiB)).toBeLessThan(0.5);
  });

  it('Llama-3.1-8B @16k ctx: f16 = 2.15GB, q8_0 ≈ ×0.535', () => {
    const f16 = kvGB(128 * 1024, 16384, 'f16');
    expect(f16).toBeCloseTo(2.15, 2);
    expect(kvGB(128 * 1024, 16384, 'q8_0')).toBeCloseTo(f16 * 0.535, 2);
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
});
