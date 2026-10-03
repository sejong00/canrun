/**
 * 계산기 리듀서 (P1-3 D31·D36) — 하드웨어 부류가 바뀔 때만 RAM·OS 를 기본값으로 되돌리고, 같은 부류 안에서는 사용자 선택을 유지한다.
 * 커스텀 하드웨어 열기도 같은 규칙을 따른다 (재검증: 맥 36GB → 커스텀 dGPU 가 시스템 RAM 36GB 로 평가되던 문제).
 */
import { toCatalogLite } from '@canrun/data/client';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../../packages/data/test/seed';
import { makeReducer } from '../components/islands/calc-shared';
import { defaultState, type CalcState } from '../lib/calc/state';
import { formatMemGB } from '../lib/format';

const catalog = toCatalogLite(loadSeed());
const reduce = makeReducer(catalog);
const at = (gpuId: string, extra: Partial<CalcState> = {}): CalcState => ({ ...defaultState(), hardware: { kind: 'catalog', gpuId }, ...extra });

describe('calculator reducer — RAM/OS reset only on a change of hardware class', () => {
  it('dGPU → dGPU keeps the chosen RAM and OS', () => {
    const next = reduce(at('rtx-4060', { ramGB: 64, os: 'linux' }), { type: 'hardware', hardware: { kind: 'catalog', gpuId: 'rtx-4070' } });
    expect(next.ramGB).toBe(64);
    expect(next.os).toBe('linux');
  });

  it('unified → custom dGPU resets RAM to the dGPU default (was: a Mac 36 GB became the custom dGPU system RAM)', () => {
    const next = reduce(at('apple-m4-max-32c', { ramGB: 36 }), { type: 'custom', patch: {} });
    expect(next.hardware).toMatchObject({ kind: 'custom', custom: { kind: 'dgpu' } });
    expect(next.ramGB).toBeUndefined();
  });

  it('CPU profile → custom dGPU resets RAM and OS', () => {
    const next = reduce(at('cpu-ddr5-5600-2ch', { ramGB: 16, os: 'windows' }), { type: 'custom', patch: {} });
    expect(next.ramGB).toBeUndefined();
    expect(next.os).toBeUndefined();
  });

  it('none → custom dGPU keeps a user RAM choice (same dGPU class)', () => {
    const next = reduce({ ...defaultState(), ramGB: 64 }, { type: 'custom', patch: {} });
    expect(next.ramGB).toBe(64);
  });

  it('custom dGPU ↔ custom unified resets RAM', () => {
    const dgpu = reduce(reduce({ ...defaultState() }, { type: 'custom', patch: { vramGB: 16, bandwidthGBs: 448 } }), { type: 'ram', ramGB: 64 });
    expect(dgpu.ramGB).toBe(64);
    const unified = reduce(dgpu, { type: 'custom', patch: { kind: 'unified', memGB: 48 } });
    expect(unified.hardware).toMatchObject({ custom: { kind: 'unified', effClass: 'apple' } });
    expect(unified.ramGB).toBeUndefined(); // 통합의 RAM 은 memGB 그 자체 (기본값)
  });
});

describe('formatMemGB keeps an entered fraction without padding whole numbers', () => {
  it('3.5 stays 3.5, 8 stays 8 (custom share text and assumptions)', () => {
    expect(formatMemGB('en', 3.5)).toBe('3.5');
    expect(formatMemGB('ko', 3.5)).toBe('3.5');
    expect(formatMemGB('en', 8)).toBe('8');
    expect(formatMemGB('en', 1024)).toBe('1,024');
  });
});

describe('calculator reducer — manual model values (D66)', () => {
  it('a value replaces a loaded HF model; an empty patch (opening the panel, clearing a field) does not', () => {
    const loaded = at('rtx-4060', { hf: 'Qwen/Qwen3-4B' });
    expect(reduce(loaded, { type: 'manual', patch: {} }).hf).toBe('Qwen/Qwen3-4B');
    expect(reduce(loaded, { type: 'manual', patch: { paramsB: undefined } })).toMatchObject({ hf: 'Qwen/Qwen3-4B', manual: undefined });
    const typed = reduce(loaded, { type: 'manual', patch: { paramsB: 8 } });
    expect(typed).toMatchObject({ manual: { paramsB: 8 } });
    expect(typed.hf).toBeUndefined();
  });

  it('patches merge; mid-typing out-of-range values stay; clearing the last field drops the spec', () => {
    let s = reduce(at('rtx-4060'), { type: 'manual', patch: { paramsB: 8.03 } });
    s = reduce(s, { type: 'manual', patch: { headDim: 1 } });
    expect(s.manual).toEqual({ paramsB: 8.03, headDim: 1 });
    s = reduce(s, { type: 'manual', patch: { headDim: undefined, paramsB: undefined } });
    expect(s.manual).toBeUndefined();
  });

  it('loading an HF model, picking a catalog model or a catalog card target drops the manual values; null removes them', () => {
    const typed = at('rtx-4060', { manual: { paramsB: 8, layers: 32, kvHeads: 8, headDim: 128 } });
    expect(reduce(typed, { type: 'hf', hf: 'Qwen/Qwen3-4B' })).toMatchObject({ hf: 'Qwen/Qwen3-4B', manual: undefined });
    expect(reduce(typed, { type: 'hf', hf: undefined }).manual).toEqual(typed.manual);
    expect(reduce({ ...typed, mode: 'model' }, { type: 'pickModel', focus: 'qwen3-14b' }).manual).toBeUndefined();
    expect(reduce(typed, { type: 'toModel', focus: 'qwen3-14b' }).manual).toBeUndefined();
    // 직접 입력 카드의 "이 모델이 돌아가는 GPU 보기"는 그 모델 그대로
    expect(reduce(typed, { type: 'toModel' })).toMatchObject({ mode: 'model', manual: typed.manual });
    expect(reduce(typed, { type: 'manual', patch: null }).manual).toBeUndefined();
  });
});

