import type { Metadata } from 'next';
import { getPathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { absoluteUrl } from './site';

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
  };
}
