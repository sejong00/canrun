/**
 * GPU 비교 페이지 레지스트리 (10-19 D106) — `/compare/{a}-vs-{b}` 쌍·상태·묶음·검색 수요 근거의 단일 출처.
 *
 * **의존성 0**: `@/` 경로·JSX·`.mdx` import 금지 — export 테스트(`test/`)·사이트맵·리다이렉트·공유 카드 스크립트가 루트 tsconfig 에서 직접 읽는다.
 * 수치는 `lib/compares.ts`(허브 요약 `getGpuHub` → `@canrun/data` `compareGpus`), 소개글은 `content/{en,ko}/compare/<slug>.mdx`(로캘별 따로 집필,
 * `lib/compare-intros.ts` 명시적 로더 맵 — 아래 `COMPARE_INTRO_SLUGS` 에 있는 쌍만).
 *
 * - docs/01 이 Phase 3 로 둔 비교 페이지를 **고른 소수 쌍**으로만 당겨 온다 — 프로그래매틱 대량 노출 금지(docs/04 §11, AdSense 승인 전). 상한 `COMPARE_MAX`
 * - 슬러그 = `${a}-vs-${b}`, 사람들이 검색하는 순서(`demand` 의 검색어 순서). 뒤집은 순서는 301(`scripts/build-redirects.ts`)
 * - `status`: `draft` = noindex + 목차·GPU 허브·사이트맵·공유 카드에서 제외(URL 로만 열린다 — 가이드 D40 과 같은 규칙).
 *   `published` 전환은 **사용자가 채팅으로 승인한 쌍만**(인덱싱 스위치 — 위임 불가). published 는 `reviewedAt` 과 en·ko 소개글이 필수(유닛 테스트)
 * - 날짜는 `YYYY-MM-DD` 문자열(빌드 시 `Date` 금지 — D21). `dateModified` 는 사이트맵 lastmod 에 들어간다(수치 기준일과 둘 중 늦은 날) —
 *   소개글을 고친 커밋에서 함께 바꾼다(기준: 배포되는 날의 UTC 날짜 — `content/updates.ts` 와 같다)
 * - 순서 = 목차 안 표시 순서(묶음 안에서)
 */

export type CompareGroup = 'entry' | 'midrange' | 'high-end' | 'cross-platform';

/** 목차의 묶음 순서 */
export const COMPARE_GROUPS: readonly CompareGroup[] = ['entry', 'midrange', 'high-end', 'cross-platform'];

export type CompareStatus = { status: 'draft' } | { status: 'published'; reviewedAt: string };

export type CompareEntry = CompareStatus & {
  /** 슬러그 앞쪽 GPU id (data/gpus.json) */
  a: string;
  /** 슬러그 뒤쪽 GPU id */
  b: string;
  group: CompareGroup;
  /** 이 쌍을 고른 검색 수요 근거 (검색엔진 자동완성·연관 검색어 — 화면에 쓰지 않는다) */
  demand: string;
  dateModified: string;
};

/** 비교 페이지 상한 — 고른 소수 쌍만 (프로그래매틱 대량 노출 금지) */
// source: docs/04 §11 (policy)
export const COMPARE_MAX = 12;

export const COMPARE_SLUGS = [
  'rtx-5060-ti-16gb-vs-rtx-5070',
  'rtx-4060-ti-16gb-vs-rtx-5060-ti-16gb',
  'rtx-3060-12gb-vs-rtx-4060',
  'rtx-5060-ti-8gb-vs-rtx-5060-ti-16gb',
  'rtx-5070-ti-vs-rtx-5060-ti-16gb',
  'rx-9070-xt-vs-rtx-5070',
  'rtx-4090-vs-rtx-5090',
  'rtx-3090-vs-rtx-4090',
  'rtx-3090-vs-rtx-5090',
  'amd-strix-halo-vs-nvidia-dgx-spark',
  'amd-strix-halo-vs-rtx-5070-ti',
  'apple-m4-pro-vs-rtx-5060-ti-16gb',
] as const;

export type CompareSlug = (typeof COMPARE_SLUGS)[number];

/** 10-19 D106 v1 — 10-19 사용자가 채팅으로 12쌍 모두 게시 승인(D108). 날짜는 UTC(배포일) */
const PUBLISHED_1019 = { status: 'published', reviewedAt: '2026-10-19', dateModified: '2026-10-19' } as const;

