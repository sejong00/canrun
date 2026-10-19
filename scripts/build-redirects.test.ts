/** build-redirects 검증 규칙 — 외부 리뷰 반영 회귀. */
import { describe, expect, it } from 'vitest';
import { COMPARE_SLUGS, COMPARES } from '../apps/web/content/compares';
import {
  buildRedirects,
  CF_PAGES_REDIRECT_LINE_LIMIT,
  compareRedirects,
  isValidRedirectPath,
} from './build-redirects';

describe('isValidRedirectPath (^/[^\\s?#]*$ + 제어문자 거부)', () => {
  it('accepts normal site paths', () => {
    for (const path of ['/', '/gpu/rtx-4060', '/can-i-run/qwen3-14b/on/rtx-4060', '/ko/모델']) {
      expect(isValidRedirectPath(path), path).toBe(true);
    }
  });

  it('rejects paths that would break the space-delimited _redirects format', () => {
    const bad = [
      'gpu/rtx-4060', // 슬래시 미시작
      '/gpu /rtx', // 공백
      '/gpu\t4060', // 탭
      '/gpu?x=1', // 쿼리
      '/gpu#frag', // 프래그먼트
      '/gpu\n/etc /evil 301', // 개행 인젝션
      `/gpu${String.fromCharCode(0)}`, // NUL
      `/gpu${String.fromCharCode(0x1b)}`, // ESC
      `/gpu${String.fromCharCode(0x7f)}`, // DEL
    ];
    for (const path of bad) {
      expect(isValidRedirectPath(path), JSON.stringify(path)).toBe(false);
    }
  });
});

describe('buildRedirects', () => {
  it('throws on an invalid alias path', () => {
    expect(() => buildRedirects([{ from: '/a b', to: '/c' }])).toThrow(/invalid redirect path/);
  });

  it('counts the limit against the final output lines (comments excluded)', () => {
    // 정적 /en 정리 룰 2개 + alias 1998개 = 2000 → 통과
    const okAliases = Array.from({ length: CF_PAGES_REDIRECT_LINE_LIMIT - 2 }, (_, i) => ({
      from: `/alias-${i}`,
      to: `/canonical-${i}`,
    }));
    const output = buildRedirects(okAliases);
    const rules = output.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(rules.length).toBe(CF_PAGES_REDIRECT_LINE_LIMIT);

    // 하나 더 = 2001 → 실패
    expect(() =>
      buildRedirects([...okAliases, { from: '/overflow', to: '/x' }]),
    ).toThrow(/exceeds Cloudflare Pages limit/);
  });
});

describe('compareRedirects (GPU 비교 뒤집은 순서 — 10-19 D103)', () => {
  it('301s the reversed slug of every registry pair to the registry slug, in both locales', () => {
    const rules = compareRedirects();
    expect(rules).toHaveLength(COMPARE_SLUGS.length * 2);
    for (const slug of COMPARE_SLUGS) {
      const { a, b } = COMPARES[slug];
      expect(rules).toContainEqual({ from: `/compare/${b}-vs-${a}`, to: `/compare/${slug}` });
      expect(rules).toContainEqual({ from: `/ko/compare/${b}-vs-${a}`, to: `/ko/compare/${slug}` });
    }
  });

  it('never redirects a real compare page (no loop) and passes the path rules', () => {
    const pages = new Set(COMPARE_SLUGS.flatMap((slug) => [`/compare/${slug}`, `/ko/compare/${slug}`]));
    for (const rule of compareRedirects()) {
      expect(pages.has(rule.from), rule.from).toBe(false);
      expect(pages.has(rule.to), rule.to).toBe(true);
    }
    expect(buildRedirects(compareRedirects())).toContain(`/compare/rtx-5090-vs-rtx-4090 /compare/rtx-4090-vs-rtx-5090 301`);
  });
});
