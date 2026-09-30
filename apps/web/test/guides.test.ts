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
import { GUIDE_COMPONENTS, NUM_KINDS, RUNTIME_FACT_IDS, splitList, type PropKind } from '../lib/guide-components';

const root = resolve(__dirname, '..');
const seed = loadSeed();
const gpuIds = new Set(seed.gpus.map((g) => g.id));
const modelIds = new Set(seed.models.map((m) => m.id));
const quantIds = new Set<string>(seed.quantDefs.map((q) => q.id));
const LOCALES: readonly GuideLocale[] = ['en', 'ko'];
const HANGUL = /[ㄱ-ㆎ가-힣]/;

const mdxPath = (locale: GuideLocale, slug: string) => join(root, 'content', locale, 'guides', `${slug}.mdx`);
const readMdx = (locale: GuideLocale, slug: string) => readFileSync(mdxPath(locale, slug), 'utf8');

type Usage = { name: string; props: Record<string, string>; line: number; raw: string };

/** `<Name a="b" c="d" />` 사용 목록 — prop 은 문자열 리터럴만 허용(식 `{…}` 은 스캔에서 따로 거부) */
function componentUsages(src: string): Usage[] {
  const out: Usage[] = [];
  const lines = src.split('\n');
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/<([A-Z][A-Za-z]*)\b([^>]*?)\/?>/g)) {
      const props: Record<string, string> = {};
      for (const p of m[2]!.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) props[p[1]!] = p[2]!;
      out.push({ name: m[1]!, props, line: i + 1, raw: m[0] });
    }
  });
  return out;
}

function validProp(kind: PropKind, value: string): boolean {
  switch (kind) {
    case 'gpu':
      return gpuIds.has(value);
    case 'model':
      return modelIds.has(value);
    case 'gpuList':
      return splitList(value).length > 0 && splitList(value).every((id) => gpuIds.has(id));
    case 'modelList':
      return splitList(value).length > 0 && splitList(value).every((id) => modelIds.has(id));
    case 'grid':
      return GUIDE_SLUGS.some((slug) => value in GUIDES[slug].grids);
    case 'slug':
      return (GUIDE_SLUGS as readonly string[]).includes(value);
    case 'quant':
      return quantIds.has(value);
    case 'ctx':
      return /^\d+$/.test(value) && Number(value) >= 1024;
    case 'ctxList':
      return splitList(value).every((c) => /^\d+$/.test(c) && Number(c) >= 1024);
    case 'kv':
      return ['f16', 'q8_0', 'q4_0'].includes(value);
    case 'verdict':
      return ['S', 'A', 'B', 'F'].includes(value);
    case 'bool':
      return value === 'true' || value === 'false';
    case 'numKind':
      return (NUM_KINDS as readonly string[]).includes(value);
    case 'fact':
      return (RUNTIME_FACT_IDS as readonly string[]).includes(value);
  }
}

/** 산문(코드 스팬·컴포넌트 태그를 뺀 텍스트)에 쓰면 안 되는 것 — D43 숫자는 컴포넌트만, 규칙 2·3 */
const PROSE_BANS: ReadonlyArray<[RegExp, string]> = [
  [/\d[\d.,]*\s*(?:tok\/s|t\/s|tokens?\/s|토큰\/초)/i, 'speed number in prose (use a data component)'],
  [/\d+\.\d+\s*GB/i, 'decimal GB in prose (use <Num>)'],
  [/\d\s*GiB/i, 'GiB threshold in prose (tool behaviour goes through <RuntimeFact>; memory is decimal GB)'],
  [/\$\s?\d|₩\s?\d|\d[\d,]*\s?원(?![가-힣])/, 'price in prose (use <Price>)'],
  [/\b(?:guaranteed|definitely|will run|runs perfectly|no problem|best GPU|fastest|future-proof)\b/i, 'assertive wording'],
  [/무조건|확실히|완벽하게|문제없이|최고의|끝판왕|사세요/, 'assertive wording (ko)'],
  [/(?:쾌적|원활|겨우 가능|불가)(?:입니다|이고|이며|이라|이지만)|(?:쾌적|원활|겨우 가능|불가) 판정을|판정(?:은|이) (?:쾌적|원활|겨우 가능|불가)/, 'verdict name used as a predicate (ko) — write "쾌적하게 돌아갑니다" (AUTHORING §1)'],
  [/[가-힣)] — [가-힣<(]/, 'em dash joining a ko sentence — split the sentence or use a comma (AUTHORING §1)'],
];

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
        const problems: string[] = [];
        const lines = src.split('\n');
        lines.forEach((line, i) => {
          const at = `${locale}/${slug}.mdx:${i + 1}`;
          if (/^#\s/.test(line)) problems.push(`${at} "#" heading (h1 belongs to the page template)`);
          if (/^\s*\|.*\|\s*$/.test(line)) problems.push(`${at} pipe table (no GFM — use a data component)`);
          if (/<table\b/i.test(line)) problems.push(`${at} raw <table>`);
          if (/^\s*(?:import|export)\s/.test(line)) problems.push(`${at} import/export`);
          if (/\]\(\//.test(line) || /href="\//.test(line)) problems.push(`${at} internal link literal (use HubLink/GuideLink/ComboLink)`);
          if (/<!--/.test(line)) problems.push(`${at} HTML comment (not valid MDX)`);
        });
        if (/^---\s*$/m.test(src.split('\n')[0] ?? '')) problems.push(`${locale}/${slug}.mdx frontmatter`);
        // 식 `{…}` 금지 — 코드 스팬(백틱) 밖에서
        const outsideCode = src.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
        if (/[{}]/.test(outsideCode)) problems.push(`${locale}/${slug}.mdx has { } outside code (MDX expression)`);

        const usages = componentUsages(src);
        for (const u of usages) {
          const spec = GUIDE_COMPONENTS[u.name];
          const at = `${locale}/${slug}.mdx:${u.line} <${u.name}>`;
          if (!spec) {
            problems.push(`${at} unknown component`);
            continue;
          }
          for (const [prop, { kind, required }] of Object.entries(spec.props)) {
            const value = u.props[prop];
            if (value === undefined) {
              if (required) problems.push(`${at} missing ${prop}`);
              continue;
            }
            if (!validProp(kind, value)) problems.push(`${at} invalid ${prop}="${value}"`);
          }
          for (const prop of Object.keys(u.props)) if (!(prop in spec.props)) problems.push(`${at} unknown prop ${prop}`);
          // 블록 컴포넌트는 자기 줄에만 (문단 속이면 <p><div> → 하이드레이션 불일치)
          if (spec.block && lines[u.line - 1]!.trim() !== u.raw.trim()) problems.push(`${at} block component must be alone on its line`);
        }
        if (!usages.some((u) => GUIDE_COMPONENTS[u.name]?.data)) problems.push(`${locale}/${slug}.mdx cites no own data (AC — D42)`);

        // 산문 검사: 코드·컴포넌트 태그·링크 URL 을 뺀 텍스트
        const prose = outsideCode.replace(/<[A-Z][^>]*\/?>/g, ' ').replace(/\]\([^)]*\)/g, ']');
        for (const [re, why] of PROSE_BANS) {
          const m = re.exec(prose);
          if (m) problems.push(`${locale}/${slug}.mdx: ${why} — "${prose.slice(Math.max(0, m.index - 20), m.index + m[0].length + 10).trim()}"`);
        }
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
