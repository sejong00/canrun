/**
 * 계산기 결과 조립 (P1-3) — 허브 가정과 같은 입력에서 `assessCombo`(허브·콤보 정본)와 동치, 정렬·필터·클램프·커스텀.
 */
import { assessCombo, buildManualModel, hardwareConfigs, pickConfigCombo, toCatalogLite, verdictRank, type ManualSpec } from '@canrun/data/client';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../../packages/data/test/seed';
import { differsFromHubAssumption, resolveHardware } from '../lib/calc/hardware';
import { assembleResults } from '../lib/calc/run';
import { defaultState, type CalcState } from '../lib/calc/state';

const seed = loadSeed();
const catalog = toCatalogLite(seed);
const withGpu = (gpuId: string, extra: Partial<CalcState> = {}): CalcState => ({
  ...defaultState(),
  hardware: { kind: 'catalog', gpuId },
  ...extra,
});

describe('assembleResults parity with the hubs (8k · f16 · policy defaults)', () => {
  it('every catalog GPU × RAM option × model equals assessCombo from the hub path', () => {
    let combos = 0;
    for (const gpu of seed.gpus) {
      for (const config of hardwareConfigs(gpu, seed.gpus)) {
        const run = assembleResults(catalog, withGpu(gpu.id, { ramGB: config.ramGB }));
        expect(run, gpu.id).toBeDefined();
        expect(run!.hardware.config.hw).toEqual(config.hw);
        for (const card of run!.all) {
          const full = assessCombo(seed, gpu, config, seed.models.find((m) => m.id === card.model.id)!);
          expect(card.combo.baseline.result.verdict, `${gpu.id}/${card.model.id}`).toBe(full.baseline.result.verdict);
          expect(card.combo.display.quant).toBe(full.display.quant);
          expect(card.combo.display.result.tgTokS).toEqual(full.display.result.tgTokS);
          expect(card.combo.display.result.confidence).toBe(full.display.result.confidence);
          expect(card.combo.display.memory.needGB).toBeCloseTo(full.display.memory.needGB, 9);
          expect(card.combo.recommended?.quant).toBe(full.recommended?.quant);
          expect(card.combo.ramHint?.ramGB).toBe(full.ramHint?.ramGB);
          expect(card.combo.maxCtx).toBe(full.maxCtx);
          combos += 1;
        }
      }
    }
    expect(combos).toBeGreaterThan(2000);
  });

  it('keeps the measured join on the hub anchor (rtx-4060 × llama-3.1-8b) and drops it at 16k', () => {
    const at8k = assembleResults(catalog, withGpu('rtx-4060'))!.all.find((c) => c.model.id === 'llama-3.1-8b')!;
    expect(at8k.combo.display.result.confidence).toBe('measured');
    expect(at8k.measuredCount).toBeGreaterThan(0);
    const at16k = assembleResults(catalog, withGpu('rtx-4060', { ctx: 16384 }))!.all.find((c) => c.model.id === 'llama-3.1-8b')!;
    expect(at16k.combo.display.result.confidence).not.toBe('measured');
    expect(at16k.measuredCount).toBe(at8k.measuredCount);
  });
});

