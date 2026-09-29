/** 콤보 조립 (packages/data/src/combo.ts) — 기대값은 P1-2 계획 검토·구현 탐침값. */
import { describe, expect, it } from 'vitest';
import {
  adjacentCombos,
  alternatives,
  assessCombo,
  ctxMatrix,
  hardwareConfigs,
  maxCtxAtVerdict,
  nCpuMoeMin,
  ppRange,
  summarizeGpu,
  summarizeModel,
  titleVerdict,
  twinGpus,
  vramBreakdown,
  type Alternative,
  type GpuHubData,
  type ModelHubData,
} from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();
const gpu = (id: string) => seed.gpus.find((g) => g.id === id)!;
const model = (id: string) => seed.models.find((m) => m.id === id)!;
const row = (modelId: string, quant: string) =>
  seed.modelQuants.find((r) => r.modelId === modelId && r.quant === quant)!;

const gpuHubs = new Map<string, GpuHubData>();
const gpuHub = (id: string) => {
  let hub = gpuHubs.get(id);
  if (!hub) {
    hub = summarizeGpu(seed, gpu(id));
    gpuHubs.set(id, hub);
  }
  return hub;
};
const modelHubs = new Map<string, ModelHubData>();
const modelHub = (id: string) => {
  let hub = modelHubs.get(id);
  if (!hub) {
    hub = summarizeModel(seed, model(id));
    modelHubs.set(id, hub);
  }
  return hub;
};

function altsFor(gpuId: string, modelId: string, configIndex = 0): Alternative[] {
  const hub = gpuHub(gpuId);
  const combo = hub.rows.find((r) => r.model.id === modelId)!.combos[configIndex]!;
  const display = combo.display;
  const nMin =
    display.fits && display.result.mode === 'cpu-moe'
      ? nCpuMoeMin(hub.configs[configIndex]!, model(modelId), row(modelId, display.quant), {
          ctx: 8192,
          kvQuant: 'f16',
        })
      : undefined;
  return alternatives({
    catalog: seed,
    gpu: gpu(gpuId),
    gpuHub: hub,
    configIndex,
    modelHub: modelHub(modelId),
    model: model(modelId),
    combo,
    ...(nMin !== undefined ? { nCpuMoeMin: nMin } : {}),
  });
}

const label = (a: Alternative) =>
  `${a.kind}:${
    'model' in a
      ? a.model.id
      : 'q' in a
        ? a.q.quant
        : 'gpu' in a
          ? a.gpu.id
          : 'option' in a
            ? a.option.gpu.id
            : 'ramGB' in a
              ? a.ramGB
              : `${a.nCpuMoe}/${a.nCpuMoeMin}`
  }`;

describe('ctxMatrix (docs/04 §4 ③) — rtx-4060 × llama-3.1-8b Q4_K_M', () => {
  const g = gpu('rtx-4060');
  const matrix = ctxMatrix(g, hardwareConfigs(g, seed.gpus)[0]!, model('llama-3.1-8b'), row('llama-3.1-8b', 'Q4_K_M'));
  const cell = (ctx: number, kv: 'f16' | 'q8_0' | 'q4_0') =>
    matrix.rows[matrix.ctxs.indexOf(ctx)]![matrix.kvQuants.indexOf(kv)]!;

  it('has ctx columns up to the model maximum and KV f16/q8_0/q4_0', () => {
    expect(matrix.ctxs).toEqual([4096, 8192, 16384, 32768, 65536, 131072]);
    expect(matrix.kvQuants).toEqual(['f16', 'q8_0', 'q4_0']);
  });

  it('8k f16 equals the baseline estimate; 16k splits on f16 but stays full-GPU on q8_0', () => {
    expect(cell(8192, 'f16').result.tgTokS.est).toBeCloseTo(31.77, 2);
    // 헤드라인이 실측 조인이면 같은 조건(8k·f16)의 셀은 그 실측을 쓴다 — 한 페이지에 두 tok/s 가 없도록
    const measured = gpuHub('rtx-4060').rows.find((r) => r.model.id === 'llama-3.1-8b')!.combos[0]!.display;
    if (measured.result.confidence === 'measured') {
      const m = ctxMatrix(g, hardwareConfigs(g, seed.gpus)[0]!, model('llama-3.1-8b'), measured);
      const at8k = m.rows[m.ctxs.indexOf(8192)]![0]!;
      expect(at8k.result).toBe(measured.result);
      expect(m.rows[m.ctxs.indexOf(16384)]![0]!.result.confidence).not.toBe('measured');
    }
    expect(cell(16384, 'f16')).toMatchObject({ mode: 'partial-offload', verdict: 'A' });
    expect(cell(16384, 'f16').result.tgTokS.est).toBeCloseTo(22.27, 2);
    expect(cell(16384, 'q8_0')).toMatchObject({ mode: 'full-gpu', verdict: 'S' });
    expect(cell(16384, 'q8_0').result.tgTokS.est).toBeCloseTo(31.37, 2);
    expect(cell(16384, 'f16').kvGB).toBeCloseTo(2.147, 3);
    expect(cell(16384, 'q8_0').kvGB).toBeCloseTo(1.149, 3);
    expect(cell(65536, 'f16')).toMatchObject({ mode: 'cpu-only', verdict: 'B' });
    expect(cell(65536, 'f16').result.tgTokS.est).toBeCloseTo(3.32, 2);
  });

  it('reports the need even when a cell does not fit, and the max ctx per KV type', () => {
    expect(cell(131072, 'f16').totalNeedGB).toBeCloseTo(23.8, 1);
    // CPU 경로 셀은 엔진이 가중치+KV 만 비교하므로 표시 필요량도 버퍼를 뺀다 (docs/02 §2.4 ④)
    expect(cell(65536, 'f16').mode).toBe('cpu-only');
    expect(cell(65536, 'f16').needGB).toBeLessThan(cell(65536, 'f16').totalNeedGB);
    expect(cell(8192, 'q8_0').needGB).toBe(cell(8192, 'q8_0').totalNeedGB);
    expect(maxCtxAtVerdict(matrix, 'f16', 'S')).toBe(8192);
    expect(maxCtxAtVerdict(matrix, 'q8_0', 'S')).toBe(16384);
    // A 기준: 4k·8k 는 S(≥A), 16k 는 A, 32k 는 B → 16k
    expect(maxCtxAtVerdict(matrix, 'f16', 'A')).toBe(16384);
  });
});

