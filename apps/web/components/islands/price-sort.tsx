'use client';
import { useId, useState } from 'react';
import { isSortKey, sortRows, type SortKey } from '@/lib/calc/sort';
import { useHydrated } from '@/lib/hydration';

/**
 * 모델 허브 GPU 표 정렬 컨트롤 (docs/01 F2, P1-3 이월) — 서버 정적 표(`<tr data-sort-index data-price data-bandwidth>`)의
 * 행을 `tbody.append` 로 재배치한다. 표는 React 가 소유하지 않는 정적 마크업이라 재조정과 충돌하지 않는다.
 * SSR 에선 disabled, 하이드레이션 뒤 활성 (D36). URL 은 건드리지 않는다(허브 캐노니컬 청결).
 */
export type PriceSortLabels = {
  label: string;
  verdict: string;
  price: string;
  bandwidth: string;
  /** {count} 미가격 행 안내 — 서버가 count 별로 만든 문장 */
  announcePrice: string;
  announceBandwidth: string;
  announceVerdict: string;
};

export function PriceSort({ tableId, labels }: { tableId: string; labels: PriceSortLabels }) {
  const id = useId();
  const hydrated = useHydrated();
  const [key, setKey] = useState<SortKey>('verdict');
  const [status, setStatus] = useState('');

  const apply = (next: SortKey) => {
    const tbody = document.getElementById(tableId)?.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-sort-index]')).map((el) => ({
      el,
      index: Number(el.dataset.sortIndex),
      ...(el.dataset.price !== undefined ? { price: Number(el.dataset.price) } : {}),
      bandwidth: Number(el.dataset.bandwidth ?? 0),
    }));
    for (const r of sortRows(rows, next)) tbody.append(r.el);
    setKey(next);
    setStatus(next === 'verdict' ? labels.announceVerdict : next === 'price-asc' ? labels.announcePrice : labels.announceBandwidth);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={id}>{labels.label}</label>
      <select
        id={id}
        data-sort-control
        value={key}
        disabled={!hydrated}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (isSortKey(v)) apply(v);
        }}
        className="h-11 rounded-md border border-border bg-background px-2 text-base sm:h-9 sm:text-sm"
      >
        <option value="verdict">{labels.verdict}</option>
        <option value="price-asc">{labels.price}</option>
        <option value="bandwidth-desc">{labels.bandwidth}</option>
      </select>
      <p role="status" aria-live="polite" className="basis-full text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