describe('assembleResults — options', () => {
  // 기본 정렬은 10-06(D68)부터 추천순 — 판정·속도 순은 sort: 'verdict' 로 명시한다
  it('verdict sort orders by verdict then speed; speed/size sorts reorder', () => {
    const run = assembleResults(catalog, withGpu('rtx-4060', { sort: 'verdict' }))!;
    const ranks = run.all.map((c) => 'FBAS'.indexOf(c.combo.baseline.result.verdict));
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    expect(run.all[0]!.model.paramsB).toBeLessThan(10); // 옛 기본 순서: 가장 빠른 작은 모델(지금 MiniCPM5 1B)이 맨 위
    const bySize = assembleResults(catalog, withGpu('rtx-4060', { sort: 'size' }))!.all.map((c) => c.model.paramsB);
    expect([...bySize].sort((a, b) => b - a)).toEqual(bySize);
    const bySpeed = assembleResults(catalog, withGpu('rtx-4060', { sort: 'speed' }))!.all;
    const first = bySpeed[0]!.combo.display.result.tgTokS.est;
    expect(bySpeed.every((c) => c.combo.display.fReason === 'no-fit' || c.combo.display.result.tgTokS.est <= first)).toBe(true);
    expect(run.counts.S + run.counts.A + run.counts.B + run.counts.F).toBe(catalog.models.length);
  });

  it('recommended (default): runs-well-or-better models largest first, then slow ones by speed, then the rest (D68)', () => {
    const run = assembleResults(catalog, withGpu('rtx-4060'))!;
    const group = (v: string) => (v === 'S' || v === 'A' ? 0 : v === 'B' ? 1 : 2);
    const groups = run.all.map((c) => group(c.combo.baseline.result.verdict));
    expect([...groups].sort((a, b) => a - b)).toEqual(groups);
    const good = run.all.filter((c) => group(c.combo.baseline.result.verdict) === 0);
    expect(good.map((c) => c.model.paramsB)).toEqual([...good.map((c) => c.model.paramsB)].sort((a, b) => b - a));
    expect(run.all[0]!.model.paramsB).toBe(Math.max(...good.map((c) => c.model.paramsB)));
    expect(run.all[0]!.model.paramsB).toBeGreaterThan(9); // 1B 모델이 아니다 — 사용자 지적(10-06)
    const slow = run.all.filter((c) => c.combo.baseline.result.verdict === 'B').map((c) => c.combo.display.result.tgTokS.est);
    expect(slow).toEqual([...slow].sort((a, b) => b - a));
    // 필터·카운트는 정렬과 무관
    expect(run.counts).toEqual(assembleResults(catalog, withGpu('rtx-4060', { sort: 'verdict' }))!.counts);
  });

  it('popular sorts by the 1–5 popularity, downloads by the Hugging Face 30-day count (D68)', () => {
    const popular = assembleResults(catalog, withGpu('rtx-4060', { sort: 'popular' }))!.all.map((c) => c.model.popularity);
    expect(popular).toEqual([...popular].sort((a, b) => b - a));
    const downloads = assembleResults(catalog, withGpu('rtx-4060', { sort: 'downloads' }))!.all.map((c) => c.model.hfDownloads30d ?? -1);
    expect(downloads).toEqual([...downloads].sort((a, b) => b - a));
  });

  it('filters by category, minimum verdict and size bucket', () => {
    const coding = assembleResults(catalog, withGpu('rtx-4060', { cat: ['coding'] }))!;
    expect(coding.cards.length).toBeGreaterThan(0);
    expect(coding.cards.every((c) => c.model.category.includes('coding'))).toBe(true);
    const goodOnly = assembleResults(catalog, withGpu('rtx-4060', { min: 'A' }))!;
    expect(goodOnly.cards.every((c) => 'AS'.includes(c.combo.baseline.result.verdict))).toBe(true);
    const small = assembleResults(catalog, withGpu('rtx-4060', { size: ['s'] }))!;
    expect(small.cards.every((c) => c.model.paramsB < 10)).toBe(true);
    expect(small.all.length).toBe(catalog.models.length);
  });

  it('clamps ctx to the model maximum', () => {
    const run = assembleResults(catalog, withGpu('rtx-4090', { ctx: 262144 }))!;
    const clamped = run.all.filter((c) => c.clamped);
    expect(clamped.length).toBeGreaterThan(0);
    for (const c of clamped) expect(c.ctx).toBe(c.model.maxContext);
  });

  it('user RAM below the hub assumption still yields a RAM hint above it; hub-assumption label logic', () => {
    const run = assembleResults(catalog, withGpu('rtx-4060', { ramGB: 16 }))!;
    const big = run.all.find((c) => c.model.id === 'gpt-oss-120b')!;
    expect(big.combo.ramHint?.ramGB).toBeGreaterThan(16);
    expect(differsFromHubAssumption(withGpu('rtx-4060', { ramGB: 16 }), run.hardware)).toBe(true);
    // "상세" 링크가 `?ram=16` 으로 그 RAM 을 넘기면 RAM 차이는 라벨 조건이 아니다 (10-03 D64 리뷰) — 다른 차이는 그대로
    expect(differsFromHubAssumption(withGpu('rtx-4060', { ramGB: 16 }), run.hardware, true)).toBe(false);
    const linux16 = withGpu('rtx-4060', { ramGB: 16, os: 'linux' });
    expect(differsFromHubAssumption(linux16, resolveHardware(linux16, catalog)!, true)).toBe(true);
    expect(differsFromHubAssumption(withGpu('rtx-4060'), resolveHardware(withGpu('rtx-4060'), catalog)!)).toBe(false);
    expect(differsFromHubAssumption(withGpu('rtx-4060', { os: 'linux' }), resolveHardware(withGpu('rtx-4060', { os: 'linux' }), catalog)!)).toBe(true);
    expect(differsFromHubAssumption(withGpu('apple-m4'), resolveHardware(withGpu('apple-m4'), catalog)!)).toBe(false);
  });

  it('CPU profile: the gpu id is the source of truth and the DDR field follows it; unified RAM snaps', () => {
    // UI 의 DDR 선택은 gpuId 와 ddr 을 함께 바꾼다 — 서로 어긋나면 gpuId 가 이긴다 (URL `gpu=` 가 정본)
    const cpu = assembleResults(catalog, withGpu('cpu-ddr4-3200-2ch', { ddr: 'ddr5-6000' }))!;
    expect(cpu.hardware.gpu.id).toBe('cpu-ddr4-3200-2ch');
    expect(cpu.hardware.config.hw.ramBandwidthGBs).toBe(catalog.gpus.find((g) => g.id === 'cpu-ddr4-3200-2ch')!.memBandwidthGBs);
    const m4 = assembleResults(catalog, withGpu('apple-m4', { ramGB: 20 }))!;
    expect(m4.hardware.ramGB).toBe(24);
    expect(m4.hardware.os).toBe('macos');
  });

  it('custom hardware: theoretical for every quant, bands present, no measured join, no ram hint without dGPU', () => {
    const run = assembleResults(catalog, {
      ...defaultState(),
      hardware: { kind: 'custom', custom: { kind: 'dgpu', effClass: 'amd', vramGB: 20, bandwidthGBs: 800 } },
    })!;
    expect(run.hardware.theoretical).toBe(true);
    expect(run.hardware.gpu.id).toBe('custom');
    for (const card of run.all) {
      for (const q of card.combo.perQuant) {
        expect(q.result.confidence).toBe('theoretical');
        expect(q.measured).toBeUndefined();
        if (q.fits) expect(q.result.tgTokS.high).toBeGreaterThan(q.result.tgTokS.low);
      }
    }
    // 필수값이 없으면 계산하지 않는다
    expect(
      assembleResults(catalog, { ...defaultState(), hardware: { kind: 'custom', custom: { kind: 'dgpu', effClass: 'nvidia', vramGB: 16 } } }),
    ).toBeUndefined();
    expect(assembleResults(catalog, { ...defaultState(), hardware: { kind: 'unresolved', text: 'nope' } })).toBeUndefined();
  });

  it('measured badge count = the reference-condition (8k·f16) join on the same hardware, never raw points (review fix)', () => {
    let joinedAtRef = 0;
    let rawButNotJoined = 0;
    for (const gpuId of catalog.gpus.map((g) => g.id)) {
      const at8k = assembleResults(catalog, withGpu(gpuId))!;
      const byModel = new Map(at8k.all.map((c) => [c.model.id, c]));
      const joinAt8k = (modelId: string, quant: string) =>
        byModel.get(modelId)!.combo.perQuant.find((x) => x.quant === quant)?.measured?.points.length ?? 0;
      for (const card of at8k.all) {
        // 기준 조건: 표시 quant 의 조인 그대로 — 배지가 붙으면 반드시 measured 라벨
        expect(card.measuredCount).toBe(card.combo.display.measured?.points.length ?? 0);
        if (card.measuredCount > 0) {
          joinedAtRef += 1;
          expect(card.combo.display.result.confidence).toBe('measured');
        }
        const raw = catalog.benchmarks.filter((b) => b.gpuId === gpuId && b.modelId === card.model.id && b.quant === card.combo.display.quant).length;
        if (raw > 0 && card.measuredCount === 0) rawButNotJoined += 1;
      }
      // 다른 조건(16k·q8_0): 조인은 없고, 부기 수는 같은 quant 의 기준 조건 조인 수
      const at16k = assembleResults(catalog, withGpu(gpuId, { ctx: 16384, kv: 'q8_0' }))!;
      for (const card of at16k.all) {
        expect(card.combo.display.measured).toBeUndefined();
        expect(card.measuredCount).toBe(joinAt8k(card.model.id, card.combo.display.quant));
      }
    }
    expect(joinedAtRef, 'fixture must exercise joined badges').toBeGreaterThanOrEqual(3);
    // 조건 무관 원시 점 수를 쓰던 때는 이런 카드에 "8k·f16 조건 실측 N건" 이 붙었다 — 지금은 0
    expect(rawButNotJoined, 'fixture must exercise raw-but-not-joined combos').toBeGreaterThan(0);
  });

  it('RAM hint is the smallest candidate (32/64/96/128) above the user RAM that improves the verdict (review fix)', () => {
    const run = assembleResults(catalog, withGpu('rtx-4060', { ramGB: 16 }))!;
    const hinted = run.all.filter((c) => c.combo.ramHint);
    expect(hinted.length).toBeGreaterThan(0);
    const gpu = run.hardware.gpu;
    for (const card of hinted) {
      const hint = card.combo.ramHint!;
      expect([32, 64, 96, 128]).toContain(hint.ramGB);
      // 32GB 로 이미 힌트 판정에 닿으면 64 를 권하면 안 된다
      const [at32] = hardwareConfigs(gpu, catalog.gpus, { ramGB: 32, os: run.hardware.os, isDisplayGpu: true, ramBandwidthGBs: run.hardware.config.hw.ramBandwidthGBs });
      const c32 = assessCombo(catalog, gpu, at32!, card.model, { ctx: card.ctx, kvQuant: 'f16' });
      const improvedAt32 = verdictRank(c32.baseline.result.verdict) > verdictRank(card.combo.baseline.result.verdict);
      if (hint.ramGB > 32) expect(improvedAt32, `${card.model.id}: 32GB should not already improve`).toBe(false);
      else expect(improvedAt32, `${card.model.id}: hint 32 must improve`).toBe(true);
    }
    // 허브(32GB)는 종전대로 64 부터
    const hub = assembleResults(catalog, withGpu('rtx-4060'))!;
    for (const card of hub.all) if (card.combo.ramHint) expect(card.combo.ramHint.ramGB).toBeGreaterThanOrEqual(64);
  });

  it('unified/CPU cards carry the combo page config so the details link can flag a RAM/OS mismatch (review fix)', () => {
    const m4pro = assembleResults(catalog, withGpu('apple-m4-pro', { ramGB: 24 }))!;
    expect(m4pro.hardware.ramGB).toBe(24);
    const options = catalog.gpus.find((g) => g.id === 'apple-m4-pro')!.ramOptionsGB!;
    for (const card of m4pro.all) {
      expect(card.hubConfig).toBeDefined();
      expect(options).toContain(card.hubConfig!.ramGB);
      expect(card.hubConfig!.os).toBe('macos');
    }
    expect(m4pro.all.some((c) => c.hubConfig!.ramGB !== 24), 'some model prefers a larger RAM option').toBe(true);
    // 콤보 페이지 규칙과 동일: RAM 옵션별 평가 중 최선 판정 구성 (동률이면 첫 옵션)
    const gpu = m4pro.hardware.gpu;
    const configs = hardwareConfigs(gpu, catalog.gpus);
    for (const card of m4pro.all) {
      const combos = configs.map((c) => assessCombo(catalog, gpu, c, card.model));
      expect(card.hubConfig!.ramGB).toBe(configs[combos.indexOf(pickConfigCombo(combos))]!.ramGB);
    }
    // CPU 프로필: 사용자가 Windows 를 골라도 콤보 페이지는 linux 최대 RAM 구성
    const cpu = assembleResults(catalog, withGpu('cpu-ddr5-5600-2ch', { os: 'windows', ramGB: 16 }))!;
    expect(cpu.hardware.os).toBe('windows');
    expect(cpu.all[0]!.hubConfig).toMatchObject({ os: 'linux' });
    // dGPU·커스텀엔 없다
    expect(assembleResults(catalog, withGpu('rtx-4060'))!.all[0]!.hubConfig).toBeUndefined();
    expect(
      assembleResults(catalog, { ...defaultState(), hardware: { kind: 'custom', custom: { kind: 'unified', effClass: 'apple', memGB: 32, bandwidthGBs: 200 } } })!.all[0]!.hubConfig,
    ).toBeUndefined();
  });
});

