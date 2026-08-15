/**
 * 정적 export 산출물 불변식 — P0-1 AC "i18n 스파이크"의 실증 (docs/06 P0-1).
 *
 * `pnpm build`(next build + postbuild) 이후 실행되어 다음을 확인한다:
 *  - en 이 루트(`/`)에, ko 가 `/ko/` 에 실제 파일로 존재 (docs/04 §2 URL 구조)
 *  - `out/en/` 디렉터리가 남아 있지 않음 (평탄화 완료)
 *  - en HTML 내부 링크에 `/en/` 프리픽스가 없음 (리다이렉트 체인 방지)
 *  - 캐노니컬 자기참조 + hreflang en/ko/x-default 완전 대칭 (CLAUDE.md 규칙 5)
 *  - `_redirects` 존재 + Cloudflare Pages 룰 한도 이내 (docs/05 §3)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CF_PAGES_REDIRECT_LINE_LIMIT } from '../scripts/build-redirects';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'apps/web/out');

function readHtml(...segments: string[]): string {
  return readFileSync(join(outDir, ...segments), 'utf8');
}

/** `<link rel="alternate" hreflang="…" href="…">` 를 hreflang→href 맵으로 추출. */
function extractHreflangs(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const linkTags = html.match(/<link\b[^>]*rel="alternate"[^>]*>/g) ?? [];
  for (const tag of linkTags) {
    const hreflang = tag.match(/hreflang="([^"]+)"/i)?.[1];
    const href = tag.match(/href="([^"]+)"/i)?.[1];
    if (hreflang && href) map[hreflang] = href;
  }
  return map;
}

function extractCanonical(html: string): string | undefined {
  return html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1];
}

beforeAll(() => {
  if (!existsSync(outDir)) {
    throw new Error('apps/web/out not found — run `pnpm build` before `pnpm test:export`');
  }
});

describe('i18n URL structure: en at root + /ko/ (docs/04 §2, P0-1 spike)', () => {
  it('serves the en home page at the root', () => {
    const html = readHtml('index.html');
    expect(html).toContain('lang="en"');
    // messages/en.json Home.heading — 하드코딩이 아니라 메시지 파일에서 온 문자열
    expect(html).toContain('Can my PC run this LLM?');
  });

  it('serves the ko home page under /ko', () => {
    // trailingSlash:false → /ko 는 out/ko.html 또는 out/ko/index.html 로 산출된다.
    const candidate = ['ko.html', 'ko/index.html'].find((path) => existsSync(join(outDir, path)));
    expect(candidate).toBeDefined();
    const html = readHtml(candidate as string);
    expect(html).toContain('lang="ko"');
    expect(html).toContain('내 PC로 이 LLM 돌릴 수 있을까?');
  });

  it('leaves no out/en directory behind after flattening', () => {
    expect(existsSync(join(outDir, 'en'))).toBe(false);
    expect(existsSync(join(outDir, 'en.html'))).toBe(false);
  });

  it('emits no /en-prefixed internal links in the en page', () => {
    const html = readHtml('index.html');
    const enPrefixed = html.match(/href="\/en(\/|")/g) ?? [];
    expect(enPrefixed).toEqual([]);
  });

  it('keeps /ko-prefixed internal links in the ko page', () => {
    const candidate = ['ko.html', 'ko/index.html'].find((path) => existsSync(join(outDir, path)));
    const html = readHtml(candidate as string);
    expect(html).toMatch(/href="[^"]*\/ko(\/|")/);
  });
});

describe('canonical + hreflang symmetry (CLAUDE.md rule 5, docs/04 §6)', () => {
  const pages = () => {
    const koPath = ['ko.html', 'ko/index.html'].find((path) => existsSync(join(outDir, path)));
    return {
      en: readHtml('index.html'),
      ko: readHtml(koPath as string),
    };
  };

  it('each page has a self-referencing canonical', () => {
    const { en, ko } = pages();
    const enCanonical = extractCanonical(en);
    const koCanonical = extractCanonical(ko);
    expect(enCanonical).toBeDefined();
    expect(koCanonical).toBeDefined();
    // en 캐노니컬은 무프리픽스 루트, ko 는 /ko.
    // (trailingSlash:false 라 Next 가 루트를 `https://host` 로 정규화 — 슬래시는 선택)
    expect(enCanonical).toMatch(/^https?:\/\/[^/]+\/?$/);
    expect(koCanonical).toMatch(/^https?:\/\/[^/]+\/ko$/);
  });

  it('hreflang set {en, ko, x-default} is identical on both pages', () => {
    const { en, ko } = pages();
    const enMap = extractHreflangs(en);
    const koMap = extractHreflangs(ko);

    for (const map of [enMap, koMap]) {
      expect(Object.keys(map).sort()).toEqual(['en', 'ko', 'x-default']);
      // x-default = en (docs/04 §6)
      expect(map['x-default']).toBe(map.en);
      expect(map.en).toMatch(/^https?:\/\/[^/]+\/?$/);
      expect(map.ko).toMatch(/^https?:\/\/[^/]+\/ko$/);
    }
    // 완전 대칭: 두 페이지가 가리키는 대안 URL 집합이 동일
    expect(enMap).toEqual(koMap);
  });
});

describe('_redirects stub (docs/05 §3)', () => {
  it('exists and stays under the Cloudflare Pages rule limit', () => {
    const path = join(outDir, '_redirects');
    expect(existsSync(path)).toBe(true);
    const rules = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.length).toBeLessThanOrEqual(CF_PAGES_REDIRECT_LINE_LIMIT);
    // en 잔존 링크 정리 룰이 포함되어야 한다
    expect(rules).toContain('/en/* /:splat 301');
  });
});
