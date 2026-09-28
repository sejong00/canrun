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

// ---------------------------------------------------------------------------
// P1-1 허브 템플릿 불변식 (docs/04 §2·§5·§6, CLAUDE.md 규칙 3·4·5)
// ---------------------------------------------------------------------------

const readIds = (file: string) =>
  (JSON.parse(readFileSync(join(repoRoot, 'data', file), 'utf8')) as Array<{ id: string }>).map(
    (record) => record.id,
  );

const isKoPath = (urlPath: string) => urlPath === '/ko' || urlPath.startsWith('/ko/');
const hubPathOf = (urlPath: string) => (isKoPath(urlPath) ? urlPath.slice('/ko'.length) : urlPath);
const isHub = (urlPath: string) => /^\/(gpu|model)\//.test(hubPathOf(urlPath));

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function jsonLdBlocks(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );
}

function metaDescription(html: string): string | undefined {
  const raw = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  return raw === undefined ? undefined : decodeEntities(raw);
}

function titleOf(html: string): string | undefined {
  const raw = html.match(/<title>([^<]*)<\/title>/)?.[1];
  return raw === undefined ? undefined : decodeEntities(raw);
}

function visibleFaq(html: string): Array<{ question: string; answer: string }> {
  const questions = [...html.matchAll(/<h3[^>]*data-faq-question[^>]*>([\s\S]*?)<\/h3>/g)].map(
    (m) => decodeEntities(m[1]!),
  );
  const answers = [...html.matchAll(/<p[^>]*data-faq-answer[^>]*>([\s\S]*?)<\/p>/g)].map((m) =>
    decodeEntities(m[1]!),
  );
  return questions.map((question, i) => ({ question, answer: answers[i] ?? '' }));
}

/** `<a href="/…">` 내부 링크 (로케일 전환 링크 제외 옵션) */
function internalLinks(html: string, { skipLocaleSwitch = false } = {}): string[] {
  const links: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const tag = m[0];
    const href = tag.match(/href="(\/[^"/][^"]*|\/)"/)?.[1];
    if (!href) continue;
    if (skipLocaleSwitch && tag.includes('data-locale-switch')) continue;
    links.push(href);
  }
  return links;
}

/** 스크립트·스타일을 뺀 가시 텍스트 (RSC 인라인 페이로드 제외) */
function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

describe('hub pages exist for every catalog record (결정 D1 — 허브 전체 생성)', () => {
  it('every gpus.json / models.json id has an en and a ko hub', () => {
    const urls = new Set(pages.map((p) => p.urlPath));
    for (const id of readIds('gpus.json')) {
      expect(urls.has(`/gpu/${id}`), `/gpu/${id}`).toBe(true);
      expect(urls.has(`/ko/gpu/${id}`), `/ko/gpu/${id}`).toBe(true);
    }
    for (const id of readIds('models.json')) {
      expect(urls.has(`/model/${id}`), `/model/${id}`).toBe(true);
      expect(urls.has(`/ko/model/${id}`), `/ko/model/${id}`).toBe(true);
    }
  });
});

describe('html lang matches the locale', () => {
  it('ko pages are lang="ko", everything else lang="en"', () => {
    for (const page of pages) {
      const lang = page.html.match(/<html[^>]*\blang="([^"]+)"/)?.[1];
      expect(lang, page.file).toBe(isKoPath(page.urlPath) ? 'ko' : 'en');
    }
  });
});