describe('assembleResults — pinned extra model (HF, D57)', () => {
  it('evaluates the extra model separately: theoretical, not counted or filtered, with a llama.cpp command', () => {
    const base = seed.models.find((m) => m.id === 'qwen3-8b')!;
    const rows = seed.modelQuants.filter((r) => r.modelId === 'qwen3-8b').map((r) => ({ ...r, modelId: 'hf-qwen3-8b' }));
    const model = { ...base, id: 'hf-qwen3-8b', name: 'Qwen3 8B (HF)' };
    const plain = assembleResults(catalog, withGpu('rtx-4060'))!;
    const run = assembleResults(catalog, withGpu('rtx-4060', { cat: ['coding'] }), { model, rows, origin: 'hf' })!;
    expect(run.pinned?.model.id).toBe('hf-qwen3-8b');
    expect(run.pinned?.combo.baseline.result.confidence).toBe('theoretical');
    expect(run.pinned?.command).toContain('llama-server -hf');
    expect(run.all.some((c) => c.model.id === 'hf-qwen3-8b')).toBe(false);
    expect(run.counts).toEqual(plain.counts);
    // 같은 레코드면 순수 추정 판정은 카탈로그 모델과 같고(실측 조인은 없다) 라벨만 이론 추정
    const twin = plain.all.find((c) => c.model.id === 'qwen3-8b')!;
    expect(run.pinned?.combo.baseline.result.verdict).toBe(twin.combo.baseline.estimate.verdict);
  });
});

