'use client';
import type { CatalogLite } from '@canrun/data/client';
import { useId, useMemo, type Dispatch } from 'react';
import type { CalcAction, CalcTranslators } from '@/components/islands/calc-shared';
import { formatCtx } from '@/lib/format';
import { CTX_OPTIONS, KV_OPTIONS, type CalcState } from '@/lib/calc/state';

// 하드웨어 폼과 같은 컨트롤 크기 — 모바일 16px(iOS 확대 방지)·44px
const SELECT = 'h-11 rounded-md border border-border bg-background px-2 text-base sm:h-10 sm:text-sm';
const HF_VALUE = '__hf';

/**
 * 모델 모드 입력 (10-03 D65) — 하드웨어 폼 자리에 대신 놓인다. 대상 모델(카탈로그 select, 불러온 모델이면 그 이름)·
 * 컨텍스트·KV 와 목록의 계산 가정. 하드웨어 폼 컨트롤을 추출해 공유하지 않는다(그 폼의 SSR 마크업·레이아웃을 바꾸지 않게).
 * `?mode=model` 딥링크의 레이아웃 이동은 아일랜드가 이 폼과 "목록에 없는 모델" 패널을 감싼 자리의 높이로 막는다.
 */
export function ModelForm({
  catalog,
  t,
  state,
  dispatch,
  hydrated,
  hfName,
  onPick,
}: {
  catalog: CatalogLite;
  t: CalcTranslators;
  state: CalcState;
  dispatch: Dispatch<CalcAction>;
  hydrated: boolean;
  /** 불러온 모델(완료)의 이름 — 있으면 그 모델이 대상 */
  hfName?: string;
  onPick: (modelId: string) => void;
}) {
  const id = useId();
  const models = useMemo(() => [...catalog.models].sort((a, b) => a.name.localeCompare(b.name, 'en')), [catalog]);
  const value = hfName !== undefined ? HF_VALUE : (state.focus ?? '');

  return (
    <section
      data-model-form
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-5 rounded-lg border border-border p-4 sm:p-6"
    >
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        {t.calc('modelLegend')}
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-model`} className="text-sm font-medium">
          {t.calc('modelLabel')}
        </label>
        <select
          id={`${id}-model`}
          name="m"
          className={`${SELECT} w-full`}
          value={value}
          disabled={!hydrated}
          onChange={(e) => {
            const next = e.currentTarget.value;
            if (next && next !== HF_VALUE) onPick(next);
          }}
        >
          <option value="" disabled>
            {t.calc('modelPlaceholder')}
          </option>
          {hfName !== undefined && (
            <option value={HF_VALUE} disabled>
              {t.calc('modelHfOption', { model: hfName })}
            </option>
          )}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t.calc('modelHint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-ctx`} className="text-sm font-medium">
            {t.calc('ctxLabel')}
          </label>
          <select
            id={`${id}-ctx`}
            name="ctx"
            className={SELECT}
            value={state.ctx}
            disabled={!hydrated}
            onChange={(e) => dispatch({ type: 'ctx', ctx: Number(e.currentTarget.value) })}
          >
            {CTX_OPTIONS.map((ctx) => (
              <option key={ctx} value={ctx}>
                {formatCtx(ctx)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t.calc('ctxHint')}</p>
        </div>
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="mb-1 font-medium">{t.calc('kvLabel')}</legend>
          {KV_OPTIONS.map((kv) => (
            <label key={kv} className="flex min-h-9 items-center gap-1">
              <input
                type="radio"
                name={`${id}-kv`}
                value={kv}
                checked={state.kv === kv}
                disabled={!hydrated}
                onChange={() => dispatch({ type: 'kv', kv })}
              />
              {kv}
            </label>
          ))}
          <span className="basis-full text-xs text-muted-foreground">{t.calc('kvHint')}</span>
        </fieldset>
      </div>

      <p data-model-assumptions className="text-sm text-muted-foreground">
        {t.calc('assumeModelMode', { ctx: formatCtx(state.ctx), kv: state.kv })}
      </p>
    </section>
  );
}
