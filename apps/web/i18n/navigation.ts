import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * 로케일을 인지하는 네비게이션 API.
 *
 * - 같은 로케일 내부 링크: 여기의 `Link` 사용 (프리픽스 자동 처리).
 * - **로케일 전환 링크: `Link` 의 `locale` prop 을 쓰지 말 것** — next-intl 은 전환
 *   링크에 항상 프리픽스를 붙이므로 en 에 `/en` 이 남아 리다이렉트 체인이 생긴다.
 *   대신 `getPathname({ href, locale })` 로 경로를 만들어 `next/link` 에 넘긴다
 *   (as-needed 규칙이 적용되어 en 은 무프리픽스). 검증: test/export-invariants.spec.ts.
 */
export const { Link, getPathname, redirect, usePathname, useRouter } = createNavigation(routing);
