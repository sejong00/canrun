/**
 * 인덱싱 배치 게이트 — `data/publish.json` 해석 (docs/04 §3, P1-2 결정 D9).
 *
 * 콤보 페이지는 카탈로그 전 조합을 생성하되, 배치에 든 조합만 index 한다:
 *  - 콤보의 배치 = gpuIds 와 modelIds 가 **둘 다** 그 쌍을 포함하는 항목들의 최소 batch
 *    (GPU 배치·모델 배치의 min 이 아니다 — 4060 이 배치 1 이고 qwen3-14b 가 배치 2 에만 있으면 배치 2)
 *  - indexable ⇔ batch 가 정해져 있고 batch ≤ currentBatch
 *  - 링크 규칙: 공개 페이지(허브·홈·공개 콤보)는 공개 콤보로만 링크, 미공개 콤보는 아무 콤보로나
 * 순수 함수 — 페이지·테스트·P1-5 사이트맵이 같은 판정을 공유한다.
 */

import type { PublishPlan } from './schema';

export const comboKey = (gpuId: string, modelId: string): string => `${gpuId}/${modelId}`;

export function comboBatch(plan: PublishPlan, gpuId: string, modelId: string): number | undefined {
  let best: number | undefined;
  for (const entry of plan.batches) {
    if (!entry.gpuIds.includes(gpuId) || !entry.modelIds.includes(modelId)) continue;
    if (best === undefined || entry.batch < best) best = entry.batch;
  }
  return best;
}

export type ComboPublishState = { batch?: number; indexable: boolean };

export function comboPublishState(
  plan: PublishPlan,
  gpuId: string,
  modelId: string,
): ComboPublishState {
  const batch = comboBatch(plan, gpuId, modelId);
  return {
    ...(batch !== undefined ? { batch } : {}),
    indexable: batch !== undefined && batch <= plan.currentBatch,
  };
}

/** 현재 index 가능한 콤보 집합 (`gpu/model` 키) — 허브 링크·인접 후보 풀·사이트맵용. */
export function indexableCombos(plan: PublishPlan): ReadonlySet<string> {
  const set = new Set<string>();
  for (const entry of plan.batches) {
    if (entry.batch > plan.currentBatch) continue;
    for (const gpuId of entry.gpuIds) {
      for (const modelId of entry.modelIds) set.add(comboKey(gpuId, modelId));
    }
  }
  return set;
}

/** 공개 페이지는 공개 콤보로만 링크한다 (미공개 섬으로 크롤을 보내지 않음). */
export function comboLinkAllowed(fromIndexable: boolean, toIndexable: boolean): boolean {
  return !fromIndexable || toIndexable;
}
