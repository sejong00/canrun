/**
 * GPU 비교 소개글 (10-19 D106) — 레지스트리(`content/compares.ts` COMPARE_INTRO_SLUGS) ↔ 로캘별 MDX(`content/{en,ko}/compare/<slug>.mdx`) ↔
 * 로더 맵(`lib/compare-intros.ts`) 대칭, 허브 소개글(hub-intros.test.ts, AUTHORING §10)과 같은 MDX 규칙(컴포넌트 명세·산문 숫자 금지·금지 어구·
 * 인라인 컴포넌트만·`<Expect>` ≥1·데이터 컴포넌트 ≥1·2~3문단·짧게·이론 추정 라벨), 허용 컴포넌트 목록(COMPARE_INTRO_COMPONENTS),
 * 게시 쌍 ⇒ 소개글 en·ko. 소개글은 아직 없다(부모 세션이 쓴다) — 규칙이 공회전하지 않도록 아래 표본 문자열로 검사기 자체를 확인한다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPARE_INTRO_COMPONENTS, COMPARE_INTRO_SLUGS, COMPARE_SLUGS, COMPARES, publishedCompares } from '../content/compares';
import { resolveExpect, type ExpectClaim } from '../lib/expect-claim';
import { getCombo } from '../lib/combos';
import { GUIDE_COMPONENTS } from '../lib/guide-components';
import { componentProblems, componentUsages, syntaxProblems } from './mdx-scan';
import { HANGUL, outsideCode, proseOf, proseProblems } from './prose-rules';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = ['en', 'ko'] as const;
type Locale = (typeof LOCALES)[number];
/** 짧은 소개 — 허브 소개글과 같은 상한(산문 기준: en 단어, ko 공백 뺀 글자). 표는 비교 페이지가 이미 그린다 */
const PARAGRAPHS = { min: 2, max: 3 } as const;
const MAX_EN_WORDS = 220;
const MAX_KO_CHARS = 600;
const ALLOWED: ReadonlySet<string> = new Set(COMPARE_INTRO_COMPONENTS);
const SLUGS = COMPARE_INTRO_SLUGS as readonly string[];

// core.autocrlf 체크아웃은 작업 트리를 CRLF 로 바꿀 수 있다 — 줄바꿈을 맞춘 뒤 검사한다 (hub-intros.test 와 같은 이유)
const readText = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const dirOf = (locale: Locale) => join(webRoot, 'content', locale, 'compare');
/** 소개글이 하나도 없으면 디렉터리가 없을 수 있다 — 빈 목록 */
const mdxFiles = (locale: Locale) =>
  existsSync(dirOf(locale)) ? readdirSync(dirOf(locale)).filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, '')) : [];

/** 이론 추정 라벨 — en "theoretical estimate(s) (±30%)", ko "이론 추정(±30%)" */
const THEORETICAL_LABEL = { en: /theoretical/i, ko: /이론 추정/ } as const;

/** `<Expect>` 가 든 문장과 그다음 문장 (hub-intros.test.ts 와 같은 문장 경계) */
function sentenceAndNext(src: string, index: number, length: number): string {
  const ends = [...src.matchAll(/[.!?](?=\s|$)/g)].map((m) => m.index! + 1);
  const start = Math.max(0, ...ends.filter((e) => e <= index));
  const after = ends.filter((e) => e >= index + length);
  return src.slice(start, after[1] ?? after[0] ?? src.length);
}

