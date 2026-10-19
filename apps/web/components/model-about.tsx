import type { ModelAboutBody } from '@/lib/model-about';

/**
 * 모델 소개 (10-19 D102) — "어떤 모델인가요" 한 문단 + 출처 링크 줄(로캘별 MDX). 서버 컴포넌트, 클라이언트 JS 0.
 * 모델 카드에 적힌 사실(만든 곳·공개 시기·용도·생각 모드·라이선스)만 쓰고 수치 주장(속도·필요 메모리)은 없다 —
 * 그래서 데이터 컴포넌트 맵을 넘기지 않는다(MDX 안 컴포넌트는 유닛 테스트가 막는다). 레지스트리에 없는 모델은 페이지가 그리지 않는다.
 * 마지막 문단(출처 링크 줄)은 작은 글씨로.
 */
export function ModelAbout({ Body, title }: { Body: ModelAboutBody; title: string }) {
  return (
    <section
      aria-labelledby="about-heading"
      data-model-about
      className="flex max-w-3xl flex-col gap-3 [&>p:last-child]:text-sm [&>p:last-child]:text-muted-foreground"
    >
      <h2 id="about-heading" className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <Body />
    </section>
  );
}
