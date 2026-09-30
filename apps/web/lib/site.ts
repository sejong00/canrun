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

/** 문의·모델 추가 요청 주소 (P1-5 — 사용자가 제공한 공개 주소, docs/05 §8 공개 값) */
export const CONTACT_EMAIL = 'turbojenm@gmail.com';

/**
 * 검색엔진 소유 확인 코드 (P1-5 — GSC·네이버 서치어드바이저 "HTML 태그" 방식, 공개 값).
 * 빈 문자열이면 메타 태그를 내지 않는다. 사용자가 각 서비스에서 받은 값을 넣는다.
 */
export const SEARCH_VERIFICATION = {
  google: 'MdEs99XwXIZVG3i_1NoVrmjidyt2lNEbCQQ3G8qTlOU',
  naver: '637680a93e2e60134ec55b3ddf0768e6105b7778',
} as const;
