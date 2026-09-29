import type { QuantAssessment } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { ConfidenceChip, SpeedCellCore } from '@/components/speed-text';
import { confidenceText } from '@/lib/phrases';

/** 신뢰 라벨 칩 — measured / calibrated ±12·20% / theoretical ±30% (docs/02 §4, 규칙 3) */
export function ConfidenceLabel({
  q,
  className,
}: {
  q: Pick<QuantAssessment, 'result' | 'measured'>;
  className?: string;
}) {
  const t = useTranslations('Confidence');
  return <ConfidenceChip q={q} text={confidenceText(t, q.result, q.measured)} className={className} />;
}

/** 표의 속도 셀 — 마크업은 `SpeedCellCore`(훅 없음, 아일랜드 공유) */
export function SpeedCell({ q }: { q: Pick<QuantAssessment, 'result' | 'estimate' | 'measured' | 'fReason'> }) {
  const locale = useLocale();
  const tCommon = useTranslations('Common');
  const tConfidence = useTranslations('Confidence');
  return <SpeedCellCore locale={locale} q={q} tCommon={tCommon} tConfidence={tConfidence} />;
}
