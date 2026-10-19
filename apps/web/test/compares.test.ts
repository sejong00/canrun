/**
 * GPU 비교 레지스트리·문장 (10-19 D103) — 레지스트리 규칙(카탈로그 id·a≠b·쌍 중복·쌍둥이 GPU·상한·게시 조건), 쌍마다 비교할 거리가 있는지
 * (구분 가드), 링크·공유 카드 경로, ko `Compare.*` 문구와 실제로 그린 문장의 산문 규칙(금지 어구·변수 바로 뒤 조사·규칙 3 밴드).
 * 산출물 끝단(noindex·링크·사이트맵·구조화 데이터)은 test/export-invariants.spec.ts 가 본다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { twinGpus } from '../../../packages/data/src/index';
import {
  COMPARE_GROUPS,
  COMPARE_INTRO_SLUGS,
  COMPARE_MAX,
  COMPARE_SLUGS,
  COMPARES,
  compareSlugOf,
  isCompareSlug,
  publishedCompares,
  reversedCompareSlugs,
} from '../content/compares';
import { catalog } from '../lib/catalog';
import {
  compareDescription,
  compareFaq,
  compareNameWithMemory,
  compareNames,
  compareTitle,
  overlapSentence,
  ppSummary,
  speedSentence,
  speedVerdict,
  type CompareTranslators,
} from '../lib/compare-phrases';
import { compareLinksForGpu, compareOgImagePath, getCompare } from '../lib/compares';
import { compareHref, comparesHref } from '../lib/links';
import { compareOgImage, defaultOgImage } from '../lib/og-images';
import { HANGUL, PROSE_BANS } from './prose-rules';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = ['en', 'ko'] as const;
type Locale = (typeof LOCALES)[number];
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(webRoot, 'messages', `${l}.json`), 'utf8')) as Record<string, Record<string, string>>]),
) as Record<Locale, Record<string, Record<string, string>>>;

function translators(locale: Locale): CompareTranslators {
  const t = (namespace: string) => createTranslator({ locale, messages: messages[locale], namespace }) as unknown as CompareTranslators['names'];
  return { compare: t('Compare'), hub: t('GpuHub'), common: t('Common'), confidence: t('Confidence'), combo: t('Combo'), names: t('GpuName') };
}

const gpuIds = new Set(catalog.gpus.map((g) => g.id));
const gpuOf = (id: string) => catalog.gpus.find((g) => g.id === id)!;

describe('compare registry (content/compares.ts)', () => {
  it('lists every pair once, keyed by `${a}-vs-${b}`, within COMPARE_MAX', () => {
    expect(Object.keys(COMPARES).sort()).toEqual([...COMPARE_SLUGS].sort());
    expect(new Set(COMPARE_SLUGS).size).toBe(COMPARE_SLUGS.length);
    expect(COMPARE_SLUGS.length).toBeLessThanOrEqual(COMPARE_MAX);
    for (const slug of COMPARE_SLUGS) {
      const { a, b } = COMPARES[slug];
      expect(slug).toBe(compareSlugOf(a, b));
      expect(isCompareSlug(slug)).toBe(true);
    }
    expect(isCompareSlug('rtx-5090-vs-rtx-4090')).toBe(false);
  });

  it('names two different catalog GPUs that are not memory twins, and each unordered pair once', () => {
    const seen = new Set<string>();
    for (const slug of COMPARE_SLUGS) {
      const { a, b } = COMPARES[slug];
      expect(gpuIds.has(a), `${slug}: ${a} is not in data/gpus.json`).toBe(true);
      expect(gpuIds.has(b), `${slug}: ${b} is not in data/gpus.json`).toBe(true);
      expect(a, slug).not.toBe(b);
      // 쌍둥이 GPU(메모리 구성이 같아 생성 속도 추정이 같다 — D22)는 비교할 거리가 FP16 뿐이다
      expect(twinGpus(gpuOf(a), catalog.gpus).map((g) => g.id), `${slug}: twins`).not.toContain(b);
      const key = [a, b].sort().join('|');
      expect(seen.has(key), `${slug}: the same pair twice`).toBe(false);
      seen.add(key);
    }
  });

  it('has a known group, a demand note and a YYYY-MM-DD dateModified; published pairs carry reviewedAt and an intro', () => {
    for (const slug of COMPARE_SLUGS) {
      const entry = COMPARES[slug];
      expect(COMPARE_GROUPS, slug).toContain(entry.group);
      expect(entry.demand.trim(), slug).not.toBe('');
      expect(entry.dateModified, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (entry.status === 'published') {
        expect(entry.reviewedAt, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect((COMPARE_INTRO_SLUGS as readonly string[]).includes(slug), `${slug} is published without an intro`).toBe(true);
      }
    }
  });

  it('reversed slugs never collide with a registry slug (they 301 to it)', () => {
    const reversed = reversedCompareSlugs();
    expect(reversed).toHaveLength(COMPARE_SLUGS.length);
    for (const { reversed: from, slug } of reversed) {
      expect(isCompareSlug(from), from).toBe(false);
      expect(from).toBe(compareSlugOf(COMPARES[slug].b, COMPARES[slug].a));
    }
  });
});

describe('distinctness guard (a comparison must have something to compare)', () => {
  it('every pair differs in verdicts, speed (outside 0.97–1.03), memory size, or FP16 (≥ 1.25×)', () => {
    const failing: string[] = [];
    for (const slug of COMPARE_SLUGS) {
      const { cmp } = getCompare(slug)!;
      const memory = (side: typeof cmp.a) => side.memoryGB ?? side.gpu.vramGB ?? 0;
      const fp16 = cmp.specRatio.fp16 === undefined ? 1 : Math.max(cmp.specRatio.fp16, 1 / cmp.specRatio.fp16);
      const speedApart = cmp.speed !== undefined && (cmp.speed.ratio < 0.97 || cmp.speed.ratio > 1.03);
      if (!(cmp.differing > 0 || speedApart || memory(cmp.a) !== memory(cmp.b) || fp16 >= 1.25)) {
        failing.push(`${slug}: ${cmp.differing} verdict differences, speed ×${cmp.speed?.ratio.toFixed(3)}, memory ${memory(cmp.a)}/${memory(cmp.b)} GB, FP16 ×${fp16.toFixed(2)}`);
      }
    }
    expect(failing).toEqual([]);
  });
});

describe('links, share cards and the GPU hub block', () => {
  it('builds locale-free paths', () => {
    expect(comparesHref()).toBe('/compare');
    expect(compareHref('rtx-4090-vs-rtx-5090')).toBe('/compare/rtx-4090-vs-rtx-5090');
    expect(compareOgImage('rtx-4090-vs-rtx-5090', 'ko')).toBe('/og/compare/rtx-4090-vs-rtx-5090-ko.png');
  });

  it('drafts keep the default card and never appear in GPU hub links; published pairs do, from both GPUs', () => {
    const published = new Set(publishedCompares());
    for (const slug of COMPARE_SLUGS) {
      for (const locale of LOCALES) {
        expect(compareOgImagePath(slug, locale)).toBe(published.has(slug) ? compareOgImage(slug, locale) : defaultOgImage(locale));
      }
      const { a, b } = COMPARES[slug];
      for (const [gpu, other] of [
        [a, b],
        [b, a],
      ] as const) {
        expect(compareLinksForGpu(gpu).some((l) => l.slug === slug && l.otherId === other), `${gpu} → ${slug}`).toBe(published.has(slug));
      }
    }
  });
});

describe('speedVerdict', () => {
  it('treats 0.95–1.05 as about the same and reports the factor of the faster side otherwise', () => {
    expect(speedVerdict(1)).toEqual({ kind: 'same' });
    expect(speedVerdict(0.95)).toEqual({ kind: 'same' });
    expect(speedVerdict(1.05)).toEqual({ kind: 'same' });
    expect(speedVerdict(1.5)).toEqual({ kind: 'faster', faster: 'b', factor: 1.5 });
    const slower = speedVerdict(0.5);
    expect(slower.kind === 'faster' && slower.faster === 'a' && slower.factor).toBe(2);
  });
});

/** ICU 변수 바로 뒤 받침 의존 조사 — 이름 끝소리에 따라 틀린 조사가 된다 ("RTX 5070과"는 되지만 "Apple M4 Pro과"는 아니다) */
const PARTICLE_AFTER_VAR = /\}(?:은|는|이|가|와|과|을|를)(?![가-힣])/;

