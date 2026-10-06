/**
 * 계산기 모델 목록 정렬 (10-06 PROGRESS §4 D68, docs/01 F4) — 순수 함수. 카드의 기준 판정(배지와 같은 값)·표시 조건의 예상 속도·
 * 모델 데이터(총 파라미터·인기도·HF 다운로드 수)만 본다. 불러온·직접 입력한 고정 카드는 정렬 대상이 아니다(run.ts).
 */
import { compareCombos, verdictRank, type ComboAssessment, type ModelCore } from '@canrun/data/client';
import type { SortKey } from './state';

export type SortableCard = { model: ModelCore; combo: ComboAssessment };

type Compare = (a: SortableCard, b: SortableCard) => number;

const byId: Compare = (a, b) => a.model.id.localeCompare(b.model.id);
const rankOf = (c: SortableCard): number => verdictRank(c.combo.baseline.result.verdict);
/** 표시 조건 tok/s — 미탑재는 -1 (빠른 순과 같은 규칙: 맨 뒤) */
const speedOf = (c: SortableCard): number => (c.combo.display.fReason === 'no-fit' ? -1 : c.combo.display.result.tgTokS.est);

/**
 * 추천순 묶음: 0 = 쾌적·원활(S·A), 1 = 겨우 가능(B), 2 = 불가(F). UI 정책(엔진 상수 아님)
 */
// source: docs/01 F4 (policy)
function recGroup(c: SortableCard): number {
  const verdict = c.combo.baseline.result.verdict;
  if (verdict === 'S' || verdict === 'A') return 0;
  return verdict === 'B' ? 1 : 2;
}

/**
 * 추천순(기본): 원활 이상으로 돌아가는 모델 가운데 큰 모델(보통 더 똑똑하다)부터, 같은 크기면 인기 있는 모델.
 * 그다음 겨우 가능한 모델을 덜 느린 것부터, 마지막으로 못 돌리는 모델을 판정·속도 순 그대로
 */
const compareRec: Compare = (a, b) => {
  const group = recGroup(a);
  const diff = group - recGroup(b);
  if (diff !== 0) return diff;
  if (group === 0) return b.model.paramsB - a.model.paramsB || b.model.popularity - a.model.popularity || byId(a, b);
  if (group === 1) return speedOf(b) - speedOf(a) || byId(a, b);
  return compareCombos(a.combo, b.combo);
};

const COMPARE: Record<SortKey, Compare> = {
  rec: compareRec,
  // 인기순: CanRun 이 매긴 인기도(1~5) → 판정 → 빠른 것 → id
  popular: (a, b) => b.model.popularity - a.model.popularity || rankOf(b) - rankOf(a) || speedOf(b) - speedOf(a) || byId(a, b),
  // 다운로드 많은 순: HF 원본 저장소 최근 30일(값이 없는 모델은 뒤) → 판정 → id
  downloads: (a, b) => (b.model.hfDownloads30d ?? -1) - (a.model.hfDownloads30d ?? -1) || rankOf(b) - rankOf(a) || byId(a, b),
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
