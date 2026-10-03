/**
 * 계산기 모델 모드 (10-03 D65) — 브라우저 카탈로그(lite)로 조립한 GPU 행이 모델 허브 표(`summarizeModel`)와 같고,
 * 종류·예산·판정 필터와 정렬, 컨텍스트 클램프, 불러온 모델(이론 추정), "내 구성" 행이 규칙대로 동작한다.
 */
import { HUB_POLICY, summarizeModel, toCatalogLite, verdictRank } from '@canrun/data/client';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../../packages/data/test/seed';
import { assembleResults } from '../lib/calc/run';
import { assembleModelRows, filterGpuRows, myConfigRow, sortGpuRows, type ModelRunResult } from '../lib/calc/run-model';
import { defaultState, hwTypeOf, type CalcState } from '../lib/calc/state';

const seed = loadSeed();
const catalog = toCatalogLite(seed);
const modelState = (focus: string, extra: Partial<CalcState> = {}): CalcState => ({ ...defaultState(), mode: 'model', focus, ...extra });
const run = (focus: string, extra: Partial<CalcState> = {}): ModelRunResult => assembleModelRows(catalog, modelState(focus, extra))!;
const noFilter = { type: [], gsort: 'verdict' } as const;

describe('assembleModelRows — parity with the model hub table (8k · f16)', () => {
  it('every catalog model: same GPU order, config RAM, verdict, display quant, speed band, label and cheapest as summarizeModel', () => {
    let rows = 0;
    for (const model of seed.models) {
      const hub = summarizeModel(seed, model);
      const r = run(model.id);
      expect(r.external).toBe(false);
      expect(r.all.map((x) => x.gpu.id), model.id).toEqual(hub.gpuRows.map((x) => x.gpu.id));
      r.all.forEach((row, i) => {
        const h = hub.gpuRows[i]!;
        expect(row.combo.ramGB).toBe(h.combo.ramGB);
        expect(row.combo.baseline.result.verdict).toBe(h.combo.baseline.result.verdict);
        expect(row.combo.display.quant).toBe(h.combo.display.quant);
        expect(row.combo.display.result.tgTokS).toEqual(h.combo.display.result.tgTokS);
        expect(row.combo.display.result.confidence).toBe(h.combo.display.result.confidence);
        // 기준 조건에서는 콤보 페이지 구성과 같다 — 라벨 부기 없음
        expect(row.hubConfig).toBeUndefined();
        rows += 1;
      });
      expect(r.cheapest.great?.gpu.id).toBe(hub.cheapest.great?.gpu.id);
      expect(r.cheapest.well?.gpu.id).toBe(hub.cheapest.well?.gpu.id);
    }
    expect(rows).toBe(seed.models.length * seed.gpus.length);
  });

  it('no target → undefined (empty state); an unknown id is no target either', () => {
    const empty: CalcState = { ...defaultState(), mode: 'model' };
    expect(assembleModelRows(catalog, empty)).toBeUndefined();
    expect(assembleModelRows(catalog, modelState('ghost'))).toBeUndefined();
  });

  it('counts and the type of every row', () => {
    const r = run('qwen3-14b');
    const sum = r.counts.S + r.counts.A + r.counts.B + r.counts.F;
    expect(sum).toBe(seed.gpus.length);
    for (const row of r.all) expect(row.type).toBe(hwTypeOf(row.gpu));
    expect(r.all.filter((x) => x.type === 'laptop')).toHaveLength(seed.gpus.filter((g) => g.kind === 'dgpu' && g.form === 'laptop').length);
  });
});

