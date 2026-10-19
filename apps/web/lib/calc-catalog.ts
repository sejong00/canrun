/**
 * 계산기 아일랜드 props — 전체 시드에서 파생한 카탈로그 요약 (P1-3 D27). 서버 전용, 빌드 워커당 1회.
 */
import { toCatalogLite, type CatalogLite, type GpuCore } from '@canrun/data';
import { defaultState, type CalcState } from './calc/state';
import { serializeCalcQuery } from './calc/url';
import { catalog } from './catalog';

let cached: CatalogLite | undefined;

export function getCatalogLite(): CatalogLite {
  cached ??= toCatalogLite(catalog);
  return cached;
}

let pickerCached: GpuCore[] | undefined;
const PRICE_KEYS = new Set<string>(['streetUSD', 'priceAsOf', 'msrpUSD'] satisfies (keyof GpuCore)[]);

/**
 * 홈·가이드 GPU 선택기(`CalcWidget` → `GpuPicker`) props — 가격 필드(`streetUSD`·`priceAsOf`·`msrpUSD`)를 뺀다.
 * 선택기는 가격을 쓰지 않는데 props 는 페이지마다 HTML 에 실린다. 출시가를 보내는 D27 예외(D65)는 계산기에만 (리뷰 반영)
 */
export function getPickerGpus(): GpuCore[] {
  pickerCached ??= getCatalogLite().gpus.map(
    (gpu) => Object.fromEntries(Object.entries(gpu).filter(([key]) => !PRICE_KEYS.has(key))) as GpuCore,
  );
  return pickerCached;
}

/**
 * 상세 페이지 → 계산기 딥 링크의 쿼리 (10-19 D107) — 계산기 공유 URL 코덱(`serializeCalcQuery`)으로 만들어 계산기가 그대로 읽고 기본값은 생략된다.
 * `ramGB` 는 그 페이지가 가정한 구성(통합·CPU 의 메모리, dGPU 의 시스템 RAM) — 같은 판정이 열리게. `modelId` 는 강조할 모델(`m`)
 */
export function calcDeepQuery(input: { gpuId: string; modelId?: string; ramGB?: number }): string {
  const state: CalcState = { ...defaultState(), hardware: { kind: 'catalog', gpuId: input.gpuId } };
  if (input.ramGB !== undefined) state.ramGB = input.ramGB;
  if (input.modelId !== undefined) state.focus = input.modelId;
  return serializeCalcQuery(state, getCatalogLite());
}
