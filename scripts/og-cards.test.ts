/**
 * 공유 카드 (scripts/og-cards.ts, D60·D96) — 글꼴 서브셋이 카드 글자를 다 담는지, 카드 개수가 허브와 같은지,
 * 콤보 카드의 속도가 늘 신뢰 라벨과 함께인지(규칙 3). 카드 = 페이지 대조는 export 테스트(빌드 뒤) 몫.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeGpu } from '../packages/data/src/index';
import { GUIDES } from '../apps/web/content/guides';
import {
  OG_FONT_CHARS_PATH,
  OG_LOCALES,
  comboCardText,
  gpuCardText,
  guideCardText,
  loadCatalog,
  loadMessages,
  modelCardText,
  ogCardChars,
  ogTranslators,
  publishedCombos,
  publishedGuides,
} from './og-cards';

const catalog = loadCatalog();

describe('og cards', () => {
  it('the committed font subset covers every character a card can show (else: pnpm exec tsx scripts/og-font.ts)', () => {
    const subset = new Set(readFileSync(OG_FONT_CHARS_PATH, 'utf8').replace(/\r?\n$/, ''));
    const missing = [...ogCardChars(catalog)].filter((ch) => !subset.has(ch));
    expect(missing).toEqual([]);
  });

  it('GPU cards count every catalog model; model cards count every GPU', () => {
    const m = loadMessages('ko');
    const gpu = catalog.gpus.find((g) => g.id === 'rtx-4060')!;
    const g = gpuCardText(catalog, gpu, m);
    expect(g.counts.S + g.counts.A + g.counts.B + g.counts.F).toBe(catalog.models.length);
    expect(g.detail).toBe('VRAM 8GB');
    const model = catalog.models.find((x) => x.id === 'gpt-oss-120b')!;
    const c = modelCardText(catalog, model, loadMessages('en'));
    expect(c.counts.S + c.counts.A + c.counts.B + c.counts.F).toBe(catalog.gpus.length);
    expect(c.detail).toContain('5.1B active');
  });

  it('CPU profile cards say RAM, not unified memory', () => {
    const cpu = catalog.gpus.find((g) => g.kind === 'cpu')!;
    expect(gpuCardText(catalog, cpu, loadMessages('en')).detail).toMatch(/^\d+ GB RAM$/);
    expect(gpuCardText(catalog, cpu, loadMessages('ko')).detail).toMatch(/^RAM \d+GB$/);
  });
});

describe('combo and guide cards (D96)', () => {
  const combos = publishedCombos();

  it('are the indexable combos, each once', () => {
    expect(combos.length).toBeGreaterThan(0);
    expect(new Set(combos.map((c) => `${c.gpuId}/${c.modelId}`)).size).toBe(combos.length);
  });

  it('every published combo card has a verdict, the memory it needs, and a speed only with its confidence label (규칙 3)', () => {
    const gpuById = new Map(catalog.gpus.map((g) => [g.id, g]));
    for (const locale of OG_LOCALES) {
      const t = ogTranslators(locale);
      for (const { gpuId, modelId } of combos) {
        const card = comboCardText(summarizeGpu(catalog, gpuById.get(gpuId)!), modelId, t, locale);
        const where = `${locale} ${gpuId}/${modelId}`;
        expect(card.title, where).toBe(catalog.models.find((m) => m.id === modelId)!.name);
        expect(card.verdictText, where).not.toBe('');
        expect(card.need, where).toMatch(/\d\s?GB/);
        if (card.speed) {
          expect(card.speed.value, where).toMatch(/tok\/s$/);
          expect(card.speed.label, where).toMatch(/±\d+%|measured \(|실측 \d/);
          // 추정은 늘 밴드 — 숫자 하나만 쓰는 건 실측뿐
          if (!/measured|실측/.test(card.speed.label)) expect(card.speed.value, where).toMatch(/\d–\d/);
        } else {
          expect(card.verdict, where).toBe('F');
        }
      }
    }
  });

  it('guide cards carry the registry title for every published guide', () => {
    const slugs = publishedGuides();
    expect(slugs.length).toBeGreaterThan(0);
    for (const locale of OG_LOCALES) {
      const t = ogTranslators(locale);
      for (const slug of slugs) expect(guideCardText(slug, t, locale).title).toBe(GUIDES[slug].locales[locale].title);
    }
  });
});
