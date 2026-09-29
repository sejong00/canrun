/**
 * 인덱싱 배치 게이트 — 데이터 레이어 판정을 웹 레이어 이름으로 재수출 (docs/04 §3, 결정 D9).
 * 페이지·허브 링크·(P1-5) 사이트맵이 같은 함수를 쓴다.
 */
import { comboLinkAllowed, comboPublishState, indexableCombos } from '@canrun/data';
import { catalog } from './catalog';

export function isComboIndexable(gpuId: string, modelId: string): boolean {
  return comboPublishState(catalog.publish, gpuId, modelId).indexable;
}

/** 이 페이지(공개 여부)에서 대상 콤보로 링크해도 되는가 */
export function canLinkCombo(fromIndexable: boolean, gpuId: string, modelId: string): boolean {
  return comboLinkAllowed(fromIndexable, isComboIndexable(gpuId, modelId));
}

/** 허브·홈은 공개 콤보로만 링크한다 */
export const INDEXABLE_COMBOS: ReadonlySet<string> = indexableCombos(catalog.publish);