describe('vramBreakdown / ppRange', () => {
  it('splits GPU and RAM shares for partial offload (rtx-4060 × qwen3-14b)', () => {
    const g = gpu('rtx-4060');
    const combo = assessCombo(seed, g, hardwareConfigs(g, seed.gpus)[0]!, model('qwen3-14b'));
    const b = vramBreakdown(combo.display);
    expect(b.gpu.weights).toBeCloseTo(5.483, 2);
    expect(b.gpu.kv).toBeCloseTo(1.342, 2);
    expect(b.gpu.buffer).toBeCloseTo(0.575, 3);
    expect(b.gpu.osReserve).toBe(0.6);
    expect(b.gpu.total).toBeCloseTo(8.0, 3);
    expect(b.gpu.usable).toBe(7.4);
    expect(b.ram.weights).toBeCloseTo(3.517, 2);
    expect(b.ram.usable).toBe(28);
    // pp 는 full-gpu 에서만 (D13)
    expect(ppRange(combo.display)).toBeUndefined();
  });

  it('pp is a rough ±40% range for full-GPU fits (rtx-4060 × llama-3.1-8b)', () => {
    const g = gpu('rtx-4060');
    const combo = assessCombo(seed, g, hardwareConfigs(g, seed.gpus)[0]!, model('llama-3.1-8b'));
    expect(ppRange(combo.display)).toEqual({ est: 2114, low: 2114 * 0.6, high: 2114 * 1.4, band: 0.4 });
  });
});

describe('alternatives (docs/04 §4 ⑥, D4)', () => {
  it('S page: larger model that still runs well; no cheaper-GPU card (rtx-4060 × llama-3.1-8b)', () => {
    expect(altsFor('rtx-4060', 'llama-3.1-8b').map(label)).toEqual(['larger-model:qwen3.5-35b-a3b']);
  });

  it('B partial page: smaller model, desperate quant flagged, S GPU (rtx-4060 × qwen3-14b)', () => {
    const alts = altsFor('rtx-4060', 'qwen3-14b');
    expect(alts.map(label)).toEqual(['smaller-model:qwen3.5-9b', 'lower-quant:Q2_K', 'gpu:rtx-3060-12gb']);
    expect(alts[1]).toMatchObject({ kind: 'lower-quant', desperate: true });
  });

  it('F page: smaller model + RAM upgrade (rtx-4060 × gpt-oss-120b)', () => {
    expect(altsFor('rtx-4060', 'gpt-oss-120b').map(label)).toEqual([
      'smaller-model:qwen3.5-35b-a3b',
      'ram-upgrade:96',
    ]);
  });

  it('cpu-moe page carries the expert-offload setting (rtx-3060-12gb × qwen3-30b-a3b-2507)', () => {
    expect(altsFor('rtx-3060-12gb', 'qwen3-30b-a3b-2507').map(label)).toEqual([
      'smaller-model:qwen3-14b',
      'lower-quant:IQ4_XS',
      'cpu-moe:48/24',
    ]);
  });

  it('unified page prefers the next chip of the same vendor over a dGPU (apple-m4 × qwen3-14b)', () => {
    expect(altsFor('apple-m4', 'qwen3-14b').map(label)).toEqual([
      'smaller-model:gemma-3-12b',
      'lower-quant:Q2_K',
      'chip:apple-m5',
    ]);
  });

  it('CPU profile falls back to a faster model at the same verdict', () => {
    expect(altsFor('cpu-ddr5-5600-2ch', 'qwen3-8b', 1).map(label)).toEqual(['faster-model:qwen3.5-35b-a3b']);
  });

  it('never exceeds 3 and never repeats a kind (whole catalog, primary config)', () => {
    for (const g of seed.gpus) {
      const hub = gpuHub(g.id);
      for (const r of hub.rows) {
        const alts = alternatives({
          catalog: seed,
          gpu: g,
          gpuHub: hub,
          configIndex: hub.primaryIndex,
          modelHub: modelHub(r.model.id),
          model: r.model,
          combo: r.combos[hub.primaryIndex]!,
        });
        expect(alts.length).toBeLessThanOrEqual(3);
        expect(new Set(alts.map((a) => a.kind)).size).toBe(alts.length);
      }
    }
  });
});