describe('assembleResults — pinned manual model (D66)', () => {
  const manual = (spec: ManualSpec) => {
    const build = buildManualModel(spec);
    if (build.kind !== 'ok') throw new Error(JSON.stringify(build));
    return { model: { ...build.model, name: 'Custom model' }, rows: build.rows, origin: 'manual' as const };
  };
  const card = (run: ReturnType<typeof assembleResults>, id: string) => run!.all.find((c) => c.model.id === id)!;

  it('Llama 3.1 8B numbers on an RTX 4060: theoretical, no command, counts unchanged, same verdict as the catalog estimate', () => {
    const plain = assembleResults(catalog, withGpu('rtx-4060'))!;
    const run = assembleResults(catalog, withGpu('rtx-4060'), manual({ paramsB: 8.03, layers: 32, kvHeads: 8, headDim: 128, maxContext: 131072 }))!;
    expect(run.pinned?.model.id).toBe('manual');
    expect(run.pinned?.combo.baseline.result.confidence).toBe('theoretical');
    expect(run.pinned?.combo.display.result.confidence).toBe('theoretical');
    // 받을 파일이 없다 — 명령 없음
    expect(run.pinned?.command).toBeUndefined();
    expect(run.counts).toEqual(plain.counts);
    expect(run.all.some((c) => c.model.id === 'manual')).toBe(false);
    expect(run.pinned?.combo.baseline.result.verdict).toBe(card(plain, 'llama-3.1-8b').combo.baseline.estimate.verdict);
  });

  it('Qwen3-30B-A3B numbers on an RTX 4060 with 32 GB RAM: the experts go to system RAM like the catalog model', () => {
    const plain = assembleResults(catalog, withGpu('rtx-4060', { ramGB: 32 }))!;
    const spec: ManualSpec = { paramsB: 30.5, activeParamsB: 3.3, experts: 128, topK: 8, layers: 48, kvHeads: 4, headDim: 128, maxContext: 262144 };
    const run = assembleResults(catalog, withGpu('rtx-4060', { ramGB: 32 }), manual(spec))!;
    const twin = card(plain, 'qwen3-30b-a3b-2507').combo;
    expect(twin.display.estimate.mode).toBe('cpu-moe');
    expect(run.pinned?.combo.display.result.mode).toBe(twin.display.estimate.mode);
    // 2507 Instruct 는 생각 모드가 없다 — 체크하지 않으면 같은 기준, 체크하면 생각 모드 기준(×1.5, D59)
    expect(twin.reasoning).toBe(false);
    expect(run.pinned?.combo.reasoning).toBe(false);
    const thinking = assembleResults(catalog, withGpu('rtx-4060', { ramGB: 32 }), manual({ ...spec, thinking: true }))!;
    expect(thinking.pinned?.combo.reasoning).toBe(true);
  });

  it('an unknown max context never clamps the chosen context', () => {
    const run = assembleResults(catalog, withGpu('rtx-4090', { ctx: 262144 }), manual({ paramsB: 8.03, layers: 32, kvHeads: 8, headDim: 128 }))!;
    expect(run.pinned?.ctx).toBe(262144);
    expect(run.pinned?.clamped).toBe(false);
  });
});

