import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();
// D38 — 가이드 본문 MDX(apps/web/content/{en,ko}/guides/*.mdx). remark/rehype 플러그인·frontmatter 없음(Turbopack 은
// 문자열 플러그인만 받는다), @mdx-js/react 금지(클라이언트 컨텍스트 → 청크). pageExtensions 는 건드리지 않는다 — .mdx 는
// 라우트가 아니라 lib/guides.ts 로더 맵이 import 한다
const withMDX = createMDX({});

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
  // D21 — 빌드 ID 를 커밋 SHA 로 고정: 같은 커밋의 일 1회 리빌드(daily-rebuild)에서 HTML 이 바이트 동일하게
  // 나와 wrangler 가 변경된 파일만 업로드한다. 청크는 내용 해시라 영향 없음. 로컬 빌드는 'local'.
  generateBuildId: () => process.env.GITHUB_SHA ?? 'local',
  experimental: {
    // 10-19 D107 — 아일랜드가 둘인 페이지(콤보: GPU 선택기 + ctx·KV 컨트롤, 모델 허브: + 가격 정렬)에서 Turbopack 이 작은 묶음을
    // 한 청크로 합치면 홈과 같은 GPU 선택기 코드가 페이지 전용 청크에 다시 들어간다(홈에서 넘어온 방문자가 같은 코드를 또 받는다 —
    // export 예산 검사 "홈 청크 집합 대비 추가분 3 KiB", 기본값에선 콤보 8.5 KB). 작은 청크 하한(기본 50 KB, 압축·축소 전 크기)을
    // 10 KB 로 낮춰 선택기 청크를 따로 둔다 — 측정: 콤보 추가분 2.7 KB, 홈은 스크립트 2개·약 0.8 KB(gzip) 늘었다. 5 KB 는 홈 스크립트가 11개로 늘었다
    turbopackChunking: { minChunkSize: 10_000 },
  },
};

// 순서: MDX 규칙을 먼저 넣고 next-intl 이 turbopack 설정을 펼쳐 합친다(resolveAlias 병합 — 규칙 보존)
export default withNextIntl(withMDX(nextConfig));