describe('assembleModelRows — conditions', () => {
  it('32k · q8_0 never joins measured points (D33) — checked on a model that has them at 8k', () => {
    const at8k = run('llama-3.1-8b');
    expect(at8k.all.some((x) => x.combo.display.result.confidence === 'measured')).toBe(true);
    const at32k = run('llama-3.1-8b', { ctx: 32768, kv: 'q8_0' });
    expect(at32k.all.some((x) => x.combo.display.result.confidence === 'measured')).toBe(false);
    expect(at32k.ctx).toBe(32768);
    expect(at32k.clamped).toBe(false);
  });

  it('clamps the context to the model maximum', () => {
    const model = seed.models.find((m) => m.maxContext < 262144)!;
    const r = run(model.id, { ctx: 262144 });
    expect(r.ctx).toBe(model.maxContext);
    expect(r.clamped).toBe(true);
  });

  it('unified / CPU rows name the combo-page RAM when the current conditions pick another config', () => {
    let labelled = 0;
    for (const model of seed.models) {
      const r = run(model.id, { ctx: 131072, kv: 'f16' });
      for (const row of r.all) {
        if (row.gpu.kind === 'dgpu') expect(row.hubConfig).toBeUndefined();
        if (row.hubConfig) {
          labelled += 1;
          expect(row.hubConfig.ramGB).not.toBe(row.combo.ramGB);
          expect(row.hubConfig.ramGB).toBe(summarizeModel(seed, seed.models.find((m) => m.id === model.id)!).gpuRows.find((x) => x.gpu.id === row.gpu.id)!.combo.ramGB);
        }
      }
    }
    // 긴 컨텍스트는 더 큰 RAM 구성을 고르게 만든다 — 적어도 한 번은 라벨이 붙는다
    expect(labelled).toBeGreaterThan(0);
  });

  it('a loaded (HF) model: every row theoretical, verdicts equal the catalog twin estimates, no combo pages', () => {
    const base = seed.models.find((m) => m.id === 'qwen3-8b')!;
    const rows = seed.modelQuants.filter((r) => r.modelId === 'qwen3-8b').map((r) => ({ ...r, modelId: 'hf-qwen3-8b' }));
    const model = { ...base, id: 'hf-qwen3-8b', name: 'Qwen3 8B (HF)' };
    const r = assembleModelRows(catalog, modelState('llama-3.1-8b'), { model, rows })!;
    // 불러온 모델이 있으면 그것이 대상 (m 보다 우선)
    expect(r.model.id).toBe('hf-qwen3-8b');
    expect(r.external).toBe(true);
    expect(r.all.every((x) => x.combo.display.result.confidence === 'theoretical')).toBe(true);
    expect(r.all.every((x) => x.hubConfig === undefined)).toBe(true);
    const twin = run('qwen3-8b');
    for (const row of r.all) {
      const t = twin.all.find((x) => x.gpu.id === row.gpu.id)!;
      expect(row.combo.baseline.result.verdict, row.gpu.id).toBe(t.combo.baseline.estimate.verdict);
    }
  });
});

describe('filterGpuRows / sortGpuRows', () => {
  const r = run('qwen3-14b');

  it('no filter = every row in hub order', () => {
    const view = filterGpuRows(r, noFilter);
    expect(view.rows.map((x) => x.gpu.id)).toEqual(r.all.map((x) => x.gpu.id));
    expect(view.hiddenUnpriced).toBe(0);
  });

  it('type: laptop only / several types', () => {
    const laptops = filterGpuRows(r, { ...noFilter, type: ['laptop'] }).rows;
    expect(laptops.length).toBeGreaterThan(0);
    expect(laptops.every((x) => x.gpu.kind === 'dgpu' && x.gpu.form === 'laptop')).toBe(true);
    const macCpu = filterGpuRows(r, { ...noFilter, type: ['unified', 'cpu'] }).rows;
    expect(macCpu.every((x) => x.gpu.kind !== 'dgpu')).toBe(true);
    expect(macCpu).toHaveLength(seed.gpus.filter((g) => g.kind !== 'dgpu').length);
  });

  it('budget: only dGPU street prices with a date, at or under the cap; the rest are counted as hidden', () => {
    const view = filterGpuRows(r, { ...noFilter, budget: 500 });
    expect(view.rows.length).toBeGreaterThan(0);
    for (const row of view.rows) {
      expect(row.gpu.kind).toBe('dgpu');
      expect(row.gpu.priceAsOf).toBeDefined();
      expect(row.street!.usd).toBeLessThanOrEqual(500);
    }
    const unpriced = r.all.filter((x) => !(x.gpu.kind === 'dgpu' && x.gpu.streetUSD !== undefined && x.gpu.priceAsOf)).length;
    expect(view.hiddenUnpriced).toBe(unpriced);
    // MSRP 만 있는 카드는 예산 안이어도 빠진다 (docs/01 §3)
    expect(view.rows.some((x) => x.gpu.streetUSD === undefined)).toBe(false);
    // 종류 필터와 함께면 숨김 수도 그 범위 안에서 센다
    expect(filterGpuRows(r, { ...noFilter, type: ['laptop'], budget: 500 })).toEqual({ rows: [], hiddenUnpriced: r.all.filter((x) => x.type === 'laptop').length });
  });

  it('min verdict: A keeps only S and A', () => {
    const rows = filterGpuRows(r, { ...noFilter, min: 'A' }).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => verdictRank(x.combo.baseline.result.verdict) >= verdictRank('A'))).toBe(true);
    expect(rows).toHaveLength(r.counts.S + r.counts.A);
  });

  it('price: street prices ascending, then the unpriced rows in hub order', () => {
    const rows = sortGpuRows(r.all, 'price');
    const priced = rows.filter((x) => x.street !== undefined);
    expect(priced.map((x) => x.street!.usd)).toEqual([...priced.map((x) => x.street!.usd)].sort((a, b) => a - b));
    expect(rows.slice(0, priced.length)).toEqual(priced);
    const rest = rows.slice(priced.length);
    expect(rest.map((x) => x.gpu.id)).toEqual(r.all.filter((x) => x.street === undefined).map((x) => x.gpu.id));
  });

  it('speed: estimated tok/s descending, rows that do not fit last', () => {
    const rows = sortGpuRows(r.all, 'speed');
    const tg = rows.map((x) => (x.combo.display.fReason === 'no-fit' ? -1 : x.combo.display.result.tgTokS.est));
    expect(tg).toEqual([...tg].sort((a, b) => b - a));
    expect(rows).toHaveLength(r.all.length);
  });
});

