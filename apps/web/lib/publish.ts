/**
 * 인덱싱 배치 게이트 — 데이터 레이어 판정을 웹 레이어 이름으로 재수출 (docs/04 §3, 결정 D9).
 * 페이지·허브 링크·(P1-5) 사이트맵이 같은 함수를 쓴다.
 * 11-02 D130: 정적 조합 페이지는 색인 쌍 × 조합 로캘(en·ko)만 만든다 — 나머지 조합은 계산기로 본다.
 */
import { comboLinkAllowed, comboPublishState, indexableCombos } from '@canrun/data';
import { hasComboPages } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';
import { calcDeepQuery } from './calc-catalog';
import { catalog } from './catalog';
import { calculatorHref, comboHref, localeHref } from './links';

export function isComboIndexable(gpuId: string, modelId: string): boolean {
  return comboPublishState(catalog.publish, gpuId, modelId).indexable;
}

/** 이 페이지(공개 여부)에서 대상 콤보로 링크해도 되는가 */
export function canLinkCombo(fromIndexable: boolean, gpuId: string, modelId: string): boolean {
  return comboLinkAllowed(fromIndexable, isComboIndexable(gpuId, modelId));
}

/** 허브·홈은 공개 콤보로만 링크한다 */
export const INDEXABLE_COMBOS: ReadonlySet<string> = indexableCombos(catalog.publish);

/** 이 로캘에 그 조합의 정적 페이지가 있는가 (D130) — 색인 쌍이고 조합 로캘(zh 아님)일 때만 */
export function hasComboPage(locale: Locale, gpuId: string, modelId: string): boolean {
  return hasComboPages(locale) && isComboIndexable(gpuId, modelId);
}

/** 계산기 딥 링크 — 이 GPU·모델을 미리 채운 계산기(로캘 경로 포함). 조합 페이지가 없는 쌍이 가는 곳 (D130) */
export function comboCalcHref(locale: Locale, modelId: string, gpuId: string, ramGB?: number): string {
  return localeHref(locale, calculatorHref(calcDeepQuery({ gpuId, modelId, ...(ramGB !== undefined ? { ramGB } : {}) })));
}

/**
 * 공개 페이지의 조합 판정 링크 대상 (D130) — 색인 쌍이 아니면 링크 없음(D9 그대로), 색인 쌍이면 이 로캘의 조합 페이지,
 * 그 로캘에 조합 페이지가 없으면(zh) 같은 GPU·모델을 미리 채운 계산기. `page` 로 마커(`data-combo-link`/`data-calc-link`)를 고른다
 */
export function comboLinkTarget(locale: Locale, modelId: string, gpuId: string): { href: string; page: boolean } | undefined {
  if (!isComboIndexable(gpuId, modelId)) return undefined;
  return hasComboPages(locale)
    ? { href: localeHref(locale, comboHref(modelId, gpuId)), page: true }
    : { href: comboCalcHref(locale, modelId, gpuId), page: false };
}

/** 계산기 아일랜드에 넘기는 조합 페이지 목록(`gpu/model` 키) — 결과 카드의 '상세' 링크는 페이지가 있을 때만 (D130). zh 는 빈 목록 */
export function comboPageKeys(locale: Locale): string[] {
  return hasComboPages(locale) ? [...INDEXABLE_COMBOS].sort() : [];
}

/** 허브 표 `ComboCells` 의 판정 링크 (D130) — `comboLinkTarget` 에 링크 텍스트를 붙인다. 계산기로 가면 `calc` */
export function comboCellLink(
  locale: Locale,
  modelId: string,
  gpuId: string,
  text: string,
): { href: string; text: string; calc?: boolean } | undefined {
  const target = comboLinkTarget(locale, modelId, gpuId);
  if (!target) return undefined;
  return target.page ? { href: target.href, text } : { href: target.href, text, calc: true };
}
