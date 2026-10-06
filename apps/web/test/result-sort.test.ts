/** 계산기 모델 목록 정렬 (10-06 D68) — 합성 카드로 묶음·동률 규칙을 고정한다. 실제 카탈로그 순서는 calc-run.test. */
import type { ComboAssessment, ModelCore } from '@canrun/data/client';
import type { Verdict } from '@canrun/engine';
import { describe, expect, it } from 'vitest';
import { sortCards, type SortableCard } from '../lib/calc/result-sort';
import { formatCompact } from '../lib/format';

function card(id: string, verdict: Verdict, o: { paramsB?: number; popularity?: number; tg?: number; noFit?: boolean; downloads?: number } = {}): SortableCard {
  const model = {
    id,
    paramsB: o.paramsB ?? 8,
    popularity: o.popularity ?? 3,
    ...(o.downloads !== undefined ? { hfDownloads30d: o.downloads, hfDownloadsAsOf: '2026-10-06' } : {}),
  } as ModelCore;
  const result = { verdict, tgTokS: { est: o.tg ?? 10 } };
  const combo = {
    modelId: id,
    baseline: { result },
    display: { result, ...(o.noFit ? { fReason: 'no-fit' } : {}) },
  } as unknown as ComboAssessment;
  return { model, combo };
}

const ids = (cards: readonly SortableCard[]) => cards.map((c) => c.model.id);

describe('sortCards — recommended (default)', () => {
  it('S·A largest first, then B fastest first, then F in verdict order', () => {
    const cards = [
      card('f-fast', 'F', { tg: 3, paramsB: 70 }),
      card('b-slow', 'B', { tg: 4, paramsB: 30 }),
      card('s-small', 'S', { paramsB: 1, tg: 200 }),
      card('a-big', 'A', { paramsB: 35, tg: 12 }),
      card('b-fast', 'B', { tg: 7, paramsB: 32 }),
      card('s-mid', 'S', { paramsB: 14, tg: 40 }),
      card('f-nofit', 'F', { noFit: true, tg: 9, paramsB: 120 }),
    ];
    expect(ids(sortCards(cards, 'rec'))).toEqual(['a-big', 's-mid', 's-small', 'b-fast', 'b-slow', 'f-nofit', 'f-fast']);
  });

  it('same size: more popular first, then id', () => {
    const cards = [card('z', 'A', { paramsB: 8, popularity: 3 }), card('y', 'S', { paramsB: 8, popularity: 5 }), card('x', 'A', { paramsB: 8, popularity: 3 })];
    expect(ids(sortCards(cards, 'rec'))).toEqual(['y', 'x', 'z']);
  });
});

describe('sortCards — popular and downloads', () => {
  it('popular: popularity, then verdict, then speed, then id', () => {
    const cards = [
      card('p3', 'S', { popularity: 3 }),
      card('p5-b', 'B', { popularity: 5, tg: 6 }),
      card('p5-s-slow', 'S', { popularity: 5, tg: 30 }),
      card('p5-s-fast', 'S', { popularity: 5, tg: 90 }),
      card('p5-f', 'F', { popularity: 5, noFit: true }),
    ];
    expect(ids(sortCards(cards, 'popular'))).toEqual(['p5-s-fast', 'p5-s-slow', 'p5-b', 'p5-f', 'p3']);
  });

  it('downloads: most first, models without a count last, ties by verdict then id', () => {
    const cards = [
      card('none', 'S'),
      card('small', 'S', { downloads: 10 }),
      card('big-f', 'F', { downloads: 5_000_000 }),
      card('big-a', 'A', { downloads: 5_000_000 }),
      card('zero', 'S', { downloads: 0 }),
    ];
    expect(ids(sortCards(cards, 'downloads'))).toEqual(['big-a', 'big-f', 'small', 'zero', 'none']);
  });

  it('verdict / speed / size keep their earlier rules and the input is not mutated', () => {
    const cards = [card('b', 'B', { tg: 5, paramsB: 70 }), card('s', 'S', { tg: 50, paramsB: 3 }), card('f', 'F', { noFit: true, tg: 99, paramsB: 120 })];
    expect(ids(sortCards(cards, 'verdict'))).toEqual(['s', 'b', 'f']);
    expect(ids(sortCards(cards, 'speed'))).toEqual(['s', 'b', 'f']);
    expect(ids(sortCards(cards, 'size'))).toEqual(['f', 'b', 's']);
    expect(ids(cards)).toEqual(['b', 's', 'f']);
  });
});

describe('formatCompact — download counts on cards', () => {
  it('shortens large counts per locale and keeps small ones whole', () => {
    expect([6104298, 10080256, 98765, 1234].map((n) => formatCompact('en', n))).toEqual(['6.1M', '10.1M', '98.8K', '1,234']);
    expect([6104298, 10080256, 123456, 1234].map((n) => formatCompact('ko', n))).toEqual(['610만', '1,008만', '12.3만', '1,234']);
  });
});
