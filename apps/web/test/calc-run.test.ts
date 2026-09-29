/**
 * 계산기 결과 조립 (P1-3) — 허브 가정과 같은 입력에서 `assessCombo`(허브·콤보 정본)와 동치, 정렬·필터·클램프·커스텀.
 */
import { assessCombo, hardwareConfigs, pickConfigCombo, toCatalogLite, verdictRank } from '@canrun/data/client';
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
  it('sorted by verdict then speed by default; speed/size sorts reorder', () => {
    const run = assembleResults(catalog, withGpu('rtx-4060'))!;
    const ranks = run.all.map((c) => 'FBAS'.indexOf(c.combo.baseline.result.verdict));
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    const bySize = assembleResults(catalog, withGpu('rtx-4060', { sort: 'size' }))!.all.map((c) => c.model.paramsB);
    expect([...bySize].sort((a, b) => b - a)).toEqual(bySize);
    const bySpeed = assembleResults(catalog, withGpu('rtx-4060', { sort: 'speed' }))!.all;
    const first = bySpeed[0]!.combo.display.result.tgTokS.est;
    expect(bySpeed.every((c) => c.combo.display.fReason === 'no-fit' || c.combo.display.result.tgTokS.est <= first)).toBe(true);
    expect(run.counts.S + run.counts.A + run.counts.B + run.counts.F).toBe(catalog.models.length);
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