describe('adjacentCombos (docs/04 §2 ④, D9)', () => {
  const open = { ...seed.publish, currentBatch: 1 };

  it('published pages pick neighbours from the published pool only', () => {
    const adj = adjacentCombos(seed, open, gpu('rtx-4060'), model('llama-3.1-8b'));
    expect(adj.restricted).toBe(true);
    expect(adj.models.map((m) => m.id)).toEqual(['gemma-3-12b', 'qwen3-14b']);
    expect(adj.gpus.map((g) => g.id)).toEqual(['rtx-3060-12gb', 'rtx-4070']);
    const big = adjacentCombos(seed, open, gpu('rtx-5090'), model('gpt-oss-120b'));
    expect(big.models.map((m) => m.id)).toEqual(['qwen3-30b-a3b-2507', 'gpt-oss-20b']);
    expect(big.gpus.map((g) => g.id)).toEqual(['rtx-4090', 'rtx-3090']);
  });

  it('same-kind GPUs come first (apple-m4 page lists apple-m4-pro before any dGPU)', () => {
    const adj = adjacentCombos(seed, open, gpu('apple-m4'), model('gemma-3-12b'));
    expect(adj.gpus[0]!.id).toBe('apple-m4-pro');
  });

  it('unpublished pages use the whole catalogue', () => {
    const adj = adjacentCombos(seed, seed.publish, gpu('rtx-4060'), model('llama-3.3-70b'));
    expect(adj.restricted).toBe(false);
    expect(adj.models.map((m) => m.id)).toEqual(['qwen3.5-35b-a3b', 'solar-open-100b']);
    expect(adj.gpus.map((g) => g.id)).toEqual(['rtx-4060-ti-8gb', 'rtx-3050-8gb']);
  });

  it('every published combo gets 2 + 2 neighbours from the published pool', () => {
    for (const entry of open.batches) {
      for (const gpuId of entry.gpuIds) {
        for (const modelId of entry.modelIds) {
          const adj = adjacentCombos(seed, open, gpu(gpuId), model(modelId));
          expect(adj.models, `${gpuId}/${modelId}`).toHaveLength(2);
          expect(adj.gpus, `${gpuId}/${modelId}`).toHaveLength(2);
        }
      }
    }
  });
});

describe('twinGpus (D22) / titleVerdict (D14)', () => {
  it('finds the memory-identical siblings (7 groups incl. one triple)', () => {
    expect(twinGpus(gpu('rtx-4090'), seed.gpus).map((g) => g.id)).toEqual(['rtx-3090-ti']);
    expect(twinGpus(gpu('rx-9070'), seed.gpus).map((g) => g.id)).toEqual(['rx-9070-xt']);
    expect(twinGpus(gpu('rtx-5060'), seed.gpus).map((g) => g.id)).toEqual(['rtx-3070', 'rtx-5060-ti-8gb']);
    expect(twinGpus(gpu('rtx-4060'), seed.gpus)).toEqual([]);
    const groups = new Set(
      seed.gpus.filter((g) => twinGpus(g, seed.gpus).length > 0).map((g) => [g.id, ...twinGpus(g, seed.gpus).map((t) => t.id)].sort().join(',')),
    );
    expect(groups.size).toBe(7);
  });

  it('title verdict follows baseline → recommended quant → RAM hint → F', () => {
    const combo = (gpuId: string, modelId: string) => gpuHub(gpuId).rows.find((r) => r.model.id === modelId)!.combos[0]!;
    expect(titleVerdict(combo('rtx-4060', 'llama-3.1-8b'))).toEqual({ kind: 'baseline', verdict: 'S' });
    expect(titleVerdict(combo('rtx-4060', 'qwen3-32b'))).toEqual({ kind: 'baseline', verdict: 'B' });
    expect(titleVerdict(combo('rtx-5060-ti-16gb', 'gpt-oss-120b'))).toEqual({ kind: 'ram', verdict: 'B', ramGB: 96 });
    expect(titleVerdict(combo('rtx-4060', 'llama-3.3-70b'))).toEqual({ kind: 'none', verdict: 'F' });
  });
});