describe('myConfigRow ("내 구성" — 하드웨어 모드에서 넣은 구성)', () => {
  it('equals the hardware-mode card for the same model (user RAM / OS / DDR / GPU count)', () => {
    const state = modelState('qwen3-14b', { hardware: { kind: 'catalog', gpuId: 'rtx-4060' }, ramGB: 16, os: 'linux', ddr: 'ddr4-3200', ctx: 16384 });
    const mine = myConfigRow(catalog, state)!;
    const card = assembleResults(catalog, { ...state, mode: 'hardware' })!.all.find((c) => c.model.id === 'qwen3-14b')!;
    expect(mine.hardware.ramGB).toBe(16);
    expect(mine.ctx).toBe(16384);
    expect(mine.combo.baseline.result.verdict).toBe(card.combo.baseline.result.verdict);
    expect(mine.combo.display.result.tgTokS).toEqual(card.combo.display.result.tgTokS);
    expect(mine.combo.ramHint?.ramGB).toBe(card.combo.ramHint?.ramGB);
  });

  it('custom and multi-GPU setups are theoretical; no hardware or no target → no row', () => {
    const custom = myConfigRow(catalog, modelState('qwen3-14b', { hardware: { kind: 'custom', custom: { kind: 'dgpu', effClass: 'nvidia', vramGB: 16, bandwidthGBs: 448 } } }))!;
    expect(custom.combo.display.result.confidence).toBe('theoretical');
    const multi = myConfigRow(catalog, modelState('llama-3.3-70b', { hardware: { kind: 'catalog', gpuId: 'rtx-3090' }, gpus: 2 }))!;
    expect(multi.hardware.gpuCount).toBe(2);
    expect(multi.combo.display.result.confidence).toBe('theoretical');
    expect(myConfigRow(catalog, modelState('qwen3-14b'))).toBeUndefined();
    expect(myConfigRow(catalog, { ...defaultState(), mode: 'model', hardware: { kind: 'catalog', gpuId: 'rtx-4060' } })).toBeUndefined();
  });

  it('at hub assumptions the "내 구성" row equals the list row of the same GPU', () => {
    const state = modelState('qwen3-14b', { hardware: { kind: 'catalog', gpuId: 'rtx-5060-ti-16gb' } });
    const mine = myConfigRow(catalog, state)!;
    const row = assembleModelRows(catalog, state)!.all.find((x) => x.gpu.id === 'rtx-5060-ti-16gb')!;
    expect(mine.combo.baseline.result.verdict).toBe(row.combo.baseline.result.verdict);
    expect(mine.combo.display.result.tgTokS).toEqual(row.combo.display.result.tgTokS);
    expect(HUB_POLICY.referenceCtx).toBe(mine.ctx);
  });
});
