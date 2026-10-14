/**
 * 허브 소개글 (10-14 D74) — 레지스트리(`content/hubs.ts`) ↔ 로캘별 MDX(`content/{en,ko}/hubs/{gpu,model}/<id>.mdx`) ↔ 로더 맵 대칭,
 * MDX 스캔(가이드와 같은 컴포넌트 명세·산문 숫자 금지·금지 어구 — `mdx-scan.ts`·`prose-rules.ts`), 소개글 고유 규칙
 * (제목·목록 없음·인라인 컴포넌트만·`<Expect>` ≥1·데이터 컴포넌트 ≥1·자기 허브 링크 금지·2~3문단·짧게). 데이터 드리프트(`<Expect>`)는 빌드가, 렌더는 export 테스트가 본다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GPU_INTRO_IDS, MODEL_INTRO_IDS, type HubIntroKind } from '../content/hubs';
import { GUIDE_COMPONENTS } from '../lib/guide-components';
import { catalogIds, componentProblems, componentUsages, syntaxProblems } from './mdx-scan';
import { HANGUL, outsideCode, proseOf, proseProblems } from './prose-rules';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = ['en', 'ko'] as const;
const KINDS: ReadonlyArray<{ kind: HubIntroKind; ids: readonly string[] }> = [
  { kind: 'gpu', ids: GPU_INTRO_IDS },
  { kind: 'model', ids: MODEL_INTRO_IDS },
];
/** 짧은 소개 — 문단 수와 분량 상한(산문 기준: en 단어, ko 공백 뺀 글자). 표는 허브가 이미 그린다 */
const PARAGRAPHS = { min: 2, max: 3 } as const;
const MAX_EN_WORDS = 220;
const MAX_KO_CHARS = 600;

// core.autocrlf 체크아웃은 작업 트리를 CRLF 로 바꿀 수 있다 — 줄바꿈을 맞춘 뒤 검사한다 (updates.test 와 같은 이유)
const readText = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const dirOf = (locale: string, kind: HubIntroKind) => join(webRoot, 'content', locale, 'hubs', kind);
const readMdx = (locale: string, kind: HubIntroKind, id: string) => readText(join(dirOf(locale, kind), `${id}.mdx`));

describe('hub intro registry ↔ MDX files ↔ loader map', () => {
  it('names catalog records of the right kind, without duplicates', () => {
    for (const { kind, ids } of KINDS) {
      expect(new Set(ids).size, `${kind} duplicates`).toBe(ids.length);
      const catalog = kind === 'gpu' ? catalogIds.gpus : catalogIds.models;
      for (const id of ids) expect(catalog.has(id), `${kind} ${id} is not in the catalog`).toBe(true);
    }
  });

  it('every registered hub has en + ko MDX, and no stray MDX files exist', () => {
    for (const locale of LOCALES) {
      for (const { kind, ids } of KINDS) {
        const files = readdirSync(dirOf(locale, kind)).filter((f) => f.endsWith('.mdx'));
        expect(files.map((f) => f.replace(/\.mdx$/, '')).sort(), `${locale}/${kind}`).toEqual([...ids].sort());
      }
    }
  });

  it('the loader map names every id × locale with a literal import', () => {
    const src = readText(join(webRoot, 'lib', 'hub-intros.ts'));
    for (const { kind, ids } of KINDS) {
      for (const id of ids) {
        for (const locale of LOCALES) expect(src, `${kind}/${id}/${locale}`).toContain(`import('@/content/${locale}/hubs/${kind}/${id}.mdx')`);
      }
    }
    expect(src).not.toMatch(/import\(`/); // 템플릿 import 금지 (D38)
  });
});

describe('hub intro MDX bodies (AUTHORING §10)', () => {
  for (const { kind, ids } of KINDS) {
    for (const id of ids) {
      for (const locale of LOCALES) {
        it(`${locale}/${kind}/${id}: guide component rules, inline only, pinned claims, 2–3 short paragraphs`, () => {
          const src = readMdx(locale, kind, id);
          const where = `${locale}/hubs/${kind}/${id}.mdx`;
          const problems = [...syntaxProblems(src, where), ...componentProblems(src, where)];
          if (/[{}]/.test(outsideCode(src))) problems.push(`${where} has { } outside code (MDX expression)`);
          // 제목은 템플릿의 h2 하나 — 소개 안에는 제목·목록을 두지 않는다(문단만)
          if (/^#/m.test(src)) problems.push(`${where} heading (the hub template renders the intro heading)`);
          if (/^\s*(?:[-*+]|\d+\.)\s/m.test(src)) problems.push(`${where} list (intros are plain paragraphs)`);

          const usages = componentUsages(src);
          for (const u of usages) {
            if (GUIDE_COMPONENTS[u.name]?.block) problems.push(`${where}:${u.line} <${u.name}> block component (the hub already shows its tables)`);
            if (u.name === 'HubLink' && u.props[kind] === id) problems.push(`${where}:${u.line} links to its own hub`);
          }
          if (!usages.some((u) => u.name === 'Expect')) problems.push(`${where} pins no claim with <Expect> (D43)`);
          if (!usages.some((u) => GUIDE_COMPONENTS[u.name]?.data)) problems.push(`${where} cites no data component (<Num>/<Price>)`);

          const paragraphs = src.split(/\n\s*\n/).filter((p) => p.trim() !== '');
          if (paragraphs.length < PARAGRAPHS.min || paragraphs.length > PARAGRAPHS.max) {
            problems.push(`${where} has ${paragraphs.length} paragraphs (${PARAGRAPHS.min}–${PARAGRAPHS.max})`);
          }

          const prose = proseOf(src);
          problems.push(...proseProblems(prose, where));
          if (locale === 'en') {
            if (HANGUL.test(prose)) problems.push(`${where} contains Hangul`);
            const words = prose.split(/\s+/).filter(Boolean).length;
            if (words > MAX_EN_WORDS) problems.push(`${where} is ${words} words (≤ ${MAX_EN_WORDS})`);
          } else {
            if (!HANGUL.test(prose)) problems.push(`${where} has no Hangul`);
            const chars = prose.replace(/\s/g, '').length;
            if (chars > MAX_KO_CHARS) problems.push(`${where} is ${chars} characters (≤ ${MAX_KO_CHARS})`);
          }
          expect(problems).toEqual([]);
        });
      }
    }
  }
});
