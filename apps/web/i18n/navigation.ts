import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * 로케일을 인지하는 네비게이션 API — **클라이언트 컴포넌트 전용**.
 *
 * 서버 컴포넌트(페이지·메타데이터)는 이 모듈을 import 하지 말고 `lib/links.ts` 의 `localeHref` 를
 * 쓴다: 이 모듈은 next-intl 클라이언트 `Link` 를 끌고 와서 import 만 해도 모든 페이지에 next-intl
 * 클라이언트 번들이 실린다(P1-1 결정 D6). 두 경로 규칙이 같은 URL 을 만드는지는
 * test/export-invariants.spec.ts(캐노니컬·hreflang·/en 링크 0건)가 산출물 끝단에서 본다.
 *
 * - 같은 로케일 내부 링크: 여기의 `Link` 사용 (프리픽스 자동 처리).
 * - **로케일 전환 링크: `Link` 의 `locale` prop 을 쓰지 말 것** — next-intl 은 전환
 *   링크에 항상 프리픽스를 붙이므로 en 에 `/en` 이 남아 리다이렉트 체인이 생긴다.
 *   대신 `getPathname({ href, locale })` 로 경로를 만들어 `next/link` 에 넘긴다
 *   (as-needed 규칙이 적용되어 en 은 무프리픽스). 검증: test/export-invariants.spec.ts.
 */
export const { Link, getPathname, redirect, usePathname, useRouter } = createNavigation(routing);
