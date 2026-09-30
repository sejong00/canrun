import type { Metadata } from 'next';
import { routing, type Locale } from '@/i18n/routing';
import { localeHref, rssHref } from './links';
import { absoluteUrl } from './site';

/** next-intl getPathname 과 같은 as-needed 규칙 (lib/links.ts — 클라이언트 번들 회피) */
const getPathname = ({ href, locale }: { href: string; locale: Locale }) => localeHref(locale, href);

/**
 * CLAUDE.md 규칙 5 / docs/04 §6 — 캐노니컬 자기참조 + hreflang 완전 대칭.
 *
 * 페이지는 이 함수만 호출하고 수기로 <link rel="alternate"> 를 쓰지 않는다.
 * `href` 는 로케일 프리픽스가 없는 내부 경로(`/`, `/calculator`, `/gpu/rtx-4060`).
 */
export function buildAlternates(href: string, locale: Locale): Metadata['alternates'] {
  const languages: Record<string, string> = {};

  for (const target of routing.locales) {
    languages[target] = absoluteUrl(getPathname({ href, locale: target }));
  }
  // x-default 는 en (docs/04 §6)
  languages['x-default'] = absoluteUrl(getPathname({ href, locale: routing.defaultLocale }));

  return {
    canonical: absoluteUrl(getPathname({ href, locale })),
    languages,
    // 로캘 RSS (P1-5) — rel=alternate type=application/rss+xml (hreflang 없음)
    types: { 'application/rss+xml': absoluteUrl(getPathname({ href: rssHref(), locale })) },
  };
}

const OG_LOCALE: Record<Locale, string> = { en: 'en_US', ko: 'ko_KR' };

/** 기본 공유 카드 (P1-5) — 로캘별 1장. 허브·콤보별 카드는 백로그 (PROGRESS §4 09-30) */
const OG_IMAGE = { width: 1200, height: 630 } as const;

/** 페이지 메타데이터 — alternates(규칙 5) + Open Graph 기본값 + 기본 공유 카드. */
export function buildPageMetadata(opts: {
  href: string;
  locale: Locale;
  title: string;
  description: string;
  /** 레이아웃의 " — CanRun" 템플릿을 쓰지 않을 때 (홈·콤보) */
  absoluteTitle?: boolean;
  /** 인덱싱 배치 밖의 콤보 (docs/04 §3, 결정 D9) — noindex,follow. 캐노니컬·hreflang 은 그대로 */
  noindex?: boolean;
  /** 가이드 (P1-4 D41) — og type article + 게시·수정일(YYYY-MM-DD) */
  article?: { publishedTime: string; modifiedTime: string };
}): Metadata {
  const { href, locale, title, description } = opts;
  return {
    title: opts.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: buildAlternates(href, locale),
    ...(opts.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      ...(opts.article
        ? { type: 'article' as const, publishedTime: opts.article.publishedTime, modifiedTime: opts.article.modifiedTime, authors: ['CanRun'] }
        : { type: 'website' as const }),
      siteName: 'CanRun',
      title,
      description,
      url: absoluteUrl(getPathname({ href, locale })),
      locale: OG_LOCALE[locale],
      images: [{ url: absoluteUrl(`/og/default-${locale}.png`), ...OG_IMAGE }],
    },
    twitter: { card: 'summary_large_image' },
  };
}
