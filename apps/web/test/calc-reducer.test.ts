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
