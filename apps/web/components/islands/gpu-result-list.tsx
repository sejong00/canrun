'use client';
import type { GpuCore, PricedOption } from '@canrun/data/client';
import { useId, type Dispatch } from 'react';
import type { CalcAction, CalcTranslators } from '@/components/islands/calc-shared';
import { GpuResultRow } from '@/components/islands/gpu-result-row';
import { Pill } from '@/components/pill';
import { VerdictChip } from '@/components/verdict-chip';
import { formatCtx, formatInt } from '@/lib/format';
import { formatPriceFx, krwNoteFx, type KrwRate } from '@/lib/krw';
import { comboDetailQuery } from '@/lib/calc/hardware';
import type { GpuView, MineRow, ModelRunResult } from '@/lib/calc/run-model';
import { BUDGET_OPTIONS_USD, HW_TYPES, type CalcState, type HwType } from '@/lib/calc/state';
import { gpuName, speedPhrase } from '@/lib/phrases';

// result-list.tsx 와 같은 칩·select (모바일 16px — iOS 확대 방지)
const CHIP =
  'inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-sm has-[:checked]:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2';
const SELECT = 'h-11 rounded-md border border-border bg-background px-2 text-base sm:h-9 sm:text-sm';


/**
 * 모델 모드 결과 (10-03 D65) — 카운트 한 줄만 aria-live, 판정 요약, 최저가(허브와 같은 규칙), 필터(종류·예산·판정)·정렬,
 * "내 구성" 행, GPU 목록, 빈 상태. 가격은 ko 에서 원화 참고값 + 환산 안내(D61).
 */
