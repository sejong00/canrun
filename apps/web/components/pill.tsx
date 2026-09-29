import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'info' | 'caution' | 'strong';

const TONE: Record<PillTone, string> = {
  neutral: 'border-border text-muted-foreground',
  info: 'border-verdict-a-fg/40 text-verdict-a-fg',
  caution: 'border-verdict-b-fg/50 bg-verdict-b-bg text-verdict-b-fg',
  strong: 'border-verdict-f-fg/50 bg-verdict-f-bg text-verdict-f-fg',
};

/**
 * 정보 배지 (판정 배지와 달리 등급이 아닌 속성 표시) — 훅·`cn` 없음: 서버 컴포넌트와 클라이언트
 * 아일랜드가 함께 쓴다 (P1-3 D36, tailwind-merge 는 클라이언트 청크에 싣지 않는다).
 */
export function Pill({
  tone = 'neutral',
  children,
  className = '',
  badge,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  /** E2E·테스트용 마커 (`data-badge`) */
  badge?: string;
}) {
  return (
    <span
      {...(badge ? { 'data-badge': badge } : {})}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
