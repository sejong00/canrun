/**
 * 모델 소개 (10-19 D102) — 레지스트리(`content/model-about.ts`) ↔ 로캘별 MDX(`content/{en,ko}/model-about/<id>.mdx`) ↔ 로더 맵 대칭,
 * 소개 고유 규칙(AUTHORING §11: 문단 하나 + 출처 링크 줄, 첫 출처 = 그 모델의 Hugging Face 모델 카드, 컴포넌트·내부 링크·메모리 수치 없음,
 * 짧은 문장, ko 합니다체), 산문 공용 금지 규칙(`prose-rules.ts`). 카탈로그 전 모델을 요구하지 않는다 — 소개가 없는 모델은 목록으로 알리기만 한다
 * (신모델은 매일 자동으로 들어오고, 그날 머지하는 ② 정기 작업이 소개를 쓴다 — docs/03 §5.3). 렌더는 export 테스트가 본다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCalendarDate } from '@canrun/data';
import { MODEL_ABOUT, MODEL_ABOUT_IDS, hasModelAbout } from '../content/model-about';
import { loadSeed } from '../../../packages/data/test/seed';
import { syntaxProblems } from './mdx-scan';
import { HANGUL, outsideCode, proseOf, proseProblems } from './prose-rules';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = ['en', 'ko'] as const;
type AboutLocale = (typeof LOCALES)[number];
const models = loadSeed().models;
const hfIdOf = new Map(models.map((m) => [m.id, m.hfId]));

/** 분량 상한 — 산문 문단 기준(en 단어, ko 공백 뺀 글자), 문장 수, 한 문장 길이(en 단어, ko 공백 포함 글자 — AUTHORING §1 "70자를 넘기면 나눈다") */
const LIMITS = {
  en: { total: 80, sentence: 35 },
  ko: { total: 200, sentence: 70 },
} as const;
const SENTENCES = { min: 2, max: 4 } as const;
/** 출처 링크 줄의 첫 링크 이름 — 모델 카드 */
const CARD_LABEL: Record<AboutLocale, string> = { en: 'Model card', ko: '모델 카드' };
/** 출처 줄 = `[이름](https://…)` 을 ` · ` 로 이은 한 줄 */
const SOURCE_LINE = /^\[[^\]\n]+\]\(https:\/\/[^)\s]+\)(?: · \[[^\]\n]+\]\(https:\/\/[^)\s]+\))*$/;
/** ko 번역투·개발 은어 (AUTHORING §1) */
const KO_BANS: ReadonlyArray<[RegExp, string]> = [
  [/당신/, 'translationese "당신"'],
  [/것이 가능/, 'translationese "~하는 것이 가능"'],
  [/라이브|개방|게이트|헤드라인|베이스라인|폴백/, 'dev jargon'],
];

// core.autocrlf 체크아웃은 작업 트리를 CRLF 로 바꿀 수 있다 — 줄바꿈을 맞춘 뒤 검사한다 (updates.test 와 같은 이유)
const readText = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const dirOf = (locale: AboutLocale) => join(webRoot, 'content', locale, 'model-about');
const readMdx = (locale: AboutLocale, id: string) => readText(join(dirOf(locale), `${id}.mdx`));

/** 문장 — 마침표·물음표·느낌표 뒤 공백(또는 끝)이 경계(2.0·llama.cpp 같은 점은 경계가 아니다) */
const sentencesOf = (prose: string) =>
  prose
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

