/**
 * 상세 페이지 → 계산기 딥 링크 쿼리 (10-19 D107 — `lib/calc-catalog.ts` calcDeepQuery). 계산기 코덱의 정규형이라 계산기가 그대로 읽고,
 * 그 페이지가 가정한 구성(통합·CPU 메모리)이 기본값과 다를 때만 `ram` 이 붙는다. 렌더된 위젯·링크는 test/export-invariants.spec.ts 가 전 페이지에서 본다.
 */
import { describe, expect, it } from 'vitest';
import { calcDeepQuery, getCatalogLite } from '@/lib/calc-catalog';
import { parseCalcQuery } from '@/lib/calc/url';

describe('calcDeepQuery', () => {
  it('a graphics card at the default 32 GB of system RAM is just gpu (+ m)', () => {
    expect(calcDeepQuery({ gpuId: 'rtx-4060' })).toBe('?gpu=rtx-4060');
    expect(calcDeepQuery({ gpuId: 'rtx-4060', modelId: 'qwen3-14b', ramGB: 32 })).toBe('?gpu=rtx-4060&m=qwen3-14b');
  });

  it('unified memory keeps a non-default size and drops the default (largest) one', () => {
    expect(calcDeepQuery({ gpuId: 'amd-strix-halo', modelId: 'qwen3-14b', ramGB: 64 })).toBe('?gpu=amd-strix-halo&ram=64&m=qwen3-14b');
    expect(calcDeepQuery({ gpuId: 'amd-strix-halo', ramGB: 128 })).toBe('?gpu=amd-strix-halo');
  });

  it('parses back to the same GPU, memory and focused model in the calculator', () => {
    const catalog = getCatalogLite();
    const state = parseCalcQuery(calcDeepQuery({ gpuId: 'apple-m4-pro', modelId: 'gpt-oss-20b', ramGB: 24 }), catalog);
    expect(state.hardware).toEqual({ kind: 'catalog', gpuId: 'apple-m4-pro' });
    expect(state.ramGB).toBe(24);
    expect(state.focus).toBe('gpt-oss-20b');
    expect(state.mode).toBe('hardware');
  });
});
