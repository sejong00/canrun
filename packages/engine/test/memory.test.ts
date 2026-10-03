/** 메모리 모델 유닛 — docs/02 §2. */
import { describe, expect, it } from 'vitest';
import {
  computeBufferGB,
  gpuCountOf,
  gpuOsReserveGB,
  gpuResidentGBFor,
  gpuSharesOf,
  gpuUnitsOf,
  isUniformGpus,
  kvBytesPerToken,
  kvGB,
  osReserveGB,
  usableGB,
  usableRamGB,
  vramTotalGB,
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

describe('gpuResidentGBFor (§2.4-1, 10-03 D62)', () => {
  const base = { paramsB: 8.03, quant: 'Q4_K_M' as const, fileGB: 4.92 };

  it('offGpuGB (dense header measurement) comes first', () => {
    expect(gpuResidentGBFor({ ...base, offGpuGB: 0.3 })).toBeCloseTo(4.62, 9);
    // 둘 다 있으면 offGpuGB 우선
    expect(gpuResidentGBFor({ ...base, offGpuGB: 0.3, expertGB: 1, nonExpertGB: 1 })).toBeCloseTo(4.62, 9);
  });

  it('then the MoE measured split, then the whole file', () => {
    expect(gpuResidentGBFor({ ...base, fileGB: 22.27, expertGB: 19.5, nonExpertGB: 1.59 })).toBeCloseTo(21.09, 9);
    expect(gpuResidentGBFor(base)).toBe(4.92);
    // 분할 한쪽만 있으면 유도하지 않는다
    expect(gpuResidentGBFor({ ...base, nonExpertGB: 1 })).toBe(4.92);
  });

  it('clamps to [0, weights] so bad data never raises or negates the need', () => {
    expect(gpuResidentGBFor({ ...base, offGpuGB: -1 })).toBe(4.92);
    expect(gpuResidentGBFor({ ...base, offGpuGB: 9 })).toBe(0);
    expect(gpuResidentGBFor({ ...base, expertGB: 4, nonExpertGB: 2 })).toBe(4.92);
  });

  it('takes an explicit weights size (bpw fallback without fileGB)', () => {
    expect(gpuResidentGBFor({ paramsB: 8.03, quant: 'Q4_K_M' }, 5)).toBe(5);
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

describe('GPU card list (§6, 10-03 D67)', () => {
  const base = { memBandwidthGBs: 936, ramGB: 64, ramBandwidthGBs: 89.6 } as const;
  const two3090: Hardware = { ...base, kind: 'dgpu', os: 'windows', vramGB: 24, effClass: 'nvidia', isDisplayGpu: true, gpuCount: 2 };
  const mixed: Hardware = {
    ...two3090,
    gpuCount: undefined,
    gpus: [
      { vramGB: 24, memBandwidthGBs: 936, effClass: 'nvidia', isDisplayGpu: true },
      { vramGB: 12, memBandwidthGBs: 360, effClass: 'nvidia' },
    ],
  };

  it('gpuUnitsOf: copies gpuCount cards with the display reserve on the first only; a card list wins; non-dGPU has none', () => {
    expect(gpuUnitsOf(two3090)).toEqual([
      { vramGB: 24, memBandwidthGBs: 936, effClass: 'nvidia', isDisplayGpu: true },
      { vramGB: 24, memBandwidthGBs: 936, effClass: 'nvidia' },
    ]);
    expect(gpuUnitsOf({ ...mixed, gpuCount: 4 })).toEqual(mixed.gpus);
    expect(gpuUnitsOf({ ...base, kind: 'unified', os: 'macos', effClass: 'apple', gpus: mixed.gpus })).toEqual([]);
  });

  it('gpuCountOf: the card list length, and still 1 for unified / CPU (compute buffer, measured join)', () => {
    expect(gpuCountOf(mixed)).toBe(2);
    expect(gpuCountOf({ kind: 'dgpu', gpus: [] })).toBe(1);
    expect(gpuCountOf({ kind: 'unified', gpus: mixed.gpus })).toBe(1);
    expect(gpuCountOf({ kind: 'cpu' })).toBe(1);
  });

  it('mixed cards: usable = Σ VRAM − display reserve, limit = Σ VRAM, shares follow free memory', () => {
    expect(vramTotalGB(mixed)).toBe(36);
    expect(gpuOsReserveGB(mixed)).toBeCloseTo(0.6, 9);
    expect(usableGB(mixed)).toBeCloseTo(35.4, 9);
    const [a, b] = gpuSharesOf(mixed);
    expect(a).toBeCloseTo(23.4 / 35.4, 9);
    expect(b).toBeCloseTo(12 / 35.4, 9);
  });

  it('a list of identical cards gives the same numbers as gpuCount, bit for bit', () => {
    const asList: Hardware = { ...two3090, gpus: gpuUnitsOf(two3090) };
    expect(isUniformGpus(asList.gpus!)).toBe(true);
    expect(usableGB(asList)).toBe(usableGB(two3090));
    expect(vramTotalGB(asList)).toBe(vramTotalGB(two3090));
    expect(gpuOsReserveGB(asList)).toBe(osReserveGB(two3090));
    expect(isUniformGpus(mixed.gpus!)).toBe(false);
  });

  it('free memory of 0 everywhere splits evenly (no division by zero)', () => {
    const empty: Hardware = { ...mixed, gpus: [{ vramGB: 0, memBandwidthGBs: 1, effClass: 'nvidia' }, { vramGB: 0, memBandwidthGBs: 1, effClass: 'nvidia' }] };
    expect(gpuSharesOf(empty)).toEqual([0.5, 0.5]);
    expect(gpuSharesOf({ ...base, kind: 'cpu', os: 'linux', effClass: 'cpu' })).toEqual([]);
  });
});
