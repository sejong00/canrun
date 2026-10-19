'use client';
import { useId, useState } from 'react';
import { useHydrated } from '@/lib/hydration';
import { isFiltered, orderRows, rowMatches, type ListFilterState } from '@/lib/list-order';

/**
 * 목록 페이지 정렬·거르기 컨트롤 (10-19 `/models`·`/gpus`) — 서버가 그린 정적 표(`[data-list="<list>"] tbody tr[data-sort-index …]`)의
 * 행을 `tbody.append` 로 다시 놓고 `hidden` 으로 숨긴다(`PriceSort` 와 같은 방식 — 표는 React 가 소유하지 않는 정적 마크업).
 * 규칙은 `lib/list-order.ts`. SSR 에선 disabled, 하이드레이션 뒤 활성(D36). URL 은 건드리지 않는다(캐노니컬 청결).
 * 문장은 서버가 완성해 넘긴다 — "N개 중 M개"는 `shownTemplate` 의 `{shown}` 만 바꾼다(번역 런타임 없음, D6).
 */
export type ListSortOption = {
  value: string;
  label: string;
  /** 정렬에 쓰는 data 속성 이름 — 없으면 서버 기본 순서 */
  key?: string;
  desc?: boolean;
  /** 고른 뒤 읽어 줄 문장 */
  announce: string;
};
export type ListSelectFilter = {
  name: string;
  label: string;
  /** 첫 항목(전체)의 라벨 */
  all: string;
  options: ReadonlyArray<{ value: string; label: string }>;
};
export type ListToggleFilter = { name: string; label: string };

const CONTROL_CLASS = 'h-11 rounded-md border border-border bg-background px-2 text-base sm:h-9 sm:text-sm';

export function ListControls({
  list,
  sortLabel,
  sorts,
  selects = [],
  toggles = [],
  togglesLabel = '',
  shownTemplate = '',
  emptyText = '',
}: {
  list: string;
  sortLabel: string;
  sorts: readonly ListSortOption[];
  selects?: readonly ListSelectFilter[];
  toggles?: readonly ListToggleFilter[];
  togglesLabel?: string;
  /** "{shown}" 자리에 보이는 행 수가 들어가는 문장 — 거르기가 걸렸을 때만 */
  shownTemplate?: string;
  emptyText?: string;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const [sort, setSort] = useState(sorts[0]!.value);
  const [state, setState] = useState<ListFilterState>({ selects: {}, toggles: [] });
  const [status, setStatus] = useState('');

  const apply = (nextSort: string, next: ListFilterState) => {
    const option = sorts.find((s) => s.value === nextSort) ?? sorts[0]!;
    const names = [option.key, ...selects.map((f) => f.name), ...toggles.map((f) => f.name)].filter(
      (name): name is string => name !== undefined,
    );
    let shown = 0;
    for (const tbody of Array.from(document.querySelectorAll(`[data-list="${list}"] tbody`))) {
      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-sort-index]')).map((el) => ({
        el,
        index: Number(el.dataset.sortIndex),
        data: Object.fromEntries(names.map((name) => [name, el.getAttribute(`data-${name}`) ?? undefined])),
      }));
      for (const row of orderRows(rows, option)) {
        const match = rowMatches(row, next);
        row.el.hidden = !match;
        if (match) shown += 1;
        tbody.append(row.el);
      }
    }
    setSort(option.value);
    setState(next);
    const count = isFiltered(next) && shownTemplate ? (shown === 0 ? emptyText : shownTemplate.replace('{shown}', String(shown))) : '';
    setStatus([option.announce, count].filter((s) => s !== '').join(' '));
  };

  return (
    <div data-list-controls={list} className="flex flex-wrap items-end gap-x-4 gap-y-3 text-sm">
      <label htmlFor={`${id}-sort`} className="flex flex-col gap-1">
        {sortLabel}
        <select
          id={`${id}-sort`}
          data-list-sort
          value={sort}
          disabled={!hydrated}
          onChange={(e) => apply(e.currentTarget.value, state)}
          className={CONTROL_CLASS}
        >
          {sorts.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {selects.map((filter) => (
        <label key={filter.name} htmlFor={`${id}-${filter.name}`} className="flex flex-col gap-1">
          {filter.label}
          <select
            id={`${id}-${filter.name}`}
            data-list-filter={filter.name}
            value={state.selects[filter.name] ?? ''}
            disabled={!hydrated}
            onChange={(e) => apply(sort, { ...state, selects: { ...state.selects, [filter.name]: e.currentTarget.value } })}
            className={CONTROL_CLASS}
          >
            <option value="">{filter.all}</option>
            {filter.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {toggles.length > 0 && (
        <fieldset className="flex min-w-0 flex-wrap items-center gap-x-4">
          <legend className="mb-1">{togglesLabel}</legend>
          {toggles.map((toggle) => (
            <label key={toggle.name} className="inline-flex min-h-11 items-center gap-2 sm:min-h-9">
              <input
                type="checkbox"
                data-list-toggle={toggle.name}
                checked={state.toggles.includes(toggle.name)}
                disabled={!hydrated}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  apply(sort, {
                    ...state,
                    toggles: on ? [...state.toggles, toggle.name] : state.toggles.filter((n) => n !== toggle.name),
                  });
                }}
                className="size-4"
              />
              {toggle.label}
            </label>
          ))}
        </fieldset>
      )}
      <p role="status" aria-live="polite" data-list-status className="basis-full text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
