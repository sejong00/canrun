/** 콤보 조립 (packages/data/src/combo.ts) — 기대값은 P1-2 계획 검토·구현 탐침값. */
import { describe, expect, it } from 'vitest';
import {
  adjacentCombos,
  alternatives,
  assessCombo,
  commandPlan,
  ctxMatrix,
  hardwareConfigs,
  HUB_POLICY,
  maxCtxAtVerdict,
  ppRange,
  ramSensitive,
  ramSteps,
  ramVerdictChanges,
  summarizeGpu,
  summarizeModel,
  titleVerdict,
  twinGpus,
  verdictRank,
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
    // 기준값 154 × 15.1 TFLOPS(7B Q4_0 상당)를 8.03B 로 나눈 값 — 모델 크기 반영(10-16 D91, 전에는 모든 모델 2114)
    const est = (154 * 15.1) / (0.05 + 0.95 * (8.03 / 6.74));
    expect(ppRange(combo.display)).toEqual({ est: expect.closeTo(est, 6), low: expect.closeTo(est * 0.6, 6), high: expect.closeTo(est * 1.4, 6), band: 0.4 });
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
    // 10-01 D59: 생각 모드 임계로 Q2_K 대안이 원활에 못 미쳐 빠졌다가, 10-15 D83(apple dense 0.60 → 0.76)에
    // Q2_K 가 원활(생각 모드 기준 12 tok/s 이상)에 들어 다시 들어온다. 다음 칩은 여전히 dGPU 가 아니다 —
    // 10-20 M6(170.6GB/s) 추가로 M4 Pro 대신 대역폭이 바로 위인 M6 가 판정이 오르는 첫 칩이 됐다(M5 153.6 은 판정이 같다)
    expect(altsFor('apple-m4', 'qwen3-14b').map(label)).toEqual(['smaller-model:gemma-3-12b', 'lower-quant:Q2_K', 'chip:apple-m6']);
  });

  it('CPU profile falls back to a faster model at the same verdict', () => {
    expect(altsFor('cpu-ddr5-5600-2ch', 'qwen3-8b', 1).map(label)).toEqual(['faster-model:qwen3.5-35b-a3b']);
  });

  it('always-theoretical structures — value experts (MoVA), hyper-connections and compressed attention — are model alternatives like any other model (10-23 D121 사용자 결정 ‘추천에도 넣기’)', () => {
    // D113·D115·D116 의 임시 기본값(후보에서 빼기)을 없앴다. 고정 집합에 한 모델씩 더하면 그 모델이 '더 큰·더 작은·더 빠른 모델' 카드로 나오는 구성이
    // 실제로 있고(빈 검사가 아니다), 카드는 그 모델의 이론 추정 라벨을 그대로 실는다. 그 모델 카드가 없는 구성의 대안은 더하기 전과 같다
    const full = loadSeed();
    const modelAlt = (a: Alternative) =>
      a.kind === 'larger-model' || a.kind === 'smaller-model' || a.kind === 'faster-model' ? a.model.id : undefined;
    const cases = [
      ['k2-horizon-mova-36b-a4b', ['rtx-4090', 'rtx-3090', 'rtx-5060-ti-16gb', 'apple-m4-pro']],
      ['deepseek-v4-flash-0731', ['apple-m3-ultra', 'apple-m5-ultra', 'apple-m2-ultra', 'rtx-5090']],
      ['glm-5.3-flash', ['apple-m3-ultra', 'apple-m5-ultra', 'apple-m2-ultra', 'rtx-5090']],
    ] as const;
    for (const [addedId, gpuIds] of cases) {
      const added = full.models.find((m) => m.id === addedId)!;
      expect(added.arch.valueExperts !== undefined || added.arch.mhc === true || added.arch.attnType === 'compressed', addedId).toBe(true);
      const withAdded = {
        ...seed,
        models: [...seed.models, added],
        modelQuants: [...seed.modelQuants, ...full.modelQuants.filter((r) => r.modelId === addedId)],
      };
      let offered = 0;
      for (const gpuId of gpuIds) {
        const g = gpu(gpuId);
        const hubWith = summarizeGpu(withAdded, g);
        const hubWithout = gpuHub(gpuId);
        hubWith.configs.forEach((_, ci) => {
          for (const r of hubWithout.rows) {
            const args = { catalog: seed, gpu: g, configIndex: ci, modelHub: modelHub(r.model.id), model: r.model };
            const withAlts = alternatives({ ...args, catalog: withAdded, gpuHub: hubWith, combo: hubWith.rows.find((x) => x.model.id === r.model.id)!.combos[ci]! });
            const withoutAlts = alternatives({ ...args, gpuHub: hubWithout, combo: r.combos[ci]! });
            const card = withAlts.find((a) => modelAlt(a) === addedId);
            if (card === undefined) {
              expect(withAlts.map(label), `${addedId} ${gpuId}#${ci}/${r.model.id}`).toEqual(withoutAlts.map(label));
              continue;
            }
            offered += 1;
            // 카드는 그 모델의 판정·라벨 그대로(늘 이론 추정), 나머지 카드는 그대로
            expect('combo' in card && card.combo.display.result.confidence, `${addedId} ${gpuId}#${ci}/${r.model.id}`).toBe('theoretical');
            expect(withAlts.filter((a) => modelAlt(a) === undefined).map(label)).toEqual(withoutAlts.filter((a) => modelAlt(a) === undefined).map(label));
          }
        });
      }
      expect(offered, addedId).toBeGreaterThan(0);
    }
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
    // 배치 1 만 열린 상태 — rtx-4060/llama-3.3-70b 는 배치 2 (10-29 D129 개방 전)
    const adj = adjacentCombos(seed, { ...seed.publish, currentBatch: 1 }, gpu('rtx-4060'), model('llama-3.3-70b'));
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
  it('finds the memory-identical siblings (8 groups incl. one triple)', () => {
    expect(twinGpus(gpu('rtx-4090'), seed.gpus).map((g) => g.id)).toEqual(['rtx-3090-ti']);
    // 10-24 D123 — RTX PRO 6000 Blackwell 의 300W Max-Q 판: 96GB·1792GB/s·nvidia 가 같아 생성 속도 추정이 같고 pp(FP16 110 vs 126)만 다르다
    expect(twinGpus(gpu('rtx-pro-6000-blackwell'), seed.gpus).map((g) => g.id)).toEqual(['rtx-pro-6000-blackwell-max-q']);
    expect(twinGpus(gpu('rx-9070'), seed.gpus).map((g) => g.id)).toEqual(['rx-9070-xt']);
    expect(twinGpus(gpu('rtx-5060'), seed.gpus).map((g) => g.id)).toEqual(['rtx-3070', 'rtx-5060-ti-8gb']);
    expect(twinGpus(gpu('rtx-4060'), seed.gpus)).toEqual([]);
    // 10-20 M6: 16GB 는 M5 와 같은 153.6 이지만 24·32GB 가 170.6 이라 쌍둥이가 아니다 — 구성별 대역폭까지 같아야 쌍둥이
    expect(twinGpus(gpu('apple-m6'), seed.gpus)).toEqual([]);
    const m6 = gpu('apple-m6');
    expect(twinGpus(m6, [...seed.gpus, { ...m6, id: 'm6-copy' }]).map((g) => g.id)).toEqual(['m6-copy']);
    expect(twinGpus(m6, [...seed.gpus, { ...m6, id: 'm6-flat', memBandwidthByRam: undefined }])).toEqual([]);
    const groups = new Set(
      seed.gpus.filter((g) => twinGpus(g, seed.gpus).length > 0).map((g) => [g.id, ...twinGpus(g, seed.gpus).map((t) => t.id)].sort().join(',')),
    );
    expect(groups.size).toBe(8);
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

describe('ramSteps — dGPU 시스템 RAM 계단 (10-03 D64)', () => {
  // 수치를 고정하지 않고 카탈로그 전체로 돈다 — 모델·GPU 가 늘거나 엔진 문턱이 움직여도 성질만 본다
  const full = loadSeed();
  const dgpus = full.gpus.filter((g) => g.kind === 'dgpu');
  const all = dgpus.flatMap((g) =>
    full.models.map((m) => {
      const config = hardwareConfigs(g, full.gpus)[0]!;
      const combo = assessCombo(full, g, config, m);
      return { g, m, config, combo, steps: ramSteps(full, g, m, { config, combo }) };
    }),
  );
  const fp = (q: { quant: string; fits: boolean; result: { verdict: string; mode: string; tgTokS: { est: number } } }) =>
    [q.quant, q.fits, q.result.verdict, q.result.mode, q.result.tgTokS.est].join('|');

  it('walks 16·32·64·96·128 GB, reusing the page combo at the assumed RAM; unified and CPU get none', () => {
    expect(HUB_POLICY.comboRamGB).toEqual([16, HUB_POLICY.dgpuRamGB, ...HUB_POLICY.ramHintGB]);
    for (const { combo, steps } of all) {
      expect(steps.map((s) => s.ramGB)).toEqual([...HUB_POLICY.comboRamGB]);
      expect(steps.find((s) => s.ramGB === HUB_POLICY.dgpuRamGB)!.combo).toBe(combo);
      for (const s of steps) expect(s.config.hw.ramGB).toBe(s.ramGB);
    }
    for (const g of full.gpus.filter((x) => x.kind !== 'dgpu')) {
      const config = hardwareConfigs(g, full.gpus)[0]!;
      const m = full.models[0]!;
      expect(ramSteps(full, g, m, { config, combo: assessCombo(full, g, config, m) })).toEqual([]);
    }
  });

  it('the explicit 32 GB path (user RAM + RAM hint) matches the assumed-RAM page combo — policy parity', () => {
    for (const { g, m, combo } of all) {
      const explicit = assessCombo(full, g, hardwareConfigs(g, full.gpus, { ramGB: HUB_POLICY.dgpuRamGB })[0]!, m, { ramHint: true });
      expect(fp(explicit.baseline), `${m.id}@${g.id} baseline`).toBe(fp(combo.baseline));
      expect(fp(explicit.display), `${m.id}@${g.id} display`).toBe(fp(combo.display));
      expect(explicit.ramHint?.ramGB, `${m.id}@${g.id} ram hint`).toBe(combo.ramHint?.ramGB);
    }
  });

  it('RAM only decides whether a quant fits — a quant that fits keeps its mode, verdict, speed and command', () => {
    let compared = 0;
    for (const { g, m, steps } of all) {
      const top = steps.at(-1)!;
      for (const s of steps) {
        for (const q of s.combo.perQuant.filter((x) => x.fits)) {
          const ref = top.combo.perQuant.find((x) => x.quant === q.quant)!;
          const where = `${m.id}@${g.id} ${q.quant} ${s.ramGB}GB`;
          expect(ref.fits, where).toBe(true);
          expect([q.result.mode, q.result.verdict, q.result.tgTokS.est, q.result.cpuMoeLayers, q.gpuFrac, q.result.confidence], where).toEqual([
            ref.result.mode,
            ref.result.verdict,
            ref.result.tgTokS.est,
            ref.result.cpuMoeLayers,
            ref.gpuFrac,
            ref.result.confidence,
          ]);
          const qRow = full.modelQuants.find((r) => r.modelId === m.id && r.quant === q.quant)!;
          expect(commandPlan(g, s.config, m, qRow, q).llamaCpp?.command, where).toBe(
            commandPlan(g, top.config, m, qRow, ref).llamaCpp?.command,
          );
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('the baseline verdict never drops as RAM grows, and the RAM-hint title agrees with the list', () => {
    for (const { g, m, combo, steps } of all) {
      for (let i = 1; i < steps.length; i += 1) {
        expect(
          verdictRank(steps[i]!.combo.baseline.result.verdict),
          `${m.id}@${g.id} ${steps[i - 1]!.ramGB}→${steps[i]!.ramGB}GB`,
        ).toBeGreaterThanOrEqual(verdictRank(steps[i - 1]!.combo.baseline.result.verdict));
      }
      // 제목 "RAM 64GB면 B" 와 목록의 64GB 행이 같은 답
      if (combo.ramHint) {
        const at = steps.find((s) => s.ramGB === combo.ramHint!.ramGB)!;
        expect(at.combo.baseline.result.verdict, `${m.id}@${g.id}`).toBe(combo.ramHint.verdict);
        expect(at.combo.display.quant, `${m.id}@${g.id}`).toBe(combo.ramHint.q.quant);
      }
    }
  });

  it('the best option a RAM row shows (display, recommended, last resort) never gets worse as RAM grows (review fix)', () => {
    // 표시 양자화는 기준이 불가일 때만 추천으로 바뀐다 — 정적 목록이 추천·최후 수단을 함께 적어야 RAM 을 늘린 행이 나빠 보이지 않는다
    const best = (c: (typeof all)[number]['combo']) =>
      Math.max(
        verdictRank(c.display.result.verdict),
        c.recommended ? verdictRank(c.recommended.result.verdict) : 0,
        c.lastResort ? verdictRank(c.lastResort.result.verdict) : 0,
      );
    for (const { g, m, steps } of all) {
      for (let i = 1; i < steps.length; i += 1) {
        expect(best(steps[i]!.combo), `${m.id}@${g.id} ${steps[i - 1]!.ramGB}→${steps[i]!.ramGB}GB`).toBeGreaterThanOrEqual(
          best(steps[i - 1]!.combo),
        );
      }
    }
  });

  it('a baseline that misses at one RAM step but fits at a larger one needs more system RAM than that step can use', () => {
    // RAM 토글 문장(ramStepSentence)이 "시스템 RAM 에 X GB 를 둬야 하는데 쓸 수 있는 RAM 은 Y GB" 로 말하는 근거
    let checked = 0;
    for (const { g, m, steps } of all) {
      for (const s of steps) {
        const base = s.combo.baseline;
        if (base.fReason !== 'no-fit') continue;
        const fitting = steps.map((x) => x.combo.perQuant.find((q) => q.quant === base.quant)!).find((q) => q.fits);
        if (!fitting) continue;
        expect(fitting.memory.ramGB, `${m.id}@${g.id} ${base.quant} ${s.ramGB}GB`).toBeGreaterThan(base.memory.ramUsableGB);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('some pages change with RAM (gpt-oss-120b on an 8 GB card does), most do not; verdict changes imply sensitivity', () => {
    const sensitive = all.filter((c) => ramSensitive(c.steps));
    expect(sensitive.length).toBeGreaterThan(0);
    expect(sensitive.length).toBeLessThan(all.length / 2);
    for (const c of all) if (ramVerdictChanges(c.steps)) expect(ramSensitive(c.steps)).toBe(true);
    const oss = all.find((c) => c.m.id === 'gpt-oss-120b' && c.g.id === 'rtx-4060')!;
    expect(ramSensitive(oss.steps)).toBe(true);
    const small = all.find((c) => c.m.id === 'llama-3.1-8b' && c.g.id === 'rtx-4090')!;
    expect(ramSensitive(small.steps)).toBe(false);
  });
});