/** 소개글 한 편의 문제 목록 — 빈 배열이면 통과 */
function introProblems(src: string, where: string, locale: Locale): string[] {
  const problems = [...syntaxProblems(src, where), ...componentProblems(src, where)];
  if (/[{}]/.test(outsideCode(src))) problems.push(`${where} has { } outside code (MDX expression)`);
  // 제목은 템플릿의 h2 하나 — 소개 안에는 제목·목록을 두지 않는다(문단만)
  if (/^#/m.test(src)) problems.push(`${where} heading (the compare template renders the intro heading)`);
  if (/^\s*(?:[-*+]|\d+\.)\s/m.test(src)) problems.push(`${where} list (intros are plain paragraphs)`);

  const usages = componentUsages(src);
  for (const u of usages) {
    if (!ALLOWED.has(u.name)) problems.push(`${where}:${u.line} <${u.name}> is not allowed in a compare intro (${COMPARE_INTRO_COMPONENTS.join(', ')})`);
    if (GUIDE_COMPONENTS[u.name]?.block) problems.push(`${where}:${u.line} <${u.name}> block component (the compare page already shows its tables)`);
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

  // <Expect> 고정 규칙 (AUTHORING §10): 조건이 붙으면 판정·fit 을 밝힌다, 이론 추정 판정은 그 문장이나 다음 문장에 라벨
  for (const m of src.matchAll(/<Expect\b([^>]*?)\/>/g)) {
    const claim = Object.fromEntries([...m[1]!.matchAll(/([a-zA-Z]+)="([^"]*)"/g)].map((p) => [p[1]!, p[2]!])) as ExpectClaim;
    const conditioned = claim.quant !== undefined || claim.ram !== undefined || claim.ctx !== undefined;
    if (conditioned && claim.verdict === undefined && claim.fits === undefined) {
      problems.push(`${where}: ${m[0]} has a condition but pins neither verdict nor fits`);
    }
    if (claim.verdict !== undefined && resolveExpect(claim).confidence === 'theoretical') {
      if (!THEORETICAL_LABEL[locale].test(sentenceAndNext(src, m.index!, m[0].length))) {
        problems.push(`${where}: ${m[0]} is a theoretical estimate — label it in that sentence or the next`);
      }
    }
  }
  return problems;
}

describe('compare intro registry ↔ MDX files ↔ loader map', () => {
  it('names registry pairs, without duplicates', () => {
    expect(new Set(SLUGS).size).toBe(SLUGS.length);
    for (const slug of SLUGS) expect((COMPARE_SLUGS as readonly string[]).includes(slug), `${slug} is not a compare pair`).toBe(true);
  });

  it('every registered pair has en + ko MDX, and no stray MDX files exist', () => {
    for (const locale of LOCALES) expect(mdxFiles(locale).sort(), locale).toEqual([...SLUGS].sort());
  });

  it('the loader map ties every slug key to its own en + ko MDX with literal imports', () => {
    const src = readText(join(webRoot, 'lib', 'compare-intros.ts'));
    const code = src.slice(src.indexOf('const LOADERS'));
    const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const slug of SLUGS) {
      // 키와 import 를 함께 본다 — 두 키의 import 가 서로 바뀌면(다른 쌍의 소개글 게시) 여기서 걸린다
      const entry = new RegExp(
        `'${esc(slug)}': \\{\\s*en: \\(\\) => import\\('@/content/en/compare/${esc(slug)}\\.mdx'\\)[^\\n]*\\n\\s*ko: \\(\\) => import\\('@/content/ko/compare/${esc(slug)}\\.mdx'\\)`,
      );
      expect(code, slug).toMatch(entry);
    }
    // 머리 주석의 형식 예시는 세지 않는다 — LOADERS 선언부터
    expect([...code.matchAll(/import\('@\/content\/(?:en|ko)\/compare\//g)].length, 'imports in the loader map').toBe(LOCALES.length * SLUGS.length);
    expect(src).not.toMatch(/import\(`/); // 템플릿 import 금지 (D38)
  });

  it('a published pair has both intros (게시 전 감수 — D40)', () => {
    for (const slug of publishedCompares()) expect(SLUGS.includes(slug), `${slug} is published without an intro`).toBe(true);
  });

  it('the allowed components are inline guide components (the page draws its own tables)', () => {
    for (const name of COMPARE_INTRO_COMPONENTS) {
      expect(GUIDE_COMPONENTS[name], name).toBeDefined();
      expect(GUIDE_COMPONENTS[name]!.block, name).toBe(false);
    }
  });
});

describe('compare intro MDX bodies (AUTHORING §12)', () => {
  it('every registered intro passes the intro rules in both locales', () => {
    const problems: string[] = [];
    for (const slug of SLUGS) {
      for (const locale of LOCALES) {
        const where = `${locale}/compare/${slug}.mdx`;
        problems.push(...introProblems(readText(join(dirOf(locale), `${slug}.mdx`)), where, locale));
      }
    }
    expect(problems).toEqual([]);
  });

  // 소개글이 아직 0편이라 위 검사가 비어 있다 — 검사기 자체가 규칙을 지키는지 표본으로 확인한다
  const { a, b } = COMPARES['rtx-4090-vs-rtx-5090'];
  const good = {
    en: [
      `The RTX 5090 has <Num kind="vramGB" gpu="${b}" /> of VRAM against <Num kind="vramGB" gpu="${a}" /> on the RTX 4090.`,
      '',
      `That extra memory is where they part: Llama 3.3 70B needs system RAM on both <Expect model="llama-3.3-70b" gpu="${a}" fits="true" />.`,
    ].join('\n'),
    ko: [
      `RTX 5090의 VRAM은 <Num kind="vramGB" gpu="${b}" />이고, RTX 4090은 <Num kind="vramGB" gpu="${a}" />입니다.`,
      '',
      `이 차이에서 갈리는 모델이 있습니다. Llama 3.3 70B는 두 카드 모두 시스템 RAM을 함께 씁니다 <Expect model="llama-3.3-70b" gpu="${a}" fits="true" />.`,
    ].join('\n'),
  } as const;

  it('the checker passes a well-formed sample and flags banned patterns', () => {
    for (const locale of LOCALES) expect(introProblems(good[locale], `sample-${locale}`, locale), locale).toEqual([]);
    const bad = (src: string, locale: Locale = 'en') => introProblems(src, 'bad', locale).join('\n');
    expect(bad(`One paragraph only <Expect model="llama-3.3-70b" gpu="${a}" fits="true" /> <Num kind="vramGB" gpu="${a}" />.`)).toMatch(/paragraphs/);
    expect(bad(`${good.en}\n\n<CtxTable model="llama-3.1-8b" gpu="${a}" />`)).toMatch(/not allowed in a compare intro/);
    expect(bad(good.en.replace(/<Expect[^>]*\/>/, ''))).toMatch(/pins no claim/);
    expect(bad(`${good.en} It runs at 40 tok/s.`)).toMatch(/speed number in prose/);
    expect(bad(`${good.en}\n\n- a list item`)).toMatch(/list/);
    expect(bad(`${good.ko} 4090은 쾌적입니다.`, 'ko')).toMatch(/verdict name used as a predicate/);
    expect(bad(good.ko, 'en')).toMatch(/Hangul/);
  });
});

describe('claims the intros make outside <Expect> (10-23 D120 review)', () => {
  it("M5 Ultra 256GB × GLM-5.3-Flash: 'Runs slowly' is the CPU-only cap — the speed estimate alone would rate higher", () => {
    // nvidia-dgx-spark-vs-apple-m5-ultra 소개글 en 'theoretical speed estimate alone would rate higher' · ko '추정 속도만으로는 더 높은 판정이 나옵니다'
    const combo = getCombo('glm-5.3-flash', 'apple-m5-ultra')!.configCombos.find((c) => c.ramGB === 256)!;
    expect(combo.baseline.result.mode).toBe('cpu-only');
    expect(combo.baseline.verdictReason).toBe('cap-cpu-only');
  });

  it('RTX PRO 6000 Blackwell × Solar Open 2 250B Q2_K: just over the usable VRAM CanRun counts from the listed 96GB, under what the card reports', () => {
    // 소개글 'a little more than the usable … CanRun counts from the listed 96GB' · 'the card reports slightly more memory to llama.cpp, so the whole file may fit'
    // (llama-bench "VRAM: 97250 MiB" = 101.97GB — #15013 16420189, gpus.json note). --fit 이 비워 두는 1024MiB 를 빼도 남는다
    const q = getCombo('solar-open2-250b', 'rtx-pro-6000-blackwell')!.combo.perQuant.find((r) => r.quant === 'Q2_K')!;
    expect(q.result.mode).toBe('cpu-moe');
    expect(q.memory.needGB).toBeGreaterThan(q.memory.gpuUsableGB);
    expect(q.memory.needGB - q.memory.gpuUsableGB).toBeLessThan(1);
    expect(q.memory.needGB).toBeLessThan((97250 - 1024) * 1.048576 / 1000);
  });
});