export const COMPARES: Readonly<Record<CompareSlug, CompareEntry>> = {
  'rtx-5060-ti-16gb-vs-rtx-5070': {
    ...PUBLISHED_1019,
    a: 'rtx-5060-ti-16gb',
    b: 'rtx-5070',
    group: 'entry',
    demand: "Naver '5060ti 16gb 5070 12gb'",
  },
  'rtx-4060-ti-16gb-vs-rtx-5060-ti-16gb': {
    ...PUBLISHED_1019,
    a: 'rtx-4060-ti-16gb',
    b: 'rtx-5060-ti-16gb',
    group: 'entry',
    demand: "Google '4060ti 16gb vs 5060ti 16gb llm'",
  },
  'rtx-3060-12gb-vs-rtx-4060': {
    ...PUBLISHED_1019,
    a: 'rtx-3060-12gb',
    b: 'rtx-4060',
    group: 'entry',
    demand: "Google '3060 vs 4060 llm'",
  },
  'rtx-5060-ti-8gb-vs-rtx-5060-ti-16gb': {
    ...PUBLISHED_1019,
    a: 'rtx-5060-ti-8gb',
    b: 'rtx-5060-ti-16gb',
    group: 'entry',
    demand: "Google ko '5060ti 8gb 16gb 차이'",
  },
  'rtx-5070-ti-vs-rtx-5060-ti-16gb': {
    ...PUBLISHED_1019,
    a: 'rtx-5070-ti',
    b: 'rtx-5060-ti-16gb',
    group: 'midrange',
    demand: "Google '5070ti vs 5060ti llm'",
  },
  'rx-9070-xt-vs-rtx-5070': {
    ...PUBLISHED_1019,
    a: 'rx-9070-xt',
    b: 'rtx-5070',
    group: 'midrange',
    demand: "Google '9070xt vs 5070 llm'",
  },
  'rtx-4090-vs-rtx-5090': {
    ...PUBLISHED_1019,
    a: 'rtx-4090',
    b: 'rtx-5090',
    group: 'high-end',
    demand: "Google '4090 vs 5090 llm'; competitor localai.co.kr compare page on Naver",
  },
  'rtx-3090-vs-rtx-4090': {
    ...PUBLISHED_1019,
    a: 'rtx-3090',
    b: 'rtx-4090',
    group: 'high-end',
    demand: "Google '3090 vs 4090 llm'",
  },
  'rtx-3090-vs-rtx-5090': {
    ...PUBLISHED_1019,
    a: 'rtx-3090',
    b: 'rtx-5090',
    group: 'high-end',
    demand: "Google '3090 vs 5090 llm'",
  },
  'amd-strix-halo-vs-nvidia-dgx-spark': {
    ...PUBLISHED_1019,
    a: 'amd-strix-halo',
    b: 'nvidia-dgx-spark',
    group: 'cross-platform',
    demand: "Google 'ai max 395 vs dgx spark'",
  },
  'amd-strix-halo-vs-rtx-5070-ti': {
    ...PUBLISHED_1019,
    a: 'amd-strix-halo',
    b: 'rtx-5070-ti',
    group: 'cross-platform',
    demand: "Naver 'Ai max 395 5070ti비교', Google 'ai max 395 vs 5070 ti'",
  },
  'apple-m4-pro-vs-rtx-5060-ti-16gb': {
    ...PUBLISHED_1019,
    a: 'apple-m4-pro',
    b: 'rtx-5060-ti-16gb',
    group: 'cross-platform',
    demand: "Google 'm4 pro vs 5060 ti'",
  },
};

/**
 * 손으로 쓴 소개글이 있는 쌍 — en·ko MDX `content/{en,ko}/compare/<slug>.mdx` + `lib/compare-intros.ts` 로더 맵 한 줄과 함께 늘린다
 * (유닛 테스트 `test/compare-intros.test.ts` 가 세 곳의 대칭을 본다). 여기 없는 쌍은 소개 없이 그린다 — 게시하려면 소개글이 있어야 한다
 */
export const COMPARE_INTRO_SLUGS = [
  'rtx-5060-ti-16gb-vs-rtx-5070',
  'rtx-4060-ti-16gb-vs-rtx-5060-ti-16gb',
  'rtx-3060-12gb-vs-rtx-4060',
  'rtx-5060-ti-8gb-vs-rtx-5060-ti-16gb',
  'rtx-5070-ti-vs-rtx-5060-ti-16gb',
  'rx-9070-xt-vs-rtx-5070',
  'rtx-4090-vs-rtx-5090',
  'rtx-3090-vs-rtx-4090',
  'rtx-3090-vs-rtx-5090',
  'amd-strix-halo-vs-nvidia-dgx-spark',
  'amd-strix-halo-vs-rtx-5070-ti',
  'apple-m4-pro-vs-rtx-5060-ti-16gb',
] as const satisfies readonly CompareSlug[];

export type CompareIntroSlug = (typeof COMPARE_INTRO_SLUGS)[number];

/**
 * 소개글이 쓸 수 있는 MDX 컴포넌트 — 허브 소개글(AUTHORING §10)과 같은 인라인 컴포넌트만. 표는 비교 페이지가 이미 그린다.
 * 렌더 맵(`components/compare-intro.tsx`)과 유닛 테스트가 같은 목록을 본다
 */
export const COMPARE_INTRO_COMPONENTS = ['Expect', 'Num', 'Price', 'HubLink', 'ComboLink', 'GuideLink'] as const;

export function isCompareSlug(slug: string): slug is CompareSlug {
  return (COMPARE_SLUGS as readonly string[]).includes(slug);
}

export function isComparePublished(slug: CompareSlug): boolean {
  return COMPARES[slug].status === 'published';
}

/** published 쌍 (레지스트리 순서) — 목차·GPU 허브 링크·사이트맵·공유 카드는 이것만 쓴다 */
export function publishedCompares(): CompareSlug[] {
  return COMPARE_SLUGS.filter(isComparePublished);
}

export function hasCompareIntro(slug: string): slug is CompareIntroSlug {
  return (COMPARE_INTRO_SLUGS as readonly string[]).includes(slug);
}

/** 슬러그를 만드는 규칙 — 레지스트리 키는 이 값과 같아야 한다(유닛 테스트) */
export const compareSlugOf = (a: string, b: string) => `${a}-vs-${b}`;

/** 뒤집은 순서 슬러그(`{b}-vs-{a}`) → 정순 슬러그 — `_redirects` 301 (`scripts/build-redirects.ts`). 초안도 넣는다(URL 이 바뀌지 않게) */
export function reversedCompareSlugs(): Array<{ reversed: string; slug: CompareSlug }> {
  return COMPARE_SLUGS.map((slug) => ({ reversed: compareSlugOf(COMPARES[slug].b, COMPARES[slug].a), slug }));
}