describe('Compare messages (ko 산문 규칙)', () => {
  it('ko Compare.* pass PROSE_BANS and put no particle directly after an ICU variable', () => {
    const problems: string[] = [];
    for (const [key, message] of Object.entries(messages.ko.Compare!)) {
      for (const [re, why] of PROSE_BANS) if (re.test(message)) problems.push(`Compare.${key}: ${why} — ${message}`);
      if (PARTICLE_AFTER_VAR.test(message)) problems.push(`Compare.${key}: particle right after a variable — ${message}`);
      if (!HANGUL.test(message) && !/^[{}\w\s:·;()+×vs]*$/.test(message)) problems.push(`Compare.${key}: no Hangul — ${message}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('rendered compare text (titles · descriptions · summary · FAQ)', () => {
  const RANGE = /\d[\d.,]*–\d[\d.,]*/;
  const QUOTED_SPEED = /\d[\d.,]*\s*tok\/s/;
  // 수치가 들어간 문장에는 숫자 금지 규칙(속도·GB·가격)을 빼고 본다 — 숫자는 데이터에서 온다
  const WORDING_BANS = PROSE_BANS.filter(([, why]) => /assertive|predicate/.test(why));

  it('titles are unique across pairs and locales; every speed quote carries a range (규칙 3); en has no Hangul; ko keeps the wording rules', () => {
    const titles = new Set<string>();
    const problems: string[] = [];
    for (const locale of LOCALES) {
      const t = translators(locale);
      for (const slug of COMPARE_SLUGS) {
        const { cmp } = getCompare(slug)!;
        const names = compareNames(t, locale, cmp);
        const title = compareTitle(t, cmp, names);
        if (titles.has(title)) problems.push(`duplicate title ${title}`);
        titles.add(title);
        const faq = compareFaq(t, locale, cmp, names);
        expect(faq, `${locale} ${slug} FAQ`).toHaveLength(3);
        const texts = [
          title,
          compareDescription(t, locale, cmp, names),
          speedSentence(t, locale, cmp, names),
          overlapSentence(t, cmp) ?? '',
          ppSummary(t, locale, cmp, names) ?? '',
          ...faq.flatMap((qa) => [qa.question, qa.answer]),
        ].filter((x) => x !== '');
        for (const text of texts) {
          if (QUOTED_SPEED.test(text) && !RANGE.test(text)) problems.push(`${locale} ${slug}: speed without a range — ${text}`);
          if (locale === 'en' && HANGUL.test(text)) problems.push(`${locale} ${slug}: Hangul — ${text}`);
          if (locale === 'ko') for (const [re, why] of WORDING_BANS) if (re.test(text)) problems.push(`${locale} ${slug}: ${why} — ${text}`);
          if (/\{|\}|Compare\./.test(text)) problems.push(`${locale} ${slug}: unformatted message — ${text}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the description answers first: the speed ratio (or "about the same") before the counts, with the memory of each side', () => {
    const t = translators('en');
    const { cmp } = getCompare('rtx-5060-ti-16gb-vs-rtx-5070')!;
    const description = compareDescription(t, 'en', cmp, compareNames(t, 'en', cmp));
    expect(description).toMatch(/^The RTX 5070 is about 1\.5× faster than the RTX 5060 Ti 16GB/);
    // VRAM 이 이름에 없는 카드만 메모리를 붙인다
    expect(compareNameWithMemory(t, 'en', cmp.b)).toBe('RTX 5070 (12 GB VRAM)');
    expect(compareNameWithMemory(t, 'en', cmp.a)).toBe('RTX 5060 Ti 16GB');
    const unified = getCompare('apple-m4-pro-vs-rtx-5060-ti-16gb')!.cmp;
    expect(compareTitle(t, unified, compareNames(t, 'en', unified))).toBe(
      'Apple M4 Pro 64GB vs RTX 5060 Ti 16GB for Local LLMs: Memory & Speed Compared',
    );
    const ko = translators('ko');
    expect(compareTitle(ko, unified, compareNames(ko, 'ko', unified))).toBe('Apple M4 Pro 64GB vs RTX 5060 Ti 16GB 로컬 LLM 비교 — 메모리·예상 속도');
  });
});
