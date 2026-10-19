/**
 * 계산기 모델 목록 정렬 (10-06 PROGRESS §4 D68, docs/01 F4) — 순수 함수. 카드의 기준 판정(배지와 같은 값)·표시 조건의 예상 속도·
 * 모델 데이터(총 파라미터·인기도·HF 다운로드 수)만 본다. 불러온·직접 입력한 고정 카드는 정렬 대상이 아니다(run.ts).
 */
import { aMinTokS, compareCombos, verdictRank, type ComboAssessment, type ModelCore } from '@canrun/data/client';
import { SIZE_BUCKETS, sizeBucket, type SortKey } from './state';

export type SortableCard = { model: ModelCore; combo: ComboAssessment };

type Compare = (a: SortableCard, b: SortableCard) => number;

const byId: Compare = (a, b) => a.model.id.localeCompare(b.model.id);
const rankOf = (c: SortableCard): number => verdictRank(c.combo.baseline.result.verdict);
/** 표시 조건 tok/s — 미탑재는 -1 (빠른 순과 같은 규칙: 맨 뒤) */
const speedOf = (c: SortableCard): number => (c.combo.display.fReason === 'no-fit' ? -1 : c.combo.display.result.tgTokS.est);
/** 크기 구간 — 크기 필터와 같은 구간(10B 미만·10B~25B 미만·25B~50B 미만·50B 이상, MoE 는 총 파라미터). 클수록 큰 값 */
const sizeRankOf = (c: SortableCard): number => SIZE_BUCKETS.indexOf(sizeBucket(c.model.paramsB));
/** 못 돌리는(F) 모델은 1 — 인기순·다운로드 순도 돌릴 수 있는 모델을 먼저 둔다(10-06 D68 리뷰 반영) */
const unrunnable = (c: SortableCard): number => (c.combo.baseline.result.verdict === 'F' ? 1 : 0);

/**
 * 추천순 묶음 (UI 정책, 엔진 상수 아님): 0 = 쾌적·원활(S·A), 1 = 겨우 가능(B)이지만 속도는 원활 기준(8 tok/s, 리즈닝 ×1.5) 이상 —
 * CPU 전용·부분 오프로드 상한·MoE 전문가를 RAM 에 둔 경우, 2 = 그 밖의 겨우 가능, 3 = 불가(F).
 * 1 묶음이 없으면 CPU 전용(전부 B)에서 가장 빠른 1~2B 모델이 맨 위로 온다(리뷰 반영)
 */
// source: docs/01 F4 (policy)
function recGroup(c: SortableCard): number {
  const verdict = c.combo.baseline.result.verdict;
  if (verdict === 'S' || verdict === 'A') return 0;
  if (verdict === 'B') return speedOf(c) >= aMinTokS(c.combo.reasoning) ? 1 : 2;
  return 3;
}

/**
 * 크기 구간 큰 쪽 → 같은 구간이면 인기도 → 총 파라미터 → id. 구간으로 묶어야 인기도가 실제로 순서를 가른다
 * (총 파라미터를 바로 비교하면 거의 다 달라서 인기도가 쓰이지 않았다 — 리뷰 반영)
 */
// source: docs/01 F4 (policy)
const bySizeThenPopularity: Compare = (a, b) =>
  sizeRankOf(b) - sizeRankOf(a) || b.model.popularity - a.model.popularity || b.model.paramsB - a.model.paramsB || byId(a, b);

/**
 * 추천순(기본): 원활 이상으로 돌아가는 모델을 크기 구간이 큰 것부터(같은 구간이면 인기 있는 것), 그다음 겨우 가능하지만 속도는
 * 쓸 만한 모델을 같은 규칙으로, 그다음 나머지 겨우 가능을 빠른 것부터, 마지막으로 못 돌리는 모델을 판정·속도 순 그대로
 */
const compareRec: Compare = (a, b) => {
  const group = recGroup(a);
  const diff = group - recGroup(b);
  if (diff !== 0) return diff;
  if (group <= 1) return bySizeThenPopularity(a, b);
  if (group === 2) return speedOf(b) - speedOf(a) || byId(a, b);
  return compareCombos(a.combo, b.combo);
};

const COMPARE: Record<SortKey, Compare> = {
  rec: compareRec,
  // 인기순: 돌릴 수 있는 모델 먼저 → CanRun 이 매긴 인기도(1~5) → 판정 → 빠른 것 → id
  popular: (a, b) =>
    unrunnable(a) - unrunnable(b) || b.model.popularity - a.model.popularity || rankOf(b) - rankOf(a) || speedOf(b) - speedOf(a) || byId(a, b),
  // 다운로드 많은 순: 돌릴 수 있는 모델 먼저 → HF 원본 저장소 최근 30일(값이 없는 모델은 뒤) → 판정 → id
  downloads: (a, b) =>
    unrunnable(a) - unrunnable(b) || (b.model.hfDownloads30d ?? -1) - (a.model.hfDownloads30d ?? -1) || rankOf(b) - rankOf(a) || byId(a, b),
  // 판정·속도 순 (D68 이전의 기본 — 허브 표 순서와 같다)
  verdict: (a, b) => compareCombos(a.combo, b.combo),
  speed: (a, b) => speedOf(b) - speedOf(a) || byId(a, b),
  size: (a, b) => b.model.paramsB - a.model.paramsB || byId(a, b),
};

export function compareCards(key: SortKey): Compare {
  return COMPARE[key];
}

/** 새 배열로 정렬 */
export function sortCards<T extends SortableCard>(cards: readonly T[], key: SortKey): T[] {
  return [...cards].sort(compareCards(key));
}
