import type { ComponentType } from 'react';
import { GUIDES, GUIDE_SLUGS, type GuideEntry, type GuideGrid, type GuideLocale, type GuideSlug } from '@/content/guides';
import type { Locale } from '@/i18n/routing';
import { findGpu, findModel } from './catalog';
import { defaultOgImage, guideOgImage } from './og-images';

/**
 * 가이드 로더 맵·조회 (D38·D40·D44). 로더는 **명시적**이다 — 템플릿 문자열 import 는 Turbopack 이 패턴으로 풀어 떠돌이
 * .mdx 까지 컴파일하고 타입이 `any` 가 된다. 로캘 누락은 타입 오류, 파일 누락은 빌드 오류.
 * (`@types/mdx` 는 React 19 에서 사라진 전역 `JSX` 를 참조해 타입이 흐려지므로 모듈 타입을 여기서 명시한다)
 */
export type GuideBody = ComponentType<{ components?: object }>;
type GuideModule = { default: GuideBody };

// 레지스트리의 로캘 타입과 라우팅 로캘이 같아야 한다 — 어긋나면 이 줄이 타입 오류
const LOCALES_MATCH: [GuideLocale, Locale] extends [Locale, GuideLocale] ? true : never = true;
void LOCALES_MATCH;

const LOADERS: Readonly<Record<GuideSlug, Readonly<Record<Locale, () => Promise<GuideModule>>>>> = {
  'vram-requirements': {
    en: () => import('@/content/en/guides/vram-requirements.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/vram-requirements.mdx') as Promise<GuideModule>,
  },
  'ollama-context-length': {
    en: () => import('@/content/en/guides/ollama-context-length.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/ollama-context-length.mdx') as Promise<GuideModule>,
  },
  'gguf-quantization': {
    en: () => import('@/content/en/guides/gguf-quantization.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/gguf-quantization.mdx') as Promise<GuideModule>,
  },
  'korean-open-llms': {
    en: () => import('@/content/en/guides/korean-open-llms.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/korean-open-llms.mdx') as Promise<GuideModule>,
  },
  'mac-local-llm': {
    en: () => import('@/content/en/guides/mac-local-llm.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/mac-local-llm.mdx') as Promise<GuideModule>,
  },
  'kv-cache-context': {
    en: () => import('@/content/en/guides/kv-cache-context.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/kv-cache-context.mdx') as Promise<GuideModule>,
  },
  'gpu-by-budget': {
    en: () => import('@/content/en/guides/gpu-by-budget.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/gpu-by-budget.mdx') as Promise<GuideModule>,
  },
  'moe-cpu-offload': {
    en: () => import('@/content/en/guides/moe-cpu-offload.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/moe-cpu-offload.mdx') as Promise<GuideModule>,
  },
  'local-coding-agents': {
    en: () => import('@/content/en/guides/local-coding-agents.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/local-coding-agents.mdx') as Promise<GuideModule>,
  },
  'gpu-offload-check': {
    en: () => import('@/content/en/guides/gpu-offload-check.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/gpu-offload-check.mdx') as Promise<GuideModule>,
  },
  'unified-memory-128gb': {
    en: () => import('@/content/en/guides/unified-memory-128gb.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/unified-memory-128gb.mdx') as Promise<GuideModule>,
  },
  'ollama-vs-llama-cpp-lm-studio': {
    en: () => import('@/content/en/guides/ollama-vs-llama-cpp-lm-studio.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/ollama-vs-llama-cpp-lm-studio.mdx') as Promise<GuideModule>,
  },
  'thinking-models': {
    en: () => import('@/content/en/guides/thinking-models.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/thinking-models.mdx') as Promise<GuideModule>,
  },
  'tokens-per-second': {
    en: () => import('@/content/en/guides/tokens-per-second.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/tokens-per-second.mdx') as Promise<GuideModule>,
  },
  'amd-intel-gpus': {
    en: () => import('@/content/en/guides/amd-intel-gpus.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/amd-intel-gpus.mdx') as Promise<GuideModule>,
  },
  'laptop-gpu-llm': {
    en: () => import('@/content/en/guides/laptop-gpu-llm.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/laptop-gpu-llm.mdx') as Promise<GuideModule>,
  },
  'multi-gpu': {
    en: () => import('@/content/en/guides/multi-gpu.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/multi-gpu.mdx') as Promise<GuideModule>,
  },
  'cpu-only-llm': {
    en: () => import('@/content/en/guides/cpu-only-llm.mdx') as Promise<GuideModule>,
    ko: () => import('@/content/ko/guides/cpu-only-llm.mdx') as Promise<GuideModule>,
  },
};

