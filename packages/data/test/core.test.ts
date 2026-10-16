/** 카탈로그 요약(lite) — 계산기 아일랜드 props (P1-3 결정 D27). */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assessCombo, hardwareConfigs, toCatalogLite } from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();
const lite = toCatalogLite(seed);

/** 문서용·출처 필드 — 브라우저로 나가면 안 된다 */
// hfId 는 10-01(D57)부터 브라우저로 간다 — 계산기 "목록에 없는 모델"이 HF 주소가 카탈로그 모델이면 그 카드로 안내 (공개 식별자, 문서 필드 아님)
// msrpUSD 는 10-03(D65)부터 브라우저로 간다 — 계산기 모델 모드의 GPU 행이 모델 허브 표처럼 "출시가"를 보인다 (공개 가격, 순위·예산에는 안 씀)
// hfDownloads30d·hfDownloadsAsOf 는 10-06(D68)부터 브라우저로 간다 — 계산기 "다운로드 많은 순" 정렬·카드 줄 (HF 공개 수치와 기준일)
const FORBIDDEN_KEYS = ['sources', 'note', 'attnOverrides', 'releasedAt', 'addedAt', 'launchYear', 'streetKRW', 'sourceUrl', 'hardwareDesc', 'backend'];

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

  it('keeps only joinable benchmarks (catalog gpu + a model-quants row with the same quant) and the join keys', () => {
    const rows = new Set(seed.modelQuants.map((r) => `${r.modelId}/${r.quant}`));
    const joinable = seed.benchmarks.filter((b) => b.gpuId !== undefined && rows.has(`${b.modelId}/${b.quant}`));
    expect(lite.benchmarks.length).toBe(joinable.length);
    // 표에만 나오는 실측(Q4_K_XL 등)이 실제로 있어서 걸러지는지 — 필터의 공회전 방지
    expect(seed.benchmarks.filter((b) => b.gpuId !== undefined).length).toBeGreaterThan(joinable.length);
    for (const b of lite.benchmarks) expect(Object.keys(b).sort()).toEqual(['ctx', 'gpuId', 'modelId', 'quant', 'tgTokS']);
  });

  it('leaks no documentation fields', () => {
    const keys = keysDeep(lite);
    for (const k of FORBIDDEN_KEYS) expect(keys.has(k), k).toBe(false);
  });

  it('carries the Hugging Face download count and its date for the calculator sort (D68)', () => {
    for (const model of seed.models) {
      const liteModel = lite.models.find((m) => m.id === model.id)!;
      expect(liteModel.hfDownloads30d, model.id).toBe(model.hfDownloads30d);
      expect(liteModel.hfDownloadsAsOf, model.id).toBe(model.hfDownloadsAsOf);
    }
  });

  it('omits undefined fields (Flight would serialise them as "$undefined")', () => {
    const json = JSON.stringify(lite);
    expect(json).not.toContain('undefined');
    expect(JSON.parse(json)).toEqual(lite);
  });

  // 예산 8 → 9 KiB (10-06 D68): 모델 43종 7,977B 에 다운로드 수·기준일 +305B — 계산기 HTML(Flight 인라인)에만 실리고 스크립트 예산 밖
  it('stays small: gzip ≤ 9 KiB and deterministic', () => {
    const a = JSON.stringify(lite);
    const b = JSON.stringify(toCatalogLite(seed));
    expect(a).toBe(b);
    expect(gzipSync(a).length).toBeLessThanOrEqual(9 * 1024);
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