export function GpuResultList({
  locale,
  t,
  state,
  dispatch,
  run,
  view,
  mine,
  mineMeta,
  total,
  hydrated,
  prefix,
  fx,
  onUseGpu,
  onMineAll,
}: {
  locale: string;
  t: CalcTranslators;
  state: CalcState;
  dispatch: Dispatch<CalcAction>;
  run: ModelRunResult | undefined;
  view: GpuView | undefined;
  mine: MineRow | undefined;
  /** "내 구성" 행의 구성 문장 (하드웨어 모드 가정 문장과 같다) */
  mineMeta?: string;
  /** 카탈로그 GPU·맥·CPU 수 */
  total: number;
  hydrated: boolean;
  prefix: string;
  /** ko 페이지만 — 원화 참고값 */
  fx?: KrwRate;
  onUseGpu: (gpuId: string, ramGB?: number) => void;
  onMineAll: () => void;
}) {
  const id = useId();
  const toggle = <T extends string>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const price = (usd: number) => formatPriceFx(t.common, locale, usd, fx);
  const priceText = (gpu: GpuCore): string =>
    gpu.streetUSD !== undefined && gpu.priceAsOf
      ? t.gpuHub('priceStreet', { price: price(gpu.streetUSD), date: gpu.priceAsOf })
      : gpu.msrpUSD !== undefined
        ? t.gpuHub('priceMsrp', { price: price(gpu.msrpUSD) })
        : t.common('none');
  const osLabel = (os: string) => t.calc(os === 'windows' ? 'osWindows' : os === 'linux' ? 'osLinux' : 'osMacos');
  const mineId = state.hardware.kind === 'catalog' ? state.hardware.gpuId : undefined;
  // 키를 리터럴로 써서 i18n 정적 스캔이 확인하게 한다
  const typeLabel = (hwType: HwType) =>
    hwType === 'desktop' ? t.calc('typeDesktop') : hwType === 'laptop' ? t.calc('typeLaptop') : hwType === 'unified' ? t.calc('typeUnified') : t.calc('typeCpu');
  const cheapest = run ? [run.cheapest.great, run.cheapest.well].filter((o): o is PricedOption<GpuCore> => o !== undefined) : [];
  const note = krwNoteFx(t.common, locale, fx);

  return (
    <section aria-labelledby="results-heading" data-gpu-results className="flex flex-col gap-4">
      <h2 id="results-heading" tabIndex={-1} className="text-xl font-semibold tracking-tight">
        {run ? t.modelHub('gpuTitle', { model: run.model.name }) : t.calc('resultsHeading')}
      </h2>
      <p data-results-count aria-live="polite" className="text-sm text-muted-foreground">
        {view ? t.calc('gpuResultsCount', { shown: view.rows.length, total }) : ''}
      </p>
      {!run && <p className="min-h-40 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{t.calc('modelEmpty')}</p>}
      {run && view && (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {(['S', 'A', 'B', 'F'] as const).map((v) => (
              <span key={v} className="inline-flex items-center gap-1">
                <VerdictChip verdict={v} label={t.verdict(v)} compact />
                <span className="tabular-nums">{run.counts[v]}</span>
              </span>
            ))}
          </p>
          {run.clamped && <p className="text-sm text-muted-foreground">{t.calc('modelCtxClamped', { ctx: formatCtx(run.ctx) })}</p>}

          <div data-cheapest className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <h3 className="font-medium">{t.modelHub('cheapestTitle')}</h3>
            {cheapest.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {cheapest.map((option) => (
                  <li key={option.gpu.id} className="flex flex-wrap items-center gap-2">
                    <VerdictChip verdict={option.combo.baseline.result.verdict} label={t.verdict(option.combo.baseline.result.verdict)} />
                    <a href={`${prefix}/gpu/${option.gpu.id}`}>{gpuName(t.names, option.gpu)}</a>
                    <span>
                      {t.modelHub('cheapest', {
                        price: price(option.priceUSD),
                        date: option.priceAsOf,
                        speed: speedPhrase(t.common, t.confidence, locale, option.combo.baseline),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t.calc('cheapestNoneModel')}</p>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm sm:flex-row sm:flex-wrap sm:items-start sm:gap-6">
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="mb-1 font-medium">{t.calc('filterType')}</legend>
              {HW_TYPES.map((hwType) => (
                <label key={hwType} className={CHIP}>
                  <input
                    type="checkbox"
                    value={hwType}
                    className="sr-only"
                    checked={state.type.includes(hwType)}
                    disabled={!hydrated}
                    onChange={() => dispatch({ type: 'type', hwType: toggle(state.type, hwType) })}
                  />
                  {typeLabel(hwType)}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${id}-budget`} className="font-medium">
                {t.calc('filterBudget')}
              </label>
              <select
                id={`${id}-budget`}
                name="budget"
                className={SELECT}
                value={state.budget ?? ''}
                disabled={!hydrated}
                onChange={(e) => dispatch({ type: 'budget', budget: e.currentTarget.value ? Number(e.currentTarget.value) : undefined })}
              >
                <option value="">{t.calc('budgetAny')}</option>
                {BUDGET_OPTIONS_USD.map((usd) => (
                  <option key={usd} value={usd}>
                    {t.calc('budgetMax', { price: price(usd) })}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="mb-1 font-medium">{t.calc('filterVerdict')}</legend>
              {([undefined, 'B', 'A', 'S'] as const).map((min) => (
                <label key={min ?? 'all'} className={CHIP}>
                  <input type="radio" name={`${id}-min`} value={min ?? ''} className="sr-only" checked={state.min === min} disabled={!hydrated} onChange={() => dispatch({ type: 'min', min })} />
                  {min === undefined ? t.calc('filterVerdictAll') : min === 'S' ? t.calc('filterVerdictS', { verdict: t.verdict('S') }) : t.calc('filterVerdictMin', { verdict: t.verdict(min) })}
                </label>
              ))}
            </fieldset>
            <div className="flex items-center gap-2">
              <label htmlFor={`${id}-gsort`} className="font-medium">
                {t.calc('sortLabel')}
              </label>
              <select
                id={`${id}-gsort`}
                name="gsort"
                className={SELECT}
                value={state.gsort}
                disabled={!hydrated}
                onChange={(e) => dispatch({ type: 'gsort', gsort: e.currentTarget.value as CalcState['gsort'] })}
              >
                <option value="verdict">{t.calc('sortVerdict')}</option>
                <option value="speed">{t.calc('sortSpeed')}</option>
                <option value="price">{t.sort('price')}</option>
              </select>
            </div>
          </div>

          {mine && (
            <div data-mine-result className="flex min-w-0 flex-col gap-2">
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <GpuResultRow
                  locale={locale}
                  t={t}
                  gpu={mine.hardware.gpu}
                  combo={mine.combo}
                  heading={
                    <>
                      <Pill tone="info">{t.calc('mineLabel')}</Pill>
                      {mine.hardware.gpu.id !== 'custom' && (
                        <span>
                          {mine.hardware.gpuCount > 1
                            ? t.calc('gpuTimes', { gpu: gpuName(t.names, mine.hardware.gpu), n: mine.hardware.gpuCount })
                            : gpuName(t.names, mine.hardware.gpu)}
                        </span>
                      )}
                    </>
                  }
                  {...(mineMeta ? { meta: mineMeta } : {})}
                  action={{ label: t.calc('mineAllModels'), onClick: onMineAll, marker: 'mine-all' }}
                  current
                />
              </ul>
              <p className="text-xs text-muted-foreground">{t.calc('mineNote')}</p>
            </div>
          )}

          {view.hiddenUnpriced > 0 && <p className="text-sm text-muted-foreground">{t.calc('budgetHidden', { count: view.hiddenUnpriced })}</p>}

          {view.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t.calc('emptyFilteredGpu')}{' '}
              <button type="button" className="underline underline-offset-4" onClick={() => dispatch({ type: 'clearGpuFilters' })}>
                {t.calc('clearFilters')}
              </button>
            </p>
          ) : (
            <ul data-gpu-list className="grid gap-3 sm:grid-cols-2">
              {view.rows.map((row) => {
                const { gpu, combo } = row;
                const name = gpuName(t.names, gpu);
                // 하드웨어 모드 카드와 같은 쿼리 규칙(D64): 기준 조건이 아니면 그 셀, 기준이면 dGPU 는 `?ram=32`(RAM 힌트 페이지도 이 행과 같은 RAM 으로 열리게)
                const comboHref = run.external
                  ? undefined
                  : `${prefix}/can-i-run/${run.model.id}/on/${gpu.id}${comboDetailQuery(state, { gpu, gpuCount: 1, ramGB: combo.ramGB }, run.ctx)}`;
                return (
                  <GpuResultRow
                    key={gpu.id}
                    locale={locale}
                    t={t}
                    gpu={gpu}
                    combo={combo}
                    heading={
                      <>
                        <a href={`${prefix}/gpu/${gpu.id}`}>{name}</a>
                        {gpu.kind !== 'dgpu' && (
                          <span className="text-xs font-normal text-muted-foreground">{t.modelHub('configRam', { ram: formatInt(locale, combo.ramGB) })}</span>
                        )}
                        {gpu.form === 'laptop' && <Pill tone="caution">{t.gpuHub('badgeLaptop')}</Pill>}
                        {gpu.id === mineId && <Pill tone="info">{t.calc('mineBadge')}</Pill>}
                      </>
                    }
                    price={priceText(gpu)}
                    {...(comboHref
                      ? {
                          detail: row.hubConfig
                            ? { href: comboHref, label: t.calc('cardDetailsHubOther', { ram: formatInt(locale, row.hubConfig.ramGB), os: osLabel(row.hubConfig.os) }) }
                            : { href: comboHref, label: t.table('details'), ariaLabel: t.table('detailsFor', { model: run.model.name, gpu: name }) },
                        }
                      : {})}
                    action={{ label: t.calc('useThisGpu'), onClick: () => onUseGpu(gpu.id, gpu.kind === 'dgpu' ? undefined : combo.ramGB), marker: 'use-gpu' }}
                    current={gpu.id === mineId}
                    rowAttrs={{
                      'data-gpu-row': '',
                      'data-gpu-id': gpu.id,
                      'data-type': row.type,
                      ...(row.street ? { 'data-price': row.street.usd } : {}),
                    }}
                  />
                );
              })}
            </ul>
          )}
          {run.all.some((r) => r.combo.reasoning) && <p className="text-xs text-muted-foreground">{t.common('reasoningNote')}</p>}
          {run.external && <p className="text-xs text-muted-foreground">{t.calc('hfNote')}</p>}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </>
      )}
    </section>
  );
}
