import type { Metadata } from 'next';
import { INDEXED_LOCALES, OG_LOCALE, isIndexedLocale, ogImageLocale } from '@/i18n/locales';
import { routing, type Locale } from '@/i18n/routing';
import { localeHref, rssHref } from './links';
import { defaultOgImage } from './og-images';
import { absoluteUrl } from './site';

/** next-intl getPathname 과 같은 as-needed 규칙 (lib/links.ts — 클라이언트 번들 회피) */
const getPathname = ({ href, locale }: { href: string; locale: Locale }) => localeHref(locale, href);

/**
 * CLAUDE.md 규칙 5 / docs/04 §6 — 캐노니컬 자기참조 + hreflang 완전 대칭.
 *
 * 페이지는 이 함수만 호출하고 수기로 <link rel="alternate"> 를 쓰지 않는다.
 * `href` 는 로케일 프리픽스가 없는 내부 경로(`/`, `/calculator`, `/gpu/rtx-4060`).
 *
 * hreflang 은 검색 노출 로캘(`INDEXED_LOCALES` — en·ko)끼리만 짝짓는다. zh(10-19 D109)는 공개 작업 전까지 검색 제외라
 * 자기 캐노니컬만 두고 hreflang·RSS 대체 링크가 없으며, en/ko 페이지의 hreflang 에도 들어가지 않는다.
 */
export function buildAlternates(href: string, locale: Locale): Metadata['alternates'] {
  const canonical = absoluteUrl(getPathname({ href, locale }));
  if (!isIndexedLocale(locale)) return { canonical };

  const languages: Record<string, string> = {};
  for (const target of INDEXED_LOCALES) {
    languages[target] = absoluteUrl(getPathname({ href, locale: target }));
  }
  // x-default 는 en (docs/04 §6)
  languages['x-default'] = absoluteUrl(getPathname({ href, locale: routing.defaultLocale }));

  return {
    canonical,
    languages,
    // 로캘 RSS (P1-5) — rel=alternate type=application/rss+xml (hreflang 없음)
    types: { 'application/rss+xml': absoluteUrl(getPathname({ href: rssHref(), locale })) },
  };
}

/**
 * 공유 카드 크기 — 기본 카드(P1-5)는 로캘별 1장. GPU·모델 허브(D60)·공개 콤보·게시 가이드(D96)는 페이지별 카드(postbuild 가 그린다,
 * 경로는 lib/og-images.ts). 미공개 콤보·초안 가이드·계산기·정적 페이지는 기본 카드. zh 는 en 카드를 쓴다(D109 — `ogImageLocale`)
 */
const OG_IMAGE = { width: 1200, height: 630 } as const;

/** 페이지 메타데이터 — alternates(규칙 5) + Open Graph 기본값 + 기본 공유 카드. */
export function buildPageMetadata(opts: {
  href: string;
  locale: Locale;
  title: string;
  description: string;
  /** 레이아웃의 " — CanRun" 템플릿을 쓰지 않을 때 (홈·콤보) */
  absoluteTitle?: boolean;
  /** 인덱싱 배치 밖의 콤보 (docs/04 §3, 결정 D9) — noindex,follow. 캐노니컬·hreflang 은 그대로. 검색 노출 로캘이 아니면(zh, D109) 항상 noindex */
  noindex?: boolean;
  /** 가이드 (P1-4 D41) — og type article + 게시·수정일(YYYY-MM-DD) */
  article?: { publishedTime: string; modifiedTime: string };
  /** 사이트 기준 경로의 공유 카드 (lib/og-images.ts — 허브 D60, 공개 콤보·게시 가이드 D96) — 없으면 로캘 기본 카드. twitter:image 는 Next 가 이 값을 이어받는다 */
  ogImage?: string;
}): Metadata {
  const { href, locale, title, description } = opts;
  const noindex = opts.noindex === true || !isIndexedLocale(locale);
  return {
    title: opts.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: buildAlternates(href, locale),
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      ...(opts.article
        ? { type: 'article' as const, publishedTime: opts.article.publishedTime, modifiedTime: opts.article.modifiedTime, authors: ['CanRun'] }
        : { type: 'website' as const }),
      siteName: 'CanRun',
      title,
      description,
      url: absoluteUrl(getPathname({ href, locale })),
      locale: OG_LOCALE[locale],
      images: [{ url: absoluteUrl(opts.ogImage ?? defaultOgImage(ogImageLocale(locale))), ...OG_IMAGE }],
    },
    twitter: { card: 'summary_large_image' },
  };
}
