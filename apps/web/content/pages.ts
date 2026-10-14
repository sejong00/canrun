/**
 * 정적 페이지 레지스트리 (P1-5) — 의존성 0: 사이트맵 스크립트·export 테스트(저장소 루트)도 읽는다.
 * 본문은 가이드처럼 로캘별 MDX `content/{en,ko}/pages/<slug>.mdx` (CLAUDE.md 규칙 4 예외 D39 를 확장), 제목·설명은 messages `Pages.*`.
 * 순서 = 푸터 링크 순서. `updates`(10-14 D72)는 날짜가 `content/updates.ts`, 모델 목록이 `data/models.json` 의 addedAt 에서 온다.
 */
export const STATIC_PAGE_SLUGS = ['about', 'methodology', 'updates', 'privacy', 'contact'] as const;
export type StaticPageSlug = (typeof STATIC_PAGE_SLUGS)[number];
