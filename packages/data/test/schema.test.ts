/** 스키마 게이트 — CLAUDE.md 규칙 2 를 zod 가 강제하는지 확인. */
import { describe, expect, it } from 'vitest';
import { GpuSchema, ModelSchema } from '../src/schema';
import { loadSeed } from './seed';

const validGpu = {
  id: 'rtx-4060',
  name: 'GeForce RTX 4060',
  aliases: ['4060'],
  vendor: 'nvidia',
  kind: 'dgpu',
  form: 'desktop',
  vramGB: 8,
  memBandwidthGBs: 272,
  fp16Tflops: 15.1,
  effClass: 'nvidia',
  launchYear: 2023,
  msrpUSD: 299,
  popular: true,
  sources: ['https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107'],
};

describe('seed files parse (AC: zod 검증 통과)', () => {
  it('all five seed files parse without error', () => {
    const seed = loadSeed();
    expect(seed.gpus.length).toBeGreaterThan(0);
    expect(seed.models.length).toBeGreaterThan(0);
  });
});

describe('sources[] enforcement (rule 2)', () => {
  it('rejects a record without sources', () => {
    expect(GpuSchema.safeParse({ ...validGpu, sources: [] }).success).toBe(false);
    const { sources: _dropped, ...noSources } = validGpu;
    expect(GpuSchema.safeParse(noSources).success).toBe(false);
  });

  it('rejects non-URL sources', () => {
    expect(GpuSchema.safeParse({ ...validGpu, sources: ['TechPowerUp'] }).success).toBe(false);
  });
});

describe('priceAsOf enforcement (rule 2)', () => {
  it('rejects street price without priceAsOf', () => {
    expect(GpuSchema.safeParse({ ...validGpu, streetUSD: 250 }).success).toBe(false);
    expect(
      GpuSchema.safeParse({ ...validGpu, streetUSD: 250, priceAsOf: '2026-08-09' }).success,
    ).toBe(true);
  });
});

describe('structural refinements', () => {
  it('rejects dgpu without vramGB / unified without ramOptionsGB', () => {
    const { vramGB: _v, ...noVram } = validGpu;
    expect(GpuSchema.safeParse(noVram).success).toBe(false);
    expect(
      GpuSchema.safeParse({ ...noVram, kind: 'unified', vendor: 'apple' }).success,
    ).toBe(false);
  });

  it('rejects moe model without activeParamsB', () => {
    const model = {
      id: 'test-moe',
      family: 'test',
      name: 'Test MoE',
      hfId: 'test/test',
      paramsB: 30,
      arch: { layers: 48, kvHeads: 4, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 98304 },
      maxContext: 32768,
      license: 'Apache-2.0',
      moe: true,
      category: ['chat'],
      popularity: 3,
      releasedAt: '2026-01-01',
      sources: ['https://example.com/model'],
    };
    expect(ModelSchema.safeParse(model).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, activeParamsB: 3 }).success).toBe(true);
  });
});
