import type { Verdict } from '@canrun/engine';

/**
 * 판정 배지의 훅 없는 코어 — 서버(`VerdictBadge`)와 클라이언트 아일랜드(계산기 카드)가 같은 마크업을 쓴다
 * (docs/01 §3 공통 언어, §7 색 + 아이콘 + 텍스트 3중 표기). 라벨 문자열은 호출 측이 번역해 넘긴다.
 * `cn`(tailwind-merge)을 쓰지 않는다 — 클라이언트 청크 예산 (P1-3 D36).
 *
 * 아이콘은 페이지당 한 번 그리는 `VerdictSprite` 의 `<symbol>` 을 `<use>` 로 참조한다.
 */
const TONE: Record<Verdict, string> = {
  S: 'bg-verdict-s-bg text-verdict-s-fg',
  A: 'bg-verdict-a-bg text-verdict-a-fg',
  B: 'bg-verdict-b-bg text-verdict-b-fg',
  F: 'bg-verdict-f-bg text-verdict-f-fg',
};

export function VerdictIcon({ verdict, className = '' }: { verdict: Verdict; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={`size-3.5 shrink-0 ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <use href={`#verdict-icon-${verdict}`} />
    </svg>
  );
}

/**
 * compact: 행렬 셀용 — 아이콘 + 등급 글자만 보이고 전체 라벨은 스크린리더 텍스트로.
 */
export function VerdictChip({
  verdict,
  label,
  compact = false,
}: {
  verdict: Verdict;
  /** 번역된 판정 라벨 ("Runs great" / "쾌적") */
  label: string;
  compact?: boolean;
}) {
  return (
    <span
      data-verdict={verdict}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[verdict]}`}
    >
      <VerdictIcon verdict={verdict} />
      {compact ? (
        <>
          <span aria-hidden="true">{verdict}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        label
      )}
    </span>
  );
}
