/**
 * 실행 커맨드 각주 (P1-3 D28) — GPU 여러 장의 cpu-moe 명령(10-03 D67)은 -ngl·--n-cpu-moe 를 이미 뺐으므로
 * "빼고 실행해도"(cpuMoeFit, 두 옵션이 있는 명령의 대안 안내)가 아니라 뺀 이유를 말하는 문장을 쓴다 (리뷰 반영).
 */
import { commandPlan, toCatalogLite } from '@canrun/data/client';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../../packages/data/test/seed';
import { resolveHardware } from '../lib/calc/hardware';
import { assembleResults } from '../lib/calc/run';
import { defaultState } from '../lib/calc/state';
import { llamaNotes } from '../lib/snippet-phrases';

const catalog = toCatalogLite(loadSeed());
const t = (key: string) => key;
/** 키와 인자를 그대로 돌려주는 번역 — 문장 고르기와 인자 값을 함께 본다 */
const tArgs = (key: string, args?: Record<string, unknown>) => `${key}${args ? ` ${JSON.stringify(args)}` : ''}`;

describe('llamaNotes', () => {
  it('a multi-GPU cpu-moe command (--fit placement) explains why the flags are gone, without the "leave them out" alternative', () => {
    const state = { ...defaultState(), hardware: { kind: 'catalog' as const, gpuId: 'rtx-4060' }, ramGB: 64, gpus: 2 };
    const run = assembleResults(catalog, state)!;
    const hw = resolveHardware(state, catalog)!;
    const card = run.all.find((c) => c.combo.display.result.mode === 'cpu-moe' && c.commandFitAuto)!;
    expect(card).toBeDefined();
    const row = catalog.modelQuants.find((r) => r.modelId === card.model.id && r.quant === card.combo.display.quant)!;
    const plan = commandPlan(hw.gpu, hw.config, card.model, row, card.combo.display, { ctx: card.ctx, kvQuant: 'f16' });
    expect(plan.llamaCpp?.ngl).toBe('auto');
    const keys = llamaNotes(t, 'en', plan, 0).map((n) => n.text);
    expect(keys[0]).toBe('nglFitAuto');
    expect(keys).not.toContain('cpuMoeFit');
  });

  it('a looped model (Nanbeige4.2, 10-22 D114) explains that -ngl counts logical layers and how many stored layers get their weights on the GPU', () => {
    const seed = loadSeed();
    const gpu = seed.gpus.find((g) => g.id === 'rtx-4060')!;
    const config = { gpuId: gpu.id, ramGB: 32, assumedRam: true, hw: resolveHardware({ ...defaultState(), hardware: { kind: 'catalog' as const, gpuId: 'rtx-4060' }, ramGB: 32 }, catalog)!.config.hw };
    const model = catalog.models.find((m) => m.id === 'nanbeige4.2-3b')!;
    const row = catalog.modelQuants.find((r) => r.modelId === model.id && r.quant === 'Q4_K_M')!;
    const q = { fits: true, result: { mode: 'partial-offload' as const }, gpuFrac: 0.259 } as Parameters<typeof commandPlan>[4];
    const plan = commandPlan(gpu, config, model, row, q, { ctx: 32768, kvQuant: 'f16' });
    expect(plan.llamaCpp?.ngl).toBe(28);
    const notes = llamaNotes(tArgs as never, 'en', plan, 0);
    expect(notes[0]!.text).toBe('nglNLoops {"n":28,"logical":44,"layers":22,"blocks":5}');
    // 반복이 없는 모델은 그대로 nglN
    const plain = commandPlan(gpu, config, { ...model, arch: { ...model.arch, loops: undefined } }, row, q, { ctx: 32768, kvQuant: 'f16' });
    expect(llamaNotes(tArgs as never, 'en', plain, 0)[0]!.text).toBe('nglN {"n":5,"layers":22}');
  });
});
