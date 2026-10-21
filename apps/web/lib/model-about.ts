import type { ComponentType } from 'react';
import { hasModelAbout, type ModelAboutId } from '@/content/model-about';
import { isContentLocale, type ContentLocale } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';

/**
 * 모델 소개 로더 (10-19 D102) — 허브 소개글(`lib/hub-intros.ts`)과 같은 **명시적** 맵(템플릿 import 금지, D38: Turbopack 이 패턴으로 풀어
 * 떠돌이 .mdx 까지 컴파일하고 타입이 흐려진다). 키는 레지스트리(`content/model-about.ts`)와 같아야 한다 — 타입이 강제하고,
 * 키와 import 경로의 짝은 유닛 테스트(`test/model-about.test.ts`)가 본다. 레지스트리에 없는 모델은 undefined — 소개 없이 그대로 렌더한다.
 */
export type ModelAboutBody = ComponentType<{ components?: object }>;
type AboutModule = { default: ModelAboutBody };

const LOADERS: Readonly<Record<ModelAboutId, Readonly<Record<ContentLocale, () => Promise<AboutModule>>>>> = {
  'deepseek-r1-0528-qwen3-8b': {
    en: () => import('@/content/en/model-about/deepseek-r1-0528-qwen3-8b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/deepseek-r1-0528-qwen3-8b.mdx') as Promise<AboutModule>,
  },
  'deepseek-r1-distill-14b': {
    en: () => import('@/content/en/model-about/deepseek-r1-distill-14b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/deepseek-r1-distill-14b.mdx') as Promise<AboutModule>,
  },
  'deepseek-r1-distill-32b': {
    en: () => import('@/content/en/model-about/deepseek-r1-distill-32b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/deepseek-r1-distill-32b.mdx') as Promise<AboutModule>,
  },
  'deepseek-r1-distill-8b': {
    en: () => import('@/content/en/model-about/deepseek-r1-distill-8b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/deepseek-r1-distill-8b.mdx') as Promise<AboutModule>,
  },
  'exaone-4.0-1.2b': {
    en: () => import('@/content/en/model-about/exaone-4.0-1.2b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/exaone-4.0-1.2b.mdx') as Promise<AboutModule>,
  },
  'exaone-4.0-32b': {
    en: () => import('@/content/en/model-about/exaone-4.0-32b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/exaone-4.0-32b.mdx') as Promise<AboutModule>,
  },
  'exaone-4.5-33b': {
    en: () => import('@/content/en/model-about/exaone-4.5-33b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/exaone-4.5-33b.mdx') as Promise<AboutModule>,
  },
  'gemma-3-12b': {
    en: () => import('@/content/en/model-about/gemma-3-12b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gemma-3-12b.mdx') as Promise<AboutModule>,
  },
  'gemma-3-27b': {
    en: () => import('@/content/en/model-about/gemma-3-27b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gemma-3-27b.mdx') as Promise<AboutModule>,
  },
  'gemma-4-12b': {
    en: () => import('@/content/en/model-about/gemma-4-12b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gemma-4-12b.mdx') as Promise<AboutModule>,
  },
  'gemma-4-26b-a4b': {
    en: () => import('@/content/en/model-about/gemma-4-26b-a4b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gemma-4-26b-a4b.mdx') as Promise<AboutModule>,
  },
  'gemma-4-31b': {
    en: () => import('@/content/en/model-about/gemma-4-31b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gemma-4-31b.mdx') as Promise<AboutModule>,
  },
  'gemma-4-e2b': {
    en: () => import('@/content/en/model-about/gemma-4-e2b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gemma-4-e2b.mdx') as Promise<AboutModule>,
  },
  'gemma-4-e4b': {
    en: () => import('@/content/en/model-about/gemma-4-e4b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gemma-4-e4b.mdx') as Promise<AboutModule>,
  },
  'gpt-oss-120b': {
    en: () => import('@/content/en/model-about/gpt-oss-120b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gpt-oss-120b.mdx') as Promise<AboutModule>,
  },
  'gpt-oss-20b': {
    en: () => import('@/content/en/model-about/gpt-oss-20b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/gpt-oss-20b.mdx') as Promise<AboutModule>,
  },
  'granite-4.2-30b': {
    en: () => import('@/content/en/model-about/granite-4.2-30b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/granite-4.2-30b.mdx') as Promise<AboutModule>,
  },
  'hyperclovax-seed-1.5b': {
    en: () => import('@/content/en/model-about/hyperclovax-seed-1.5b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/hyperclovax-seed-1.5b.mdx') as Promise<AboutModule>,
  },
  'hyperclovax-seed-think-14b': {
    en: () => import('@/content/en/model-about/hyperclovax-seed-think-14b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/hyperclovax-seed-think-14b.mdx') as Promise<AboutModule>,
  },
  'kanana-1.5-15.7b-a3b': {
    en: () => import('@/content/en/model-about/kanana-1.5-15.7b-a3b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/kanana-1.5-15.7b-a3b.mdx') as Promise<AboutModule>,
  },
  'kanana-1.5-8b': {
    en: () => import('@/content/en/model-about/kanana-1.5-8b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/kanana-1.5-8b.mdx') as Promise<AboutModule>,
  },
  'kolibri-1': {
    en: () => import('@/content/en/model-about/kolibri-1.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/kolibri-1.mdx') as Promise<AboutModule>,
  },
  'laguna-s-2.1': {
    en: () => import('@/content/en/model-about/laguna-s-2.1.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/laguna-s-2.1.mdx') as Promise<AboutModule>,
  },
  'lfm2.5-2.6b': {
    en: () => import('@/content/en/model-about/lfm2.5-2.6b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/lfm2.5-2.6b.mdx') as Promise<AboutModule>,
  },
  'ling-3.0-flash': {
    en: () => import('@/content/en/model-about/ling-3.0-flash.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/ling-3.0-flash.mdx') as Promise<AboutModule>,
  },
  'ling-3.0-tiny': {
    en: () => import('@/content/en/model-about/ling-3.0-tiny.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/ling-3.0-tiny.mdx') as Promise<AboutModule>,
  },
  'llama-3.1-8b': {
    en: () => import('@/content/en/model-about/llama-3.1-8b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/llama-3.1-8b.mdx') as Promise<AboutModule>,
  },
  'llama-3.2-1b': {
    en: () => import('@/content/en/model-about/llama-3.2-1b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/llama-3.2-1b.mdx') as Promise<AboutModule>,
  },
  'llama-3.2-3b': {
    en: () => import('@/content/en/model-about/llama-3.2-3b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/llama-3.2-3b.mdx') as Promise<AboutModule>,
  },
  'llama-3.3-70b': {
    en: () => import('@/content/en/model-about/llama-3.3-70b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/llama-3.3-70b.mdx') as Promise<AboutModule>,
  },
  'mellum2.1-12b-a2.5b-thinking': {
    en: () => import('@/content/en/model-about/mellum2.1-12b-a2.5b-thinking.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/mellum2.1-12b-a2.5b-thinking.mdx') as Promise<AboutModule>,
  },
  'minicpm-v-4.7-35b-a3b': {
    en: () => import('@/content/en/model-about/minicpm-v-4.7-35b-a3b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/minicpm-v-4.7-35b-a3b.mdx') as Promise<AboutModule>,
  },
  'minicpm5-1b': {
    en: () => import('@/content/en/model-about/minicpm5-1b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/minicpm5-1b.mdx') as Promise<AboutModule>,
  },
  'minicpm5-2b': {
    en: () => import('@/content/en/model-about/minicpm5-2b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/minicpm5-2b.mdx') as Promise<AboutModule>,
  },
  'mistral-small-3.2-24b': {
    en: () => import('@/content/en/model-about/mistral-small-3.2-24b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/mistral-small-3.2-24b.mdx') as Promise<AboutModule>,
  },
  'muse-glimmer-30b': {
    en: () => import('@/content/en/model-about/muse-glimmer-30b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/muse-glimmer-30b.mdx') as Promise<AboutModule>,
  },
  'nemotron-3.5-lightning-30b-a3b': {
    en: () => import('@/content/en/model-about/nemotron-3.5-lightning-30b-a3b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/nemotron-3.5-lightning-30b-a3b.mdx') as Promise<AboutModule>,
  },
  'phi-4': {
    en: () => import('@/content/en/model-about/phi-4.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/phi-4.mdx') as Promise<AboutModule>,
  },
  'qwen3-14b': {
    en: () => import('@/content/en/model-about/qwen3-14b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3-14b.mdx') as Promise<AboutModule>,
  },
  'qwen3-30b-a3b-2507': {
    en: () => import('@/content/en/model-about/qwen3-30b-a3b-2507.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3-30b-a3b-2507.mdx') as Promise<AboutModule>,
  },
  'qwen3-32b': {
    en: () => import('@/content/en/model-about/qwen3-32b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3-32b.mdx') as Promise<AboutModule>,
  },
  'qwen3-8b': {
    en: () => import('@/content/en/model-about/qwen3-8b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3-8b.mdx') as Promise<AboutModule>,
  },
  'qwen3.5-122b-a10b': {
    en: () => import('@/content/en/model-about/qwen3.5-122b-a10b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3.5-122b-a10b.mdx') as Promise<AboutModule>,
  },
  'qwen3.5-27b': {
    en: () => import('@/content/en/model-about/qwen3.5-27b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3.5-27b.mdx') as Promise<AboutModule>,
  },
  'qwen3.5-35b-a3b': {
    en: () => import('@/content/en/model-about/qwen3.5-35b-a3b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3.5-35b-a3b.mdx') as Promise<AboutModule>,
  },
  'qwen3.5-4b': {
    en: () => import('@/content/en/model-about/qwen3.5-4b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3.5-4b.mdx') as Promise<AboutModule>,
  },
  'qwen3.5-9b': {
    en: () => import('@/content/en/model-about/qwen3.5-9b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3.5-9b.mdx') as Promise<AboutModule>,
  },
  'qwen3.6-27b': {
    en: () => import('@/content/en/model-about/qwen3.6-27b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3.6-27b.mdx') as Promise<AboutModule>,
  },
  'qwen3.6-35b-a3b': {
    en: () => import('@/content/en/model-about/qwen3.6-35b-a3b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3.6-35b-a3b.mdx') as Promise<AboutModule>,
  },
  'qwen3.8-27b': {
    en: () => import('@/content/en/model-about/qwen3.8-27b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/qwen3.8-27b.mdx') as Promise<AboutModule>,
  },
  'solar-open-100b': {
    en: () => import('@/content/en/model-about/solar-open-100b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/solar-open-100b.mdx') as Promise<AboutModule>,
  },
  'solar-open2-250b': {
    en: () => import('@/content/en/model-about/solar-open2-250b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/solar-open2-250b.mdx') as Promise<AboutModule>,
  },
  'spark-x2.5-4b': {
    en: () => import('@/content/en/model-about/spark-x2.5-4b.mdx') as Promise<AboutModule>,
    ko: () => import('@/content/ko/model-about/spark-x2.5-4b.mdx') as Promise<AboutModule>,
  },
};

/** 모델 소개는 장문이라 장문 로캘(en·ko)에만 — zh 모델 허브는 소개 없이 그린다(D109, CLAUDE.md 규칙 4) */
export async function loadModelAbout(id: string, locale: Locale): Promise<ModelAboutBody | undefined> {
  if (!isContentLocale(locale) || !hasModelAbout(id)) return undefined;
  return (await LOADERS[id][locale]()).default;
}
