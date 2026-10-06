'use client';
import type { CatalogLite } from '@canrun/data/client';
import { useId, type Dispatch } from 'react';
import type { CalcAction, CalcTranslators } from '@/components/islands/calc-shared';
import { ResultCard, type PinnedMeta } from '@/components/islands/result-card';
import { VerdictChip } from '@/components/verdict-chip';
import type { RunResult } from '@/lib/calc/run';
import { CATEGORIES, SIZE_BUCKETS, SORT_KEYS, type CalcState, type SizeBucket, type SortKey } from '@/lib/calc/state';

// 칩의 체크박스·라디오는 sr-only — 키보드 포커스 표시는 래퍼가 :has(:focus-visible) 로 대신한다
const CHIP =
  'inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-sm has-[:checked]:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2';
// 모바일은 16px — iOS Safari 는 16px 미만 폼 컨트롤에 포커스하면 페이지를 확대한다
const SELECT = 'h-11 rounded-md border border-border bg-background px-2 text-base sm:h-9 sm:text-sm';

const SIZE_KEY: Record<SizeBucket, string> = { s: 'sizeS', m: 'sizeM', l: 'sizeL', xl: 'sizeXl' };
/** 정렬 메뉴 문구 — 순서는 SORT_KEYS (10-06 D68: 추천순 기본) */
const SORT_LABEL: Record<SortKey, string> = {
  rec: 'sortRec',
  popular: 'sortPopular',
  downloads: 'sortDownloads',
  verdict: 'sortVerdict',
  speed: 'sortSpeed',
  size: 'sortSize',
};

