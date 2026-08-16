/** 판정·신뢰 밴드 유닛 — docs/02 §4·§5. */
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index';
import { bandFor, calibratedBand, verdictOf } from '../src/verdict';
import { LLAMA31_8B_Q4, LLAMA33_70B_Q4, M4_MAX_128, RTX_4060_8GB } from './fixtures';

describe('verdictOf (§5, ctx 8k Q4_K_M 기준)', () => {
  it('S: full-gpu && tg ≥ 20', () => {
    expect(verdictOf({ mode: 'full-gpu', tgTokS: 20 })).toBe('S');
    expect(verdictOf({ mode: 'full-gpu', tgTokS: 150 })).toBe('S');
  });

  it('A: full-gpu 8~20 또는 cpu-moe ≥ 20', () => {
    expect(verdictOf({ mode: 'full-gpu', tgTokS: 8 })).toBe('A');
    expect(verdictOf({ mode: 'full-gpu', tgTokS: 19.9 })).toBe('A');
    expect(verdictOf({ mode: 'cpu-moe', tgTokS: 25 })).toBe('A');
  });

  it('B: 2~8 (모드 불문) 또는 cpu-moe 8~20', () => {
    expect(verdictOf({ mode: 'full-gpu', tgTokS: 7.9 })).toBe('B');
    expect(verdictOf({ mode: 'cpu-only', tgTokS: 5 })).toBe('B');
    expect(verdictOf({ mode: 'cpu-moe', tgTokS: 12 })).toBe('B');
  });

  it('F: tg < 2 또는 모든 quant 미탑재', () => {
    expect(verdictOf({ mode: 'cpu-only', tgTokS: 1.9 })).toBe('F');
    expect(verdictOf({ mode: 'full-gpu', tgTokS: 100, fitsAnyQuant: false })).toBe('F');
  });

  it('partial-offload gpuFrac < 0.9 → B 상한 (§3.4 절벽)', () => {
    expect(verdictOf({ mode: 'partial-offload', tgTokS: 30, gpuFrac: 0.5 })).toBe('B');
    // cpu-moe 가 아닌 partial 은 S 불가(§5: S 는 full-gpu 전용) — gpuFrac ≥ 0.9 라도 A 상한
    expect(verdictOf({ mode: 'partial-offload', tgTokS: 30, gpuFrac: 0.95 })).toBe('A');
  });

  it('리즈닝 모델: 임계 ×1.5 (§5)', () => {
    expect(verdictOf({ mode: 'full-gpu', tgTokS: 25, reasoning: true })).toBe('A'); // 25 < 30
    expect(verdictOf({ mode: 'full-gpu', tgTokS: 30, reasoning: true })).toBe('S');
    expect(verdictOf({ mode: 'cpu-only', tgTokS: 2.5, reasoning: true })).toBe('F'); // 2.5 < 3
  });
});

describe('calibratedBand / bandFor (§4)', () => {
  it('NVIDIA·AMD dGPU dense ±12%', () => {
    expect(calibratedBand('nvidia', 'full-gpu', false)).toBe(0.12);
    expect(calibratedBand('amd', 'full-gpu', false)).toBe(0.12);
  });

  it('그 외 클래스·모든 MoE·부분 오프로드 ±20%', () => {
    expect(calibratedBand('apple', 'full-gpu', false)).toBe(0.2);
    expect(calibratedBand('nvidia', 'full-gpu', true)).toBe(0.2); // MoE
    expect(calibratedBand('nvidia', 'partial-offload', false)).toBe(0.2);
    expect(calibratedBand('cpu', 'cpu-only', false)).toBe(0.2);
  });

  it('theoretical ±30%', () => {
    expect(bandFor('theoretical', 'nvidia', 'full-gpu', false)).toBe(0.3);
  });
});

describe('evaluate confidence wiring (§4)', () => {
  it('measured: 실측 주입 시 est=중앙값', () => {
    const r = evaluate(RTX_4060_8GB, LLAMA31_8B_Q4, { measuredTgTokS: [38, 40, 42] });
    expect(r.confidence).toBe('measured');
    expect(r.tgTokS.est).toBe(40);
  });

  it('calibrated: 기본 경로, low/high = est × (1∓밴드)', () => {
    const r = evaluate(RTX_4060_8GB, LLAMA31_8B_Q4);
    expect(r.confidence).toBe('calibrated');
    expect(r.tgTokS.low).toBeCloseTo(r.tgTokS.est * 0.88, 4); // nvidia dense ±12%
    expect(r.tgTokS.high).toBeCloseTo(r.tgTokS.est * 1.12, 4);
  });

  it('theoretical: 검증 밖 플래그 시 ±30%', () => {
    const r = evaluate(RTX_4060_8GB, LLAMA31_8B_Q4, { theoretical: true });
    expect(r.confidence).toBe('theoretical');
    expect(r.tgTokS.low).toBeCloseTo(r.tgTokS.est * 0.7, 4);
  });
});

describe('§8 seed: M4 Max 128GB + Llama-3.3-70B Q4 (measured 9.8 tok/s)', () => {
  it("verdict ∈ ['A','B']", () => {
    const r = evaluate(M4_MAX_128, LLAMA33_70B_Q4);
    expect(['A', 'B']).toContain(r.verdict);
  });
});
