/** 메모리 모델 유닛 — docs/02 §2. */
import { describe, expect, it } from 'vitest';
import {
  computeBufferGB,
  kvBytesPerToken,
  kvGB,
  osReserveGB,
  usableGB,
  usableRamGB,
  weightsGB,
  weightsGBFromBpw,
} from '../src/memory';
import type { Hardware } from '../src/types';

describe('weightsGB (§2.1)', () => {
  it('prefers actual fileGB over bpw fallback', () => {
    expect(weightsGB({ paramsB: 8.03, quant: 'Q4_K_M', fileGB: 4.92 })).toBe(4.92);
  });

  it('falls back to paramsB × bpw / 8 when fileGB is absent', () => {
    // docs/02 §8 시드: weightsGB(8.03, 'Q4_K_M') ≈ 4.91 (actual 4.92)
    expect(weightsGB({ paramsB: 8.03, quant: 'Q4_K_M' })).toBeCloseTo(4.91, 1);
    expect(weightsGBFromBpw(8.03, 'Q4_K_M')).toBeCloseTo((8.03 * 4.8944) / 8, 6);
  });

  it('refuses bpw conversion for native quants — fileGB required (§2.1, 리뷰 반영)', () => {
    expect(() => weightsGB({ paramsB: 20.9, quant: 'MXFP4' })).toThrow(/fileGB/);
    expect(() => weightsGBFromBpw(20.9, 'MXFP4')).toThrow(/native/);
    // fileGB 가 있으면 정상 (환산 없이 실측값 그대로)
    expect(weightsGB({ paramsB: 20.9, quant: 'MXFP4', fileGB: 12.11 })).toBe(12.11);
  });
});

describe('kvBytesPerToken (§2.2)', () => {
  it('§8 seed: Llama-3.1-8B = 131072 B/tok (128 KiB)', () => {
    expect(kvBytesPerToken({ layers: 32, kvHeads: 8, headDim: 128 })).toBe(131072);
  });

  it('scales by KV quant bytesPerEl (q8_0=1.07, q4_0=0.57)', () => {
    const f16 = kvBytesPerToken({ layers: 32, kvHeads: 8, headDim: 128 });
    expect(kvBytesPerToken({ layers: 32, kvHeads: 8, headDim: 128 }, 'q8_0')).toBeCloseTo(
      (f16 * 1.07) / 2,
      3,
    );
    expect(kvBytesPerToken({ layers: 32, kvHeads: 8, headDim: 128 }, 'q4_0')).toBeCloseTo(
      (f16 * 0.57) / 2,
      3,
    );
  });
});

describe('kvGB (§2.2)', () => {
  it('kvBytesPerTokenF16 × ctx / 1e9 (decimal GB)', () => {
    expect(kvGB(128 * 1024, 8192)).toBeCloseTo((128 * 1024 * 8192) / 1e9, 6);
  });
});

describe('computeBufferGB (§2.3)', () => {
  it('0.5 + 0.3 × ctx/32k', () => {
    expect(computeBufferGB(0)).toBeCloseTo(0.5, 6);
    expect(computeBufferGB(8192)).toBeCloseTo(0.575, 6);
    expect(computeBufferGB(32768)).toBeCloseTo(0.8, 6);
  });
});

describe('osReserveGB (§2.3)', () => {
  it('windows display 0.6 / linux display 0.3 / headless 0', () => {
    expect(osReserveGB({ kind: 'dgpu', os: 'windows', isDisplayGpu: true })).toBe(0.6);
    expect(osReserveGB({ kind: 'dgpu', os: 'linux', isDisplayGpu: true })).toBe(0.3);
    expect(osReserveGB({ kind: 'dgpu', os: 'windows', isDisplayGpu: false })).toBe(0);
    expect(osReserveGB({ kind: 'dgpu', os: 'linux' })).toBe(0);
  });

  it('macOS unified is absorbed into the ×0.70 rule → 0', () => {
    expect(osReserveGB({ kind: 'unified', os: 'macos', isDisplayGpu: true })).toBe(0);
    // macOS dgpu(eGPU 엣지)도 흡수 규칙 — 별도 예약 없음
    expect(osReserveGB({ kind: 'dgpu', os: 'macos', isDisplayGpu: true })).toBe(0);
  });
});

describe('usableGB / usableRamGB (§2.3)', () => {
  const base = { memBandwidthGBs: 1000, ramGB: 32, ramBandwidthGBs: 89.6 } as const;

  it('dgpu: vram − osReserve', () => {
    const hw: Hardware = { ...base, kind: 'dgpu', os: 'windows', vramGB: 8, effClass: 'nvidia', isDisplayGpu: true };
    expect(usableGB(hw)).toBeCloseTo(7.4, 6);
  });

  it('unified: ram × 0.70', () => {
    const hw: Hardware = { ...base, kind: 'unified', os: 'macos', ramGB: 128, effClass: 'apple' };
    expect(usableGB(hw)).toBeCloseTo(89.6, 6);
  });

  it('cpu: ram − 4', () => {
    const hw: Hardware = { ...base, kind: 'cpu', os: 'linux', effClass: 'cpu' };
    expect(usableGB(hw)).toBeCloseTo(28, 6);
    expect(usableRamGB({ ramGB: 32 })).toBeCloseTo(28, 6);
  });
});
