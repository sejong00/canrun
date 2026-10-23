import type { ComponentType } from 'react';
import { hasCompareIntro, type CompareIntroSlug } from '@/content/compares';
import { isContentLocale, type ContentLocale } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';

/**
 * GPU 비교 소개글 로더 (10-19 D106) — 허브 소개글(`lib/hub-intros.ts`)과 같은 **명시적** 맵(템플릿 import 금지, D38: Turbopack 이 패턴으로 풀어
 * 떠돌이 .mdx 까지 컴파일하고 타입이 흐려진다). 키는 레지스트리 `COMPARE_INTRO_SLUGS`(content/compares.ts)와 같아야 한다 — 타입이 강제하고,
 * 키와 import 경로의 짝은 유닛 테스트(`test/compare-intros.test.ts`)가 본다. 소개글이 없는 쌍은 undefined — 소개 없이 그대로 렌더한다.
 *
 * 한 줄 형식(테스트가 읽는다):
 *   'rtx-4090-vs-rtx-5090': {
 *     en: () => import('@/content/en/compare/rtx-4090-vs-rtx-5090.mdx') as Promise<IntroModule>,
 *     ko: () => import('@/content/ko/compare/rtx-4090-vs-rtx-5090.mdx') as Promise<IntroModule>,
 *   },
 */
export type CompareIntroBody = ComponentType<{ components?: object }>;
type IntroModule = { default: CompareIntroBody };
type Loader = Readonly<Record<ContentLocale, () => Promise<IntroModule>>>;

const LOADERS: Readonly<Record<CompareIntroSlug, Loader>> = {
  'rtx-5060-ti-16gb-vs-rtx-5070': {
    en: () => import('@/content/en/compare/rtx-5060-ti-16gb-vs-rtx-5070.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rtx-5060-ti-16gb-vs-rtx-5070.mdx') as Promise<IntroModule>,
  },
  'rtx-4060-ti-16gb-vs-rtx-5060-ti-16gb': {
    en: () => import('@/content/en/compare/rtx-4060-ti-16gb-vs-rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rtx-4060-ti-16gb-vs-rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
  },
  'rtx-3060-12gb-vs-rtx-4060': {
    en: () => import('@/content/en/compare/rtx-3060-12gb-vs-rtx-4060.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rtx-3060-12gb-vs-rtx-4060.mdx') as Promise<IntroModule>,
  },
  'rtx-5060-ti-8gb-vs-rtx-5060-ti-16gb': {
    en: () => import('@/content/en/compare/rtx-5060-ti-8gb-vs-rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rtx-5060-ti-8gb-vs-rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
  },
  'rtx-5070-ti-vs-rtx-5060-ti-16gb': {
    en: () => import('@/content/en/compare/rtx-5070-ti-vs-rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rtx-5070-ti-vs-rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
  },
  'rx-9070-xt-vs-rtx-5070': {
    en: () => import('@/content/en/compare/rx-9070-xt-vs-rtx-5070.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rx-9070-xt-vs-rtx-5070.mdx') as Promise<IntroModule>,
  },
  'rtx-4090-vs-rtx-5090': {
    en: () => import('@/content/en/compare/rtx-4090-vs-rtx-5090.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rtx-4090-vs-rtx-5090.mdx') as Promise<IntroModule>,
  },
  'rtx-3090-vs-rtx-4090': {
    en: () => import('@/content/en/compare/rtx-3090-vs-rtx-4090.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rtx-3090-vs-rtx-4090.mdx') as Promise<IntroModule>,
  },
  'rtx-3090-vs-rtx-5090': {
    en: () => import('@/content/en/compare/rtx-3090-vs-rtx-5090.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/rtx-3090-vs-rtx-5090.mdx') as Promise<IntroModule>,
  },
  'amd-strix-halo-vs-nvidia-dgx-spark': {
    en: () => import('@/content/en/compare/amd-strix-halo-vs-nvidia-dgx-spark.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/amd-strix-halo-vs-nvidia-dgx-spark.mdx') as Promise<IntroModule>,
  },
  'amd-strix-halo-vs-rtx-5070-ti': {
    en: () => import('@/content/en/compare/amd-strix-halo-vs-rtx-5070-ti.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/amd-strix-halo-vs-rtx-5070-ti.mdx') as Promise<IntroModule>,
  },
  'apple-m4-pro-vs-rtx-5060-ti-16gb': {
    en: () => import('@/content/en/compare/apple-m4-pro-vs-rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/apple-m4-pro-vs-rtx-5060-ti-16gb.mdx') as Promise<IntroModule>,
  },
  'nvidia-dgx-spark-vs-apple-m5-max-40c': {
    en: () => import('@/content/en/compare/nvidia-dgx-spark-vs-apple-m5-max-40c.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/nvidia-dgx-spark-vs-apple-m5-max-40c.mdx') as Promise<IntroModule>,
  },
  'nvidia-dgx-spark-vs-rtx-5090': {
    en: () => import('@/content/en/compare/nvidia-dgx-spark-vs-rtx-5090.mdx') as Promise<IntroModule>,
    ko: () => import('@/content/ko/compare/nvidia-dgx-spark-vs-rtx-5090.mdx') as Promise<IntroModule>,
  },
};

/** 소개글은 장문이라 장문 로캘(en·ko)에만 — zh 비교 페이지는 소개 없이 그린다(D109, CLAUDE.md 규칙 4) */
export async function loadCompareIntro(slug: string, locale: Locale): Promise<CompareIntroBody | undefined> {
  if (!isContentLocale(locale) || !hasCompareIntro(slug)) return undefined;
  // 레지스트리가 비어 있으면 키 타입이 never 라 문자열 색인으로 찾는다 — 맵에 없으면 빌드 실패(조용히 빠지지 않게)
  const loader = (LOADERS as Readonly<Record<string, Loader | undefined>>)[slug];
  if (!loader) throw new Error(`compare intro ${slug}: registered in COMPARE_INTRO_SLUGS but missing from the loader map`);
  return (await loader[locale]()).default;
}
