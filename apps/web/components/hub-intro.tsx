import { GUIDE_MDX_COMPONENTS } from '@/components/guide/guide-components';
import type { HubIntroBody } from '@/lib/hub-intros';

/**
 * 허브 소개글 (10-14 D74) — 손으로 쓴 2~3문단(로캘별 MDX). 서버 컴포넌트, 클라이언트 JS 0.
 * 수치·판정 주장은 가이드와 같은 데이터 컴포넌트(`Num`·`Price`·`Expect` …)로만 — 데이터가 바뀌면 빌드가 실패해 문장을 고치게 한다.
 * 레지스트리에 없는 허브는 페이지가 이 블록을 그리지 않는다.
 */
export function HubIntro({ Body, title }: { Body: HubIntroBody; title: string }) {
  return (
    <section aria-labelledby="intro-heading" data-hub-intro className="flex max-w-3xl flex-col gap-4">
      <h2 id="intro-heading" className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <Body components={GUIDE_MDX_COMPONENTS} />
    </section>
  );
}
