/** 카탈로그 요약(lite) — 계산기 아일랜드 props (P1-3 결정 D27). */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assessCombo, hardwareConfigs, toCatalogLite } from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();
const lite = toCatalogLite(seed);

/** 문서용·출처 필드 — 브라우저로 나가면 안 된다 */
// hfId 는 10-01(D57)부터 브라우저로 간다 — 계산기 "목록에 없는 모델"이 HF 주소가 카탈로그 모델이면 그 카드로 안내 (공개 식별자, 문서 필드 아님)
const FORBIDDEN_KEYS = ['sources', 'note', 'attnOverrides', 'releasedAt', 'launchYear', 'msrpUSD', 'streetKRW', 'sourceUrl', 'hardwareDesc', 'backend'];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe('toCatalogLite', () => {
  it('keeps every gpu, model, quant row and quant def (same id sets)', () => {
    expect(lite.gpus.map((g) => g.id)).toEqual(seed.gpus.map((g) => g.id));
    expect(lite.models.map((m) => m.id)).toEqual(seed.models.map((m) => m.id));
    expect(lite.modelQuants.length).toBe(seed.modelQuants.length);
    expect(lite.quantDefs.map((q) => q.id)).toEqual(seed.quantDefs.map((q) => q.id));
  });

  it('drops calibration benchmarks without a catalog gpu and keeps the join keys', () => {
    expect(lite.benchmarks.length).toBe(seed.benchmarks.filter((b) => b.gpuId !== undefined).length);
    for (const b of lite.benchmarks) expect(Object.keys(b).sort()).toEqual(['ctx', 'gpuId', 'modelId', 'quant', 'tgTokS']);
  });

  it('leaks no documentation fields', () => {
    const keys = keysDeep(lite);
    for (const k of FORBIDDEN_KEYS) expect(keys.has(k), k).toBe(false);
  });

  it('omits undefined fields (Flight would serialise them as "$undefined")', () => {
    const json = JSON.stringify(lite);
    expect(json).not.toContain('undefined');
    expect(JSON.parse(json)).toEqual(lite);
  });

  it('stays small: gzip ≤ 8 KiB and deterministic', () => {
    const a = JSON.stringify(lite);
    const b = JSON.stringify(toCatalogLite(seed));
    expect(a).toBe(b);
    expect(gzipSync(a).length).toBeLessThanOrEqual(8 * 1024);
  });

  it('is enough for assessCombo — same verdicts as the full catalog for every hub configuration', () => {
    let combos = 0;
    for (const gpu of seed.gpus) {
      const liteGpu = lite.gpus.find((g) => g.id === gpu.id)!;
      for (const config of hardwareConfigs(gpu, seed.gpus)) {
        for (const model of seed.models) {
          const liteModel = lite.models.find((m) => m.id === model.id)!;
          const full = assessCombo(seed, gpu, config, model);
          const viaLite = assessCombo(lite, liteGpu, config, liteModel);
          expect(viaLite.baseline.result.verdict).toBe(full.baseline.result.verdict);
          expect(viaLite.display.quant).toBe(full.display.quant);
          expect(viaLite.display.result.tgTokS).toEqual(full.display.result.tgTokS);
          expect(viaLite.display.result.confidence).toBe(full.display.result.confidence);
          expect(viaLite.ramHint?.ramGB).toBe(full.ramHint?.ramGB);
          combos += 1;
        }
      }
    }
    expect(combos).toBeGreaterThan(2000);
  });
});
