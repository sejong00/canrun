import { routing, type Locale } from '@/i18n/routing';

/**
 * 로케일 내부 경로 — en 무프리픽스, ko `/ko/…` (next-intl `localePrefix: 'as-needed'` 와 동일 규칙).
 *
 * next-intl 의 `getPathname`(i18n/navigation.ts)을 쓰지 않는 이유: createNavigation 모듈은
 * 클라이언트 `Link` 를 함께 끌고 와서, 서버 컴포넌트에서 import 만 해도 모든 페이지에 next-intl
 * 클라이언트 번들(intl-messageformat 포함)이 실린다 (결정 D6, JS 예산 docs/01 §7).
 * 규칙 표는 apps/web/test/links.test.ts, 산출물 끝단(캐노니컬 = 실제 파일 경로·hreflang 짝·
 * `/en` 링크 0건)은 test/export-invariants.spec.ts 가 전 페이지에 대해 검증한다.
 */
export function localeHref(locale: Locale, href: string): string {
  if (locale === routing.defaultLocale) return href;
  return href === '/' ? `/${locale}` : `/${locale}${href}`;
}

/** 내부 링크는 next/link 대신 이 경로를 쓰는 평범한 `<a>` — 표마다 수십 개를 하이드레이션·프리페치하지 않는다 */
export const gpuHref = (id: string) => `/gpu/${id}`;
export const modelHref = (id: string) => `/model/${id}`;
/** 목록 페이지 (10-19) — 카탈로그 전 모델·전 GPU. 허브 브레드크럼의 가운데 단계 */
export const modelsHref = () => `/models`;
export const gpusHref = () => `/gpus`;
/** 콤보 페이지 (docs/04 §2) — 모델이 앞, GPU 가 뒤 */
export const comboHref = (modelId: string, gpuId: string) => `/can-i-run/${modelId}/on/${gpuId}`;
export const hfUrl = (repo: string) => `https://huggingface.co/${repo}`;
/** 계산기 (docs/04 §2) — 쿼리는 이미 직렬화된 `?…` 문자열 (lib/calc/url.ts) */
export const calculatorHref = (query = '') => `/calculator${query}`;
/** 가이드 목차·글 (docs/04 §2, P1-4) — 슬러그는 로캘 불변 */
export const guidesHref = () => `/guides`;
export const guideHref = (slug: string) => `/guides/${slug}`;
/** 정적 페이지 (P1-5) — 소개·계산 방법·개인정보처리방침·문의 */
export const staticHref = (slug: string) => `/${slug}`;
/** 로캘별 RSS (P1-5) — en `/rss.xml`, ko `/ko/rss.xml` */
export const rssHref = () => `/rss.xml`;
/** 메일 링크 — 문의·카탈로그 밖 모델 요청 (P1-5: 저장소가 비공개라 GitHub 이슈 대신 이메일, D35 대체) */
export const mailtoHref = (email: string, subject: string) => `mailto:${email}?subject=${encodeURIComponent(subject)}`;