describe('structured data (docs/04 §5)', () => {
  it('every JSON-LD block parses; hubs carry BreadcrumbList + FAQPage', () => {
    for (const page of pages) {
      const blocks = jsonLdBlocks(page.html);
      if (!isHub(page.urlPath)) continue;
      const types = blocks.map((b) => b['@type']);
      expect(types, page.file).toContain('BreadcrumbList');
      expect(types, page.file).toContain('FAQPage');
    }
  });

  it('breadcrumbs: every item has a URL (결정 D7), the last one is the canonical', () => {
    for (const page of pages.filter((p) => isHub(p.urlPath))) {
      const crumbs = jsonLdBlocks(page.html).find((b) => b['@type'] === 'BreadcrumbList')!;
      const items = crumbs.itemListElement as Array<{ item?: string; position: number }>;
      expect(items.length, page.file).toBeGreaterThanOrEqual(2);
      items.forEach((item, i) => {
        expect(item.position, page.file).toBe(i + 1);
        expect(item.item, page.file).toMatch(/^https?:\/\//);
      });
      expect(items.at(-1)!.item, page.file).toBe(extractCanonical(page.html));
    }
  });

  it('FAQPage text equals the visible FAQ (Google FAQ guideline)', () => {
    for (const page of pages.filter((p) => isHub(p.urlPath))) {
      const faq = jsonLdBlocks(page.html).find((b) => b['@type'] === 'FAQPage')!;
      const entities = (
        faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>
      ).map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }));
      expect(entities.length, page.file).toBe(3);
      expect(entities, page.file).toEqual(visibleFaq(page.html));
    }
  });
});

describe('estimates always carry a band (CLAUDE.md 규칙 3)', () => {
  const RANGE = /\d[\d.,]*–\d[\d.,]*/;
  const QUOTED_SPEED = /\d[\d.,]*\s*tok\/s/;
  it('meta descriptions and FAQ answers that quote a tok/s value also quote a range', () => {
    for (const page of pages) {
      const texts = [metaDescription(page.html) ?? '', ...visibleFaq(page.html).map((q) => q.answer)];
      for (const text of texts) {
        if (!QUOTED_SPEED.test(text)) continue;
        expect(RANGE.test(text), `${page.file}: ${text}`).toBe(true);
      }
    }
  });
});

describe('titles and descriptions (docs/04 §4 — no duplicate templates)', () => {
  it('are present and unique across pages', () => {
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const page of pages) {
      const title = titleOf(page.html);
      const description = metaDescription(page.html);
      expect(title, `${page.file} title`).toBeTruthy();
      expect(description, `${page.file} description`).toBeTruthy();
      expect(titles.get(title!), `duplicate title: ${title}`).toBeUndefined();
      expect(descriptions.get(description!), `duplicate description: ${description}`).toBeUndefined();
      titles.set(title!, page.file);
      descriptions.set(description!, page.file);
    }
  });
});

describe('internal linking (docs/04 §2 — 고아 페이지 0)', () => {
  it('every hub is linked from at least one other page', () => {
    const inbound = new Map<string, number>();
    for (const page of pages) {
      // 로케일 전환 링크는 제외 — 짝 페이지의 스위처가 항상 인바운드가 되어 검사가 무력해진다
      for (const href of new Set(internalLinks(page.html, { skipLocaleSwitch: true }))) {
        if (href === page.urlPath) continue;
        inbound.set(href, (inbound.get(href) ?? 0) + 1);
      }
    }
    for (const page of pages.filter((p) => isHub(p.urlPath))) {
      expect(inbound.get(page.urlPath) ?? 0, `orphan hub ${page.urlPath}`).toBeGreaterThan(0);
    }
  });

  it('ko pages link only to /ko/* (except the locale switcher)', () => {
    for (const page of pages.filter((p) => isKoPath(p.urlPath))) {
      for (const href of internalLinks(page.html, { skipLocaleSwitch: true })) {
        expect(isKoPath(href), `${page.file} → ${href}`).toBe(true);
      }
    }
  });
});

describe('en pages render no Korean text (CLAUDE.md 규칙 4)', () => {
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]+/g;
  it('only the locale switcher label may be Hangul', () => {
    for (const page of pages.filter((p) => !isKoPath(p.urlPath))) {
      const hangul = (visibleText(page.html).match(HANGUL) ?? []).filter((w) => w !== '한국어');
      expect(hangul, page.file).toEqual([]);
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
