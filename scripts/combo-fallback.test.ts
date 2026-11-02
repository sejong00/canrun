/** 없어진 조합 주소 → 계산기 (11-02 D130) — 404.html 인라인 스크립트를 그대로 vm 에서 돌려 이동할 주소를 본다 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { comboFallbackScript, FALLBACK_MARKER, injectComboFallback, type FallbackLabels } from './combo-fallback';

const LABELS: FallbackLabels = { '': 'Open in the calculator', '/ko': '계산기에서 열기', '/zh': '在计算器中打开' };

/** 가짜 location·document 로 스크립트를 돌린다 — replace 된 주소와 붙인 링크(문구·주소) */
function run(pathname: string, search = '') {
  let replaced: string | undefined;
  let onReady: (() => void) | undefined;
  const appended: Array<{ href: string; text: string }> = [];
  const makeEl = () => {
    const el: Record<string, unknown> = {
      style: {},
      href: '',
      textContent: '',
      setAttribute() {},
      appendChild(child: { href: string; textContent: string }) {
        appended.push({ href: child.href, text: child.textContent });
      },
    };
    return el;
  };
  runInNewContext(comboFallbackScript(LABELS), {
    URLSearchParams,
    location: { pathname, search, replace: (u: string) => (replaced = u) },
    document: {
      createElement: makeEl,
      addEventListener: (_: string, fn: () => void) => (onReady = fn),
      body: { appendChild() {} },
    },
  });
  onReady?.();
  return { replaced, appended };
}

describe('combo fallback script (D130)', () => {
  it('sends a removed combo URL to the calculator with that GPU and model, keeping the locale prefix', () => {
    expect(run('/can-i-run/qwen3-14b/on/rx-9060-xt-16gb').replaced).toBe('/calculator?gpu=rx-9060-xt-16gb&m=qwen3-14b');
    expect(run('/ko/can-i-run/llama-3.1-8b/on/rtx-3050-8gb').replaced).toBe('/ko/calculator?gpu=rtx-3050-8gb&m=llama-3.1-8b');
    expect(run('/zh/can-i-run/gpt-oss-20b/on/apple-m4').replaced).toBe('/zh/calculator?gpu=apple-m4&m=gpt-oss-20b');
    // 정적 서버가 붙인 .html·끝 슬래시도 같은 쌍
    expect(run('/can-i-run/gpt-oss-20b/on/rtx-4060.html').replaced).toBe('/calculator?gpu=rtx-4060&m=gpt-oss-20b');
    expect(run('/can-i-run/gpt-oss-20b/on/rtx-4060/').replaced).toBe('/calculator?gpu=rtx-4060&m=gpt-oss-20b');
  });

  it('keeps the old query (ram, ctx …) but never lets it override gpu or m', () => {
    expect(run('/can-i-run/qwen3-14b/on/rx-9060-xt-16gb', '?ram=64&ctx=32768&gpu=evil&m=x').replaced).toBe(
      '/calculator?gpu=rx-9060-xt-16gb&m=qwen3-14b&ram=64&ctx=32768',
    );
  });

  it('adds one visible link to the same place, worded in the path locale', () => {
    expect(run('/ko/can-i-run/qwen3-14b/on/rx-9060-xt-16gb').appended).toEqual([{ href: '/ko/calculator?gpu=rx-9060-xt-16gb&m=qwen3-14b', text: LABELS['/ko'] }]);
    expect(run('/can-i-run/qwen3-14b/on/rx-9060-xt-16gb').appended[0]!.text).toBe(LABELS['']);
  });

  it('does nothing on other 404s or on paths outside the slug alphabet', () => {
    for (const path of ['/', '/gpu/nope', '/en/can-i-run/a/on/b', '/can-i-run/a/on', '/can-i-run/A%2F/on/b', '/can-i-run/a/on/b/c', '/fr/can-i-run/a/on/b']) {
      expect(run(path), path).toEqual({ replaced: undefined, appended: [] });
    }
  });

  it('is injected once into <head>, and escapes "<" in the labels', () => {
    const html = '<!DOCTYPE html><html><head><title>404</title></head><body></body></html>';
    const once = injectComboFallback(html, LABELS);
    expect(once.indexOf(FALLBACK_MARKER)).toBeLessThan(once.indexOf('</head>'));
    expect(injectComboFallback(once, LABELS)).toBe(once);
    expect(comboFallbackScript({ ...LABELS, '': '</script><b>' })).not.toContain('</script>');
    expect(() => injectComboFallback('<html></html>', LABELS)).toThrow(/no <\/head>/);
  });
});
