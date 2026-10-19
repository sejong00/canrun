/**
 * GPU 비교 페이지 조회 (10-19 D103) — 레지스트리(`content/compares.ts`) 슬러그 → 두 허브 요약(`getGpuHub` 캐시)을 맞댄 `compareGpus` 결과.
 * 빌드 워커 프로세스 단위 메모(정적 export 전용 — `lib/hubs.ts` 와 같다). 서버 전용.
 */
import { compareGpus, type CompareSide, type GpuComparison } from '@canrun/data';
import { COMPARES, isCompareSlug, isComparePublished, publishedCompares, type CompareEntry, type CompareSlug } from '@/content/compares';
import type { Locale } from '@/i18n/routing';
import { formatInt } from './format';
import { getGpuHub } from './hubs';
import { compareOgImage, defaultOgImage } from './og-images';
import { gpuName, shortGpuName, type Translate } from './phrases';

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

type NamesT = Translate & { has?: (key: string) => boolean };

/**
 * 비교 페이지의 기기 이름 — 그래픽카드는 짧은 이름("RTX 5060 Ti 16GB" — 콤보 제목과 같은 `shortGpuName`),
 * 통합 메모리·CPU 는 전체 이름 + 비교 구성 메모리("Apple M4 Pro 64 GB" — 수치가 그 구성 하나의 것이다). `tCompare` = Compare 네임스페이스
 */
export function compareName(tNames: NamesT, tCompare: Translate, locale: Locale, side: CompareSide): string {
  const name = gpuName(tNames, side.gpu);
  if (side.memoryGB === undefined) return shortGpuName(name);
  return tCompare('nameMemory', { name, ram: formatInt(locale, side.memoryGB) });
}

/**
 * 메모리를 함께 밝힌 이름 — 설명·목차 카드용. 그래픽카드는 이름에 VRAM 이 없으면 붙인다("RTX 5070 (12 GB VRAM)"),
 * 통합 메모리·CPU 는 이름에 이미 메모리가 있다
 */
export function compareNameWithMemory(tNames: NamesT, tCompare: Translate, locale: Locale, side: CompareSide): string {
  const name = compareName(tNames, tCompare, locale, side);
  const vram = side.gpu.vramGB;
  if (side.memoryGB !== undefined || vram === undefined || new RegExp(`\\b${vram}GB\\b`).test(name)) return name;
  return tCompare('nameVram', { name, vram: formatInt(locale, vram) });
}

/** 한쪽이라도 그래픽카드가 아니면 제목이 "VRAM" 대신 "메모리"를 쓴다 */
export const isUnifiedPair = (cmp: GpuComparison) => cmp.a.gpu.kind !== 'dgpu' || cmp.b.gpu.kind !== 'dgpu';

/** 이 비율 안이면 "거의 같은 속도" — 표시 정책(엔진 상수 아님, 10-19 D103). 추정 밴드(±12% 이상)보다 훨씬 좁다 */
export const SAME_SPEED = { min: 0.95, max: 1.05 } as const;

export type SpeedVerdict =
  | { kind: 'same' }
  | { kind: 'faster'; faster: 'a' | 'b'; factor: number };

/** 속도 비율(b ÷ a) → 어느 쪽이 몇 배 빠른가 */
export function speedVerdict(ratio: number): SpeedVerdict {
  if (ratio >= SAME_SPEED.min && ratio <= SAME_SPEED.max) return { kind: 'same' };
  return ratio > 1 ? { kind: 'faster', faster: 'b', factor: ratio } : { kind: 'faster', faster: 'a', factor: 1 / ratio };
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
