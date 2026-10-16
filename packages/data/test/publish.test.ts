/** 인덱싱 배치 게이트 (packages/data/src/publish.ts, data/publish.json) — docs/04 §3, 결정 D9. */
import { describe, expect, it } from 'vitest';
import {
  comboBatch,
  comboLinkAllowed,
  comboPublishState,
  indexableCombos,
  PublishSchema,
  twinGpus,
  validateAll,
} from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();

describe('seed publish.json', () => {
  it('batch 1 (10 GPUs × 6 models) is open since P1-6 (09-30, user-approved gate — rule 5)', () => {
    expect(seed.publish.currentBatch).toBe(1);
    expect(seed.publish.batches[0]!.batch).toBe(1);
    expect(seed.publish.batches[0]!.gpuIds).toHaveLength(10);
    expect(seed.publish.batches[0]!.modelIds).toHaveLength(6);
  });

  it('batch 2 is planned only (10 GPUs × 12 models, 10-16 D92) — opening it needs the gate and user approval', () => {
    const batch2 = seed.publish.batches.find((b) => b.batch === 2)!;
    expect(batch2.gpuIds).toEqual(seed.publish.batches[0]!.gpuIds);
    expect(batch2.modelIds).toHaveLength(12);
    // 배치 1 모델과 겹치지 않는다 — 겹치면 그 쌍은 배치 1 로 남아 계획한 120쌍이 줄어든다
    expect(batch2.modelIds.filter((id) => seed.publish.batches[0]!.modelIds.includes(id))).toEqual([]);
  });

  it('batch 1 indexes exactly the 60 candidate combos, nothing outside it', () => {
    expect(indexableCombos(seed.publish).size).toBe(60);
    expect(comboPublishState(seed.publish, 'rtx-4060', 'llama-3.1-8b')).toEqual({ batch: 1, indexable: true });
    // 배치 2 계획에 든 쌍 — 배치 번호는 있지만 아직 색인 안 함
    expect(comboPublishState(seed.publish, 'rtx-4060', 'llama-3.3-70b')).toEqual({ batch: 2, indexable: false });
    expect(comboPublishState(seed.publish, 'rtx-4060', 'phi-4')).toEqual({ indexable: false });
  });

  it('closing the gate (currentBatch 0) indexes nothing — the rollback switch', () => {
    const closed = { ...seed.publish, currentBatch: 0 };
    expect(indexableCombos(closed).size).toBe(0);
    expect(comboPublishState(closed, 'rtx-4060', 'llama-3.1-8b')).toEqual({ batch: 1, indexable: false });
  });

  it('never pairs twin GPUs inside one batch (D22) — every batch, every twin group', () => {
    // 쌍둥이 = 메모리 구성 동일(twinGpus). 배치가 늘어나도 이 테스트가 그대로 지킨다
    expect(seed.publish.batches.length).toBeGreaterThan(0);
    for (const batch of seed.publish.batches) {
      const ids = new Set(batch.gpuIds);
      for (const id of ids) {
        const gpu = seed.gpus.find((g) => g.id === id)!;
        const twins = twinGpus(gpu, seed.gpus).filter((t) => ids.has(t.id));
        expect(twins.map((t) => t.id), `batch ${batch.batch}: ${id} shares the batch with its twin`).toEqual([]);
      }
    }
    // 알려진 쌍이 실제로 쌍둥이로 잡히는지 (테스트 자체의 공회전 방지)
    expect(twinGpus(seed.gpus.find((g) => g.id === 'rtx-4090')!, seed.gpus).map((g) => g.id)).toContain('rtx-3090-ti');
  });
});

describe('comboBatch — the pair must be inside one entry, not just its GPU and model separately', () => {
  const plan = PublishSchema.parse({
    currentBatch: 1,
    batches: [
      { batch: 1, gpuIds: ['rtx-4060'], modelIds: ['llama-3.1-8b'] },
      { batch: 2, gpuIds: ['rtx-4060', 'rtx-3090'], modelIds: ['qwen3-14b'] },
      { batch: 1, gpuIds: ['rtx-3090'], modelIds: ['qwen3-14b'] },
    ],
  });

  it('takes the smallest batch among entries containing the pair', () => {
    expect(comboBatch(plan, 'rtx-4060', 'llama-3.1-8b')).toBe(1);
    // 4060 은 배치 1, qwen3-14b 는 배치 1 항목에도 있지만 그 쌍은 배치 2 항목에만 있다
    expect(comboBatch(plan, 'rtx-4060', 'qwen3-14b')).toBe(2);
    expect(comboBatch(plan, 'rtx-3090', 'qwen3-14b')).toBe(1);
    expect(comboBatch(plan, 'rtx-3090', 'llama-3.1-8b')).toBeUndefined();
    expect(indexableCombos(plan)).toEqual(new Set(['rtx-4060/llama-3.1-8b', 'rtx-3090/qwen3-14b']));
  });

  it('published pages only link to published combos', () => {
    expect(comboLinkAllowed(true, true)).toBe(true);
    expect(comboLinkAllowed(true, false)).toBe(false);
    expect(comboLinkAllowed(false, false)).toBe(true);
    expect(comboLinkAllowed(false, true)).toBe(true);
  });
});

describe('PublishSchema', () => {
  it('rejects currentBatch beyond the defined batches, duplicate ids and batch 0', () => {
    expect(
      PublishSchema.safeParse({ currentBatch: 2, batches: [{ batch: 1, gpuIds: ['a'], modelIds: ['b'] }] })
        .success,
    ).toBe(false);
    expect(PublishSchema.safeParse({ currentBatch: 0, batches: [] }).success).toBe(true);
    expect(PublishSchema.safeParse({ currentBatch: 1, batches: [] }).success).toBe(false);
    expect(
      PublishSchema.safeParse({ currentBatch: 0, batches: [{ batch: 1, gpuIds: ['a', 'a'], modelIds: ['b'] }] })
        .success,
    ).toBe(false);
    expect(
      PublishSchema.safeParse({ currentBatch: 0, batches: [{ batch: 0, gpuIds: ['a'], modelIds: ['b'] }] })
        .success,
    ).toBe(false);
  });

  it('validateAll catches unknown ids in batch lists', () => {
    const broken = {
      ...seed,
      publish: { currentBatch: 0, batches: [{ batch: 1, gpuIds: ['ghost-gpu'], modelIds: ['llama-3.1-8b'] }] },
    };
    expect(validateAll(broken).some((p) => p.includes('ghost-gpu'))).toBe(true);
  });
});
