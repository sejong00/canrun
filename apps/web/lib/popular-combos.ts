/**
 * 홈 "많이 찾는 조합" (10-16 D95) — 공개(index) 콤보 몇 개로 바로 가는 링크. 서버 전용, 빌드 때 정한다(클라이언트 JS 0).
 *
 * 고르는 규칙(결정론 — 데이터의 판정이 바뀌어도 목록은 그대로):
 *  - GPU 순서 = 홈 "자주 찾는 GPU"(`HOME_QUICK_PICKS`) 순, 그다음 나머지 공개 GPU 는 `data/publish.json` 배치 순
 *  - 모델 순서 = `popularity` 높은 순, 같으면 `data/publish.json` 배치 순
 *  - i 번째 GPU 에 그 GPU 의 공개 모델 중 (i mod 개수) 번째 — GPU 는 한 번씩, 모델은 고르게 섞인다
 * 공개 콤보로만 링크한다(docs/04 §3 링크 규칙 — export 테스트가 홈도 검사). 공개 콤보가 없으면(currentBatch 0) 빈 목록.
 */
import type { Gpu, Model } from '@canrun/data';
import { catalog, findGpu, findModel } from './catalog';
import { isComboIndexable } from './publish';

/** 홈의 "자주 찾는 GPU" 칩 — 계산기 딥링크 (D25). 많이 찾는 조합의 GPU 순서도 이 순서를 따른다. UI 정책(엔진 상수 아님) */
// source: docs/04 §2 (policy)
export const HOME_QUICK_PICKS = [
  'rtx-4060',
  'rtx-3060-12gb',
  'rtx-5060-ti-16gb',
  'rtx-4090',
  'apple-m4',
  'apple-m4-pro',
  'amd-strix-halo',
  'rtx-4060-laptop',
] as const;

/** 홈에 싣는 조합 수 (6~10 — 목록이 길면 홈이 링크 모음이 된다) */
// source: docs/04 §2 (policy)
export const POPULAR_COMBO_COUNT = 8;

export type PopularCombo = { gpu: Gpu; model: Model };

/** 열린 배치(batch ≤ currentBatch)의 GPU·모델 id — 배치 순, 처음 나온 자리 */
function openIds(key: 'gpuIds' | 'modelIds'): string[] {
  const { publish } = catalog;
  const ids = publish.batches
    .filter((b) => b.batch <= publish.currentBatch)
    .sort((a, b) => a.batch - b.batch)
    .flatMap((b) => b[key]);
  return [...new Set(ids)];
}

export function popularCombos(count = POPULAR_COMBO_COUNT): PopularCombo[] {
  const gpuIds = openIds('gpuIds');
  const quick: readonly string[] = HOME_QUICK_PICKS;
  const gpus = [...quick.filter((id) => gpuIds.includes(id)), ...gpuIds.filter((id) => !quick.includes(id))]
    .map((id) => findGpu(id))
    .filter((gpu): gpu is Gpu => gpu !== undefined);
  const modelIds = openIds('modelIds');
  const models = modelIds
    .map((id) => findModel(id))
    .filter((model): model is Model => model !== undefined)
    .sort((a, b) => b.popularity - a.popularity || modelIds.indexOf(a.id) - modelIds.indexOf(b.id));
  return gpus.slice(0, count).flatMap((gpu, i): PopularCombo[] => {
    const options = models.filter((model) => isComboIndexable(gpu.id, model.id));
    const model = options[i % Math.max(1, options.length)];
    return model ? [{ gpu, model }] : [];
  });
}
