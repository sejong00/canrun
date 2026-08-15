# 05. 기술 아키텍처

> 원칙: MVP는 **정적 사이트 + 순수 계산 엔진** (서버 0대, 비용 $0). 단, Phase 2/3 확장(제출 API·보정 배치·가격 연동)이 구조 변경 없이 얹히도록 경계를 잘라 둔다.

## 1. 스택 확정

| 레이어 | 선택 | 근거 / 대안 |
|---|---|---|
| 프레임워크 | **Next.js 16 (App Router) + `output:'export'` 정적 내보내기** + TypeScript strict | SSG 풀 HTML(네이버 Yeti·구글 렌더큐 리스크 제거). **주의: static export는 middleware·redirects·headers 미지원** → "en 루트 + `/ko/`" URL 구조는 P0-1 스파이크로 검증 완료(아래 결정 기록). 대안: Astro(더 가벼움)지만 계산기 인터랙션·팀 숙련도로 Next 우세. (계획 시점 표기는 15였으나 P0-1 착수 시점(2026-08-15) 안정 버전이 16.3이라 16으로 시작 — 한 메이저 뒤에서 시작하지 않기 위함) |
| i18n | next-intl (SSG 호환) + `[locale]` 세그먼트 | en 루트, `/ko/` — `04` §6 스펙 |
| UI | Tailwind CSS 4 + shadcn/ui + 다크모드 | |
| 엔진 | `packages/engine` 순수 TS + vitest | UI/빌드 공용. `02-engine-spec.md` |
| 데이터 | `/data/*.json` + zod 검증 + 빌드 시 타입 생성 | DB 없음. PR 리뷰 가능 = 데이터 거버넌스 |
| 호스팅 | **Cloudflare Pages** (무료·대역폭 무제한) | 트래픽 커져도 $0. 대안: Vercel(DX↑, 무료 대역폭 100GB 한도) |
| 빌드 | GitHub Actions: push 배포 + **일 1회 스케줄 리빌드**(데이터/가격 반영) | ISR 불필요 — 데이터 갱신 주기가 일 단위 |
| og:image | 빌드 타임 satori→resvg (허브+상위 콤보만), 나머지 기본 카드 | P2: Workers 온디맨드 전환 |
| 분석 | Cloudflare Web Analytics + GSC + 네이버 서치어드바이저 (+P2 Plausible 검토) | 쿠키리스, 동의 배너 최소화 |
| 에러 | Sentry 무료 티어 (클라이언트만) | |

### i18n 스파이크 결정 기록 (P0-1, 2026-08-15)

**결정: A안 채택 — "en 루트 + `/ko/`" URL 구조를 static export에서 구현 가능함을 산출물로 확인했다.**

