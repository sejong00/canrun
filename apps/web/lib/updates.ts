/**
 * 업데이트 소식 — 카탈로그 추가 날짜별 묶음 (10-14 D72). 순수 함수: 서버 컴포넌트(`components/updates.tsx`)가 `catalog.models` 로 부른다.
 */
import type { Model } from '@canrun/data';

type AddedModel = Pick<Model, 'id' | 'name' | 'addedAt'>;

export type CatalogAdditionGroup<M extends AddedModel> = { date: string; models: M[] };

/** `addedAt` 날짜별 묶음 — 최신 날짜가 위, 같은 날은 이름순(en 정렬 — 로캘과 무관하게 같은 순서) */
export function catalogAdditions<M extends AddedModel>(models: readonly M[]): CatalogAdditionGroup<M>[] {
  const byDate = new Map<string, M[]>();
  for (const model of models) byDate.set(model.addedAt, [...(byDate.get(model.addedAt) ?? []), model]);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({
      date,
      models: [...list].sort((x, y) => x.name.localeCompare(y.name, 'en', { sensitivity: 'base', numeric: true }) || x.id.localeCompare(y.id)),
    }));
}
