/**
 * 데이터 기준일 (P1-5, docs/01 §7) — `data/meta.json`. 빌드 시각이 아니라 데이터에서 온다(D21 결정론).
 * 서버 전용(zod). 푸터 표시와 사이트맵 lastmod(`scripts/build-sitemaps.ts`)가 같은 값을 쓴다.
 */
import { parseMeta } from '@canrun/data';
import metaJson from '../../../data/meta.json';

export const DATA_UPDATED: string = parseMeta(metaJson).dataUpdated;
