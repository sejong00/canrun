import type { QuantAssessment } from '@canrun/data/client';
import { formatSpeed, formatTokS } from '@/lib/format';
import { confidenceText, type Translate } from '@/lib/phrases';

/**
 * 속도·신뢰 라벨의 훅 없는 코어 — 서버 표(`SpeedCell`)와 계산기 카드가 같은 마크업을 쓴다 (규칙 3).
 * 번역은 `Translate` 로 받는다 (서버: useTranslations, 아일랜드: i18n-lite makeT).
 */
export function ConfidenceChip({
  q,
  text,
  className = '',
}: {
  q: Pick<QuantAssessment, 'result'>;
  /** `confidenceText(...)` 결과 */
  text: string;
  className?: string;
}) {
  const measured = q.result.confidence === 'measured';
  return (
    <span
      data-confidence={q.result.confidence}
      className={`inline-block rounded border px-1 text-[0.7rem] leading-4 whitespace-nowrap first-letter:uppercase ${
        measured ? 'border-verdict-s-fg/40' : 'border-border'
      } ${className}`.trim()}
    >
      {text}
    </span>
  );
}

/**
 * 표의 속도 셀. F(미탑재)는 수치 대신 대시, 실측이면 실측값 + 추정 밴드 병기(n=1 이면 엔진 밴드가
 * 폭 0 — 규칙 3 을 위해 추정 밴드를 함께 보인다).
 */
export function SpeedCellCore({
  locale,
  q,
  tCommon,
  tConfidence,
}: {
  locale: string;
  q: Pick<QuantAssessment, 'result' | 'estimate' | 'measured' | 'fReason'>;
  tCommon: Translate;
  tConfidence: Translate;
}) {
  if (q.fReason === 'no-fit') {
    return <span className="text-muted-foreground">{tCommon('none')}</span>;
  }
  const measured = q.result.confidence === 'measured';
  const shown = formatSpeed(locale, measured ? q.estimate : q.result);
  return (
    <div className="flex flex-col gap-0.5" data-speed>
      <span className="font-medium tabular-nums whitespace-nowrap">
        {measured
          ? tCommon('tokS', { value: formatTokS(locale, q.result.tgTokS.est) })
          : tCommon('estTokS', { value: shown.est })}
      </span>
      <span
        className={`text-xs text-muted-foreground tabular-nums ${measured ? 'min-w-40' : 'whitespace-nowrap'}`}
      >
        {measured
          ? tCommon('estimateAlso', {
              est: shown.est,
              low: shown.low,
              high: shown.high,
              label: confidenceText(tConfidence, q.estimate),
            })
          : tCommon('range', { low: shown.low, high: shown.high })}
      </span>
      <ConfidenceChip q={q} text={confidenceText(tConfidence, q.result, q.measured)} className="self-start" />
    </div>
  );
}
