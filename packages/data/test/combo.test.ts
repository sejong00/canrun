/** 콤보 조립 (packages/data/src/combo.ts) — 기대값은 P1-2 계획 검토·구현 탐침값. */
import { describe, expect, it } from 'vitest';
import {
  adjacentCombos,
  alternatives,
  assessCombo,
  ctxMatrix,
  hardwareConfigs,
  maxCtxAtVerdict,
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
import { scenarioSeed } from './scenario-models';
import { loadSeed } from './seed';

// 이 파일은 상황별 기대값 스냅숏 — 고정 모델 집합 위에서 돈다(새 모델 추가에 흔들리지 않게, scenario-models.ts)
const seed = scenarioSeed(loadSeed());
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
  return alternatives({
    catalog: seed,
    gpu: gpu(gpuId),
    gpuHub: hub,
    configIndex,
    modelHub: modelHub(modelId),
    model: model(modelId),
    combo,
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
              : `${a.nCpuMoe}/${a.layers}`
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
    // 10-03 D62: GPU 경로 필요량은 그래픽카드에 올라가는 가중치(4.92 − 입력 임베딩 0.30) + KV 17.18 + 버퍼 1.7 (전엔 23.8)
    expect(cell(131072, 'f16').totalNeedGB).toBeCloseTo(23.5, 1);
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
    const b = vramBreakdown(combo.display, 'qwen3-14b');
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

  it('notes the off-GPU share on a dGPU full-GPU fit, and the MTP block where it was left out (10-03 D62)', () => {
    const g = gpu('rtx-4060');
    const llama = vramBreakdown(
      assessCombo(seed, g, hardwareConfigs(g, seed.gpus)[0]!, model('llama-3.1-8b')).baseline,
      'llama-3.1-8b',
    );
    expect(llama.note).toEqual({ fileGB: 4.92, offGpuGB: expect.closeTo(0.3, 6) as number });
    expect(llama.ram.weights).toBe(0);
    // 부분 오프로드: GPU 밖 몫 각주 없음(RAM 몫에 이미 들어 있다)
    const qwen14 = vramBreakdown(
      assessCombo(seed, g, hardwareConfigs(g, seed.gpus)[0]!, model('qwen3-14b')).display,
      'qwen3-14b',
    );
    expect(qwen14.note.offGpuGB).toBe(0);
    // cpu-moe(전문가 일부 RAM): MTP 는 GPU 몫에서 빠졌지만 RAM 몫(파일 − GPU 가중치)에는 들어 있다 → RAM 몫 기준 MTP 안내
    const g12 = gpu('rtx-3060-12gb');
    const q36Combo = assessCombo(seed, g12, hardwareConfigs(g12, seed.gpus)[0]!, model('qwen3.6-35b-a3b')).baseline;
    expect(q36Combo.result.mode).toBe('cpu-moe');
    const q36 = vramBreakdown(q36Combo, 'qwen3.6-35b-a3b');
    expect(q36.note).toMatchObject({ mtpGB: expect.closeTo(0.9, 6) as number, mtpLoadable: true });
    expect(q36.gpu.weights + q36.ram.weights).toBeCloseTo(22.29, 6);
    // EXAONE 4.5: MTP 블록은 있지만 llama.cpp(exaone4)가 늘 건너뛴다 — 켤 수 있다는 안내를 하지 않는다
    const g3090 = gpu('rtx-3090');
    const exaone = assessCombo(seed, g3090, hardwareConfigs(g3090, seed.gpus)[0]!, model('exaone-4.5-33b')).baseline;
    expect(exaone.result.mode).toBe('full-gpu');
    expect(vramBreakdown(exaone, 'exaone-4.5-33b').note).toMatchObject({
      offGpuGB: expect.closeTo(0.79, 6) as number,
      mtpGB: 0.34,
      mtpLoadable: false,
    });
    // 맥(통합 메모리)은 파일 전체 — 각주 없음
    const m4 = gpu('apple-m4');
    const mac = assessCombo(seed, m4, hardwareConfigs(m4, seed.gpus).at(-1)!, model('qwen3.6-35b-a3b')).baseline;
    expect(vramBreakdown(mac, 'qwen3.6-35b-a3b').note).toEqual({ fileGB: 22.29, offGpuGB: 0 });
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
    // 09-30 Gemma 4 12B KV 수정으로 12B 가 4060 에서 A — '더 작은 모델' 대안이 qwen3.5-9b 에서 gemma-4-12b 로
    // 10-01 D59: qwen3-14b 는 생각 모드 — 3060 12GB 로는 쾌적(30 tok/s)이 안 되어 GPU 대안이 5060 Ti 16GB 로
    expect(alts.map(label)).toEqual(['smaller-model:gemma-4-12b', 'lower-quant:Q2_K', 'gpu:rtx-5060-ti-16gb']);
    expect(alts[1]).toMatchObject({ kind: 'lower-quant', desperate: true });
  });

  it('F page: smaller model + RAM upgrade (rtx-4060 × gpt-oss-120b)', () => {
    expect(altsFor('rtx-4060', 'gpt-oss-120b').map(label)).toEqual([
      'smaller-model:qwen3.5-35b-a3b',
      'ram-upgrade:96',
    ]);
  });

  it('cpu-moe page carries the expert-offload setting (rtx-3060-12gb × qwen3-30b-a3b-2507)', () => {
    // 09-30 cpu-moe 보정으로 이 조합이 A — 대안이 "더 작은 모델·낮은 양자화" 에서 "더 큰 모델" 로
    // 10-01 D56: 대안 카드의 --n-cpu-moe 는 엔진 배치 하나(앞쪽 24/48층 전문가만 RAM)
    expect(altsFor('rtx-3060-12gb', 'qwen3-30b-a3b-2507').map(label)).toEqual([
      'larger-model:qwen3.5-35b-a3b',
      'cpu-moe:24/48',
    ]);
  });

  it('unified page prefers the next chip of the same vendor over a dGPU (apple-m4 × qwen3-14b)', () => {
    // 10-01 D59: 생각 모드 임계로 Q2_K 대안이 원활에 못 미쳐 빠지고, 다음 칩이 M4 Pro
    expect(altsFor('apple-m4', 'qwen3-14b').map(label)).toEqual(['smaller-model:gemma-3-12b', 'chip:apple-m4-pro']);
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
    // 10-01 D59: qwen3-32b 는 생각 모드 — 기준 양자화는 너무 느려 F, 제목은 Q2_K 의 겨우 가능
    expect(titleVerdict(combo('rtx-4060', 'qwen3-32b'))).toEqual({ kind: 'quant', verdict: 'B', quant: 'Q2_K' });
    // 10-01 D56: RAM 에는 CPU 쪽 전문가만 — 96GB 가 아니라 64GB 에서 들어간다
    expect(titleVerdict(combo('rtx-5060-ti-16gb', 'gpt-oss-120b'))).toEqual({ kind: 'ram', verdict: 'B', ramGB: 64 });
    expect(titleVerdict(combo('rtx-4060', 'llama-3.3-70b'))).toEqual({ kind: 'none', verdict: 'F' });
  });
});

describe('ctxMatrix planRow — 콤보 아일랜드 props (P1-3 결정 D28)', () => {
  it('셀마다 그 조건의 llama.cpp·Ollama 명령이 붙는다 (rtx-4060 × qwen3-14b, 16k·q8_0)', () => {
    const g = gpu('rtx-4060');
    const r = row('qwen3-14b', 'Q4_K_M');
    const matrix = ctxMatrix(g, hardwareConfigs(g, seed.gpus)[0]!, model('qwen3-14b'), r, { planRow: r });
    const cell = matrix.rows[matrix.ctxs.indexOf(16384)]![matrix.kvQuants.indexOf('q8_0')]!;
    expect(cell.plan?.llamaCpp?.command).toContain('-c 16384');
    expect(cell.plan?.llamaCpp?.command).toContain('--cache-type-k q8_0 --cache-type-v q8_0');
    expect(cell.plan?.ollama?.serve).toContain('OLLAMA_CONTEXT_LENGTH="16384"');
    expect(cell.plan?.ollama?.serve).toContain('$env:OLLAMA_KV_CACHE_TYPE="q8_0"');
    expect(cell.plan?.ollama?.replSet).toBe('/set parameter num_ctx 16384');
    // planRow 없이는 붙지 않는다 (기존 콤보 표 경로)
    const plain = ctxMatrix(g, hardwareConfigs(g, seed.gpus)[0]!, model('qwen3-14b'), r);
    expect(plain.rows[0]![0]!.plan).toBeUndefined();
  });
});
