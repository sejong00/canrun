import type { Verdict } from '@canrun/engine';
import { useTranslations } from 'next-intl';
import { VerdictChip } from '@/components/verdict-chip';
import { cn } from '@/lib/utils';

/**
 * 판정 배지 — docs/01 §3 "사이트 전체 공통 언어", §7 접근성: 색 + 아이콘 + 텍스트 3중 표기.
 * 마크업은 훅 없는 `VerdictChip` 이 정본이고 여기서는 번역만 붙인다 (클라이언트 아일랜드와 공유, P1-3).
 *
 * 아이콘은 페이지당 한 번 그리는 `<symbol>` 스프라이트를 `<use>` 로 참조한다 — 행마다 SVG 경로를
 * 반복하면 HTML 과 RSC 페이로드에 두 번씩 실린다(성능 예산 docs/01 §7). 경로는 lucide(ISC) 아이콘.
 */
const VERDICTS: readonly Verdict[] = ['S', 'A', 'B', 'F'];

/** 페이지 셸이 한 번 렌더하는 아이콘 스프라이트 */
export function VerdictSprite() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
      <defs>
        {/* S: circle-check */}
        <symbol id="verdict-icon-S" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </symbol>
        {/* A: check */}
        <symbol id="verdict-icon-A" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5" />
        </symbol>
        {/* B: triangle-alert */}
        <symbol id="verdict-icon-B" viewBox="0 0 24 24">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </symbol>
        {/* F: circle-x */}
        <symbol id="verdict-icon-F" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="m15 9-6 6" />
          <path d="m9 9 6 6" />
        </symbol>
      </defs>
    </svg>
  );
}

/**
 * compact: 행렬 셀용 — 아이콘 + 등급 글자만 보이고 전체 라벨은 스크린리더 텍스트로
 * (가시 범례 `VerdictLegend` 와 함께 쓴다).
 */
export function VerdictBadge({ verdict, compact = false }: { verdict: Verdict; compact?: boolean }) {
  const t = useTranslations('Verdict');
  return <VerdictChip verdict={verdict} label={t(verdict)} compact={compact} />;
}

/** 판정 기준 범례 (docs/01 §3 표) */
export function VerdictLegend({ className }: { className?: string }) {
  const t = useTranslations('Verdict');
  return (
    <div className={cn('rounded-lg border border-border p-4', className)}>
      <h3 className="text-sm font-semibold">{t('legendTitle')}</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {VERDICTS.map((verdict) => (
          <div key={verdict} className="flex items-start gap-2">
            <dt className="shrink-0">
              <VerdictBadge verdict={verdict} />
            </dt>
            <dd className="text-muted-foreground">{t(`legend${verdict}`)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