describe('calculator reducer — model mode (10-03 D65)', () => {
  it('switching modes keeps hardware, RAM, filters and the shared min verdict', () => {
    const start = at('rtx-4060', { ramGB: 16, min: 'A', cat: ['coding'], focus: 'qwen3-14b' });
    const model = reduce(start, { type: 'mode', mode: 'model' });
    expect(model).toEqual({ ...start, mode: 'model' });
    expect(reduce(model, { type: 'mode', mode: 'hardware' })).toEqual(start);
  });

  it('picking a catalog model drops a loaded HF model', () => {
    const next = reduce({ ...defaultState(), mode: 'model', hf: 'Qwen/Qwen3-4B', focus: 'llama-3.1-8b' }, { type: 'pickModel', focus: 'qwen3-14b' });
    expect(next.focus).toBe('qwen3-14b');
    expect(next.hf).toBeUndefined();
  });

  it('toModel: a catalog card targets its model (and drops hf); the HF card keeps hf and the focus', () => {
    const fromCard = reduce(at('rtx-4060', { hf: 'Qwen/Qwen3-4B' }), { type: 'toModel', focus: 'gpt-oss-20b' });
    expect(fromCard).toMatchObject({ mode: 'model', focus: 'gpt-oss-20b', hardware: { kind: 'catalog', gpuId: 'rtx-4060' } });
    expect(fromCard.hf).toBeUndefined();
    const fromHf = reduce(at('rtx-4060', { hf: 'Qwen/Qwen3-4B', focus: 'llama-3.1-8b' }), { type: 'toModel' });
    expect(fromHf).toMatchObject({ mode: 'model', hf: 'Qwen/Qwen3-4B', focus: 'llama-3.1-8b' });
  });

  it('useGpu: dGPU → dGPU keeps the user RAM; a Mac or CPU row brings the RAM that row used; the target model stays focused', () => {
    const base: CalcState = { ...at('rtx-4060', { ramGB: 64, os: 'linux' }), mode: 'model', focus: 'qwen3-14b' };
    const dgpu = reduce(base, { type: 'useGpu', gpuId: 'rtx-3090' });
    expect(dgpu).toMatchObject({ mode: 'hardware', hardware: { kind: 'catalog', gpuId: 'rtx-3090' }, ramGB: 64, os: 'linux', focus: 'qwen3-14b' });
    const mac = reduce(base, { type: 'useGpu', gpuId: 'apple-m4-max-40c', ramGB: 48 });
    expect(mac).toMatchObject({ mode: 'hardware', hardware: { kind: 'catalog', gpuId: 'apple-m4-max-40c' }, ramGB: 48 });
    expect(mac.os).toBeUndefined();
    const cpu = reduce(base, { type: 'useGpu', gpuId: 'cpu-ddr4-3200-2ch', ramGB: 32 });
    expect(cpu).toMatchObject({ hardware: { kind: 'catalog', gpuId: 'cpu-ddr4-3200-2ch' }, ddr: 'ddr4-3200', ramGB: 32 });
    // dGPU 행에 RAM 이 와도 사용자 RAM 을 유지한다 (행 RAM 은 허브 가정 32GB)
    expect(reduce(base, { type: 'useGpu', gpuId: 'rtx-3090', ramGB: 32 }).ramGB).toBe(64);
  });

  it('useGpu: a row was assessed as one card, so the GPU count goes back to one (no forced theoretical label)', () => {
    const multi = reduce(defaultState(), { type: 'restore', state: { ...at('rtx-3090', { ramGB: 64 }), gpus: 2, mode: 'model', focus: 'llama-3.3-70b' } });
    expect(multi.gpus).toBe(2);
    const next = reduce(multi, { type: 'useGpu', gpuId: 'rtx-4090' });
    expect(next).toMatchObject({ mode: 'hardware', hardware: { kind: 'catalog', gpuId: 'rtx-4090' }, ramGB: 64, focus: 'llama-3.3-70b' });
    expect(next.gpus).toBeUndefined();
  });

  it('type / budget / gsort are normalised; clearGpuFilters clears type, budget and min only', () => {
    let s: CalcState = { ...defaultState(), mode: 'model', focus: 'qwen3-14b', cat: ['chat'] };
    s = reduce(s, { type: 'type', hwType: ['cpu', 'desktop', 'cpu'] });
    expect(s.type).toEqual(['desktop', 'cpu']);
    s = reduce(s, { type: 'budget', budget: 650 });
    expect(s.budget).toBeUndefined();
    s = reduce(s, { type: 'budget', budget: 700 });
    expect(s.budget).toBe(700);
    s = reduce(s, { type: 'gsort', gsort: 'price' });
    s = reduce(s, { type: 'min', min: 'S' });
    const cleared = reduce(s, { type: 'clearGpuFilters' });
    expect(cleared).toMatchObject({ type: [], min: undefined, gsort: 'price', cat: ['chat'] });
    expect(cleared.budget).toBeUndefined();
  });
});
