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
  // 고르기 전의 새 줄 — 그때의 1번 GPU 에 묶는다
  const [pendingFor, setPendingFor] = useState<string | undefined>(undefined);
  const plus = state.plus ?? [];
  const base = state.gpus ?? 1;
  const total = base + plus.length;
  // 1번 GPU 가 바뀌거나 합계가 4장이 되면 빈 줄을 버린다 — 숨겨 두기만 하면 장수가 줄거나 1번이 돌아올 때 누르지 않은 줄이 되살아난다
  // (렌더 중 상태 정리 — React 문서의 '이전 렌더 정보 저장' 패턴, 리뷰 반영)
  const stalePending = pendingFor !== undefined && (pendingFor !== primary.id || total >= MAX_GPUS);
  if (stalePending) setPendingFor(undefined);
  const pending = pendingFor !== undefined && !stalePending;
  const options = catalog.gpus.filter((g) => g.id !== primary.id && canMixWith(primary, g));
  const rowId = (i: number) => `${id}-plus-${i}`;
  const focusLater = (target: string) => window.setTimeout(() => document.getElementById(target)?.focus(), 0);

  const setAt = (i: number, gpuId: string) => dispatch({ type: 'plus', plus: plus.map((v, j) => (j === i ? gpuId : v)) });
  const removeAt = (i: number) => {
    dispatch({ type: 'plus', plus: plus.filter((_, j) => j !== i) });
    // 고르기 전 줄이 열려 있으면 추가 버튼이 꺼져 있어 포커스를 받지 못한다 — 그 줄(한 칸 당겨진 번호)로 보낸다. 줄 key 가 번호라
    // 포커스가 남으면 다음 카드의 '빼기'를 가리키게 된다(리뷰 반영)
    focusLater(pending ? rowId(plus.length - 1) : `${id}-add`);
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
      {/* 줄이 여럿이면 '빼기'가 여러 번 읽힌다 — 어느 GPU 인지 이름에 넣는다(보이는 글자를 포함, WCAG 2.5.3) */}
      <button type="button" data-remove-gpu className={BUTTON} disabled={!hydrated} aria-label={t.calc('removeGpuNamed', { n: base + i + 1 })} onClick={onRemove}>
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
        <p className="text-xs text-muted-foreground">{t.calc('extraGpuHint', { max: MAX_GPUS })}</p>
      </div>
    </div>
  );
}
