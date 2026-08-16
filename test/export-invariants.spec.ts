/**
 * 정적 export 산출물 불변식 — P0-1 i18n 스파이크의 실증 + 상시 회귀.
 *
 * 외부 리뷰 반영(2026-08): 홈 2페이지 고정 검사 → **산출물 재귀 열거** 로 확장.
 * `pnpm build` 이후 전 HTML 페이지에 대해:
 *  - en/ko 짝 존재 (전 페이지 대칭 — docs/04 §6)
 *  - canonical == 실제 파일 경로의 URL (자기참조, CLAUDE.md 규칙 5)
 *  - hreflang {en, ko, x-default} 상호 대조 (짝 페이지와 동일 집합, x-default=en)
 *  - URL 당 파일 1개 (foo.html 과 foo/index.html 중복 금지)
 *  - out/en/ 부재 (평탄화), en 페이지에 /en 프리픽스 링크 0건, _redirects 한도
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CF_PAGES_REDIRECT_LINE_LIMIT } from '../scripts/build-redirects';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'apps/web/out');

/** hreflang 짝 검사에서 제외되는 에러/시스템 페이지 */
const EXCLUDED = new Set(['404.html', '_not-found.html']);

type Page = {
  /** out/ 기준 상대 파일 경로 (posix) */
  file: string;
  /** 사이트 URL 경로 (`/`, `/ko`, `/gpu/rtx-4060` …) */
  urlPath: string;
  html: string;
};

function walkHtml(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walkHtml(full));
    } else if (entry.endsWith('.html')) {
      found.push(full);
    }
  }
  return found;
}

/** 파일 경로 → URL 경로 (trailingSlash:false 규약: foo.html → /foo, dir/index.html → /dir) */
function toUrlPath(relFile: string): string {
  const posix = relFile.replaceAll('\\', '/');
  if (posix === 'index.html') return '/';
  if (posix.endsWith('/index.html')) return `/${posix.slice(0, -'/index.html'.length)}`;
  return `/${posix.slice(0, -'.html'.length)}`;
}

function extractHreflangs(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tag of html.match(/<link\b[^>]*rel="alternate"[^>]*>/g) ?? []) {
    const hreflang = tag.match(/hreflang="([^"]+)"/i)?.[1];
    const href = tag.match(/href="([^"]+)"/i)?.[1];
    if (hreflang && href) map[hreflang] = href;
  }
  return map;
}

function extractCanonical(html: string): string | undefined {
  return html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1];
}

/** 절대 URL → 경로 (루트는 슬래시 유무 무관하게 '/' 로 정규화) */
function urlToPath(url: string): string {
  const { pathname } = new URL(url);
  return pathname === '' ? '/' : pathname;
}

let pages: Page[] = [];

beforeAll(() => {
  if (!existsSync(outDir)) {
    throw new Error('apps/web/out not found — run `pnpm build` before `pnpm test:export`');
  }
  pages = walkHtml(outDir)
    .map((full) => relative(outDir, full))
    .filter((rel) => !EXCLUDED.has(rel.replaceAll('\\', '/')))
    .map((rel) => ({
      file: rel.replaceAll('\\', '/'),
      urlPath: toUrlPath(rel),
      html: readFileSync(join(outDir, rel), 'utf8'),
    }));
});

describe('URL space integrity', () => {
  it('found at least the en/ko home pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });

  it('exactly one file per URL (no foo.html + foo/index.html duplicates)', () => {
    const byUrl = new Map<string, string[]>();
    for (const page of pages) {
      byUrl.set(page.urlPath, [...(byUrl.get(page.urlPath) ?? []), page.file]);
    }
    for (const [urlPath, files] of byUrl) {
      expect(files, `duplicate files for ${urlPath}`).toHaveLength(1);
    }
  });

  it('leaves no out/en directory or /en-prefixed pages behind after flattening', () => {
    expect(existsSync(join(outDir, 'en'))).toBe(false);
    expect(existsSync(join(outDir, 'en.html'))).toBe(false);
    for (const page of pages) {
      expect(page.urlPath === '/en' || page.urlPath.startsWith('/en/'), page.file).toBe(false);
    }
  });
});

describe('en/ko page pairing (docs/04 §6 — every page in both locales)', () => {
  it('every en page has its /ko twin and vice versa', () => {
    const urls = new Set(pages.map((p) => p.urlPath));
    for (const url of urls) {
      if (url === '/ko' || url.startsWith('/ko/')) {
        const enTwin = url === '/ko' ? '/' : url.slice('/ko'.length);
        expect(urls.has(enTwin), `ko page ${url} missing en twin ${enTwin}`).toBe(true);
      } else {
        const koTwin = url === '/' ? '/ko' : `/ko${url}`;
        expect(urls.has(koTwin), `en page ${url} missing ko twin ${koTwin}`).toBe(true);
      }
    }
  });
});

describe('canonical + hreflang per page (CLAUDE.md rule 5)', () => {
  it('canonical is self-referencing: canonical path == actual file URL path', () => {
    for (const page of pages) {
      const canonical = extractCanonical(page.html);
      expect(canonical, `${page.file} missing canonical`).toBeDefined();
      expect(urlToPath(canonical!), `${page.file} canonical mismatch`).toBe(page.urlPath);
    }
  });

  it('hreflang set is {en, ko, x-default}, points at the real pair, x-default=en', () => {
    const urls = new Set(pages.map((p) => p.urlPath));
    for (const page of pages) {
      const map = extractHreflangs(page.html);
      expect(Object.keys(map).sort(), page.file).toEqual(['en', 'ko', 'x-default']);
      expect(map['x-default'], `${page.file} x-default != en`).toBe(map.en);

      const enPath = urlToPath(map.en!);
      const koPath = urlToPath(map.ko!);
      const isKo = page.urlPath === '/ko' || page.urlPath.startsWith('/ko/');
      // 자기참조 + 짝 참조가 실제 존재하는 페이지를 가리켜야 한다 (상호 대조)
      expect(isKo ? koPath : enPath, `${page.file} hreflang self-ref`).toBe(page.urlPath);
      expect(urls.has(enPath), `${page.file} hreflang en → missing page ${enPath}`).toBe(true);
      expect(urls.has(koPath), `${page.file} hreflang ko → missing page ${koPath}`).toBe(true);
    }
  });

  it('hreflang maps are identical across each en/ko pair', () => {
    const byUrl = new Map(pages.map((p) => [p.urlPath, p]));
    for (const page of pages) {
      const isKo = page.urlPath === '/ko' || page.urlPath.startsWith('/ko/');
      if (isKo) continue;
      const twin = byUrl.get(page.urlPath === '/' ? '/ko' : `/ko${page.urlPath}`);
      expect(twin).toBeDefined();
      expect(extractHreflangs(page.html), `pair mismatch at ${page.urlPath}`).toEqual(
        extractHreflangs(twin!.html),
      );
    }
  });
});

describe('en pages carry no /en-prefixed internal links', () => {
  it('no href="/en" or href="/en/…" anywhere', () => {
    for (const page of pages) {
      const enPrefixed = page.html.match(/href="\/en(\/|")/g) ?? [];
      expect(enPrefixed, page.file).toEqual([]);
    }
  });
});

describe('_redirects (docs/05 §3)', () => {
  it('exists, includes the /en cleanup rules, stays under the CF limit', () => {
    const path = join(outDir, '_redirects');
    expect(existsSync(path)).toBe(true);
    const rules = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.length).toBeLessThanOrEqual(CF_PAGES_REDIRECT_LINE_LIMIT);
    expect(rules).toContain('/en/* /:splat 301');
  });
});
