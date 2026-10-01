'use client';
import type { CatalogLite } from '@canrun/data/client';
import { useId, type Dispatch } from 'react';
import type { CalcAction, CalcTranslators } from '@/components/islands/calc-shared';
import { ResultCard } from '@/components/islands/result-card';
import { VerdictChip } from '@/components/verdict-chip';
import type { RunResult } from '@/lib/calc/run';
import { CATEGORIES, SIZE_BUCKETS, type CalcState, type SizeBucket } from '@/lib/calc/state';

// 칩의 체크박스·라디오는 sr-only — 키보드 포커스 표시는 래퍼가 :has(:focus-visible) 로 대신한다
const CHIP =
  'inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-sm has-[:checked]:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2';
// 모바일은 16px — iOS Safari 는 16px 미만 폼 컨트롤에 포커스하면 페이지를 확대한다
const SELECT = 'h-11 rounded-md border border-border bg-background px-2 text-base sm:h-9 sm:text-sm';

const SIZE_KEY: Record<SizeBucket, string> = { s: 'sizeS', m: 'sizeM', l: 'sizeL', xl: 'sizeXl' };

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
  hfMeta,
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
  /** 불러온 모델의 HF 저장소 (결과 맨 위 카드의 링크) — D57 */
  hfMeta?: { baseId: string; ggufRepo: string };
}) {
  const id = useId();
  const total = catalog.models.length;
  const toggle = <T extends string>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const hiddenFocus = results && state.focus && results.all.some((c) => c.model.id === state.focus) && !results.cards.some((c) => c.model.id === state.focus);
  const focusModel = state.focus ? catalog.models.find((m) => m.id === state.focus) : undefined;

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
              <select id={`${id}-sort`} className={SELECT} value={state.sort} disabled={!hydrated} onChange={(e) => dispatch({ type: 'sort', sort: e.currentTarget.value as CalcState['sort'] })}>
                <option value="verdict">{t.calc('sortVerdict')}</option>
                <option value="speed">{t.calc('sortSpeed')}</option>
                <option value="size">{t.calc('sortSize')}</option>
              </select>
            </div>
          </div>

          {results.pinned && hfMeta && (
            <div data-hf-result className="flex min-w-0 flex-col gap-2">
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ResultCard
                  locale={locale}
                  t={t}
                  card={results.pinned}
                  state={state}
                  hardware={results.hardware}
                  prefix={prefix}
                  focused={false}
                  external={hfMeta}
                />
              </ul>
              <p className="text-xs text-muted-foreground">{t.calc('hfNote')}</p>
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
