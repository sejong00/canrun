/**
 * lib/links.ts localeHref — next-intl `localePrefix: 'as-needed'` 규칙의 순수 구현 (결정 D6).
 * 전 페이지 끝단 검증은 test/export-invariants.spec.ts(캐노니컬 = 실제 파일 경로, hreflang 짝,
 * /en 링크 0건)가 하고, 여기서는 규칙 자체와 라우팅 설정 전제를 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { routing } from '../i18n/routing';
import { localeHref } from '../lib/links';

describe('localeHref (as-needed prefix)', () => {
  it('assumes the routing config it mirrors', () => {
    expect(routing.defaultLocale).toBe('en');
    expect(routing.locales).toEqual(['en', 'ko']);
    expect(routing.localePrefix).toBe('as-needed');
  });

  it.each([
    ['en', '/', '/'],
    ['en', '/gpu/rtx-4060', '/gpu/rtx-4060'],
    ['en', '/model/qwen3.5-9b', '/model/qwen3.5-9b'],
    ['ko', '/', '/ko'],
    ['ko', '/gpu/rtx-4060', '/ko/gpu/rtx-4060'],
    ['ko', '/model/qwen3.5-9b', '/ko/model/qwen3.5-9b'],
  ] as const)('%s %s → %s', (locale, href, expected) => {
    expect(localeHref(locale, href)).toBe(expected);
  });
});
