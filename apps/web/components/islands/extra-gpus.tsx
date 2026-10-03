'use client';
import { canMixWith, type CatalogLite, type GpuCore } from '@canrun/data/client';
import { useId, useState, type Dispatch } from 'react';
import type { CalcAction, CalcTranslators } from '@/components/islands/calc-shared';
import { MAX_GPUS, type CalcState } from '@/lib/calc/state';
import { gpuName } from '@/lib/phrases';

const SELECT = 'h-11 w-full rounded-md border border-border bg-background px-2 text-base sm:h-10 sm:text-sm';
const BUTTON = 'h-11 shrink-0 rounded-md border border-border px-3 text-sm disabled:opacity-50 sm:h-10';

/**
 * 서로 다른 GPU 함께 쓰기 (docs/01 F1, 10-03 D67) — 1번 GPU 가 섞기 자격(같은 계열 데스크톱 NVIDIA·AMD)일 때만 보인다.
 * 줄마다 네이티브 select(같은 계열 카드, 1번과 같은 카드는 "GPU 수"로) + 빼기. 새 줄은 "다른 GPU 함께 쓰기" → 고르기 전까지 이 컴포넌트만 안다.
 * 합계 최대 4장(`MAX_GPUS`) — 넘치면 추가 버튼이 꺼진다
 */
export function ExtraGpus({
  catalog,
  t,
  primary,
  state,
  dispatch,
  hydrated,
}: {
  catalog: CatalogLite;
  t: CalcTranslators;
  primary: GpuCore;
  state: CalcState;
  dispatch: Dispatch<CalcAction>;
  hydrated: boolean;
}) {
  const id = useId();
  // 고르기 전의 새 줄 — 그때의 1번 GPU 에 묶는다(1번이 바뀌면 사라진다)
  const [pendingFor, setPendingFor] = useState<string | undefined>(undefined);
  const plus = state.plus ?? [];
  const base = state.gpus ?? 1;
  const total = base + plus.length;
  const pending = pendingFor === primary.id && total < MAX_GPUS;
  const options = catalog.gpus.filter((g) => g.id !== primary.id && canMixWith(primary, g));
  const rowId = (i: number) => `${id}-plus-${i}`;
  const focusLater = (target: string) => window.setTimeout(() => document.getElementById(target)?.focus(), 0);

  const setAt = (i: number, gpuId: string) => dispatch({ type: 'plus', plus: plus.map((v, j) => (j === i ? gpuId : v)) });
  const removeAt = (i: number) => {
    dispatch({ type: 'plus', plus: plus.filter((_, j) => j !== i) });
    focusLater(`${id}-add`);
  };
  const commitPending = (gpuId: string) => {
    if (!gpuId) return;
    dispatch({ type: 'plus', plus: [...plus, gpuId] });
    setPendingFor(undefined);
    focusLater(rowId(plus.length));
  };

  const row = (i: number, value: string, onChange: (v: string) => void, onRemove: () => void, placeholder: boolean) => (
    <div key={i} data-extra-gpu className="flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={rowId(i)} className="text-sm font-medium">
          {t.calc('extraGpuLabel', { n: base + i + 1 })}
        </label>
        <select id={rowId(i)} className={SELECT} value={value} disabled={!hydrated} onChange={(e) => onChange(e.currentTarget.value)}>
          {placeholder && (
            <option value="" disabled>
              {t.calc('extraGpuPlaceholder')}
            </option>
          )}
          {options.map((g) => (
            <option key={g.id} value={g.id}>
              {gpuName(t.names, g)}
            </option>
          ))}
        </select>
      </div>
      <button type="button" data-remove-gpu className={BUTTON} disabled={!hydrated} onClick={onRemove}>
        {t.calc('removeGpu')}
      </button>
    </div>
  );

  return (
    <div data-extra-gpus className="flex flex-col gap-3">
      {plus.map((gpuId, i) => row(i, gpuId, (v) => setAt(i, v), () => removeAt(i), false))}
      {pending &&
        row(plus.length, '', commitPending, () => {
          setPendingFor(undefined);
          focusLater(`${id}-add`);
        }, true)}
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          id={`${id}-add`}
          data-add-gpu
          className={BUTTON}
          disabled={!hydrated || pending || total >= MAX_GPUS}
          onClick={() => {
            setPendingFor(primary.id);
            focusLater(rowId(plus.length));
          }}
        >
          {t.calc('addGpu')}
        </button>
        <p className="text-xs text-muted-foreground">{t.calc('extraGpuHint')}</p>
      </div>
    </div>
  );
}
