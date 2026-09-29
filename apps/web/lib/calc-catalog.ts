/**
 * 계산기 아일랜드 props — 전체 시드에서 파생한 카탈로그 요약 (P1-3 D27). 서버 전용, 빌드 워커당 1회.
 */
import { toCatalogLite, type CatalogLite } from '@canrun/data';
import { catalog } from './catalog';

let cached: CatalogLite | undefined;

export function getCatalogLite(): CatalogLite {
  cached ??= toCatalogLite(catalog);
  return cached;
}
