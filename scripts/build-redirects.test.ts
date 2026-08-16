/** build-redirects 검증 규칙 — 외부 리뷰 반영 회귀. */
import { describe, expect, it } from 'vitest';
import {
  buildRedirects,
  CF_PAGES_REDIRECT_LINE_LIMIT,
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
