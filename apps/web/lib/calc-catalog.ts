/**
 * 계산기 아일랜드 props — 전체 시드에서 파생한 카탈로그 요약 (P1-3 D27). 서버 전용, 빌드 워커당 1회.
 */
import { toCatalogLite, type CatalogLite, type GpuCore } from '@canrun/data';
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
