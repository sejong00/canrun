/**
 * 목록 페이지 표 정렬·거르기 (10-19 `/models`·`/gpus`) — 순수 함수, 의존성 0(클라이언트 아일랜드가 쓴다).
 * 브라우저에서는 `ListControls` 아일랜드가 서버가 그린 `<tr data-sort-index data-…>` 의 data 속성을 읽어 이 규칙으로
 * 행을 다시 놓고 숨긴다. 서버 HTML 에는 늘 전 행이 기본 순서로 들어 있다(크롤러·JS 없는 방문자).
 */

/** 행 하나 — `index` = 서버 기본 순서, `data` = 쓰는 data 속성 값(`data-<이름>`, 없으면 undefined) */
export type ListRowData = { index: number; data: Readonly<Record<string, string | undefined>> };

/** 정렬 기준 — `key` 가 없으면 서버 기본 순서. 값이 없거나 숫자가 아닌 행은 늘 뒤(그 안에서는 기본 순서) */
export type ListSortSpec = { key?: string; desc?: boolean };

/** 거르기 상태 — `selects`: data-<이름> 이 값과 같은 행만(빈 문자열 = 전체), `toggles`: data-<이름> 이 있는 행만 */
export type ListFilterState = { selects: Readonly<Record<string, string>>; toggles: readonly string[] };

const numberOf = (row: ListRowData, key: string): number | undefined => {
  const raw = row.data[key];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

/** 입력 배열을 바꾸지 않고 정렬된 새 배열을 돌려준다 */
export function orderRows<R extends ListRowData>(rows: readonly R[], sort: ListSortSpec): R[] {
  const byIndex = (a: R, b: R) => a.index - b.index;
  const key = sort.key;
  if (!key) return [...rows].sort(byIndex);
  const valued = rows.filter((r) => numberOf(r, key) !== undefined);
  const missing = rows.filter((r) => numberOf(r, key) === undefined).sort(byIndex);
  valued.sort((a, b) => {
    const diff = numberOf(a, key)! - numberOf(b, key)!;
    return (sort.desc ? -diff : diff) || byIndex(a, b);
  });
  return [...valued, ...missing];
}

export function rowMatches(row: ListRowData, state: ListFilterState): boolean {
  for (const [name, value] of Object.entries(state.selects)) {
    if (value !== '' && row.data[name] !== value) return false;
  }
  return state.toggles.every((name) => row.data[name] !== undefined);
}

/** 거르기가 하나라도 걸려 있는지 — 아일랜드가 "N개 중 M개" 문장을 붙일지 정한다 */
export const isFiltered = (state: ListFilterState): boolean =>
  state.toggles.length > 0 || Object.values(state.selects).some((value) => value !== '');
