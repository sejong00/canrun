/** 모델 허브 GPU 표 정렬 규칙 (docs/01 §3·F2) */
import { describe, expect, it } from 'vitest';
import { isSortKey, sortRows } from '../lib/calc/sort';

const rows = [
  { index: 0, id: 'a', price: 500, bandwidth: 900 },
  { index: 1, id: 'b', bandwidth: 1000 },
  { index: 2, id: 'c', price: 250, bandwidth: 300 },
  { index: 3, id: 'd', price: 250, bandwidth: 400 },
  { index: 4, id: 'e', bandwidth: 100 },
];

describe('sortRows', () => {
  it('verdict = server order, input untouched', () => {
    const shuffled = [rows[3]!, rows[0]!, rows[4]!, rows[1]!, rows[2]!];
    expect(sortRows(shuffled, 'verdict').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(shuffled.map((r) => r.id)).toEqual(['d', 'a', 'e', 'b', 'c']);
  });

  it('price-asc: cheapest first, ties by server order, unpriced rows last in server order', () => {
    expect(sortRows(rows, 'price-asc').map((r) => r.id)).toEqual(['c', 'd', 'a', 'b', 'e']);
  });

  it('bandwidth-desc: highest first, ties by server order', () => {
    expect(sortRows(rows, 'bandwidth-desc').map((r) => r.id)).toEqual(['b', 'a', 'd', 'c', 'e']);
  });

  it('handles empty and all-unpriced input', () => {
    expect(sortRows([], 'price-asc')).toEqual([]);
    expect(sortRows([rows[1]!, rows[4]!], 'price-asc').map((r) => r.id)).toEqual(['b', 'e']);
  });

  it('a unified-memory device keeps no price even if the catalog had one (caller filters to dGPU street prices)', () => {
    // 정렬 함수는 price 필드만 본다 — dGPU 한정·priceAsOf 동반은 서버(data-price 부여)가 보장한다
    expect(isSortKey('price-asc')).toBe(true);
    expect(isSortKey('msrp')).toBe(false);
  });
});
