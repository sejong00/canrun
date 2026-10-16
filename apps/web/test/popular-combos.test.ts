/**
 * 홈 "많이 찾는 조합" (10-16 D95) — 공개 콤보만, 6~10개, GPU 는 한 번씩·모델은 고르게, 같은 입력이면 같은 목록.
 * 렌더 결과의 링크 규칙(홈은 공개 콤보로만)은 export 테스트가 본다.
 */
import { describe, expect, it } from 'vitest';
import { catalog } from '../lib/catalog';
import { isComboIndexable } from '../lib/publish';
import { HOME_QUICK_PICKS, POPULAR_COMBO_COUNT, popularCombos } from '../lib/popular-combos';

describe('home popular combos (D95)', () => {
  const combos = popularCombos();

  it('lists 6–10 published combos, each GPU once', () => {
    expect(catalog.publish.currentBatch, 'a batch is open').toBeGreaterThan(0);
    expect(combos.length).toBeGreaterThanOrEqual(6);
    expect(combos.length).toBeLessThanOrEqual(10);
    expect(combos.length).toBeLessThanOrEqual(POPULAR_COMBO_COUNT);
    for (const { gpu, model } of combos) expect(isComboIndexable(gpu.id, model.id), `${gpu.id}/${model.id}`).toBe(true);
    expect(new Set(combos.map((c) => c.gpu.id)).size).toBe(combos.length);
  });

  it('spreads models evenly and keeps the quick-pick GPU order first', () => {
    const models = new Set(combos.map((c) => c.model.id));
    const perModel = Math.ceil(combos.length / models.size);
    for (const id of models) expect(combos.filter((c) => c.model.id === id).length, id).toBeLessThanOrEqual(perModel);
    const quick = HOME_QUICK_PICKS.filter((id) => combos.some((c) => c.gpu.id === id));
    expect(combos.slice(0, quick.length).map((c) => c.gpu.id)).toEqual(quick);
  });

  it('puts the most popular model on the first GPU and is deterministic', () => {
    const top = Math.max(...combos.map((c) => c.model.popularity));
    expect(combos[0]!.model.popularity).toBe(top);
    expect(popularCombos().map((c) => `${c.gpu.id}/${c.model.id}`)).toEqual(combos.map((c) => `${c.gpu.id}/${c.model.id}`));
  });
});
