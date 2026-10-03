'use client';
import type { ComboAssessment, GpuCore } from '@canrun/data/client';
import type { ReactNode } from 'react';
import type { CalcTranslators } from '@/components/islands/calc-shared';
import { SpeedCellCore } from '@/components/speed-text';
import { VerdictChip } from '@/components/verdict-chip';
import { formatGB } from '@/lib/format';
import { memoryText, modeKey, noteLines, quantText } from '@/lib/phrases';

/**
 * 모델 모드 GPU 한 줄 (10-03 D65) — 표 대신 카드 목록이라 휴대폰에서 옆으로 밀지 않는다. 내용은 모델 허브 표 행과 같은
 * 코어(VerdictChip·SpeedCellCore — 밴드 + 신뢰 라벨, 규칙 3·memoryText·noteLines)이고, 가격·상세·반대 방향 버튼을 덧붙인다.
 */
export function GpuResultRow({
  locale,
  t,
  gpu,
  combo,
  heading,
  meta,
  price,
  detail,
  action,
  current = false,
  rowAttrs,
}: {
  locale: string;
  t: CalcTranslators;
  gpu: GpuCore;
  combo: ComboAssessment;
  /** h3 내용 (GPU 이름 링크·구성 RAM·배지) */
  heading: ReactNode;
  /** 제목 아래 한 줄 ("내 구성" 행의 구성 문장) */
  meta?: string;
  price?: string;
  detail?: { href: string; label: string; ariaLabel?: string };
  action: { label: string; onClick: () => void; marker: 'use-gpu' | 'mine-all' };
  /** 내 GPU — 테두리 강조 */
  current?: boolean;
  /** `<li>` 의 data-* (목록 행만) */
  rowAttrs?: Record<`data-${string}`, string | number>;
}) {
  const q = combo.display;
  const baseline = combo.baseline.result.verdict;
  const notes = noteLines({ reason: t.reason, hint: t.hint, verdict: t.verdict, common: t.common }, locale, combo, gpu.kind, false);
  return (
    <li
      {...rowAttrs}
      aria-current={current ? 'true' : undefined}
      className={`flex min-w-0 flex-col gap-2 rounded-lg border p-4 ${current ? 'border-foreground' : 'border-border'}`}
    >
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">{heading}</h3>
      {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip verdict={baseline} label={t.verdict(baseline)} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t.calc('cardQuant')}</dt>
        <dd>
          {quantText(t.hint, q)} · {t.common('gb', { value: formatGB(locale, q.fileGB, 2) })}
        </dd>
        {q.fReason !== 'no-fit' && (
          <>
            <dt className="text-muted-foreground">{t.calc('cardSpeed')}</dt>
            <dd data-speed-text>
              <SpeedCellCore locale={locale} q={q} tCommon={t.common} tConfidence={t.confidence} />
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t.calc('cardMemory')}</dt>
        <dd className="tabular-nums">{memoryText(t.memory, locale, q, gpu)}</dd>
        {q.fReason !== 'no-fit' && (
          <>
            <dt className="text-muted-foreground">{t.calc('cardMode')}</dt>
            <dd>{t.mode(modeKey(q.result.mode, gpu.kind))}</dd>
          </>
        )}
        {price !== undefined && (
          <>
            <dt className="text-muted-foreground">{t.table('price')}</dt>
            <dd data-price-text>{price}</dd>
          </>
        )}
      </dl>
      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {notes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <p className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {detail && (
          <a href={detail.href} data-combo-link aria-label={detail.ariaLabel}>
            {detail.label}
          </a>
        )}
        <button
          type="button"
          {...{ [`data-${action.marker}`]: '' }}
          onClick={action.onClick}
          className="min-h-11 text-left underline underline-offset-4 sm:min-h-9"
        >
          {action.label}
        </button>
      </p>
    </li>
  );
}
