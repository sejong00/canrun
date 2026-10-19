/**
 * 로캘 능력표 (10-19 D109) — 로캘마다 "무엇이 있는가"의 단일 출처.
 *
 * **의존성 0**: `@/` 별칭·next-intl import 금지 — 루트 tsconfig 의 스크립트(사이트맵·리다이렉트)·export 테스트가 직접 읽는다.
 *
 * - `ALL_LOCALES`: 라우팅 로캘(`i18n/routing.ts`) — 화면 문구(messages)가 있는 모든 로캘
 * - `INDEXED_LOCALES`: 검색에 내보내는 로캘 — hreflang·사이트맵·RSS·IndexNow. zh 는 공개 작업 전까지 빠진다(noindex)
 * - `CONTENT_LOCALES`: 사람이 따로 쓴 장문(MDX — 가이드·정적 페이지·허브/비교 소개글·모델 소개)이 있는 로캘.
 *   zh 는 화면 문구만 기계번역(사용자 승인)이고 장문은 만들지 않는다(CLAUDE.md 규칙 4 — 장문 기계번역 게시 금지)
 */
export const ALL_LOCALES = ['en', 'ko', 'zh'] as const;
export type AppLocale = (typeof ALL_LOCALES)[number];

export const DEFAULT_LOCALE = 'en' satisfies AppLocale;

export const INDEXED_LOCALES = ['en', 'ko'] as const satisfies readonly AppLocale[];
export type IndexedLocale = (typeof INDEXED_LOCALES)[number];

export const CONTENT_LOCALES = ['en', 'ko'] as const satisfies readonly AppLocale[];
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export function isIndexedLocale(locale: string): locale is IndexedLocale {
  return (INDEXED_LOCALES as readonly string[]).includes(locale);
}

export function isContentLocale(locale: string): locale is ContentLocale {
  return (CONTENT_LOCALES as readonly string[]).includes(locale);
}

/** `<html lang>`·JSON-LD `inLanguage`·언어 선택 링크의 `hreflang`/`lang` — zh 는 간체(BCP 47 `zh-Hans`) */
export const HTML_LANG: Readonly<Record<AppLocale, string>> = { en: 'en', ko: 'ko', zh: 'zh-Hans' };

/** Open Graph `og:locale` (언어_지역) */
export const OG_LOCALE: Readonly<Record<AppLocale, string>> = { en: 'en_US', ko: 'ko_KR', zh: 'zh_CN' };

/** 장문이 없는 로캘이 대신 가리키는 장문 로캘 — zh 푸터의 정적 페이지 링크는 영어판으로 간다 */
export function contentLocaleFor(locale: AppLocale): ContentLocale {
  return isContentLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** 공유 카드(og:image) 로캘 — 카드는 검색에 내보내는 로캘만 그린다(scripts/og-cards.ts). zh 페이지는 en 카드를 쓴다 */
export function ogImageLocale(locale: AppLocale): IndexedLocale {
  return isIndexedLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * 장문 페이지의 `generateStaticParams` — 정적 세그먼트(about 등)는 부모 레이아웃의 `[locale]` 을 그대로 물려받아 모든 로캘로
 * 생성되므로, 페이지가 이 목록을 돌려줘 부모 값을 덮어쓴다(Next 16.3.6 `generateRouteStaticParams` 가 `{...parent, ...child}` 로
 * 합치고 중복을 걸러낸다 — 10-19 D109 스파이크). 빈 배열은 `output: 'export'` 에서 빌드 실패라 부모 값과 무관하게 같은 목록을 돌려준다.
 * 검증: test/export-invariants.spec.ts "zh (D109)" — `out/zh/` 에 장문 페이지가 없어야 한다
 */
export function contentLocaleParams(): Array<{ locale: ContentLocale }> {
  return CONTENT_LOCALES.map((locale) => ({ locale }));
}
