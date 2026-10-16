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

/** `/calculator` — 무료 웹 도구 (docs/04 §5, P1-3 D24) */
export function softwareApplicationJsonLd(input: {
  name: string;
  url: string;
  description: string;
  inLanguage: string;
  version: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: input.name,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    url: input.url,
    inLanguage: input.inLanguage,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: input.description,
    softwareVersion: input.version,
  };
}

/** 홈 — WebSite (SearchAction 은 두지 않는다: 사이트링크 검색창 종료, P1-3 D25) */
export function webSiteJsonLd(input: {
  name: string;
  /** 사이트 이름의 다른 표기 (Google 사이트 이름 — 홈 페이지의 WebSite 에만, D70) */
  alternateName?: readonly string[];
  url: string;
  inLanguage: string;
  description: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.name,
    ...(input.alternateName && input.alternateName.length > 0 ? { alternateName: [...input.alternateName] } : {}),
    url: input.url,
    inLanguage: input.inLanguage,
    description: input.description,
  };
}

/**
 * 가이드 — Article (docs/04 §5, P1-4 D41). 저자·발행처는 브랜드 Organization(사용자 결정 — 실명 전환은 레지스트리 한 줄).
 * headline 은 Google 권장 110자 이하(레지스트리 제목 길이 테스트가 보장), 날짜는 레지스트리 `YYYY-MM-DD` 그대로.
 * image 는 og:image 와 같은 공유 카드 절대 URL (10-16 D96 — 1200×630).
 */
export function articleJsonLd(input: {
  headline: string;
  description: string;
  url: string;
  inLanguage: string;
  datePublished: string;
  dateModified: string;
  author: string;
  siteUrl: string;
  image: string;
}) {
  const org = { '@type': 'Organization', name: input.author, url: input.siteUrl };
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.headline,
    description: input.description,
    url: input.url,
    mainEntityOfPage: input.url,
    image: input.image,
    inLanguage: input.inLanguage,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: org,
    publisher: org,
  };
}

/** `<script type="application/ld+json">` 본문 — `<` 이스케이프로 스크립트 탈출 차단. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
