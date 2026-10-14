/**
 * 업데이트 소식 (10-14 D72) — 레지스트리(`content/updates.ts`) ↔ 로캘별 MDX(`content/{en,ko}/pages/updates.mdx`) 대칭,
 * 카탈로그 추가 날짜 묶음(`lib/updates.ts`). 렌더 결과(전 모델 링크·항목 id 순서)는 test/export-invariants.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCalendarDate, parseModels } from '@canrun/data';
import { STATIC_PAGE_SLUGS } from '@/content/pages';
import { SITE_UPDATES, latestSiteUpdate } from '@/content/updates';
import { catalogAdditions } from '@/lib/updates';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const mdx = (locale: 'en' | 'ko') => readFileSync(join(webRoot, 'content', locale, 'pages', 'updates.mdx'), 'utf8');

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
      const blocks = [...src.matchAll(/^<Update id="[^"]+">\n([\s\S]*?)\n<\/Update>$/gm)].map((m) => m[1]!);
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
  }

  it('en and ko have the same sections', () => {
    const sections = (locale: 'en' | 'ko') => (mdx(locale).match(/^## /gm) ?? []).length;
    expect(sections('ko')).toBe(sections('en'));
  });
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
