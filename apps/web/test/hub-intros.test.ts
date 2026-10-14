/**
 * 허브 소개글 (10-14 D74) — 레지스트리(`content/hubs.ts`) ↔ 로캘별 MDX(`content/{en,ko}/hubs/{gpu,model}/<id>.mdx`) ↔ 로더 맵 대칭,
 * MDX 스캔(가이드와 같은 컴포넌트 명세·산문 숫자 금지·금지 어구 — `mdx-scan.ts`·`prose-rules.ts`), 소개글 고유 규칙
 * (제목·목록 없음·인라인 컴포넌트만·`<Expect>` ≥1·데이터 컴포넌트 ≥1·자기 허브 링크 금지·2~3문단·짧게), `<Expect>` 고정 규칙
 * (조건 붙은 주장은 판정인지 fit 인지 밝힌다·이론 추정 판정은 라벨과 함께 — 10-14 hub-intros 리뷰). 데이터 드리프트(`<Expect>`)는 빌드가, 렌더는 export 테스트가 본다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GPU_INTRO_IDS, MODEL_INTRO_IDS, type HubIntroKind } from '../content/hubs';
import { getCombo } from '../lib/combos';
import { checkExpect, resolveExpect, type ExpectClaim } from '../lib/expect-claim';
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

  it('the loader map ties every id key to its own en + ko MDX with literal imports', () => {
    const src = readText(join(webRoot, 'lib', 'hub-intros.ts'));
    const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const { kind, ids } of KINDS) {
      for (const id of ids) {
        // 키와 import 를 함께 본다 — 두 키의 import 가 서로 바뀌면(다른 카드의 소개글 게시) 여기서 걸린다
        const entry = new RegExp(
          `'${esc(id)}': \\{\\s*en: \\(\\) => import\\('@/content/en/hubs/${kind}/${esc(id)}\\.mdx'\\)[^\\n]*\\n\\s*ko: \\(\\) => import\\('@/content/ko/hubs/${kind}/${esc(id)}\\.mdx'\\)`,
        );
        expect(src, `${kind}/${id}`).toMatch(entry);
      }
    }
    const imports = [...src.matchAll(/import\('@\/content\/(?:en|ko)\/hubs\//g)].length;
    expect(imports, 'imports in the loader map').toBe(LOCALES.length * KINDS.reduce((n, k) => n + k.ids.length, 0));
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

/** 이론 추정 라벨 — en "theoretical estimate(s) (±30%)", ko "이론 추정(±30%)" */
const THEORETICAL_LABEL = { en: /theoretical/i, ko: /이론 추정/ } as const;

/**
 * `<Expect>` 가 든 문장과 그다음 문장 — 마침표·물음표·느낌표 뒤 공백(또는 끝)이 문장 경계다.
 * 태그 prop 속 점(`qwen3.5-35b-a3b`)·URL 의 점은 뒤에 공백이 없어 경계가 되지 않는다.
 */
function sentenceAndNext(src: string, index: number, length: number): string {
  const ends = [...src.matchAll(/[.!?](?=\s|$)/g)].map((m) => m.index! + 1);
  const start = Math.max(0, ...ends.filter((e) => e <= index));
  const after = ends.filter((e) => e >= index + length);
  return src.slice(start, after[1] ?? after[0] ?? src.length);
}

describe('hub intro <Expect> pins (AUTHORING §10)', () => {
  for (const { kind, ids } of KINDS) {
    for (const id of ids) {
      for (const locale of LOCALES) {
        it(`${locale}/${kind}/${id}: conditioned pins say verdict or fit, theoretical verdicts carry the label`, () => {
          const src = readMdx(locale, kind, id);
          const where = `${locale}/hubs/${kind}/${id}.mdx`;
          const problems: string[] = [];
          for (const m of src.matchAll(/<Expect\b([^>]*?)\/>/g)) {
            const claim = Object.fromEntries([...m[1]!.matchAll(/([a-zA-Z]+)="([^"]*)"/g)].map((p) => [p[1]!, p[2]!])) as ExpectClaim;
            // 양자화·RAM·컨텍스트 조건이 붙은 문장은 "어떻게 돌아가는지"(verdict)인지 "올라가는지"(fits)인지 밝힌다 —
            // mode 만 고정하면 같은 문장의 "느리다"가 고정되지 않는다(qwen3.8-27b IQ4_XS 가 실제로는 원활하던 사례)
            const conditioned = claim.quant !== undefined || claim.ram !== undefined || claim.ctx !== undefined;
            if (conditioned && claim.verdict === undefined && claim.fits === undefined) {
              problems.push(`${where}: ${m[0]} has a condition but pins neither verdict nor fits`);
            }
            // 규칙 3 — 이론 추정(±30%) 셀의 판정은 그 문장이나 바로 다음 문장에 라벨
            if (claim.verdict !== undefined && resolveExpect(claim).confidence === 'theoretical') {
              if (!THEORETICAL_LABEL[locale].test(sentenceAndNext(src, m.index!, m[0].length))) {
                problems.push(`${where}: ${m[0]} is a theoretical estimate — label it in that sentence or the next`);
              }
            }
          }
          expect(problems).toEqual([]);
        });
      }
    }
  }
});

describe('<Expect> ctx claims follow the RAM the ctx table is computed at (10-14 hub-intros review)', () => {
  it('a combo that needs more system RAM than the page assumes has its ctx table at the RAM hint, so ctx claims must name it', () => {
    // gpt-oss-120b 는 RTX 3090 + 시스템 RAM 32GB(페이지 기준)에 안 올라간다 — ctx 표는 RAM 힌트 구성으로 계산된다
    const page = getCombo('gpt-oss-120b', 'rtx-3090')!;
    expect(page.usesRamHint).toBe(true);
    const hint = String(page.qConfig.ramGB);
    const pageRam = String(page.config.ramGB);
    expect(hint).not.toBe(pageRam);
    expect(() => checkExpect({ model: 'gpt-oss-120b', gpu: 'rtx-3090', fits: 'false' })).not.toThrow();
    // 전엔 이 둘이 함께 통과했다(같은 8k·f16 칸인데 결론이 반대)
    expect(() => resolveExpect({ model: 'gpt-oss-120b', gpu: 'rtx-3090', ctx: '8192' })).toThrow(/RAM hint/);
    expect(() => resolveExpect({ model: 'gpt-oss-120b', gpu: 'rtx-3090', ctx: '8192', ram: pageRam })).toThrow(new RegExp(`computed at ${hint} GB`));
    expect(resolveExpect({ model: 'gpt-oss-120b', gpu: 'rtx-3090', ctx: '8192', ram: hint }).fits).toBe(true);
  });

  it('on an ordinary combo ram is optional with ctx, and must match the page RAM when given', () => {
    const page = getCombo('llama-3.1-8b', 'rtx-3090')!;
    expect(page.usesRamHint).toBe(false);
    const pageRam = String(page.config.ramGB);
    const cell = resolveExpect({ model: 'llama-3.1-8b', gpu: 'rtx-3090', ctx: '32768' });
    expect(resolveExpect({ model: 'llama-3.1-8b', gpu: 'rtx-3090', ctx: '32768', ram: pageRam })).toEqual(cell);
    expect(() => resolveExpect({ model: 'llama-3.1-8b', gpu: 'rtx-3090', ctx: '32768', ram: '128' })).toThrow(/computed at/);
  });
});
