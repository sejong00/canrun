/**
 * 사이트 절대 URL. 캐노니컬·hreflang·사이트맵이 전부 이 값을 기준으로 만들어진다.
 *
 * 공개 성격 값이므로 시크릿이 아니다(docs/05 §8 표) — 다만 환경 분리를 위해 env 로 관리한다.
 * 09-30 도메인 canrunllm.com 연결 — 폴백 기본값이 곧 운영 주소다(배포 워크플로는 env 를 넘기지 않는다). 옛 canrun.pages.dev 는 대량 리디렉션으로 301.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://canrunllm.com').replace(
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
  naver: '2bedddb0c84c85624795925e6ec425766a8c1f41',
} as const;

/**
 * AdSense 게시자 ID (Phase 1.5 — `ca-pub-` 로 시작, 공개 값). 빈 문자열이면 확인 메타 태그·ads.txt 를 내지 않는다.
 * 설정하면 모든 페이지 head 에 `google-adsense-account` 메타(스크립트 없음)와 postbuild 가 `out/ads.txt` 를 만든다.
 * 광고 스크립트·슬롯은 승인 뒤 별도 작업(docs/07 §3).
 */
export const ADSENSE_CLIENT: string = 'ca-pub-7918829214294284';
