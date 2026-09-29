/**
 * 모델 허브 GPU 표 정렬 (docs/01 F2, P1-3 이월) — 순수 함수. 브라우저에서는 `PriceSort` 아일랜드가
 * `<tr data-sort-index data-price data-bandwidth>` 를 읽어 같은 규칙으로 행을 재배치한다.
 * 가격 순위는 dGPU 실거래가(priceAsOf 동반)만 (docs/01 §3 — MSRP·통합 메모리 기기는 순위 밖).
 */
export type SortKey = 'verdict' | 'price-asc' | 'bandwidth-desc';

export const SORT_KEYS: readonly SortKey[] = ['verdict', 'price-asc', 'bandwidth-desc'];

export type SortableRow = {
  /** 서버 기본 정렬(판정 → tok/s → id)의 인덱스 */
  index: number;
  /** dGPU 실거래가 USD — 없으면 정렬에서 뒤로 */
  price?: number;
  bandwidth: number;
};

/** 입력 배열을 바꾸지 않고 정렬된 새 배열을 돌려준다. 가격 없는 행은 항상 뒤, 그 안에서는 기본 순서. */
export function sortRows<R extends SortableRow>(rows: readonly R[], key: SortKey): R[] {
  const byIndex = (a: R, b: R) => a.index - b.index;
  if (key === 'verdict') return [...rows].sort(byIndex);
  if (key === 'bandwidth-desc') return [...rows].sort((a, b) => b.bandwidth - a.bandwidth || byIndex(a, b));
  const priced = rows.filter((r) => r.price !== undefined).sort((a, b) => a.price! - b.price! || byIndex(a, b));
  const unpriced = rows.filter((r) => r.price === undefined).sort(byIndex);
  return [...priced, ...unpriced];
}

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}
