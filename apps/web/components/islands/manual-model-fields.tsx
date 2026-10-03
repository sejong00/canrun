'use client';
import { MANUAL_LIMITS, manualIssues, type ManualIssue, type ManualNumberField, type ManualSpec } from '@canrun/data/client';
import { useId, useMemo } from 'react';
import type { CalcTranslators } from '@/components/islands/calc-shared';
import { formatCtx } from '@/lib/format';
import { CTX_OPTIONS } from '@/lib/calc/state';

// 하드웨어 폼·커스텀 사양 칸과 같은 크기 — 모바일 16px(iOS 확대 방지)·44px
const INPUT = 'h-11 w-full rounded-md border border-border bg-background px-3 text-base sm:h-10 sm:text-sm';

/**
 * 모델 값 직접 입력 (계산기 P2, PROGRESS §4 D66) — "목록에 없는 모델" 패널 안의 펼침 영역. 커스텀 하드웨어 칸(D32)과 같은 방식:
 * 입력 도중의 값도 상태에 두고 칸 아래 한 줄로 안내한다(범위·정수·MoE 비율). 펼침·MoE 체크는 아일랜드가 갖는다 —
 * 이 패널은 모드마다 다른 자리에 다시 그려진다(D65). 펼치기만으로는 아무것도 보내지 않는다(불러온 모델을 지우지 않게).
 * 하이드레이션 전엔 비활성(D36).
 */
export function ManualModelFields({
  locale,
  t,
  hydrated,
  spec,
  open,
  onOpenChange,
  moe,
  onMoeChange,
  onPatch,
  status,
}: {
  locale: string;
  t: CalcTranslators;
  hydrated: boolean;
  spec: ManualSpec;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moe: boolean;
  onMoeChange: (moe: boolean) => void;
  onPatch: (patch: Partial<ManualSpec>) => void;
  /** 계산이 됐을 때의 상태 문장 (aria-live) */
  status: string;
}) {
  const id = useId();
  const issues = useMemo(() => manualIssues(spec), [spec]);
  const fmt = (n: number) => new Intl.NumberFormat(locale).format(n);
  const issueText = (issue: ManualIssue): string => {
    switch (issue.code) {
      case 'range':
        return issue.integer
          ? t.calc('manualIntegerRange', { min: fmt(issue.min), max: fmt(issue.max) })
          : t.calc('invalidRange', { min: fmt(issue.min), max: fmt(issue.max) });
      case 'active-too-large':
        return t.calc('manualActiveTooLarge');
      case 'active-too-small':
        return t.calc('manualActiveTooSmall', { min: fmt(issue.min) });
      default:
        return t.calc('manualTopKTooLarge');
    }
  };
  const num = (raw: string): number | undefined => {
    const n = Number(raw);
    return raw.trim() === '' || !Number.isFinite(n) ? undefined : n;
  };

  const field = (f: ManualNumberField, label: string, hint: string, required: boolean) => {
    const value = spec[f];
    const issue = issues[f];
    const r = MANUAL_LIMITS[f];
    const max = f === 'fullAttnLayers' && spec.layers !== undefined ? Math.min(r.max, spec.layers) : r.max;
    const message = issue ? issueText(issue) : required && value === undefined ? t.calc('requiredField') : hint;
    return (
      <div key={f} className="flex flex-col gap-1">
        <label htmlFor={`${id}-${f}`} className="text-sm font-medium">
          {label}
        </label>
        <input
          id={`${id}-${f}`}
          name={`mm-${f}`}
          type="number"
          inputMode={r.integer ? 'numeric' : 'decimal'}
          min={r.min}
          max={max}
          step={r.integer ? 1 : 'any'}
          className={INPUT}
          value={value ?? ''}
          disabled={!hydrated}
          aria-describedby={`${id}-${f}-hint`}
          aria-invalid={issue ? true : undefined}
          onChange={(e) => {
            const patch: Partial<ManualSpec> = {};
            patch[f] = num(e.currentTarget.value);
            onPatch(patch);
          }}
        />
        <p id={`${id}-${f}-hint`} className="text-xs text-muted-foreground">
          {message}
        </p>
      </div>
    );
  };

  return (
    <details data-manual-model open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)} className="border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-medium">{t.calc('manualToggle')}</summary>
      <div className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t.calc('manualIntro')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('paramsB', t.calc('manualParamsLabel'), t.calc('manualParamsHint'), true)}
          {field('layers', t.calc('manualLayersLabel'), t.calc('manualLayersHint'), true)}
          {field('kvHeads', t.calc('manualKvHeadsLabel'), t.calc('manualKvHeadsHint'), true)}
          {field('headDim', t.calc('manualHeadDimLabel'), t.calc('manualHeadDimHint'), true)}
          {field('fullAttnLayers', t.calc('manualFullLayersLabel'), t.calc('manualFullLayersHint'), false)}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-ctx`} className="text-sm font-medium">
              {t.calc('manualCtxLabel')}
            </label>
            <select
              id={`${id}-ctx`}
              name="mm-ctx"
              className={INPUT}
              value={spec.maxContext ?? ''}
              disabled={!hydrated}
              onChange={(e) => onPatch({ maxContext: e.currentTarget.value ? Number(e.currentTarget.value) : undefined })}
            >
              <option value="">{t.calc('manualCtxUnknown')}</option>
              {CTX_OPTIONS.map((ctx) => (
                <option key={ctx} value={ctx}>
                  {formatCtx(ctx)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex min-h-9 items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="mm-thinking"
            className="mt-1"
            checked={spec.thinking === true}
            disabled={!hydrated}
            onChange={(e) => onPatch({ thinking: e.currentTarget.checked ? true : undefined })}
          />
          <span>
            {t.calc('manualThinkingLabel')}
            <span className="block text-xs text-muted-foreground">{t.calc('manualThinkingHint')}</span>
          </span>
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="mm-moe" checked={moe} disabled={!hydrated} onChange={(e) => onMoeChange(e.currentTarget.checked)} />
          {t.calc('manualMoeLabel')}
        </label>
        {moe && (
          <div data-manual-moe className="grid gap-4 sm:grid-cols-2">
            {field('activeParamsB', t.calc('manualActiveLabel'), t.calc('manualActiveHint'), true)}
            {field('experts', t.calc('manualExpertsLabel'), t.calc('manualExpertsHint'), true)}
            {field('topK', t.calc('manualTopKLabel'), t.calc('manualTopKHint'), true)}
          </div>
        )}
        <p data-manual-status aria-live="polite" className="text-sm text-muted-foreground">
          {status}
        </p>
      </div>
    </details>
  );
}
