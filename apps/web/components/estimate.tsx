import type { QuantAssessment } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { formatSpeed, formatTokS } from '@/lib/format';
import { confidenceText } from '@/lib/phrases';
import { cn } from '@/lib/utils';

/** 신뢰 라벨 칩 — measured / calibrated ±12·20% / theoretical ±30% (docs/02 §4, 규칙 3) */
export function ConfidenceLabel({
  q,
  className,
}: {
  q: Pick<QuantAssessment, 'result' | 'measured'>;
  className?: string;
}) {
  const t = useTranslations('Confidence');
  const measured = q.result.confidence === 'measured';
  return (
    <span
      data-confidence={q.result.confidence}
      className={cn(
        'inline-block rounded border px-1 text-[0.7rem] leading-4 whitespace-nowrap first-letter:uppercase',
        measured ? 'border-verdict-s-fg/40' : 'border-border',
        className,
      )}
    >
      {confidenceText(t, q.result, q.measured)}
    </span>
  );
}

/**
 * 표의 속도 셀. F(미탑재)는 수치 대신 대시, 실측이면 실측값 + 추정 밴드 병기(n=1 이면 엔진 밴드가
 * 폭 0 — 규칙 3 을 위해 추정 밴드를 함께 보인다).
 */
export function SpeedCell({ q }: { q: Pick<QuantAssessment, 'result' | 'estimate' | 'measured' | 'fReason'> }) {
  const locale = useLocale();
  const t = useTranslations('Common');
  const tConfidence = useTranslations('Confidence');
  if (q.fReason === 'no-fit') {
    return <span className="text-muted-foreground">{t('none')}</span>;
  }
  const measured = q.result.confidence === 'measured';
  const shown = formatSpeed(locale, measured ? q.estimate : q.result);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium tabular-nums whitespace-nowrap">
        {measured
          ? t('tokS', { value: formatTokS(locale, q.result.tgTokS.est) })
          : t('estTokS', { value: shown.est })}
      </span>
      <span
        className={cn(
          'text-xs text-muted-foreground tabular-nums',
          measured ? 'min-w-40' : 'whitespace-nowrap',
        )}
      >
        {measured
          ? t('estimateAlso', {
              est: shown.est,
              low: shown.low,
              high: shown.high,
              label: confidenceText(tConfidence, q.estimate),
            })
          : t('range', { low: shown.low, high: shown.high })}
      </span>
      <ConfidenceLabel q={q} className="self-start" />
    </div>
  );
}