/** 결과 영역 (docs/01 F1) — 카운트 한 줄만 aria-live, 판정 요약, 필터·정렬, 카드 목록, 빈 상태 */
export function ResultList({
  locale,
  catalog,
  t,
  state,
  dispatch,
  results,
  hydrated,
  prefix,
  issueUrl,
  pinnedMeta,
  onSeeGpus,
}: {
  locale: string;
  catalog: CatalogLite;
  t: CalcTranslators;
  state: CalcState;
  dispatch: Dispatch<CalcAction>;
  results: RunResult | undefined;
  hydrated: boolean;
  prefix: string;
  issueUrl: string;
  /** 결과 맨 위 카드의 출처 — 불러온 모델의 HF 저장소(D57) 또는 직접 입력(D66) */
  pinnedMeta?: PinnedMeta;
  /** 카드 → 그 모델의 GPU 목록(모델 모드, D65). 불러온 모델 카드는 인자 없이 */
  onSeeGpus: (modelId?: string) => void;
}) {
  const id = useId();
  const total = catalog.models.length;
  const toggle = <T extends string>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const hiddenFocus = results && state.focus && results.all.some((c) => c.model.id === state.focus) && !results.cards.some((c) => c.model.id === state.focus);
  const focusModel = state.focus ? catalog.models.find((m) => m.id === state.focus) : undefined;
  // 다운로드 수 기준일 — 모델마다 다르면(읽기 실패로 옛 값이 남은 모델) 가장 이른 날
  const downloadsAsOf = catalog.models.reduce<string | undefined>(
    (min, m) => (m.hfDownloadsAsOf !== undefined && (min === undefined || m.hfDownloadsAsOf < min) ? m.hfDownloadsAsOf : min),
    undefined,
  );
  // 정렬 안내 한 줄 — 추천순·인기순은 순서의 뜻, 다운로드 순은 수치의 출처와 한계. 보이는 카드가 없으면 생략.
  // 추천순은 보이는 카드에 쾌적·원활이 하나도 없으면(CPU 전용 등) 그 경우의 순서를 따로 밝힌다(D68 리뷰 반영)
  const shown = results?.cards ?? [];
  const anyRunsWell = shown.some((c) => c.combo.baseline.result.verdict === 'S' || c.combo.baseline.result.verdict === 'A');
  let sortNote: string | undefined;
  if (shown.length > 0) {
    if (state.sort === 'rec') sortNote = t.calc(anyRunsWell ? 'sortRecHint' : 'sortRecHintSlow');
    else if (state.sort === 'popular') sortNote = t.calc('sortPopularHint');
    else if (state.sort === 'downloads' && downloadsAsOf !== undefined) sortNote = t.calc('downloadsNote', { date: downloadsAsOf });
  }

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-4">
      <h2 id="results-heading" tabIndex={-1} className="text-xl font-semibold tracking-tight">
        {t.calc('resultsHeading')}
      </h2>
      <p data-results-count aria-live="polite" className="text-sm text-muted-foreground">
        {results ? t.calc('resultsCount', { shown: results.cards.length, total }) : ''}
      </p>
      {!results && (
        <p className="min-h-40 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{t.calc('emptyNoGpu')}</p>
      )}
      {results && (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {(['S', 'A', 'B', 'F'] as const).map((v) => (
              <span key={v} className="inline-flex items-center gap-1">
                <VerdictChip verdict={v} label={t.verdict(v)} compact />
                <span className="tabular-nums">{results.counts[v]}</span>
              </span>
            ))}
            {results.counts.otherQuant > 0 && <span className="text-muted-foreground">{t.calc('summaryOther', { count: results.counts.otherQuant })}</span>}
          </p>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm sm:flex-row sm:flex-wrap sm:items-start sm:gap-6">
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="mb-1 font-medium">{t.calc('filterUse')}</legend>
              {CATEGORIES.map((cat) => (
                <label key={cat} className={CHIP}>
                  <input type="checkbox" className="sr-only" checked={state.cat.includes(cat)} disabled={!hydrated} onChange={() => dispatch({ type: 'cat', cat: toggle(state.cat, cat) })} />
                  {t.category(cat)}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="mb-1 font-medium">{t.calc('filterVerdict')}</legend>
              {([undefined, 'B', 'A', 'S'] as const).map((min) => (
                <label key={min ?? 'all'} className={CHIP}>
                  <input type="radio" name={`${id}-min`} className="sr-only" checked={state.min === min} disabled={!hydrated} onChange={() => dispatch({ type: 'min', min })} />
                  {min === undefined ? t.calc('filterVerdictAll') : min === 'S' ? t.calc('filterVerdictS', { verdict: t.verdict('S') }) : t.calc('filterVerdictMin', { verdict: t.verdict(min) })}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="mb-1 font-medium">{t.calc('filterSize')}</legend>
              {SIZE_BUCKETS.map((size) => (
                <label key={size} className={CHIP}>
                  <input type="checkbox" className="sr-only" checked={state.size.includes(size)} disabled={!hydrated} onChange={() => dispatch({ type: 'size', size: toggle(state.size, size) })} />
                  {t.calc(SIZE_KEY[size])}
                </label>
              ))}
            </fieldset>
            <div className="flex items-center gap-2">
              <label htmlFor={`${id}-sort`} className="font-medium">
                {t.calc('sortLabel')}
              </label>
              <select
                id={`${id}-sort`}
                name="sort"
                className={SELECT}
                value={state.sort}
                disabled={!hydrated}
                onChange={(e) => dispatch({ type: 'sort', sort: e.currentTarget.value as CalcState['sort'] })}
              >
                {SORT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {t.calc(SORT_LABEL[key])}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {sortNote && (
            <p data-sort-note={state.sort === 'rec' && !anyRunsWell ? 'rec-slow' : state.sort} className="text-xs text-muted-foreground">
              {sortNote}
            </p>
          )}

          {results.pinned && pinnedMeta && (
            <div data-hf-result data-pinned-kind={pinnedMeta.kind} className="flex min-w-0 flex-col gap-2">
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ResultCard
                  locale={locale}
                  t={t}
                  card={results.pinned}
                  state={state}
                  hardware={results.hardware}
                  prefix={prefix}
                  focused={false}
                  external={pinnedMeta}
                  onSeeGpus={() => onSeeGpus()}
                />
              </ul>
              <p className="text-xs text-muted-foreground">{pinnedMeta.kind === 'manual' ? t.calc('manualNote') : t.calc('hfNote')}</p>
            </div>
          )}

          {hiddenFocus && focusModel && (
            <p className="text-sm text-muted-foreground">
              {t.calc('hiddenModel', { model: focusModel.name })}{' '}
              <button type="button" className="underline underline-offset-4" onClick={() => dispatch({ type: 'clearFilters' })}>
                {t.calc('clearFilters')}
              </button>
            </p>
          )}

          {results.cards.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t.calc('emptyFiltered')}{' '}
              <button type="button" className="underline underline-offset-4" onClick={() => dispatch({ type: 'clearFilters' })}>
                {t.calc('clearFilters')}
              </button>
            </p>
          ) : (
            <ul data-results className="grid gap-3 sm:grid-cols-2">
              {results.cards.map((card) => (
                <ResultCard
                  key={card.model.id}
                  locale={locale}
                  t={t}
                  card={card}
                  state={state}
                  hardware={results.hardware}
                  prefix={prefix}
                  focused={state.focus === card.model.id}
                  onSeeGpus={() => onSeeGpus(card.model.id)}
                />
              ))}
            </ul>
          )}
          {results.all.some((c) => c.combo.reasoning) && <p className="text-xs text-muted-foreground">{t.common('reasoningNote')}</p>}
          <p className="text-sm text-muted-foreground">
            <a href={issueUrl}>
              {t.calc('requestModel')}
            </a>
          </p>
        </>
      )}
    </section>
  );
}
