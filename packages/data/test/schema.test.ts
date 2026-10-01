/** 스키마 게이트 — CLAUDE.md 규칙 2 를 zod 가 강제하는지 확인. */
import { describe, expect, it } from 'vitest';
import { GpuSchema, ModelQuantSchema, ModelSchema } from '../src/schema';
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

  it('arch.experts/topK: integers, set together, topK < experts (10-01)', () => {
    const model = {
      id: 'test-moe',
      family: 'test',
      name: 'Test MoE',
      hfId: 'test/test',
      paramsB: 30,
      activeParamsB: 3,
      arch: { layers: 48, kvHeads: 4, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 98304, experts: 128, topK: 8 },
      maxContext: 32768,
      license: 'Apache-2.0',
      moe: true,
      category: ['chat'],
      popularity: 3,
      releasedAt: '2026-01-01',
      sources: ['https://example.com/model'],
    };
    expect(ModelSchema.safeParse(model).success).toBe(true);
    const arch = (over: Record<string, unknown>) => ({ ...model, arch: { ...model.arch, ...over } });
    expect(ModelSchema.safeParse(arch({ topK: undefined })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ topK: 128 })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ experts: 12.5 })).success).toBe(false);
  });

  it('model-quants expertGB/nonExpertGB are optional but must come together (10-01)', () => {
    const row = {
      modelId: 'test-moe',
      quant: 'Q4_K_M',
      fileGB: 18.56,
      ggufRepo: 'org/test-GGUF',
      fileName: 'test-Q4_K_M.gguf',
      sources: ['https://huggingface.co/org/test-GGUF'],
    };
    expect(ModelQuantSchema.safeParse(row).success).toBe(true);
    expect(ModelQuantSchema.safeParse({ ...row, expertGB: 17.55, nonExpertGB: 0.82 }).success).toBe(true);
    expect(ModelQuantSchema.safeParse({ ...row, expertGB: 17.55 }).success).toBe(false);
    expect(ModelQuantSchema.safeParse({ ...row, nonExpertGB: 0.82 }).success).toBe(false);
  });
});

describe('attnOverrides (docs/03 §5.1 수동 필드 우선)', () => {
  const hybridModel = {
    id: 'test-hybrid',
    family: 'test',
    name: 'Test Hybrid',
    hfId: 'test/test-hybrid',
    paramsB: 27,
    arch: { layers: 48, kvHeads: 4, headDim: 256, attnType: 'hybrid', kvBytesPerTokenF16: 49152 },
    maxContext: 262144,
    license: 'Apache-2.0',
    moe: false,
    category: ['chat'],
    popularity: 3,
    releasedAt: '2026-01-01',
    sources: ['https://example.com/model'],
  };
  const override = {
    kvBytesPerTokenF16: 49152,
    reason: 'hybrid 3:1 — full attn 12/48 layers',
    sources: ['https://example.com/config'],
  };

  it('accepts a valid override on a non-full model', () => {
    expect(ModelSchema.safeParse({ ...hybridModel, attnOverrides: override }).success).toBe(true);
  });

  it('rejects an override on a full-attention model', () => {
    const full = {
      ...hybridModel,
      arch: { ...hybridModel.arch, attnType: 'full', kvBytesPerTokenF16: 393216 },
      attnOverrides: { ...override, kvBytesPerTokenF16: 393216 },
    };
    expect(ModelSchema.safeParse(full).success).toBe(false);
  });

  it('rejects an override whose kvBytesPerTokenF16 mismatches arch', () => {
    const mismatched = { ...hybridModel, attnOverrides: { ...override, kvBytesPerTokenF16: 1 } };
    expect(ModelSchema.safeParse(mismatched).success).toBe(false);
  });
});