- 문제: next-intl 공식 가이드는 static export에서 `localePrefix: 'always'`(전 로케일 프리픽스)를 권장한다 — 무프리픽스 URL은 middleware가 로케일을 해석해야 하는데 static export는 middleware 미지원([공식 문서](https://next-intl.dev/docs/routing/middleware), [maintainer 답변](https://github.com/amannn/next-intl/discussions/2132)).
- 채택한 방법: `localePrefix: 'as-needed'`(링크·캐노니컬·hreflang은 en 무프리픽스로 생성, middleware 없음) + **빌드 후처리 `scripts/postbuild.ts`가 `out/en/**`을 `out/` 루트로 평탄화**(충돌 시 즉시 실패). 정적 파일 위치가 곧 URL이므로 미들웨어 없이 en=루트가 성립한다.
- 주의점 1: next-intl의 `Link`에 `locale` prop을 주는 로케일 전환 링크는 항상 프리픽스를 붙인다(`/en` 잔존) → 전환 링크는 `getPathname({href, locale})` + `next/link`로 생성한다(`apps/web/i18n/navigation.ts` 주석).
- 주의점 2: `trailingSlash: false`라 루트 URL은 `https://host`(슬래시 없음)로 정규화된다 — 캐노니컬·hreflang 전체가 동일 형태라 SEO 문제 없음.
- 안전망: `out/_redirects`에 `/en /`·`/en/* /:splat` 301을 생성해 잔존 `/en` 링크·북마크를 정리한다.
- 검증(회귀 테스트로 상시 강제): `pnpm test:export` → `test/export-invariants.spec.ts` — ①`out/index.html`=en·`out/ko.html`=ko 존재 ②`out/en/` 부재 ③en 페이지에 `/en` 프리픽스 링크 0건 ④캐노니컬 자기참조+hreflang en/ko/x-default 완전 대칭 ⑤`_redirects` 존재·2,000룰 이내.
- 폴백(불필요해졌으나 기록): A안이 향후 Next/next-intl 변경으로 깨지면 `localePrefix: 'always'` + 루트 `_redirects`(`/ → /en` 302) + x-default=en으로 전환한다. 전환 비용은 postbuild 평탄화 제거 + 테스트 기대값 변경.

## 2. 저장소 구조 (모노레포, pnpm)
```
canrun/
├─ CLAUDE.md                    # 작업 컨벤션 (본 세트의 CLAUDE.md)
├─ docs/                        # 이 계획 문서 세트 그대로 커밋
├─ packages/
│  ├─ engine/                   # 계산 엔진 (의존성 0)
│  │  ├─ src/{memory,speed,verdict,constants}.ts
│  │  └─ test/  ← 02 §8 케이스 + verify 회귀
│  └─ data/                     # zod 스키마 + JSON 로더 + 파생 계산(kvBytesPerToken 등)
├─ data/
│  ├─ gpus.json  models.json  model-quants.json  quants.json
│  ├─ benchmarks.json  prices.json  aliases.json
├─ apps/web/                    # Next.js
│  ├─ app/[locale]/(pages…)     # 라우트는 01-prd §5
│  ├─ components/  lib/  messages/{en,ko}.json
│  └─ content/{en,ko}/guides/*.mdx
├─ scripts/
│  ├─ sync-models.ts  new-model-alert.ts  build-sitemaps.ts  og-images.ts
│  └─ parse-bench.ts            # llama-bench 파서 (P2 제출과 공용 — 미리 엔진 옆에)
└─ .github/workflows/{deploy,daily-rebuild,data-sync}.yml
```

## 3. 페이지 생성 흐름
`data/*.json` → zod 파싱 → `generateStaticParams`로 콤보/허브 열거(인덱싱 배치 플래그 필드 `publishBatch`로 noindex/생성 제어) → 페이지 컴포넌트는 엔진 호출 결과를 빌드 시 계산해 HTML에 박음 → 클라이언트 하이드레이션 후 슬라이더 조작 시 동일 엔진으로 재계산.
규모: 1차 (30 GPU + 20 모델 + 600 콤보 + 20 가이드) × 2언어 ≈ **1,350페이지** — 빌드 수 분. 전체 확장(수천 페이지)도 정적으로 감당, 20분 초과 시 콤보 분할 빌드 도입.

alias→canonical 301(`04` §2)은 Next redirects가 정적 export에서 미지원이므로 **Cloudflare Pages `_redirects` 파일을 `aliases.json`에서 빌드 시 생성**한다(정적 룰 2,000줄 한도 — 수요 있는 alias만 301, 나머지는 캐노니컬 태그로만).

## 4. Phase 2 확장 경계 (지금 잘라 두는 것)
- **제출 API**: Cloudflare **Workers + D1** (같은 플랫폼, 무료 티어 충분). `POST /api/submissions` → 파서(`scripts/parse-bench.ts` 재사용) → 엔진 추정 대비 ±3배 새너티 → `pending` 저장. 승인 큐는 소형 관리자 페이지(Workers + Access 인증) or 초기엔 D1 콘솔.
- 승인된 제출 → 주간 배치가 `benchmarks.json`으로 export + 효율계수 재산출 → PR → 리빌드. **정적 사이트 원칙 유지**(실측도 빌드 데이터로 흡수, 실시간성 불필요).
- 대안 검토했음: Supabase(Postgres+auth) — 익명 제출 정책이라 auth 불요, 플랫폼 일원화로 D1 선정. 제출량이 커지면 재평가.
- 가격 연동(P3): Workers cron → 어필리에이트 API/피드 → `prices.json` PR.
- 계정/저장 기능이 필요해지는 시점에만 auth 도입(설계상 어디에도 세션 전제 없음).

## 5. 계산기 클라이언트 설계
- 엔진+카탈로그 요약(모델·GPU 스펙만, ~100KB gzip)을 계산기 페이지에서 lazy load. 콤보 페이지는 해당 조합 데이터만 인라인(<5KB).
- WebGPU 감지: `navigator.gpu.requestAdapter()` → adapter info 매핑 테이블(aliases.json) — 실패/미지원 시 UI 노출 없이 수동 검색만. HF repo 직접 입력 모드: 클라이언트에서 HF API fetch(CORS 허용됨) → config 파싱 → 엔진.

## 6. 품질·성능 가드
- CI: typecheck + vitest(엔진 회귀 = 실측 대조 케이스) + zod 데이터 검증(**출처 없는 레코드 실패**) + Playwright 스모크(대표 페이지 3종 × 2언어) + Lighthouse CI(콤보 템플릿 LCP < 2s, CLS < 0.1 예산).
- 광고 도입 후: 슬롯 고정 높이 예약으로 CLS 방어(`07` §3).
- 접근성: verdict 색+아이콘+텍스트, 키보드 콤보 탐색.

## 7. 비용 (월)
Cloudflare Pages/Workers/D1 무료 티어 $0 + 도메인 ~$1 + Sentry $0 = **~$1/월**. 유료 전환 트리거: 빌드 시간(Pages 500회/월 한도) → 그때 Vercel/셀프 러너 검토.

## 8. 보안·프라이버시 설계

**배포 구조 명시**: 개발·빌드·벤치마크만 로컬 PC에서 수행하고, **서비스는 Cloudflare CDN이 서빙한다 — 사용자 PC는 서버가 아니며 인바운드 포트를 열 일이 없다.** 계산은 방문자 브라우저(클라이언트)에서 실행되므로 런타임 서버 자체가 없음 = 서버 침해 표면 0. (셀프 호스팅은 기술적으로 가능하나 — 정적 파일이므로 — 가용성·보안·회선 문제로 채택하지 않음.)

**시크릿 제로 원칙**: 정적 export는 빌드 산출물 전체가 공개다. 저장소·`data/*.json`·빌드 출력 어디에도 시크릿이 존재할 수 없는 구조가 1차 방어선.

| 값 | 위치 | 규칙 |
|---|---|---|
| Cloudflare API 토큰(배포용) | **GitHub Actions Secrets만** | 최소 권한(Pages Edit 한정), 워크플로에서 echo 금지 |
| HF 토큰(선택 — 공개 API는 무토큰으로 충분) | Actions Secrets | 코드·JSON 하드코딩 금지 |
| AdSense pub ID·어필리에이트 태그·Sentry DSN | 공개 성격 값 | 시크릿 아님 — 다만 env로 관리해 환경 분리 |
| 로컬 개발 변수 | `.env.local` (gitignore) | `.env*` 커밋 금지, CI에 gitleaks 스캔 |

**Phase 2(Workers+D1) 추가 규칙**: 서버 시크릿은 `wrangler secret`으로만 주입 · D1은 prepared statement만(문자열 SQL 조립 금지) · 제출 입력은 파서가 숫자·열거형 화이트리스트로 정규화, 자유 텍스트는 렌더 시 이스케이프(XSS 차단) · URL 필드는 도메인 화이트리스트 + `rel="nofollow noopener"` · rate limit용 IP는 **솔트 해시로만 저장(원문 IP 저장 금지, TTL 24h)** — PII 미수집 설계로 GDPR·개인정보보호법 부담 최소화(프라이버시 페이지에 명시).

**운영**: 저장소는 시작 시 private 권장(공개 전환 시 GitHub secret scanning 활성화 + 히스토리 1회 스캔). 의존성 lockfile 고정 + Dependabot. 배포는 GitHub → Cloudflare 단방향(로컬에서 프로덕션 직배포 금지).
