/**
 * 콤보 시스템 RAM 토글 (10-03 D64) — 아일랜드 초기값 파싱(`?ctx=&kv=&ram=`)과 계산기 카드 "상세" 링크의 쿼리.
 */
import { HUB_POLICY, toCatalogLite } from '@canrun/data/client';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../../packages/data/test/seed';
import { comboDetailQuery, resolveHardware } from '../lib/calc/hardware';
import { defaultState, type CalcState } from '../lib/calc/state';
import { comboPreset, type ComboPresetInput } from '../lib/combo-preset';

const base: ComboPresetInput = {
  ctxs: [4096, 8192, 16384, 32768],
  kvQuants: ['f16', 'q8_0', 'q4_0'],
  initial: { ctx: 8192, kv: 'f16' },
};
const withRam: ComboPresetInput = { ...base, ram: { options: [16, 32, 64, 96, 128], initial: 32 } };

describe('comboPreset — 처음 열 때만 읽는 URL 초기값 (D28 · D64)', () => {
  it('reads ctx and kv as before when the page has no RAM toggle, ignoring ram', () => {
    expect(comboPreset('?ctx=16384&kv=q8_0', base)).toEqual({ ctxIdx: 2, kv: 'q8_0' });
    expect(comboPreset('?ram=16&ctx=16384', base)).toEqual({ ctxIdx: 2, kv: 'f16' });
    expect(comboPreset('?ctx=12345&kv=q2', base)).toEqual({ ctxIdx: 1, kv: 'f16' });
    expect(comboPreset('', base)).toEqual({ ctxIdx: 1, kv: 'f16' });
  });

  it('a valid other RAM wins over ctx/kv (RAM mode is 8k·f16 only); the static RAM or an unknown one is ignored', () => {
    expect(comboPreset('?ram=16', withRam)).toEqual({ ctxIdx: 1, kv: 'f16', ram: 16 });
    expect(comboPreset('?ram=64&ctx=16384&kv=q8_0', withRam)).toEqual({ ctxIdx: 1, kv: 'f16', ram: 64 });
    expect(comboPreset('?ram=32&ctx=16384', withRam)).toEqual({ ctxIdx: 2, kv: 'f16' });
    expect(comboPreset('?ram=24&kv=q4_0', withRam)).toEqual({ ctxIdx: 1, kv: 'q4_0' });
    expect(comboPreset('?ram=abc', withRam)).toEqual({ ctxIdx: 1, kv: 'f16' });
    // RAM 힌트 페이지 — 정적 기준이 96GB 면 32GB 가 "다른 RAM"
    const hint: ComboPresetInput = { ...base, ram: { options: [16, 32, 64, 96, 128], initial: 96 } };
    expect(comboPreset('?ram=32', hint)).toEqual({ ctxIdx: 1, kv: 'f16', ram: 32 });
    expect(comboPreset('?ram=96', hint)).toEqual({ ctxIdx: 1, kv: 'f16' });
  });
});

describe('comboDetailQuery — 계산기 카드 → 콤보 딥링크', () => {
  const catalog = toCatalogLite(loadSeed());
  const state = (gpuId: string, extra: Partial<CalcState> = {}): CalcState => ({
    ...defaultState(),
    hardware: { kind: 'catalog', gpuId },
    ...extra,
  });
  const query = (s: CalcState, cardCtx = s.ctx) => comboDetailQuery(s, resolveHardware(s, catalog)!, cardCtx);

  it('carries a dGPU system RAM on the RAM ladder — 32 GB included (RAM-hint pages start elsewhere)', () => {
    expect(query(state('rtx-4060'))).toBe(`?ram=${HUB_POLICY.dgpuRamGB}`);
    for (const ram of HUB_POLICY.comboRamGB) expect(query(state('rtx-4060', { ramGB: ram }))).toBe(`?ram=${ram}`);
  });

  it('drops ram off the ladder, on multi-GPU and on unified/CPU hardware', () => {
    expect(query(state('rtx-4060', { ramGB: 24 }))).toBe('');
    expect(query(state('rtx-3090', { gpus: 2 }))).toBe('');
    expect(query(state('apple-m4'))).toBe('');
  });

  it('a non-default context or KV cache keeps the ctx/kv link (RAM mode is 8k·f16 only)', () => {
    expect(query(state('rtx-4060', { ramGB: 16, ctx: 16384 }))).toBe('?ctx=16384&kv=f16');
    expect(query(state('rtx-4060', { kv: 'q8_0' }))).toBe('?ctx=8192&kv=q8_0');
    // 카드 ctx 는 모델 최대 컨텍스트로 잘린 값
    expect(query(state('rtx-4060', { ctx: 262144 }), 131072)).toBe('?ctx=131072&kv=f16');
  });
});
