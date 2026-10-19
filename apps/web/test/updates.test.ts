/**
 * 업데이트 소식 (10-14 D72) — 레지스트리(`content/updates.ts`) ↔ 로캘별 MDX(`content/{en,ko}/pages/updates.mdx`) 대칭,
 * 카탈로그 추가 날짜 묶음(`lib/updates.ts`). 렌더 결과(전 모델 링크·항목 id 순서)는 test/export-invariants.spec.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCalendarDate, parseGpus, parseModels } from '@canrun/data';
import { GUIDES, GUIDE_SLUGS } from '@/content/guides';
import { STATIC_PAGE_SLUGS } from '@/content/pages';
import { SITE_UPDATES, latestSiteUpdate } from '@/content/updates';
import { catalogAdditions } from '@/lib/updates';
import { HANGUL, proseOf, proseProblems } from './prose-rules';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const seedJson = (file: string): unknown => JSON.parse(readFileSync(join(webRoot, '..', '..', 'data', file), 'utf8'));
// core.autocrlf 체크아웃은 작업 트리를 CRLF 로 바꾼다(.gitattributes 는 data/*.json 만 LF 고정) — 줄바꿈을 맞춘 뒤 검사한다
const readText = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const mdx = (locale: 'en' | 'ko') => readText(join(webRoot, 'content', locale, 'pages', 'updates.mdx'));
const BLOCK = /^<Update id="([^"]+)">\n([\s\S]*?)\n<\/Update>$/gm;

/** 블록 본문(### 제목 줄 제외)의 문장 수 — 마침표·물음표·느낌표 뒤가 공백이나 끝(e.g.·i.e.·vs. 제외, 1.5·config.json 같은 점은 세지 않는다) */
function sentenceCount(block: string): number {
  const body = proseOf(
    block
      .split('\n')
      .filter((line) => !line.startsWith('### '))
      .join('\n'),
  );
  return (body.match(/(?<!\be\.g|\bi\.e|\bvs)[.!?](?=\s|$)/g) ?? []).length;
}

describe('site updates registry', () => {
  it('is a registered static page (footer · sitemap · export checks)', () => {
    expect(STATIC_PAGE_SLUGS).toContain('updates');
  });

  it('has unique slug ids and real dates, newest first', () => {
    const ids = SITE_UPDATES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { id, date } of SITE_UPDATES) {
      expect(id, id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(isCalendarDate(date), `${id} ${date}`).toBe(true);
    }
    for (let i = 1; i < SITE_UPDATES.length; i += 1) {
      expect(SITE_UPDATES[i]!.date <= SITE_UPDATES[i - 1]!.date, `${SITE_UPDATES[i]!.id} is newer than the entry above it`).toBe(true);
    }
    expect(latestSiteUpdate()).toBe(SITE_UPDATES[0].date);
  });
});

