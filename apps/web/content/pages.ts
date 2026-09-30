/**
 * 정적 페이지 레지스트리 (P1-5) — 의존성 0: 사이트맵 스크립트·export 테스트(저장소 루트)도 읽는다.
 * 본문은 가이드처럼 로캘별 MDX `content/{en,ko}/pages/<slug>.mdx` (CLAUDE.md 규칙 4 예외 D39 를 확장), 제목·설명은 messages `Pages.*`.
 */
export const STATIC_PAGE_SLUGS = ['about', 'methodology', 'privacy', 'contact'] as const;
export type StaticPageSlug = (typeof STATIC_PAGE_SLUGS)[number];
