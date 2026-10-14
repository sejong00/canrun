/**
 * 가이드 (P1-4 D37~D44) — 레지스트리 ↔ MDX 파일 ↔ 로더 맵 대칭, 레지스트리 스키마, MDX 본문 스캔(허용 컴포넌트·유효 id·
 * 산문 숫자 금지·금지 어구·블록 컴포넌트 줄 단독), en/ko 동등성(같은 컴포넌트 구성), 배치 1 콤보 커버리지(currentBatch 1 시뮬레이션).
 * 빌드 전에 도는 유닛 테스트라 MDX 컴파일 실패·데이터 드리프트(`<Expect>`)는 빌드가, 렌더 결과는 export 테스트가 본다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { comboKey, indexableCombos } from '@canrun/data/client';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../../packages/data/test/seed';
import { GUIDES, GUIDE_SLUGS, type GuideLocale } from '../content/guides';
import { GUIDE_COMPONENTS } from '../lib/guide-components';
import { catalogIds, componentProblems, componentUsages, syntaxProblems } from './mdx-scan';
import { HANGUL, outsideCode as stripCode, proseProblems } from './prose-rules';

const root = resolve(__dirname, '..');
const seed = loadSeed();
const gpuIds = catalogIds.gpus;
const modelIds = catalogIds.models;
const LOCALES: readonly GuideLocale[] = ['en', 'ko'];

const mdxPath = (locale: GuideLocale, slug: string) => join(root, 'content', locale, 'guides', `${slug}.mdx`);
const readMdx = (locale: GuideLocale, slug: string) => readFileSync(mdxPath(locale, slug), 'utf8');

describe('MDX toolchain pin (D38)', () => {
  it('installed @next/mdx is exactly the installed next version', () => {
    const version = (pkg: string) =>
      (JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')) as { version: string }).version;
    expect(version('@next/mdx')).toBe(version('next'));
  });
});

describe('guide registry ↔ MDX files ↔ loader map', () => {
  it('every slug has en + ko MDX, and no stray MDX files exist', () => {
    for (const locale of LOCALES) {
      const files = readdirSync(join(root, 'content', locale, 'guides')).filter((f) => f.endsWith('.mdx'));
      expect(files.map((f) => f.replace(/\.mdx$/, '')).sort(), `${locale} files`).toEqual([...GUIDE_SLUGS].sort());
    }
  });

  it('the loader map names every slug × locale with a literal import', () => {
    const src = readFileSync(join(root, 'lib', 'guides.ts'), 'utf8');
    for (const slug of GUIDE_SLUGS) {
      for (const locale of LOCALES) {
        expect(src, `${slug}/${locale} loader`).toContain(`import('@/content/${locale}/guides/${slug}.mdx')`);
      }
    }
    expect(src).not.toMatch(/import\(`/); // 템플릿 import 금지 (D38)
  });

  it('registry schema: dates, review stamp, titles/descriptions per locale, grid ids, unique grid keys', () => {
    const gridOwners = new Map<string, string>();
    for (const slug of GUIDE_SLUGS) {
      const e = GUIDES[slug];
      expect(e.datePublished, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.dateModified, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.dateModified >= e.datePublished, `${slug} dateModified ≥ datePublished`).toBe(true);
      if (e.status === 'published') expect(e.reviewedAt, `${slug} reviewedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.related.every((r) => r !== slug && (GUIDE_SLUGS as readonly string[]).includes(r)), `${slug} related`).toBe(true);
      const { en, ko } = e.locales;
      expect(HANGUL.test(en.title) || HANGUL.test(en.description), `${slug} en has Hangul`).toBe(false);
      expect(HANGUL.test(ko.title), `${slug} ko title has Hangul`).toBe(true);
      expect(en.title.length, `${slug} en title ≤ 110 (Article headline)`).toBeLessThanOrEqual(110);
      expect(ko.title.length, `${slug} ko title ≤ 110`).toBeLessThanOrEqual(110);
      for (const d of [en.description, ko.description]) {
        expect(d.length, `${slug} description length`).toBeGreaterThan(50);
        expect(d.length, `${slug} description length`).toBeLessThanOrEqual(170);
        expect(d, `${slug} description has no tok/s`).not.toMatch(/tok\/s/);
      }
      for (const [key, grid] of Object.entries(e.grids)) {
        expect(gridOwners.has(key), `grid key "${key}" is used by ${gridOwners.get(key)} and ${slug}`).toBe(false);
        gridOwners.set(key, slug);
        for (const id of grid.gpus) expect(gpuIds.has(id), `${slug}.${key} gpu ${id}`).toBe(true);
        for (const id of grid.models) expect(modelIds.has(id), `${slug}.${key} model ${id}`).toBe(true);
      }
    }
  });
});

describe('guide MDX bodies (D38·D43)', () => {
  for (const slug of GUIDE_SLUGS) {
    for (const locale of LOCALES) {
      it(`${locale}/${slug}: allowed syntax, known components with valid ids, no numbers or assertive words in prose`, () => {
        const src = readMdx(locale, slug);
        const where = `${locale}/${slug}.mdx`;
        const problems: string[] = syntaxProblems(src, where);
        // 식 `{…}` 금지 — 코드 스팬(백틱) 밖에서
        const outsideCode = stripCode(src);
        if (/[{}]/.test(outsideCode)) problems.push(`${where} has { } outside code (MDX expression)`);

        const usages = componentUsages(src);
        problems.push(...componentProblems(src, where));
        if (!usages.some((u) => GUIDE_COMPONENTS[u.name]?.data)) problems.push(`${locale}/${slug}.mdx cites no own data (AC — D42)`);

        // 산문 검사: 코드·컴포넌트 태그·링크 URL 을 뺀 텍스트
        const prose = outsideCode.replace(/<[A-Z][^>]*\/?>/g, ' ').replace(/\]\([^)]*\)/g, ']');
        problems.push(...proseProblems(prose, `${locale}/${slug}.mdx`));
        if (locale === 'en' && HANGUL.test(prose)) problems.push(`en/${slug}.mdx contains Hangul`);
        expect(problems).toEqual([]);
      });
    }

    it(`${slug}: en and ko are the same page — same data blocks and grids, same number of sections`, () => {
      const shape = (locale: GuideLocale) => {
        const src = readMdx(locale, slug);
        const blocks = componentUsages(src)
          .filter((u) => GUIDE_COMPONENTS[u.name]?.block)
          .map((u) => `${u.name}(${Object.entries(u.props).map(([k, v]) => `${k}=${v}`).join(',')})`);
        return { blocks, sections: (src.match(/^##\s/gm) ?? []).length };
      };
      const en = shape('en');
      const ko = shape('ko');
      expect(ko.blocks, 'data blocks (hreflang pair = same page)').toEqual(en.blocks);
      expect(ko.sections, 'number of ## sections').toBe(en.sections);
    });
  }
});

describe('memory rule per guide (10-03 D62 — graphics card weights vs whole file)', () => {
  // 맥 가이드는 통합 메모리 — 필요량은 파일 전체. Num needGB 는 기본이 그래픽카드 규칙이라 통합 칩을 gpu 로 지정해야 하고,
  // ModelMemoryTable 은 memory="unified" 여야 화면 숫자가 판정(엔진 fit)과 같다
  const UNIFIED_GUIDES = ['mac-local-llm'] as const;
  const unifiedGpuIds = new Set(seed.gpus.filter((g) => g.kind === 'unified').map((g) => g.id));
  for (const slug of UNIFIED_GUIDES) {
    for (const locale of LOCALES) {
      it(`${locale}/${slug}: every needGB names a unified chip and every ModelMemoryTable is memory="unified"`, () => {
        const problems = componentUsages(readMdx(locale, slug)).flatMap((u) => {
          const at = `${locale}/${slug}.mdx:${u.line} <${u.name}>`;
          if (u.name === 'Num' && u.props.kind === 'needGB' && !unifiedGpuIds.has(u.props.gpu ?? '')) return [`${at} needGB without a unified gpu`];
          if (u.name === 'ModelMemoryTable' && u.props.memory !== 'unified') return [`${at} missing memory="unified"`];
          return [];
        });
        expect(problems).toEqual([]);
      });
    }
  }
});

describe('batch-1 coverage (docs/04 §2 ③, D44)', () => {
  it('every combo that opens at currentBatch 1 is covered by a guide grid that is rendered in both locales', () => {
    const next = indexableCombos({ ...seed.publish, currentBatch: Math.max(1, seed.publish.currentBatch) });
    const rendered = new Set<string>();
    for (const slug of GUIDE_SLUGS) {
      const grids = new Set(
        LOCALES.map((l) => new Set(componentUsages(readMdx(l, slug)).filter((u) => u.name === 'ComboGrid').map((u) => u.props.grid!))).reduce(
          (a, b) => new Set([...a].filter((k) => b.has(k))),
        ),
      );
      for (const key of grids) {
        const grid = GUIDES[slug].grids[key]!;
        for (const gpu of grid.gpus) for (const model of grid.models) rendered.add(comboKey(gpu, model));
      }
    }
    const missing = [...next].filter((key) => !rendered.has(key));
    expect(missing, 'batch-1 combos without a guide grid (vram-requirements · mac-local-llm)').toEqual([]);
  });
});
