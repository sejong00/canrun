import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // docs/05 §1 — 정적 export. middleware·redirects·headers 미지원이 전제이며,
  // en 루트 + /ko/ URL 구조는 scripts/postbuild.ts 가 산출물 단계에서 완성한다.
  output: 'export',
  // docs/04 §2 — 모든 URL은 trailing slash 없음.
  trailingSlash: false,
  // 정적 export 에서는 이미지 최적화 서버가 없다.
  images: { unoptimized: true },
  // 워크스페이스 패키지는 TS 소스를 그대로 소비한다(빌드 산출물 없음).
  transpilePackages: ['@canrun/engine', '@canrun/data'],
};

export default withNextIntl(nextConfig);