export function isGuideSlug(slug: string): slug is GuideSlug {
  return (GUIDE_SLUGS as readonly string[]).includes(slug);
}

export function guideEntry(slug: GuideSlug): GuideEntry {
  return GUIDES[slug];
}

export function isPublished(slug: GuideSlug): boolean {
  return GUIDES[slug].status === 'published';
}

/** published 가이드 (레지스트리 순서 = 우선순위) — 목차·내비·관련 링크는 이것만 쓴다 (D40) */
export function publishedGuides(): GuideSlug[] {
  return GUIDE_SLUGS.filter(isPublished);
}

/** 공유 카드 경로 — 게시 가이드는 가이드별 카드(10-16 D96, postbuild 가 그린다), 초안은 기본 카드. og:image 와 Article.image 가 같이 쓴다 */
export function guideOgImagePath(slug: GuideSlug, locale: Locale): string {
  return isPublished(slug) ? guideOgImage(slug, locale) : defaultOgImage(locale);
}

export async function loadGuideBody(slug: GuideSlug, locale: Locale): Promise<GuideBody> {
  return (await LOADERS[slug][locale]()).default;
}

/**
 * 그리드 조회 + 카탈로그 검증 — 그리드 키는 **전 가이드에서 유일**(유닛 테스트가 강제)이라 슬러그 없이 찾는다
 * (MDX 컴포넌트는 모듈 수준 서버 컴포넌트라 슬러그를 모른다). 모르는 키·id 는 빌드 실패 — 오타가 조용히 빈 표가 되지 않게
 */
export function findGuideGrid(key: string): GuideGrid {
  const owners = GUIDE_SLUGS.filter((slug) => key in GUIDES[slug].grids);
  if (owners.length !== 1) throw new Error(`guide grid "${key}": ${owners.length === 0 ? 'unknown' : `defined in ${owners.join(', ')}`}`);
  const grid = GUIDES[owners[0]!].grids[key]!;
  for (const id of grid.gpus) if (!findGpu(id)) throw new Error(`guide grid ${key}: unknown gpu "${id}"`);
  for (const id of grid.models) if (!findModel(id)) throw new Error(`guide grid ${key}: unknown model "${id}"`);
  return grid;
}

/** 이 콤보를 그리드로 다루는 **published** 가이드 (레지스트리 순서상 첫 번째) — 콤보 페이지 "관련 가이드" 링크 (D44) */
export function relatedGuideFor(gpuId: string, modelId: string): GuideSlug | undefined {
  return publishedGuides().find((slug) =>
    Object.values(GUIDES[slug].grids).some((g) => g.gpus.includes(gpuId) && g.models.includes(modelId)),
  );
}

/** 날짜 표시 — UTC 고정 (D21: 빌드 머신 시간대와 무관하게 같은 HTML) */
export function formatGuideDate(locale: Locale, isoDate: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** 날짜 범위 — 겹치는 연·월은 한 번만("October 14 – 16, 2026", "2026년 10월 14일~16일"). 같은 날이면 날짜 하나 */
export function formatGuideDateRange(locale: Locale, from: string, to: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).formatRange(
    new Date(`${from}T00:00:00Z`),
    new Date(`${to}T00:00:00Z`),
  );
}
