/** 스키마 게이트 — CLAUDE.md 규칙 2 를 zod 가 강제하는지 확인. */
import { describe, expect, it } from 'vitest';
import { GpuSchema, isCalendarDate, ModelQuantSchema, ModelSchema } from '../src/schema';
import { loadSeed, readSeedJson } from './seed';

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

  // 카탈로그 추가일(10-14 D72)은 데이터를 고친 날이라 데이터 기준일을 넘을 수 없다 — add-model 이 둘을 같은 날로 쓴다
  it('no model was added to the catalog after the data date (data/meta.json)', () => {
    const { dataUpdated } = readSeedJson('meta.json') as { dataUpdated: string };
    for (const model of loadSeed().models) {
      expect(model.addedAt <= dataUpdated, `${model.id} addedAt ${model.addedAt} > dataUpdated ${dataUpdated}`).toBe(true);
    }
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

  it('Apple chips list the Macs they ship in, checked against ramOptionsGB and sources (10-16 D97)', () => {
    const spec = 'https://support.apple.com/en-us/121555';
    const mac = {
      ...validGpu,
      id: 'apple-test',
      name: 'Apple Test',
      vendor: 'apple',
      kind: 'unified',
      vramGB: undefined,
      ramOptionsGB: [16, 24, 32],
      effClass: 'apple',
      sources: ['https://en.wikipedia.org/wiki/Apple_M4', spec],
      products: [
        { line: 'mac-mini', model: 'Mac mini (2024)', memoryGB: [16, 24, 32], sources: [spec] },
        { line: 'imac', model: 'iMac (24-inch, 2024, Two ports)', memoryGB: [16, 24], sources: [spec] },
      ],
    };
    const products = (list: unknown[]) => ({ ...mac, products: list });
    const [mini, imac] = mac.products;
    expect(GpuSchema.safeParse(mac).success).toBe(true);
    // Apple 칩은 필수, 다른 벤더는 금지
    expect(GpuSchema.safeParse({ ...mac, products: undefined }).success).toBe(false);
    expect(GpuSchema.safeParse({ ...validGpu, products: mac.products }).success).toBe(false);
    // 메모리: ramOptionsGB 안의 값만, 오름차순, 모든 구성을 어느 모델이든 판다
    expect(GpuSchema.safeParse(products([{ ...mini, memoryGB: [16, 24, 32, 64] }])).success).toBe(false);
    expect(GpuSchema.safeParse(products([{ ...mini, memoryGB: [24, 16, 32] }])).success).toBe(false);
    expect(GpuSchema.safeParse(products([imac])).success).toBe(false);
    // 출처: 애플 사양 페이지(또는 그 아카이브 사본)이고 레코드 sources 에도 있어야 한다
    expect(GpuSchema.safeParse(products([{ ...mini, sources: ['https://en.wikipedia.org/wiki/Apple_M4'] }])).success).toBe(false);
    expect(GpuSchema.safeParse(products([{ ...mini, sources: ['https://support.apple.com/en-us/121556'] }])).success).toBe(false);
    const archived = 'https://web.archive.org/web/20260219042642/https://support.apple.com/en-us/122211';
    expect(GpuSchema.safeParse({ ...products([{ ...mini, sources: [spec, archived] }]), sources: [...mac.sources, archived] }).success).toBe(true);
    // 같은 모델 두 번 금지
    expect(GpuSchema.safeParse(products([mini, mini])).success).toBe(false);
  });

  it('per-memory-size bandwidth (10-20 — Apple M6): unified only, a listed size, once, below the chip value', () => {
    const spec = 'https://support.apple.com/en-us/128108';
    const m6 = {
      ...validGpu,
      id: 'apple-test',
      name: 'Apple Test',
      vendor: 'apple',
      kind: 'unified',
      vramGB: undefined,
      ramOptionsGB: [16, 24, 32],
      memBandwidthGBs: 170.6,
      effClass: 'apple',
      sources: [spec],
      products: [{ line: 'mac-mini', model: 'Mac mini (M6 or M5 Pro)', memoryGB: [16, 24, 32], sources: [spec] }],
    };
    const by = (list: unknown[]) => ({ ...m6, memBandwidthByRam: list });
    expect(GpuSchema.safeParse(by([{ ramGB: 16, memBandwidthGBs: 153.6 }])).success).toBe(true);
    expect(GpuSchema.safeParse(by([])).success).toBe(false);
    expect(GpuSchema.safeParse(by([{ ramGB: 48, memBandwidthGBs: 153.6 }])).success).toBe(false);
    expect(GpuSchema.safeParse(by([{ ramGB: 16, memBandwidthGBs: 153.6 }, { ramGB: 16, memBandwidthGBs: 150 }])).success).toBe(false);
    expect(GpuSchema.safeParse(by([{ ramGB: 16, memBandwidthGBs: 170.6 }])).success).toBe(false);
    expect(GpuSchema.safeParse({ ...validGpu, memBandwidthByRam: [{ ramGB: 16, memBandwidthGBs: 100 }] }).success).toBe(false);
  });

  it('per-memory-size GPU-usable memory (10-23 D117 — DGX Spark): unified only, every listed size once, below the size', () => {
    const spark = {
      ...validGpu,
      id: 'spark-test',
      vendor: 'nvidia-dgx',
      kind: 'unified',
      vramGB: undefined,
      ramOptionsGB: [64, 128],
      memBandwidthGBs: 273,
      effClass: 'dgx-spark',
    };
    const by = (list: unknown[]) => ({ ...spark, usableGBByRam: list });
    const both = [{ ramGB: 64, usableGB: 48.2 }, { ramGB: 128, usableGB: 116.9 }];
    expect(GpuSchema.safeParse(by(both)).success).toBe(true);
    expect(GpuSchema.safeParse(spark).success).toBe(true);
    expect(GpuSchema.safeParse(by([])).success).toBe(false);
    // 구성 하나만 — 구성마다 규칙이 갈리지 않게 전부 적는다
    expect(GpuSchema.safeParse(by([both[1]])).success).toBe(false);
    expect(GpuSchema.safeParse(by([...both, { ramGB: 96, usableGB: 80 }])).success).toBe(false);
    expect(GpuSchema.safeParse(by([...both, { ramGB: 64, usableGB: 40 }])).success).toBe(false);
    expect(GpuSchema.safeParse(by([both[0], { ramGB: 128, usableGB: 128 }])).success).toBe(false);
    expect(GpuSchema.safeParse({ ...validGpu, usableGBByRam: [{ ramGB: 16, usableGB: 10 }] }).success).toBe(false);
  });

  it('several units linked (10-23 D118 — DGX Spark cluster): unified only, direct ≤ max, https sources that are also record sources, no extra keys', () => {
    const doc = 'https://docs.nvidia.com/dgx/dgx-spark/spark-clustering.html';
    const spark = {
      ...validGpu,
      id: 'spark-test',
      vendor: 'nvidia-dgx',
      kind: 'unified',
      vramGB: undefined,
      ramOptionsGB: [64, 128],
      memBandwidthGBs: 273,
      effClass: 'dgx-spark',
      sources: [...validGpu.sources, doc],
    };
    const cluster = { maxNodes: 4, directMaxNodes: 3, linkGbps: 200, sources: [doc] };
    expect(GpuSchema.safeParse({ ...spark, cluster }).success).toBe(true);
    expect(GpuSchema.safeParse({ ...spark, cluster: { ...cluster, directMaxNodes: 5 } }).success).toBe(false);
    expect(GpuSchema.safeParse({ ...spark, cluster: { ...cluster, maxNodes: 1 } }).success).toBe(false);
    expect(GpuSchema.safeParse({ ...spark, cluster: { ...cluster, sources: ['http://example.com/x'] } }).success).toBe(false);
    expect(GpuSchema.safeParse({ ...spark, cluster: { ...cluster, sources: ['https://example.com/not-in-sources'] } }).success).toBe(false);
    expect(GpuSchema.safeParse({ ...spark, cluster: { ...cluster, nic: 'cx7' } }).success).toBe(false);
    expect(GpuSchema.safeParse({ ...validGpu, sources: [...validGpu.sources, doc], cluster }).success).toBe(false);
  });

  it('representative memory size (10-23 D120 — DGX Spark 128GB): unified only, one of ramOptionsGB', () => {
    const spark = {
      ...validGpu,
      id: 'spark-test',
      vendor: 'nvidia-dgx',
      kind: 'unified',
      vramGB: undefined,
      ramOptionsGB: [64, 128],
      memBandwidthGBs: 273,
      effClass: 'dgx-spark',
    };
    expect(GpuSchema.safeParse({ ...spark, primaryRamGB: 128 }).success).toBe(true);
    expect(GpuSchema.safeParse({ ...spark, primaryRamGB: 64 }).success).toBe(true);
    expect(GpuSchema.safeParse({ ...spark, primaryRamGB: 96 }).success).toBe(false);
    expect(GpuSchema.safeParse({ ...validGpu, primaryRamGB: 32 }).success).toBe(false);
    // 시드에서는 DGX Spark 만 (사용자 결정 — 맥·Strix Halo 는 최고 판정의 최소 구성 규칙 그대로)
    expect(loadSeed().gpus.filter((g) => g.primaryRamGB !== undefined).map((g) => [g.id, g.primaryRamGB])).toEqual([['nvidia-dgx-spark', 128]]);
  });

  it('every Apple chip in the seed names at least one Mac', () => {
    const apple = loadSeed().gpus.filter((g) => g.vendor === 'apple');
    expect(apple.length).toBeGreaterThan(0);
    for (const gpu of apple) expect(gpu.products?.length, gpu.id).toBeGreaterThan(0);
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
      addedAt: '2026-01-02',
      sources: ['https://example.com/model'],
    };
    expect(ModelSchema.safeParse(model).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, activeParamsB: 3 }).success).toBe(true);
  });

  it('addedAt: required, a real date, not before releasedAt (10-14 D72)', () => {
    const model = {
      id: 'test-dense',
      family: 'test',
      name: 'Test',
      hfId: 'test/test',
      paramsB: 8,
      arch: { layers: 32, kvHeads: 8, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 131072 },
      maxContext: 32768,
      license: 'Apache-2.0',
      moe: false,
      category: ['chat'],
      popularity: 3,
      releasedAt: '2026-10-07',
      addedAt: '2026-10-13',
      sources: ['https://example.com/model'],
    };
    expect(ModelSchema.safeParse(model).success).toBe(true);
    expect(ModelSchema.safeParse({ ...model, addedAt: '2026-10-07' }).success).toBe(true);
    expect(ModelSchema.safeParse({ ...model, addedAt: undefined }).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, addedAt: '2026-02-30' }).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, addedAt: '2026-10-13T00:00:00Z' }).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, addedAt: '2026-10-06' }).success).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-13-01')).toBe(false);
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
      addedAt: '2026-01-02',
      sources: ['https://example.com/model'],
    };
    expect(ModelSchema.safeParse(model).success).toBe(true);
    const arch = (over: Record<string, unknown>) => ({ ...model, arch: { ...model.arch, ...over } });
    expect(ModelSchema.safeParse(arch({ topK: undefined })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ topK: 128 })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ experts: 12.5 })).success).toBe(false);
    // arch.expertLayers (10-03 D63): 오름차순 층 번호 < layers, 전체 층보다 적게, MoE 만
    expect(ModelSchema.safeParse(arch({ expertLayers: [1, 3, 47] })).success).toBe(true);
    expect(ModelSchema.safeParse(arch({ expertLayers: [3, 1] })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ expertLayers: [1, 1] })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ expertLayers: [48] })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ expertLayers: Array.from({ length: 48 }, (_, i) => i) })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ expertLayers: [] })).success).toBe(false);
    expect(ModelSchema.safeParse(arch({ experts: undefined, topK: undefined, expertLayers: [1] })).success).toBe(false);
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

  it('model-quants offGpuGB ≥ 0 and mtpGB > 0 are optional (10-03 D62 — range checks live in validateAll)', () => {
    const row = {
      modelId: 'test-8b',
      quant: 'Q4_K_M',
      fileGB: 4.92,
      ggufRepo: 'org/test-GGUF',
      fileName: 'test-Q4_K_M.gguf',
      sources: ['https://huggingface.co/org/test-GGUF'],
    };
    expect(ModelQuantSchema.safeParse({ ...row, offGpuGB: 0 }).success).toBe(true);
    expect(ModelQuantSchema.safeParse({ ...row, offGpuGB: 0.3, mtpGB: 0.17 }).success).toBe(true);
    expect(ModelQuantSchema.safeParse({ ...row, offGpuGB: -0.1 }).success).toBe(false);
    expect(ModelQuantSchema.safeParse({ ...row, offGpuGB: 0.3, mtpGB: 0 }).success).toBe(false);
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
    addedAt: '2026-01-02',
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
