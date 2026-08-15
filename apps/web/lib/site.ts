/**
 * 사이트 절대 URL. 캐노니컬·hreflang·사이트맵이 전부 이 값을 기준으로 만들어진다.
 *
 * 공개 성격 값이므로 시크릿이 아니다(docs/05 §8 표) — 다만 환경 분리를 위해 env 로 관리한다.
 * 도메인 확정 전까지는 Cloudflare Pages 기본 도메인을 폴백으로 쓴다.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://canrun.pages.dev').replace(
  /\/+$/,
  '',
);

/** 사이트 내부 경로(`/`, `/ko`, `/gpu/rtx-4060` …)를 절대 URL로. */
export function absoluteUrl(pathname: string): string {
  return pathname === '/' ? `${SITE_URL}/` : `${SITE_URL}${pathname}`;
}