describe('model about registry ↔ MDX files ↔ loader map', () => {
  it('names catalog models, each with a real last-edited date', () => {
    expect(MODEL_ABOUT_IDS.length).toBeGreaterThan(0);
    for (const id of MODEL_ABOUT_IDS) {
      expect(hfIdOf.has(id), `${id} is not in data/models.json`).toBe(true);
      expect(isCalendarDate(MODEL_ABOUT[id]), `${id} date ${MODEL_ABOUT[id]}`).toBe(true);
    }
    expect(hasModelAbout(MODEL_ABOUT_IDS[0]!)).toBe(true);
    expect(hasModelAbout('not-a-model')).toBe(false);
    expect(hasModelAbout('constructor')).toBe(false);
  });

  it('every registered model has en + ko MDX, and no stray MDX files exist', () => {
    for (const locale of LOCALES) {
      const files = readdirSync(dirOf(locale)).filter((f) => f.endsWith('.mdx'));
      expect(files.map((f) => f.replace(/\.mdx$/, '')).sort(), locale).toEqual([...MODEL_ABOUT_IDS].sort());
    }
  });

  it('the loader map ties every id key to its own en + ko MDX with literal imports', () => {
    const src = readText(join(webRoot, 'lib', 'model-about.ts'));
    const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const id of MODEL_ABOUT_IDS) {
      // 키와 import 를 함께 본다 — 두 키의 import 가 서로 바뀌면(다른 모델의 소개 게시) 여기서 걸린다
      const entry = new RegExp(
        `'${esc(id)}': \\{\\s*en: \\(\\) => import\\('@/content/en/model-about/${esc(id)}\\.mdx'\\)[^\\n]*\\n\\s*ko: \\(\\) => import\\('@/content/ko/model-about/${esc(id)}\\.mdx'\\)`,
      );
      expect(src, id).toMatch(entry);
    }
    const imports = [...src.matchAll(/import\('@\/content\/(?:en|ko)\/model-about\//g)].length;
    expect(imports, 'imports in the loader map').toBe(LOCALES.length * MODEL_ABOUT_IDS.length);
    expect(src).not.toMatch(/import\(`/); // 템플릿 import 금지 (D38)
  });

  it('lists catalog models without an about text (soft report — the daily review job writes them, docs/03 §5.3)', () => {
    const missing = models.map((m) => m.id).filter((id) => !hasModelAbout(id));
    if (missing.length > 0) {
      console.info(`[model-about] ${missing.length} catalog model(s) without an about text: ${missing.join(', ')}`);
    }
    expect(missing.length + MODEL_ABOUT_IDS.length).toBe(models.length);
  });
});

describe('model about MDX bodies (AUTHORING §11)', () => {
  for (const id of MODEL_ABOUT_IDS) {
    for (const locale of LOCALES) {
      it(`${locale}/${id}: one short paragraph, then a source line led by the model card`, () => {
        const src = readMdx(locale, id);
        const where = `${locale}/model-about/${id}.mdx`;
        const problems = syntaxProblems(src, where);
        const code = outsideCode(src);
        if (/[{}]/.test(code)) problems.push(`${where} has { } outside code (MDX expression)`);
        // 데이터 컴포넌트·HTML 없음 — 소개는 모델 카드 사실만, 수치는 허브 표가 그린다
        if (/<[A-Za-z]/.test(code)) problems.push(`${where} has a component or HTML tag (plain prose only)`);
        if (/^#/m.test(src)) problems.push(`${where} heading (the hub template renders the heading)`);
        if (/^\s*(?:[-*+>]|\d+\.)\s/m.test(src)) problems.push(`${where} list or quote (plain paragraph only)`);

        const paragraphs = src.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
        if (paragraphs.length !== 2) problems.push(`${where} has ${paragraphs.length} paragraphs (one paragraph + the source line)`);
        const [body = '', sources = ''] = paragraphs;

        // 출처 줄: 첫 링크 = 이 모델의 Hugging Face 모델 카드(카탈로그 hfId), 나머지는 1차 출처(https)
        if (!SOURCE_LINE.test(sources)) problems.push(`${where} last paragraph is not a source line "[label](https://…) · [label](https://…)"`);
        const links = [...sources.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => ({ label: m[1]!, url: m[2]! }));
        if (links[0]?.label !== CARD_LABEL[locale]) problems.push(`${where} first source is not labelled "${CARD_LABEL[locale]}"`);
        if (links[0]?.url !== `https://huggingface.co/${hfIdOf.get(id)}`) problems.push(`${where} first source is not the model's Hugging Face card (${hfIdOf.get(id)})`);
        if (new Set(links.map((l) => l.url)).size !== links.length) problems.push(`${where} repeats a source`);
        if (/\]\(/.test(body)) problems.push(`${where} links inside the paragraph (sources go on the last line)`);

        const prose = proseOf(body);
        problems.push(...proseProblems(prose, where));
        // 메모리 수치는 허브의 표·FAQ 몫(공식으로 계산한 값) — 소개 문단에는 쓰지 않는다
        if (/\d\s*GB\b/i.test(prose)) problems.push(`${where} memory figure in the about text (the hub tables show memory)`);
        const sentences = sentencesOf(prose);
        if (sentences.length < SENTENCES.min || sentences.length > SENTENCES.max) {
          problems.push(`${where} has ${sentences.length} sentences (${SENTENCES.min}–${SENTENCES.max})`);
        }
        if (locale === 'en') {
          if (HANGUL.test(src)) problems.push(`${where} contains Hangul`);
          const words = prose.split(/\s+/).filter(Boolean).length;
          if (words > LIMITS.en.total) problems.push(`${where} is ${words} words (≤ ${LIMITS.en.total})`);
          for (const s of sentences) {
            const n = s.split(/\s+/).length;
            if (n > LIMITS.en.sentence) problems.push(`${where} sentence of ${n} words (≤ ${LIMITS.en.sentence}): "${s}"`);
          }
        } else {
          if (!HANGUL.test(prose)) problems.push(`${where} has no Hangul`);
          const chars = prose.replace(/\s/g, '').length;
          if (chars > LIMITS.ko.total) problems.push(`${where} is ${chars} characters (≤ ${LIMITS.ko.total})`);
          for (const s of sentences) {
            if (s.length > LIMITS.ko.sentence) problems.push(`${where} sentence of ${s.length} characters (≤ ${LIMITS.ko.sentence}): "${s}"`);
            // 합니다체 — 명사로 끝나는 개조식 문장 금지 (AUTHORING §1)
            if (!/니다\.$/.test(s)) problems.push(`${where} sentence not in 합니다체: "${s}"`);
          }
          for (const [re, why] of KO_BANS) if (re.test(prose)) problems.push(`${where}: ${why}`);
        }
        expect(problems).toEqual([]);
      });
    }
  }
});
