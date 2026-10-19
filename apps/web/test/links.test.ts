/**
 * lib/links.ts localeHref — next-intl `localePrefix: 'as-needed'` 규칙의 순수 구현 (결정 D6).
 * 전 페이지 끝단 검증은 test/export-invariants.spec.ts(캐노니컬 = 실제 파일 경로, hreflang 짝,
 * /en 링크 0건)가 하고, 여기서는 규칙 자체와 라우팅 설정 전제, 로캘 능력표(i18n/locales.ts — 10-19 D109)를 고정한다.
 */
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_LOCALES,
  CONTENT_LOCALES,
  DEFAULT_LOCALE,
  HTML_LANG,
  INDEXED_LOCALES,
  OG_LOCALE,
  contentLocaleFor,
  contentLocaleParams,
  isContentLocale,
  isIndexedLocale,
  ogImageLocale,
} from '../i18n/locales';
import { routing } from '../i18n/routing';
import { localeHref } from '../lib/links';

describe('localeHref (as-needed prefix)', () => {
  it('assumes the routing config it mirrors', () => {
    expect(routing.defaultLocale).toBe('en');
    expect(routing.locales).toEqual(['en', 'ko', 'zh']);
    expect(routing.locales).toEqual(ALL_LOCALES);
    expect(routing.localePrefix).toBe('as-needed');
  });

  it.each([
    ['en', '/', '/'],
    ['en', '/gpu/rtx-4060', '/gpu/rtx-4060'],
    ['en', '/model/qwen3.5-9b', '/model/qwen3.5-9b'],
    ['ko', '/', '/ko'],
    ['ko', '/gpu/rtx-4060', '/ko/gpu/rtx-4060'],
    ['ko', '/model/qwen3.5-9b', '/ko/model/qwen3.5-9b'],
    ['zh', '/', '/zh'],
    ['zh', '/gpu/rtx-4060', '/zh/gpu/rtx-4060'],
    ['zh', '/can-i-run/qwen3-14b/on/rtx-4060', '/zh/can-i-run/qwen3-14b/on/rtx-4060'],
  ] as const)('%s %s → %s', (locale, href, expected) => {
    expect(localeHref(locale, href)).toBe(expected);
  });
});

describe('locale capabilities (i18n/locales.ts — 10-19 D109)', () => {
  it('zh is routed but neither indexed nor a long-form locale', () => {
    expect(ALL_LOCALES).toEqual(['en', 'ko', 'zh']);
    expect(DEFAULT_LOCALE).toBe('en');
    expect(INDEXED_LOCALES).toEqual(['en', 'ko']);
    expect(CONTENT_LOCALES).toEqual(['en', 'ko']);
    expect(ALL_LOCALES.filter(isIndexedLocale)).toEqual(['en', 'ko']);
    expect(ALL_LOCALES.filter(isContentLocale)).toEqual(['en', 'ko']);
    expect(isIndexedLocale('fr')).toBe(false);
    expect(isContentLocale('fr')).toBe(false);
  });

  it('html lang, og:locale, share-card locale and long-form fallback per locale', () => {
    expect(HTML_LANG).toEqual({ en: 'en', ko: 'ko', zh: 'zh-Hans' });
    expect(OG_LOCALE).toEqual({ en: 'en_US', ko: 'ko_KR', zh: 'zh_CN' });
    expect(ALL_LOCALES.map(ogImageLocale)).toEqual(['en', 'ko', 'en']);
    expect(ALL_LOCALES.map(contentLocaleFor)).toEqual(['en', 'ko', 'en']);
  });

  it('long-form routes generate en and ko only (overrides the parent [locale] params)', () => {
    expect(contentLocaleParams()).toEqual([{ locale: 'en' }, { locale: 'ko' }]);
  });

  it('long-form content folders exist for the content locales only — no machine-translated content/zh (CLAUDE.md rule 4)', () => {
    const contentDir = fileURLToPath(new URL('../content/', import.meta.url));
    const localeDirs = readdirSync(contentDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(localeDirs).toEqual([...CONTENT_LOCALES].sort());
    expect(existsSync(fileURLToPath(new URL('../content/zh', import.meta.url)))).toBe(false);
  });
});
