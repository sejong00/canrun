/**
 * 공유 카드(og:image) 경로 — 페이지 메타데이터와 postbuild 렌더러(scripts/og-cards.ts)가 같은 경로를 쓴다 (D60·D96).
 *
 * **의존성 0**: `@/` 별칭 import 금지 — 루트 tsconfig 의 postbuild 스크립트·export 테스트가 직접 읽는다.
 * 경로는 사이트 기준(`/og/…`, 로캘 프리픽스 없음) — 카드 자체에 로캘이 들어 있다.
 * - 기본 카드: 로캘별 1장(커밋된 PNG, scripts/make-og.ts) — 계산기·정적 페이지·미공개 콤보·초안 가이드
 * - 허브: GPU·모델마다 (D60) · 공개 콤보(indexable)·게시 가이드마다 (D96) — 빌드마다 다시 그린다
 */
export type OgLocale = 'en' | 'ko';

export const defaultOgImage = (locale: OgLocale) => `/og/default-${locale}.png`;
export const hubOgImage = (kind: 'gpu' | 'model', id: string, locale: OgLocale) => `/og/${kind}/${id}-${locale}.png`;
/** 콤보 URL(`/can-i-run/{model}/on/{gpu}`)처럼 모델이 앞 — 모델마다 디렉터리 하나 */
export const comboOgImage = (modelId: string, gpuId: string, locale: OgLocale) => `/og/combo/${modelId}/${gpuId}-${locale}.png`;
export const guideOgImage = (slug: string, locale: OgLocale) => `/og/guide/${slug}-${locale}.png`;
