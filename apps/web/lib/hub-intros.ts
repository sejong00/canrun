import type { ComponentType } from 'react';
import { GPU_INTRO_IDS, MODEL_INTRO_IDS, type GpuIntroId, type HubIntroKind, type ModelIntroId } from '@/content/hubs';
import type { Locale } from '@/i18n/routing';

/**
 * 허브 소개글 로더 (10-14 D74) — 가이드(`lib/guides.ts`)와 같은 **명시적** 맵(템플릿 import 금지, D38: Turbopack 이 패턴으로 풀어
 * 떠돌이 .mdx 까지 컴파일하고 타입이 흐려진다). 레지스트리(`content/hubs.ts`)에 없는 허브는 undefined — 소개 없이 그대로 렌더한다.
 */
export type HubIntroBody = ComponentType<{ components?: object }>;
type IntroModule = { default: HubIntroBody };
type Loaders<Id extends string> = Readonly<Record<Id, Readonly<Record<Locale, () => Promise<IntroModule>>>>>;

const GPU_LOADERS: Loaders<GpuIntroId> = {
  'rtx-4060': {
    en: () => import('@/content/en/hubs/gpu/rtx-4060.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/rtx-4060.mdx') as Promise<IntroModule>,
  },
  'rtx-3060-12gb': {
    en: () => import('@/content/en/hubs/gpu/rtx-3060-12gb.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/rtx-3060-12gb.mdx') as Promise<IntroModule>,
  },
  'rtx-4070': {
    en: () => import('@/content/en/hubs/gpu/rtx-4070.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/rtx-4070.mdx') as Promise<IntroModule>,
  },
  'rtx-5070': {
    en: () => import('@/content/en/hubs/gpu/rtx-5070.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/rtx-5070.mdx') as Promise<IntroModule>,
  },
  'rtx-5060-ti-16gb': {
    en: () => import('@/content/en/hubs/gpu/rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
  },
  'rtx-4090': {
    en: () => import('@/content/en/hubs/gpu/rtx-4090.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/rtx-4090.mdx') as Promise<IntroModule>,
  },
  'rtx-3090': {
    en: () => import('@/content/en/hubs/gpu/rtx-3090.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/rtx-3090.mdx') as Promise<IntroModule>,
  },
  'rtx-5090': {
    en: () => import('@/content/en/hubs/gpu/rtx-5090.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/rtx-5090.mdx') as Promise<IntroModule>,
  },
  'apple-m4': {
    en: () => import('@/content/en/hubs/gpu/apple-m4.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/apple-m4.mdx') as Promise<IntroModule>,
  },
  'apple-m4-pro': {
    en: () => import('@/content/en/hubs/gpu/apple-m4-pro.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/gpu/apple-m4-pro.mdx') as Promise<IntroModule>,
  },
};

const MODEL_LOADERS: Loaders<ModelIntroId> = {
  'llama-3.1-8b': {
    en: () => import('@/content/en/hubs/model/llama-3.1-8b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/llama-3.1-8b.mdx') as Promise<IntroModule>,
  },
  'qwen3-8b': {
    en: () => import('@/content/en/hubs/model/qwen3-8b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/qwen3-8b.mdx') as Promise<IntroModule>,
  },
  'qwen3-14b': {
    en: () => import('@/content/en/hubs/model/qwen3-14b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/qwen3-14b.mdx') as Promise<IntroModule>,
  },
  'qwen3-30b-a3b-2507': {
    en: () => import('@/content/en/hubs/model/qwen3-30b-a3b-2507.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/qwen3-30b-a3b-2507.mdx') as Promise<IntroModule>,
  },
  'qwen3.5-35b-a3b': {
    en: () => import('@/content/en/hubs/model/qwen3.5-35b-a3b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/qwen3.5-35b-a3b.mdx') as Promise<IntroModule>,
  },
  'qwen3.8-27b': {
    en: () => import('@/content/en/hubs/model/qwen3.8-27b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/qwen3.8-27b.mdx') as Promise<IntroModule>,
  },
  'gpt-oss-20b': {
    en: () => import('@/content/en/hubs/model/gpt-oss-20b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/gpt-oss-20b.mdx') as Promise<IntroModule>,
  },
  'gpt-oss-120b': {
    en: () => import('@/content/en/hubs/model/gpt-oss-120b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/gpt-oss-120b.mdx') as Promise<IntroModule>,
  },
  'gemma-4-31b': {
    en: () => import('@/content/en/hubs/model/gemma-4-31b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/gemma-4-31b.mdx') as Promise<IntroModule>,
  },
  'gemma-4-26b-a4b': {
    en: () => import('@/content/en/hubs/model/gemma-4-26b-a4b.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/hubs/model/gemma-4-26b-a4b.mdx') as Promise<IntroModule>,
  },
};

export function hasHubIntro(kind: HubIntroKind, id: string): boolean {
  return ((kind === 'gpu' ? GPU_INTRO_IDS : MODEL_INTRO_IDS) as readonly string[]).includes(id);
}

export async function loadHubIntro(kind: HubIntroKind, id: string, locale: Locale): Promise<HubIntroBody | undefined> {
  if (!hasHubIntro(kind, id)) return undefined;
  const loader = kind === 'gpu' ? GPU_LOADERS[id as GpuIntroId] : MODEL_LOADERS[id as ModelIntroId];
  return (await loader[locale]()).default;
}