describe('assembleResults — multi-GPU (D58, beta)', () => {
  it('2× RTX 3090: Llama 3.3 70B Q4 runs fully on the GPUs, every estimate theoretical, combo link labelled', () => {
    const one = assembleResults(catalog, withGpu('rtx-3090', { ramGB: 64 }))!;
    const two = assembleResults(catalog, withGpu('rtx-3090', { ramGB: 64, gpus: 2 }))!;
    expect(two.hardware.gpuCount).toBe(2);
    expect(two.hardware.theoretical).toBe(true);
    const card = (r: typeof one) => r.all.find((c) => c.model.id === 'llama-3.3-70b')!;
    expect(card(one).combo.baseline.result.mode).not.toBe('full-gpu');
    expect(card(two).combo.baseline.result.mode).toBe('full-gpu');
    expect(card(two).combo.baseline.result.vram.limit).toBe(48);
    expect(two.all.every((c) => c.combo.display.result.confidence === 'theoretical')).toBe(true);
    expect(differsFromHubAssumption(withGpu('rtx-3090', { gpus: 2 }), two.hardware)).toBe(true);
  });
});

describe('assembleResults — mixed GPUs (10-03 D67, beta)', () => {
  const pair = assembleResults(catalog, withGpu('rtx-3090', { ramGB: 64, plus: ['rtx-3060-12gb'] }))!;
  const alone = assembleResults(catalog, withGpu('rtx-3090', { ramGB: 64 }))!;
  const card = (r: typeof pair, id: string) => r.all.find((c) => c.model.id === id)!;

  it('RTX 3090 + RTX 3060 12GB: 36GB in all, every estimate theoretical, no measured badge, combo link labelled', () => {
    expect(pair.hardware.gpuCount).toBe(2);
    expect(pair.hardware.extras.map((g) => g.id)).toEqual(['rtx-3060-12gb']);
    expect(pair.hardware.theoretical).toBe(true);
    expect(pair.all.every((c) => c.combo.display.result.confidence === 'theoretical' && c.measuredCount === 0)).toBe(true);
    expect(alone.all.some((c) => c.measuredCount > 0)).toBe(true);
    expect(differsFromHubAssumption(withGpu('rtx-3090', { plus: ['rtx-3060-12gb'] }), pair.hardware)).toBe(true);
    const llama70 = card(pair, 'llama-3.3-70b');
    expect(llama70.combo.baseline.result.vram.limit).toBe(36);
    expect(llama70.combo.baseline.result.mode).toBe('partial-offload');
  });

  it('a model that fits on the 3090 alone is estimated on both cards (llama.cpp default split, slower) with a one-card hint', () => {
    const pairCard = card(pair, 'qwen3-8b');
    const aloneCard = card(alone, 'qwen3-8b');
    expect(pairCard.combo.display.result.mode).toBe('full-gpu');
    expect(pairCard.combo.display.result.tgTokS.est).toBeLessThan(aloneCard.combo.display.result.tgTokS.est);
    expect(pairCard.singleGpu?.gpu.id).toBe('rtx-3090');
    // 참고 줄 = 계산기에 3090 한 장만 넣었을 때와 같은 값·라벨(리뷰 반영 — 이론 추정으로 고정하지 않는다)
    expect(pairCard.singleGpu?.q.quant).toBe(aloneCard.combo.display.quant);
    expect(pairCard.singleGpu?.q.result).toEqual(aloneCard.combo.display.result);
    expect(pairCard.singleGpu?.q.result.confidence).toBe('calibrated');
    // 실측이 있는 조합은 실측 중앙값 그대로 (기준 조건 8k·f16)
    const measured = card(pair, 'gpt-oss-20b');
    const measuredAlone = card(alone, 'gpt-oss-20b');
    expect(measuredAlone.combo.display.result.confidence).toBe('measured');
    expect(measured.singleGpu?.q.result).toEqual(measuredAlone.combo.display.result);
    expect(measured.singleGpu?.q.measured?.values).toEqual(measuredAlone.combo.display.measured?.values);
    // 다른 조건(16k)은 단독 결과처럼 실측을 붙이지 않는다
    const longCtx = assembleResults(catalog, withGpu('rtx-3090', { ramGB: 64, ctx: 16384, plus: ['rtx-3060-12gb'] }))!;
    const longAlone = assembleResults(catalog, withGpu('rtx-3090', { ramGB: 64, ctx: 16384 }))!;
    expect(card(longCtx, 'gpt-oss-20b').singleGpu?.q.result).toEqual(card(longAlone, 'gpt-oss-20b').combo.display.result);
    expect(card(longCtx, 'gpt-oss-20b').singleGpu?.q.measured).toBeUndefined();
    // 카탈로그 밖 모델은 단독 결과처럼 늘 이론 추정
    const build = buildManualModel({ paramsB: 8.03, layers: 32, kvHeads: 8, headDim: 128, maxContext: 131072 });
    if (build.kind !== 'ok') throw new Error(JSON.stringify(build));
    const pinned = assembleResults(catalog, withGpu('rtx-3090', { ramGB: 64, plus: ['rtx-3060-12gb'] }), {
      model: { ...build.model, name: 'Custom model' },
      rows: build.rows,
      origin: 'manual',
    })!.pinned;
    expect(pinned?.singleGpu?.gpu.id).toBe('rtx-3090');
    expect(pinned?.singleGpu?.q.result.confidence).toBe('theoretical');
    // 한 장에 안 들어가는 모델·같은 카드 여러 장·1장엔 힌트가 없다
    expect(card(pair, 'llama-3.3-70b').singleGpu).toBeUndefined();
    const two = assembleResults(catalog, withGpu('rtx-3090', { ramGB: 64, gpus: 2 }))!;
    expect(two.all.some((c) => c.singleGpu)).toBe(false);
    expect(alone.all.some((c) => c.singleGpu)).toBe(false);
  });

  it('several GPUs get their own llama.cpp command on every card that fits (the combo page command is for one card); cpu-moe leaves placement to --fit', () => {
    for (const run of [pair, assembleResults(catalog, withGpu('rtx-4060', { ramGB: 64, gpus: 2 }))!]) {
      for (const c of run.all) {
        expect(c.command !== undefined, c.model.id).toBe(c.combo.display.fits);
        if (c.combo.display.result.mode === 'cpu-moe') {
          expect(c.commandFitAuto).toBe(true);
          expect(c.command).not.toMatch(/-ngl|--n-cpu-moe/);
        } else {
          expect(c.commandFitAuto).toBeUndefined();
        }
      }
      expect(run.all.some((c) => c.commandFitAuto)).toBe(true);
    }
    expect(alone.all.some((c) => c.command)).toBe(false);
  });
});
