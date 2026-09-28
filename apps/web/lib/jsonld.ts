/**
 * 구조화 데이터 (docs/04 §5) — 허브: BreadcrumbList + FAQPage.
 *
 * - 브레드크럼은 2단(홈 › 허브, 결정 D7): Google 은 마지막 외 항목에 `item` URL 을 요구하고
 *   `/gpu`·`/model` 인덱스 페이지는 없다. 마지막 항목 URL = 캐노니컬.
 * - FAQPage 답 텍스트는 화면에 보이는 FAQ 와 같은 문자열을 쓴다(구글 가이드라인). 2023년 이후
 *   FAQ 리치 결과는 정부·보건 사이트 한정이라 노출은 기대하지 않는다(결정 D8).
 */

export type Crumb = { name: string; url: string };
export type QA = { question: string; answer: string };

export function breadcrumbJsonLd(crumbs: readonly Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

export function faqJsonLd(items: readonly QA[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((qa) => ({
      '@type': 'Question',
      name: qa.question,
      acceptedAnswer: { '@type': 'Answer', text: qa.answer },
    })),
  };
}

/** `<script type="application/ld+json">` 본문 — `<` 이스케이프로 스크립트 탈출 차단. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