describe('updates MDX (en and ko are the same page, written separately)', () => {
  for (const locale of ['en', 'ko'] as const) {
    it(`${locale}: one <Update> block per registry entry, in registry order, each with one ### heading`, () => {
      const src = mdx(locale);
      const opened = [...src.matchAll(/^<Update id="([^"]+)">$/gm)].map((m) => m[1]);
      expect(opened).toEqual(SITE_UPDATES.map((u) => u.id));
      expect((src.match(/^<\/Update>$/gm) ?? []).length).toBe(opened.length);
      const blocks = [...src.matchAll(BLOCK)].map((m) => m[2]!);
      expect(blocks).toHaveLength(opened.length);
      for (const [i, block] of blocks.entries()) {
        expect((block.match(/^### /gm) ?? []).length, `${locale} ${opened[i]} heading`).toBe(1);
        expect(block.trim().startsWith('### '), `${locale} ${opened[i]} starts with its heading`).toBe(true);
      }
      expect((src.match(/^<CatalogAdditions \/>$/gm) ?? []).length).toBe(1);
    });

    it(`${locale}: dates come from the registry and data only — none written by hand; no h1, braces or markdown internal links`, () => {
      const src = mdx(locale);
      // 연도(RTX 2080 같은 모델 번호는 제외)·월 이름·"10월 6일"
      expect(src).not.toMatch(/\b202\d\b/);
      expect(src).not.toMatch(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/);
      expect(src).not.toMatch(/\d+월 \d+일/);
      expect(src).not.toMatch(/^# /m);
      expect(src).not.toMatch(/[{}]/);
      expect(src).not.toMatch(/\]\(\//);
    });

    it(`${locale}: prose follows the guide number rules (AUTHORING §2·§9) and each block is a ### heading plus 2–5 sentences`, () => {
      const src = mdx(locale);
      const prose = proseOf(src);
      const problems = proseProblems(prose, `${locale}/pages/updates.mdx`);
      if (locale === 'en' && HANGUL.test(prose)) problems.push('en/pages/updates.mdx contains Hangul');
      for (const [, id, block] of src.matchAll(BLOCK)) {
        const n = sentenceCount(block!);
        if (n < 2 || n > 5) problems.push(`${locale} ${id}: ${n} sentences (2–5)`);
      }
      expect(problems).toEqual([]);
    });
  }

  it('en and ko have the same sections', () => {
    const sections = (locale: 'en' | 'ko') => (mdx(locale).match(/^## /gm) ?? []).length;
    expect(sections('ko')).toBe(sections('en'));
  });
});

describe('static page MDX internal links (<SiteLink to>) point at pages that exist', () => {
  // 정적 페이지 MDX 에는 가이드의 HubLink 같은 id 검사 컴포넌트가 없다 — 모델·GPU 허브 링크는 카탈로그 id 로 확인한다.
  // 가이드는 published 만(D40 — 초안은 어떤 페이지에서도 링크하지 않는다), 목차는 published 가 1편 이상일 때만
  const modelIds = new Set(parseModels(seedJson('models.json')).map((m) => m.id));
  const gpuIds = new Set(parseGpus(seedJson('gpus.json')).map((g) => g.id));
  const published = GUIDE_SLUGS.filter((slug) => GUIDES[slug].status === 'published');
  const fixed = new Set([
    '/',
    '/calculator',
    // 모델·GPU 목록 (10-19)
    '/models',
    '/gpus',
    ...STATIC_PAGE_SLUGS.map((slug) => `/${slug}`),
    ...(published.length > 0 ? ['/guides'] : []),
    ...published.map((slug) => `/guides/${slug}`),
  ]);
  const exists = (to: string) => {
    const hub = /^\/(model|gpu)\/([^/]+)$/.exec(to);
    if (hub) return (hub[1] === 'model' ? modelIds : gpuIds).has(hub[2]!);
    return fixed.has(to);
  };

  for (const locale of ['en', 'ko'] as const) {
    it(`${locale}: every SiteLink target is a static page, the calculator, a list page, a catalog model/GPU hub or a published guide`, () => {
      const dir = join(webRoot, 'content', locale, 'pages');
      const bad = readdirSync(dir)
        .filter((f) => f.endsWith('.mdx'))
        .flatMap((f) => [...readText(join(dir, f)).matchAll(/<SiteLink to="([^"]*)">/g)].map((m) => ({ f, to: m[1]! })))
        .filter(({ to }) => !exists(to))
        .map(({ f, to }) => `${locale}/pages/${f} → ${to}`);
      expect(bad).toEqual([]);
    });
  }
});

describe('catalogAdditions — models grouped by the day they joined the catalog', () => {
  const m = (id: string, name: string, addedAt: string) => ({ id, name, addedAt });

  it('newest date first, names in natural order within a day', () => {
    const groups = catalogAdditions([
      m('b', 'Qwen3 14B', '2026-08-16'),
      m('c', 'MiniCPM-V 4.7 35B-A3B', '2026-10-13'),
      m('a', 'Qwen3 8B', '2026-08-16'),
      m('d', 'gpt-oss-20b', '2026-08-16'),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-13', '2026-08-16']);
    expect(groups[1]!.models.map((x) => x.id)).toEqual(['d', 'a', 'b']);
  });

  it('puts every catalog model in exactly one group', () => {
    const models = parseModels(JSON.parse(readFileSync(join(webRoot, '..', '..', 'data', 'models.json'), 'utf8')));
    const groups = catalogAdditions(models);
    expect(groups.flatMap((g) => g.models.map((x) => x.id)).sort()).toEqual(models.map((x) => x.id).sort());
    for (let i = 1; i < groups.length; i += 1) expect(groups[i]!.date < groups[i - 1]!.date).toBe(true);
  });
});
