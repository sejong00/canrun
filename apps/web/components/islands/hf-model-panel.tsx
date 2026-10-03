'use client';
import { useId, type FormEvent, type ReactNode } from 'react';
import type { CalcTranslators } from '@/components/islands/calc-shared';
import type { HfErrorCode } from '@/lib/calc/hf-load';

export type HfPanelStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; name: string }
  | { kind: 'catalog'; name: string }
  | { kind: 'error'; code: HfErrorCode; modelType?: string };

/** 모델이 Hugging Face 에 있어도 값을 직접 넣으면 계산할 수 있는 오류(D66) — 구조를 계산하지 못하는 경우(unsupported)·입력 형식 오류는 빼고 */
const TRY_MANUAL: ReadonlySet<HfErrorCode> = new Set<HfErrorCode>(['not-found', 'gated', 'no-base', 'no-gguf', 'no-base-quant', 'no-params', 'network']);

const ERROR_KEY: Record<HfErrorCode, string> = {
  invalid: 'hfErrorInvalid',
  'not-found': 'hfErrorNotFound',
  gated: 'hfErrorGated',
  unsupported: 'hfErrorUnsupported',
  'no-base': 'hfErrorNoBase',
  'no-gguf': 'hfErrorNoGguf',
  'no-base-quant': 'hfErrorNoBaseQuant',
  'no-params': 'hfErrorNoParams',
  network: 'hfErrorNetwork',
};

/**
 * 목록에 없는 모델 (계산기 P2, D57) — Hugging Face 주소·id 입력 → 아일랜드가 불러와 결과 맨 위 카드로 보인다.
 * 상태 문장 한 줄만 aria-live. 하이드레이션 전엔 비활성(SSR 과 첫 렌더 동일, D36).
 * `children` = 그 아래 "모델 값 직접 입력" 펼침 영역(D66) — 불러오기 폼 밖에 둔다(숫자 칸에서 Enter 가 불러오기를 보내지 않게).
 */
export function HfModelPanel({
  t,
  hydrated,
  status,
  hasHardware,
  modelMode = false,
  canRemove,
  text,
  onTextChange,
  onLoad,
  onRemove,
  children,
}: {
  t: CalcTranslators;
  hydrated: boolean;
  status: HfPanelStatus;
  hasHardware: boolean;
  /** 모델 모드(D65) — 불러온 모델이 GPU 목록의 대상이 된다 (상태 문장만 다르다) */
  modelMode?: boolean;
  /** 불러온 모델이 걸려 있거나 불러오는 중 — 다음 불러오기가 실패해도 뺄 수 있게 상태가 아니라 이것으로 정한다 (직접 입력 값은 펼침 영역 안에서 지운다) */
  canRemove: boolean;
  /**
   * 입력창 글자 — 아일랜드가 갖는다. 모드를 바꾸면 이 패널이 다른 자리에 다시 그려지므로(D65) 패널 안 상태로 두면 친 주소가 사라진다 (리뷰 반영)
   */
  text: string;
  onTextChange: (text: string) => void;
  onLoad: (text: string) => void;
  /** 불러온(불러오는 중인) 모델을 뺀다 */
  onRemove: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onLoad(text.trim());
  };
  const message =
    status.kind === 'loading'
      ? t.calc('hfLoading')
      : status.kind === 'loaded'
        ? modelMode
          ? t.calc('hfLoadedModelMode', { model: status.name })
          : `${t.calc('hfLoaded', { model: status.name })}${hasHardware ? '' : ` ${t.calc('hfNeedGpu')}`}`
        : status.kind === 'catalog'
          ? modelMode
            ? t.calc('hfInCatalogModelMode', { model: status.name })
            : `${t.calc('hfInCatalog', { model: status.name })}${hasHardware ? '' : ` ${t.calc('hfNeedGpu')}`}`
        : status.kind === 'error'
          ? status.code === 'unsupported' && status.modelType
            ? t.calc('hfErrorUnsupportedType', { type: status.modelType })
            : `${t.calc(ERROR_KEY[status.code])}${TRY_MANUAL.has(status.code) ? ` ${t.calc('hfTryManual')}` : ''}`
          : '';

  return (
    <section data-hf-panel aria-labelledby={`${id}-h`} className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h2 id={`${id}-h`} className="text-base font-semibold">
        {t.calc('hfHeading')}
      </h2>
      <p className="text-sm text-muted-foreground">{t.calc('hfIntro')}</p>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={`${id}-in`} className="sr-only">
          {t.calc('hfLabel')}
        </label>
        <input
          id={`${id}-in`}
          name="hf"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={t.calc('hfPlaceholder')}
          value={text}
          disabled={!hydrated}
          onChange={(e) => onTextChange(e.currentTarget.value)}
          className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-base sm:h-9 sm:text-sm"
        />
        <button
          type="submit"
          data-hf-submit
          disabled={!hydrated || status.kind === 'loading'}
          className="h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50 sm:h-9"
        >
          {t.calc('hfSubmit')}
        </button>
        {canRemove && (
          <button type="button" data-hf-remove onClick={onRemove} className="h-11 rounded-md px-3 text-sm underline underline-offset-4 sm:h-9">
            {t.calc('hfRemove')}
          </button>
        )}
      </form>
      <p data-hf-status aria-live="polite" className={`text-sm ${status.kind === 'error' ? 'text-verdict-f-fg' : 'text-muted-foreground'}`}>
        {message}
      </p>
      {children}
    </section>
  );
}
