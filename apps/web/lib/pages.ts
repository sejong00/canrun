import type { ComponentType } from 'react';
import type { StaticPageSlug } from '@/content/pages';
import type { Locale } from '@/i18n/routing';

/** 정적 페이지 본문 로더 — 가이드(`lib/guides.ts`)와 같은 명시적 맵(템플릿 import 금지, D38) */
export type PageBody = ComponentType<{ components?: object }>;
type PageModule = { default: PageBody };

const LOADERS: Readonly<Record<StaticPageSlug, Readonly<Record<Locale, () => Promise<PageModule>>>>> = {
  about: {
    en: () => import('@/content/en/pages/about.mdx') as Promise<PageModule>,
    ko: () => import('@/content/ko/pages/about.mdx') as Promise<PageModule>,
  },
  methodology: {
    en: () => import('@/content/en/pages/methodology.mdx') as Promise<PageModule>,
    ko: () => import('@/content/ko/pages/methodology.mdx') as Promise<PageModule>,
  },
  updates: {
    en: () => import('@/content/en/pages/updates.mdx') as Promise<PageModule>,
    ko: () => import('@/content/ko/pages/updates.mdx') as Promise<PageModule>,
  },
  privacy: {
    en: () => import('@/content/en/pages/privacy.mdx') as Promise<PageModule>,
    ko: () => import('@/content/ko/pages/privacy.mdx') as Promise<PageModule>,
  },
  contact: {
    en: () => import('@/content/en/pages/contact.mdx') as Promise<PageModule>,
    ko: () => import('@/content/ko/pages/contact.mdx') as Promise<PageModule>,
  },
};

export async function loadPageBody(slug: StaticPageSlug, locale: Locale): Promise<PageBody> {
  return (await LOADERS[slug][locale]()).default;
}
