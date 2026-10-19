/**
 * GPU 비교 페이지 조회 (10-19 D103) — 레지스트리(`content/compares.ts`) 슬러그 → 두 허브 요약(`getGpuHub` 캐시)을 맞댄 `compareGpus` 결과.
 * 빌드 워커 프로세스 단위 메모(정적 export 전용 — `lib/hubs.ts` 와 같다). 서버 전용.
 * 이름·속도 판정 등 문장 조립은 `lib/compare-phrases.ts` 한 곳에 있다(공유 카드 스크립트·유닛 테스트도 같은 함수를 쓴다).
 */
import { compareGpus, type GpuComparison } from '@canrun/data';
import { COMPARES, isCompareSlug, isComparePublished, publishedCompares, type CompareEntry, type CompareSlug } from '@/content/compares';
import type { Locale } from '@/i18n/routing';
import { getGpuHub } from './hubs';
import { compareOgImage, defaultOgImage } from './og-images';

export type ComparePage = { slug: CompareSlug; entry: CompareEntry; cmp: GpuComparison };

const pages = new Map<CompareSlug, ComparePage>();

export function getCompare(slug: string): ComparePage | undefined {
  if (!isCompareSlug(slug)) return undefined;
  const cached = pages.get(slug);
  if (cached) return cached;
  const entry = COMPARES[slug];
  const a = getGpuHub(entry.a);
  const b = getGpuHub(entry.b);
  if (!a || !b) throw new Error(`compare ${slug}: unknown GPU ${a ? entry.b : entry.a}`);
  const page = { slug, entry, cmp: compareGpus(a, b) };
  pages.set(slug, page);
  return page;
}

/** GPU 허브 "다른 기기와 비교" — 이 GPU 가 든 **게시** 쌍만(초안은 링크하지 않는다 — D40 과 같은 규칙), 레지스트리 순서 */
export function compareLinksForGpu(gpuId: string): Array<{ slug: CompareSlug; otherId: string }> {
  return publishedCompares()
    .filter((slug) => COMPARES[slug].a === gpuId || COMPARES[slug].b === gpuId)
    .map((slug) => ({ slug, otherId: COMPARES[slug].a === gpuId ? COMPARES[slug].b : COMPARES[slug].a }));
}

/** 공유 카드 경로 — 게시 쌍은 쌍마다 카드(postbuild 가 그린다), 초안은 기본 카드 */
export function compareOgImagePath(slug: CompareSlug, locale: Locale): string {
  return isComparePublished(slug) ? compareOgImage(slug, locale) : defaultOgImage(locale);
}
