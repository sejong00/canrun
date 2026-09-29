'use client';
import type { EffClass } from '@canrun/engine';
import { useId, type Dispatch } from 'react';
import { classKey, type CalcAction, type CalcTranslators } from '@/components/islands/calc-shared';
import { CUSTOM_CLASSES, type CustomHardware } from '@/lib/calc/state';

const INPUT = 'h-11 w-full rounded-md border border-border bg-background px-3 text-base sm:h-10 sm:text-sm';

const RANGES = {
  vram: { min: 1, max: 512 },
  mem: { min: 1, max: 1024 },
  bw: { min: 10, max: 8000 },
  fp16: { min: 0.1, max: 2000 },
} as const;

const UNIFIED_CLASSES: readonly EffClass[] = ['apple', 'apple-ultra', 'strix', 'dgx-spark'];
const DGPU_CLASSES: readonly EffClass[] = ['nvidia', 'amd', 'intel-arc'];

/** 목록에 없는 GPU·칩 사양 직접 입력 (docs/01 F4 커스텀 하드웨어, D32) — 범위 검증은 인라인 문장, 오류 색 없음 */
export function CustomHardwareFields({
  locale,
  t,
  custom,
  dispatch,
  hydrated,
}: {
  locale: string;
  t: CalcTranslators;
  custom: CustomHardware;
  dispatch: Dispatch<CalcAction>;
  hydrated: boolean;
}) {
  const id = useId();
  const num = (raw: string): number | undefined => {
    const n = Number(raw);
    return raw.trim() === '' || !Number.isFinite(n) ? undefined : n;
  };
  const classes = custom.kind === 'unified' ? UNIFIED_CLASSES : DGPU_CLASSES;
  const memField = custom.kind === 'dgpu' ? 'vramGB' : 'memGB';
  const memRange = custom.kind === 'dgpu' ? RANGES.vram : RANGES.mem;
  const memValue = custom.kind === 'dgpu' ? custom.vramGB : custom.memGB;
  const invalid = (v: number | undefined, r: { min: number; max: number }) => v !== undefined && (v < r.min || v > r.max);
  const rangeText = (r: { min: number; max: number }) => t.calc('invalidRange', { min: new Intl.NumberFormat(locale).format(r.min), max: new Intl.NumberFormat(locale).format(r.max) });

  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      <fieldset className="flex flex-wrap gap-3 text-sm sm:col-span-2">
        <legend className="mb-1 font-medium">{t.calc('customKindLabel')}</legend>
        {(['dgpu', 'unified'] as const).map((kind) => (
          <label key={kind} className="flex min-h-9 items-center gap-1">
            <input type="radio" name="kind" value={kind} checked={custom.kind === kind} disabled={!hydrated} onChange={() => dispatch({ type: 'custom', patch: { kind } })} />
            {t.calc(kind === 'dgpu' ? 'customKindDgpu' : 'customKindUnified')}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-class`} className="text-sm font-medium">
          {t.calc('customClassLabel')}
        </label>
        <select id={`${id}-class`} name="class" className={INPUT} value={custom.effClass} disabled={!hydrated} onChange={(e) => dispatch({ type: 'custom', patch: { effClass: e.currentTarget.value as EffClass } })}>
          {CUSTOM_CLASSES.filter((c) => classes.includes(c)).map((c) => (
            <option key={c} value={c}>
              {t.calc(classKey(c))}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-mem`} className="text-sm font-medium">
          {t.calc(custom.kind === 'dgpu' ? 'customVramLabel' : 'customMemLabel')}
        </label>
        <input
          id={`${id}-mem`}
          name={custom.kind === 'dgpu' ? 'vram' : 'mem'}
          type="number"
          inputMode="decimal"
          min={memRange.min}
          max={memRange.max}
          className={INPUT}
          value={memValue ?? ''}
          disabled={!hydrated}
          aria-describedby={`${id}-mem-hint`}
          aria-invalid={invalid(memValue, memRange) || undefined}
          onChange={(e) => dispatch({ type: 'custom', patch: { [memField]: num(e.currentTarget.value) } })}
        />
        <p id={`${id}-mem-hint`} className="text-xs text-muted-foreground">
          {invalid(memValue, memRange) ? rangeText(memRange) : memValue === undefined ? t.calc('requiredField') : ''}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-bw`} className="text-sm font-medium">
          {t.calc('customBwLabel')}
        </label>
        <input
          id={`${id}-bw`}
          name="bw"
          type="number"
          inputMode="decimal"
          min={RANGES.bw.min}
          max={RANGES.bw.max}
          className={INPUT}
          value={custom.bandwidthGBs ?? ''}
          disabled={!hydrated}
          aria-describedby={`${id}-bw-hint`}
          aria-invalid={invalid(custom.bandwidthGBs, RANGES.bw) || undefined}
          onChange={(e) => dispatch({ type: 'custom', patch: { bandwidthGBs: num(e.currentTarget.value) } })}
        />
        <p id={`${id}-bw-hint`} className="text-xs text-muted-foreground">
          {invalid(custom.bandwidthGBs, RANGES.bw) ? rangeText(RANGES.bw) : custom.bandwidthGBs === undefined ? t.calc('requiredField') : t.calc('customBwHint')}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-fp16`} className="text-sm font-medium">
          {t.calc('customFp16Label')}
        </label>
        <input
          id={`${id}-fp16`}
          name="fp16"
          type="number"
          inputMode="decimal"
          min={RANGES.fp16.min}
          max={RANGES.fp16.max}
          step="0.1"
          className={INPUT}
          value={custom.fp16Tflops ?? ''}
          disabled={!hydrated}
          aria-invalid={invalid(custom.fp16Tflops, RANGES.fp16) || undefined}
          aria-describedby={invalid(custom.fp16Tflops, RANGES.fp16) ? `${id}-fp16-hint` : undefined}
          onChange={(e) => dispatch({ type: 'custom', patch: { fp16Tflops: num(e.currentTarget.value) } })}
        />
        {invalid(custom.fp16Tflops, RANGES.fp16) && (
          <p id={`${id}-fp16-hint`} className="text-xs text-muted-foreground">
            {rangeText(RANGES.fp16)}
          </p>
        )}
      </div>
    </div>
  );
}
