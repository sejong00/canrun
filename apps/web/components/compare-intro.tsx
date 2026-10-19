import { GUIDE_MDX_COMPONENTS } from '@/components/guide/guide-components';
import { COMPARE_INTRO_COMPONENTS } from '@/content/compares';
import type { CompareIntroBody } from '@/lib/compare-intros';

/** 소개글이 쓸 수 있는 컴포넌트만 넘긴다 — 목록 밖 컴포넌트는 MDX 렌더에서 "missing component" 로 빌드가 실패한다 */
const COMPONENTS = Object.fromEntries(COMPARE_INTRO_COMPONENTS.map((name) => [name, GUIDE_MDX_COMPONENTS[name]]));

/**
 * GPU 비교 소개글 (10-19 D103) — 손으로 쓴 짧은 문단(로캘별 MDX). 서버 컴포넌트, 클라이언트 JS 0.
 * 수치·판정 주장은 허브 소개글과 같은 데이터 컴포넌트(`Num`·`Price`·`Expect`)로만 — 데이터가 바뀌면 빌드가 실패해 문장을 고치게 한다.
 * 소개글이 없는 쌍은 페이지가 이 블록을 그리지 않는다.
 */
export function CompareIntro({ Body, title }: { Body: CompareIntroBody; title: string }) {
  return (
    <section aria-labelledby="intro-heading" data-compare-intro className="flex max-w-3xl flex-col gap-4">
      <h2 id="intro-heading" className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <Body components={COMPONENTS} />
    </section>
  );
}
