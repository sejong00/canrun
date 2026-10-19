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
| og:image | 빌드 타임 satori→resvg (postbuild `scripts/og-cards.ts`, 경로 `lib/og-images.ts`) — GPU·모델 허브(10-01 D60) + 공개 콤보(indexable 집합 — 배치를 열면 카드도 늘어난다)·게시 가이드(10-16 D96), 나머지(미공개 콤보·초안·계산기·정적 페이지) 기본 카드 | P2: Workers 온디맨드 전환 |
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

### zh(간체) 화면판 생성 방식 (10-19, PROGRESS §4 D109)

- 로캘 능력표 `apps/web/i18n/locales.ts`(의존성 0 — 스크립트·export 테스트도 읽는다): `ALL_LOCALES` en·ko·zh = 라우팅(`routing.ts`) · `INDEXED_LOCALES` en·ko = hreflang·사이트맵·RSS·IndexNow · `CONTENT_LOCALES` en·ko = 사람이 쓴 MDX 장문. `HTML_LANG`(zh → `zh-Hans`)·`OG_LOCALE`(zh → `zh_CN`)·`ogImageLocale`(zh → en 카드)·`contentLocaleFor`(zh → en, 푸터 정적 페이지 링크).
- 장문 페이지에서 zh 빼기: 정적 세그먼트(about 등)는 부모 레이아웃의 `[locale]` 을 물려받아 모든 로캘로 생성된다. 페이지가 `generateStaticParams` 로 en·ko 목록(`contentLocaleParams()`)을 돌려주면 Next 16.3.6 `generateRouteStaticParams` 가 부모 값마다 `{...부모, ...자식}` 으로 합치고 중복을 걸러내 zh 가 사라진다(빈 배열은 `output: 'export'` 에서 빌드 실패라 부모 값과 무관하게 같은 목록). 10-19 스파이크(작은 Next 앱)에서 `/zh/about`·`/zh/guides*` 없음, `/ko/about`·`/zh/gpus` 있음을 확인. 정적 페이지 5종·가이드 목차·`guides/[slug]`(en·ko × 슬러그)가 이 방식이고 `notFound()` 안전망을 둔다. 소개글·모델 소개 로더는 zh 면 `undefined`(소개 없이 그린다).
- 대안(안 씀, 기록): Next 가 부모 param 덮어쓰기 동작을 바꾸면 페이지에서 `notFound()` 로 그리고 postbuild 가 정해 둔 목록(`out/zh/{about,…}.html`, `out/zh/guides/`)을 지운다. export 테스트 "zh (D109)" 가 zh 장문 파일이 생기면 바로 잡는다.
- 검색: `buildAlternates` 는 `INDEXED_LOCALES` 끼리만 hreflang 을 짝짓고, zh 는 자기 캐노니컬만(hreflang·RSS 대체 링크 없음) + `buildPageMetadata` 가 noindex 를 강제한다. 사이트맵 스크립트는 `INDEXED_LOCALES` 를 import 해 출력이 그대로다. `_redirects` 의 GPU 비교 뒤집은 순서 301 은 zh 까지 36줄.

## 2. 저장소 구조 (모노레포, pnpm)
```
canrun/
├─ CLAUDE.md                    # 작업 컨벤션 (본 세트의 CLAUDE.md)
├─ docs/                        # 이 계획 문서 세트 그대로 커밋
├─ packages/
│  ├─ engine/                   # 계산 엔진 (의존성 0)
│  │  ├─ src/{memory,speed,verdict,constants}.ts
│  │  └─ test/  ← 02 §8 케이스 + verify 회귀
│  └─ data/                     # zod 스키마 + JSON 로더 + 파생 계산(kvBytesPerToken 등) — 서브패스 `@canrun/data/client`(zod 없는 클라이언트 엔트리, P1-3 D26)
├─ data/
│  ├─ gpus.json  models.json  model-quants.json  quants.json
│  ├─ benchmarks.json  prices.json  aliases.json
├─ apps/web/                    # Next.js
│  ├─ app/[locale]/(pages…)     # 라우트는 01-prd §5
│  ├─ components/  lib/  messages/{en,ko}.json   # components/islands/ = 클라이언트 아일랜드, lib/calc/ = 계산기 순수 로직 (P1-3, §5)
│  └─ content/{en,ko}/guides/*.mdx  # + content/guides.ts 레지스트리·AUTHORING.md (P1-4 D38)
│     content/{en,ko}/pages/*.mdx   # 정적 페이지 본문 — 레지스트리 content/pages.ts (P1-5 D47), 업데이트 소식 항목 날짜는 content/updates.ts (10-14 D72)
│     content/{en,ko}/hubs/{gpu,model}/*.mdx  # 인기 허브 소개글 — 레지스트리 content/hubs.ts, 로더 lib/hub-intros.ts (10-14 D74)
├─ scripts/
│  ├─ sync-models.ts  new-model-alert.ts  build-sitemaps.ts(postbuild 4단계 — P1-5 D49)  make-og.ts(기본 공유 카드 1회 생성 — D50)
│  ├─ indexnow.ts               # 배포 전 지금 사이트맵 받기 → 배포 뒤 바뀐 URL 을 IndexNow 로 전송 (deploy.yml — 10-16 D93)
│  └─ parse-bench.ts            # llama-bench 파서 (P2 제출과 공용 — 미리 엔진 옆에)
└─ .github/workflows/{deploy,daily-rebuild,data-sync}.yml
```

## 3. 페이지 생성 흐름
`data/*.json` → zod 파싱 → `generateStaticParams`로 콤보/허브 열거 → 페이지 컴포넌트는 엔진 호출 결과를 빌드 시 계산해 HTML에 박음. **인덱싱 게이트는 `data/publish.json`**(`currentBatch` + `batches[{batch, gpuIds, modelIds}]` — 메커니즘 `04` §3, 스키마 `03` §1, P1-2 D9): 콤보는 카탈로그 **전 조합을 생성**하고, 개방된 배치 밖의 콤보는 `robots noindex, follow` 메타로만 구분한다(생성 여부는 게이트와 무관). **콤보 페이지의 ctx × KV quant(f16/q8_0/q4_0) 표는 정적**(메모리·tg 밴드·판정 — 색인 콘텐츠). P1-2는 클라이언트 JS 0(D11)이었고, **P1-3에서 엔진 미탑재 아일랜드 `CtxKvControls`**(슬라이더·KV 라디오 → 셀 강조·요약·실행 명령 교체, 서버가 21셀 뷰를 props로 — D28, §5)를 얹었다(콤보 스크립트 135.1KB gz, 캡 150KB).
규모: 허브 168(GPU 54 + 모델 29 × 2언어) + 콤보 1,566 × 2 = 3,132 + 계산기 2 + 가이드 목차 2 + 가이드 12(6쌍, P1-4) → 홈 포함 **3,318페이지 전부 생성**, 인덱싱만 게이트(계획 시점 "1,400페이지"는 GPU 30 × 모델 20 시절 수치 — PROGRESS §4 09-29). 허브·콤보 조립 로직(기준·추천 quant, 실측 조인, 신뢰 라벨, ctx×KV 표, 대안, 커맨드 스니펫, 공개 상태)은 `packages/data/src/{assess,combo,snippet,publish}.ts`(순수·엔진 무변경 — P1-3부터 계산기가 같은 함수를 `{ctx, kvQuant, theoretical, ramHint}` 옵션으로 브라우저에서 호출, D33), 페이지는 서버 컴포넌트 + **클라이언트 아일랜드 3종**(`components/islands/` — 계산기·콤보 ctx/KV·모델 허브 가격 정렬, 번역·카탈로그는 props, §5) — 내부 링크는 `<a>`, next-intl 클라이언트 프로바이더 없음(JS 예산 `01` §7). 20분 초과 시 콤보 분할 빌드 도입. **10-19 zh 화면판(PROGRESS §4 D109)**: zh 템플릿 페이지 2,704장(장문 페이지 제외, 홈 `zh.html` 포함)이 더해져 정적 생성 5,467 → 8,171장(HTML 8,170 — zh 2,704), `out/` 파일 5,897 → 8,601개(한도 검사 16,000의 54%), `out/` 1.5GB 중 zh 460MB(첫 배포 업로드가 그만큼 늘고, 그 뒤엔 바뀐 파일만 올라간다). 로컬 빌드: 정적 생성 48~56초 → 62~70초, `pnpm build` 전체 106~118초(10-19 측정 3회).

빌드 후처리 `scripts/postbuild.ts`(P1-2 D18·D21, PROGRESS §4 09-29) — 순서가 중요하다:
1. **RSC 페이로드 프루닝(평탄화 전)**: Cloudflare Pages 파일 한도 20,000개 — 페이지당 html + RSC `.txt` 3 + `__next.*` 디렉터리 = 5파일이라 3,302페이지면 ~16,500(82%). `__next.*` 디렉터리를 재귀 삭제하고 허용목록(`robots.txt|ads.txt|llms.txt` — P1-5 대비, IndexNow 키 파일 `<키>.txt` — D93) 외 `*.txt`를 전부 삭제한다(~17% 감소). 안전 근거: 사이트는 `<a>`만 쓰고 next/link·router가 없어 Next 16.3.6 클라이언트가 `.txt`를 요청하는 경로(`fetchServerResponse` — navigate/prefetch/refresh)가 실행되지 않고, HTML에 `.txt` 참조 0건, 뒤로가기(`pageshow`/`popstate`) 복원은 기존 CacheNode를 재사용한다. 안전망: export 테스트(허용목록 외 `.txt` 0 · `__next` 0 · 총 파일 < 16,000 · 최대 파일 < 25MiB) + E2E 실패 요청 0(인접 링크 이동 후 `goBack()` + networkidle 포함 — 유일한 history 경로).
2. `out/en/**` → 루트 평탄화(`renameSync`, §1).
3. `_redirects` 생성(아래).
4. 사이트맵·robots·RSS·ads.txt·IndexNow 키 파일(`scripts/build-sitemaps.ts`) — RSS 항목은 요약 `description` + 이미 export 된 가이드 HTML 의 본문을 정리한 `content:encoded`(D93). 배포 워크플로는 Cloudflare 배포 전에 지금 사이트의 사이트맵을 받아 두고, 배포가 성공하면 새로 생기거나 lastmod 가 바뀐 URL 만 IndexNow 로 보낸다(실패해도 경고만 — `scripts/indexnow.ts`).
- `next.config.ts` `generateBuildId: () => GITHUB_SHA ?? 'local'`(D21)로 빌드 ID를 고정 — 산출물 결정성(채택 조건: 두 번 빌드 `diff -r out` 바이트 동일, 결과는 PROGRESS §4 09-29).

alias→canonical 301(`04` §2)은 Next redirects가 정적 export에서 미지원이므로 **Cloudflare Pages `_redirects` 파일을 `aliases.json`에서 빌드 시 생성**한다(정적 룰 2,000줄 한도 — 수요 있는 alias만 301, 나머지는 캐노니컬 태그로만). **콤보 URL엔 alias 301을 만들지 않는다**(1,566쌍 × 2언어가 한도를 넘는다 — 캐노니컬만, `04` §2, P1-2).

## 4. Phase 2 확장 경계 (지금 잘라 두는 것)
- **제출 API**: Cloudflare **Workers + D1** (같은 플랫폼, 무료 티어 충분). `POST /api/submissions` → 파서(`scripts/parse-bench.ts` 재사용) → 엔진 추정 대비 ±3배 새너티 → `pending` 저장. 승인 큐는 소형 관리자 페이지(Workers + Access 인증) or 초기엔 D1 콘솔.
- 승인된 제출 → 주간 배치가 `benchmarks.json`으로 export + 효율계수 재산출 → PR → 리빌드. **정적 사이트 원칙 유지**(실측도 빌드 데이터로 흡수, 실시간성 불필요).
- 대안 검토했음: Supabase(Postgres+auth) — 익명 제출 정책이라 auth 불요, 플랫폼 일원화로 D1 선정. 제출량이 커지면 재평가.
- 가격 연동(P3): Workers cron → 어필리에이트 API/피드 → `prices.json` PR.
- 계정/저장 기능이 필요해지는 시점에만 auth 도입(설계상 어디에도 세션 전제 없음).

## 4b. 가이드 콘텐츠 파이프라인 (P1-4 — PROGRESS §4 D37~D45)
- 본문 = `apps/web/content/{en,ko}/guides/<slug>.mdx`(로캘별 별도 집필), 메타 = 의존성 0 레지스트리 `content/guides.ts`(상태·날짜·저자·그리드·제목/설명). `@next/mdx`(next 와 같은 버전 고정) + `@mdx-js/loader`, 플러그인·frontmatter 없음, `@mdx-js/react` 금지. 로드는 `lib/guides.ts` 명시적 로더 맵(템플릿 import 금지). `mdx-components.tsx` 는 요소 스타일만.
- 수치는 서버 데이터 컴포넌트(`components/guide/guide-components.tsx` — 허브·콤보와 같은 `getCombo`·`getGpuHub`·`getModelHub` 조립)만 그린다 — 산문 숫자 금지(D43), 산문의 판정 주장은 `<Expect>`(데이터가 바뀌면 빌드 실패). 가이드 페이지 클라이언트 JS 0(스크립트 = 홈과 동일).
- 감수 게이트(D40): 초안 = noindex + 미링크(URL 로만), published 전환은 사용자 승인. 목차 `/guides`·헤더 `data-nav-guides` 는 published ≥1 일 때만.
- 검사: 유닛 `apps/web/test/guides.test.ts`(레지스트리·파일·로더 대칭, MDX 스캔, en/ko 동등성, 배치1 커버리지 시뮬레이션), export(구조화 데이터·게이트·링크 규칙·자체 데이터 블록·위젯·`<p>` 속 블록 0·규칙 3 본문 확장). 집필 규칙 `apps/web/content/AUTHORING.md`, 데이터 브리프 `apps/web/scripts/guide-brief.ts`.
- 허브 소개글(10-14 PROGRESS §4 D74): 같은 컴포넌트 맵을 GPU·모델 허브 머리말 아래(`components/hub-intro.tsx`, 서버 컴포넌트)에 쓴다 — 본문 `content/{en,ko}/hubs/{gpu,model}/<id>.mdx`, 레지스트리 `content/hubs.ts`, 명시적 로더 `lib/hub-intros.ts`. `<Expect>` 는 `quant`·`ram`·`ctx`/`kv`·`mode`·`confidence` 조건 prop 으로 문장의 조건까지 고정한다 — 대조 함수는 `lib/expect-claim.ts`(컴포넌트·빌드 없는 확인 `apps/web/scripts/check-expect.ts`·유닛 테스트가 공유). 검사: 유닛 `apps/web/test/hub-intros.test.ts`(스캔 함수는 가이드와 공유 `test/mdx-scan.ts`, 조건 붙은 고정은 verdict 나 fits 를 밝히고 이론 추정 판정은 같은·다음 문장에 라벨), export(소개가 있는 허브 = 레지스트리, 사이트맵 lastmod = max(데이터 기준일, `HUB_INTROS_UPDATED`)).

## 5. 계산기 클라이언트 설계 (P1-3 구현 — PROGRESS §4 09-29 D26~D36; 계획 시점 문구는 취소선)
- ~~엔진+카탈로그 요약(모델·GPU 스펙만, ~100KB gzip)을 계산기 페이지에서 lazy load.~~ → **단일 아일랜드 + props**: 서버 페이지가 `toCatalogLite(seed)`(sources·note 등 제거한 코어 필드만 — 예외로 보내는 공개 값 `hfId`(D57)·`msrpUSD`(D65)·`hfDownloads30d`·`hfDownloadsAsOf`(D68 — 계산기 "다운로드 많은 순"), ≈8.1KB gz ≤ 9KiB(10-06 D68 에서 8→9KiB — 다운로드 수 +305B). 홈·가이드·상세 페이지(콤보·GPU 허브·모델 허브·GPU 비교의 미리 채운 계산기 위젯 — 10-19 D107)의 GPU 선택기는 가격 필드를 뺀 GPU 목록 `getPickerGpus()`만 받는다 — export 테스트가 고정)와 `pickMessages(CALC_MESSAGE_SPEC)`(계산기가 쓰는 네임스페이스·키만)을 `<CalculatorIsland>` props로 넘긴다 — Flight 인라인이라 HTML 계정(스크립트 예산 밖), 런타임 JSON fetch 없음(export 위생: 비-HTML은 `_next/static/**`만). 엔진 + 조립 로직은 **`@canrun/data/client`**(`packages/data/src/client.ts` — core·assess·combo·snippet·publish·license·derive·manual(D66) 재수출, zod·schema·index 미포함, `sideEffects:false`)로 아일랜드 청크에 포함(≈19KB gz). 서버는 계속 `@canrun/data`(zod). 콤보 페이지는 ~~해당 조합 데이터만 인라인~~ → **엔진 미탑재 아일랜드**(D28): 서버가 ctx×KV 21셀 뷰(필요량·판정 라벨·속도 문장·llama.cpp 명령·Ollama 블록·각주)를 props로, `CtxKvControls`는 셀 강조·요약·명령(Ollama 포함 — 명령 없는 셀은 블록 숨김) 교체만(+1.7KB gz). **10-03 D64 시스템 RAM 토글**: 맨 위 판정이 RAM 계단(16~128GB)에서 바뀌는 dGPU 콤보만 같은 아일랜드에 `ram` props(RAM 마다 서버가 완성한 판정 문장 + 들어가는 quant 마다 실행 계획 1개 — 명령은 RAM 과 무관해 quant 로 중복 제거)를 받는다. 다른 RAM 이면 ctx·KV 를 8k·f16 으로 잠그고 결과 블록(그 RAM 을 밝힌 안내·파일·llama.cpp·Ollama·계산기 링크)을 React 로 직접 그린다 — 정적 스니펫은 8k·f16 으로 되돌리기만 하고 RAM 내용으로 바꾸지 않는다(정적 스니펫에는 기준 RAM 과 다른 RAM 의 명령을 고르는 곳을 적은 한 줄이 있다). 바깥 fieldset 은 `min-w-0`(기본 min-inline-size 가 min-content 라 줄바꿈 없는 명령이 휴대폰 폭을 넘긴다). 엔진·카탈로그는 여전히 싣지 않는다(콤보 청크 홈 대비 추가분 1,897 → 2,700B gz, 게이트 3,072). 모델 허브 가격 정렬(`PriceSort`)은 DOM 재배치만(+0.9KB gz). **청크 하한(10-19 D107)**: 위젯이 붙은 콤보·모델 허브는 아일랜드가 둘(`GpuPicker` + 자기 아일랜드)이라 Turbopack 기본 설정(작은 청크 하한 50,000 — 압축·축소 전 크기)에선 선택기 코드를 자기 아일랜드와 한 청크로 다시 받아 홈 대비 추가분이 8.5 KB gz(게이트 3,072B)였다. 예산은 그대로 두고 `apps/web/next.config.ts` `experimental.turbopackChunking.minChunkSize: 10_000` 으로 선택기 청크를 따로 둔다(사이트 전체 적용) — 측정: 콤보 추가분 2.7 KB·모델 허브 2.2 KB, 모든 페이지 스크립트 +2개(홈 6 → 8개, +0.8 KB gz → 140,587B), 5,000 은 홈 스크립트 11개라 기각(PROGRESS §4 D107).
- **클라이언트 규약**: next-intl 클라이언트 프로바이더 없음(D6) → 번역은 `lib/i18n-lite.ts`(의존성 0, ICU 부분집합 `{x}`·`{n, plural, =k one other}`·`#`)로 서버 사전을 포맷 — `createTranslator` 대조 유닛 테스트(양 로케일 × 아일랜드 전 키)가 동치를 강제. `next/link`·router·`useSearchParams` 금지(RSC 프루닝 D18) → URL 상태는 `history.replaceState(history.state, …)` 300ms 디바운스 + `popstate`(Next 16 `HistoryUpdater`가 `useInsertionEffect`로 `__NA` 상태를 써 두므로 `history.state`를 그대로 넘긴다 — null·새 객체면 뒤로가기가 `location.reload()`). 하이드레이션 플래그·URL 스냅샷은 `useSyncExternalStore`, 상태 갱신은 핸들러·`popstate` 콜백에서만, SSR = 첫 클라이언트 렌더(datalist 입력의 콤보박스 승격·결과 영역·감지 버튼 활성은 플래그 이후 렌더 분기 — React 19 프로덕션은 속성 불일치를 패치하지 않는다). eslint `no-restricted-imports`(클라이언트 파일에 next-intl·`@canrun/data` 배럴·`@/lib/utils`(tailwind-merge)·catalog/hubs·`ui/button`·`next/*`·zod·`node:*` 금지) + 전이적 import 그래프 테스트(`apps/web/test/client-graph.test.ts`)가 강제.
- ~~WebGPU 감지: `navigator.gpu.requestAdapter()` → adapter info 매핑 테이블(aliases.json)~~ → **GPU 감지(D30)**: 버튼은 SSR에 항상(disabled, 고정 박스) → 마운트 후 `navigator.gpu || WebGLRenderingContext` 있으면 활성, 없으면 `visibility:hidden`(CLS 0). 클릭 시에만 `import('@/lib/calc/detect-gpu')` → WebGL `UNMASKED_RENDERER_WEBGL` + WebGPU `adapter.info`(vendor·architecture) 병행 수집(1.5s 타임아웃, 예외 전부 삼킴, SwiftShader 등 소프트웨어 렌더러 거부, WebGL·WebGPU vendor 불일치(Optimus)면 추측 금지). 매핑 테이블은 별도 파일이 아니라 **`data/gpus.json` `aliases` + 토큰 매처 코드**(`apps/web/lib/calc/gpu-match.ts`: ANGLE 언랩 → 괄호·`(0x…)`·`vs_5_0` 제거 → 토큰화 → id/이름 100 · 별칭 90 · 토큰 집합 80 · 부분 60(라벨의 나머지가 시리즈 접두·메모리 용량·DDR 구성뿐일 때) · 약한 부분 50(Ti/Super/XT/Laptop/Pro 같은 SKU 토큰이 남음 — 콤보박스 목록엔 뜨지만 확정 금지), 메모리 변형 형제(4060 Ti 8/16GB 등)는 숫자 근거 없으면 ambiguous, 이름에 용량이 박힌 단일 변형(3060 12GB·9060 XT 16GB)은 감지 문자열에 용량이 없으면 확정 대신 확인 후보). 결과 4상태: exact(값 세팅) / ambiguous(후보 목록 제시 — 입력창엔 용량을 뺀 표시명, 활성 옵션 없음, blur·커스텀 열기로는 확정되지 않고 옵션 선택·Enter·제출만 확정; 후보가 1개면 "카탈로그엔 이 용량만" 확인 문구) / apple-unknown(Safari "Apple GPU" — Apple 칩 목록) / none(시각 변화 0 — 열린 목록도 닫음, 상시 렌더된 sr-only live region 문구). 실패/미지원 시 UI 노출 없이 수동 검색만 — AC "무소음 폴백". ~~HF repo 직접 입력 모드~~ → P2(D35).
- **모델 모드(10-03 D65)**: 같은 아일랜드의 `mode` 상태(URL `mode=model`). 하드웨어 폼 자리에 `ModelForm`(+ "목록에 없는 모델" 패널), 결과 자리에 `GpuResultList` — SSR·첫 렌더는 하드웨어 모드라 정적 HTML 불변식(폼 마커·결과 카드 0)은 그대로. 계산은 `lib/calc/run-model.ts`: `assembleModelRows`(무거움 — `@canrun/data` `modelGpuRows`, 모델 허브 표와 같은 함수·가정 D2, 대상·ctx·KV 가 바뀔 때만) · `filterGpuRows`(종류·예산·판정·정렬 — 가벼움, 따로 메모) · `myConfigRow`("내 구성" — `resolveHardware` + `assessCombo` 1회). 가격 순위·예산은 `rankableStreet`(허브 정렬·최저가와 공용). 원화는 서버가 ko 에만 넘기는 환율 props + 순수 `lib/krw.ts`(서버 `lib/price.ts` 가 위임, eslint CLIENT_FILES). `?mode=model` 딥링크는 마운트 때 SSR 하드웨어 폼의 화면 안 높이를 재서 모델 쪽 자리의 최소 높이로 둔다(CLS). 모델 허브는 정적 링크 하나(스크립트 증가 0).
- **모델 값 직접 입력(10-03 D66)**: 순수 빌더 `buildManualModel`(`packages/data/src/manual.ts`, `@canrun/data/client` 재수출 — 값 import 는 `@canrun/engine`·`derive` 뿐, hf.ts·gguf.ts 미도달은 client-entry 테스트)이 HF 불러오기와 같은 `ExtraModel`(ModelCore + ModelQuantCore[], `origin: 'manual'`)을 만들고, 아일랜드는 이를 D57 고정 카드 경로(`run.ts` theoretical 고정, 명령은 `origin === 'hf'` 만)·모델 모드 대상(`run-model.ts` `origin`)에 그대로 넣는다. 상태 `CalcState.manual`(입력 도중의 범위 밖 값도 유지 — 범위 검사는 URL 파서와 빌더, normalize 는 hf 검증 뒤 hf 가 있으면 manual 삭제·빈 칸 정리), URL `mm=`(숫자 조각만), 리듀서 `{type:'manual', patch}`(숫자 칸에 값이 생기면 hf 삭제 — `hasManualNumber`, 펼치기·생각 모드·최대 컨텍스트만으로는 삭제하지 않음). 카탈로그 모델 고르기·HF 불러오기가 지운 값은 아일랜드 로컬 보관분으로 되살린다. 펼침·MoE 체크는 아일랜드 로컬 상태(패널이 모드마다 다시 마운트, D65), 빌더 결과는 manual 내용 문자열 키로 메모. 네트워크 요청 0.
- **서로 다른 GPU 섞기(10-03 D67)**: 엔진 `Hardware.gpus`(카드 목록 — `gpuUnitsOf`·`gpuSharesOf`·`gpuThroughputGBs`, 스펙 0.7.0)를 데이터 레이어 `dgpuHardware`/`hardwareConfigs` 의 `extraGpus` 옵션이 만들고, 자격은 `canMixWith`(정책 `MIXABLE_GPU_CLASSES`). 계산기 상태 `plus?: string[]`(정리 = `state.ts` `normalizePlus`: 자격·같은 카드 접기·최대 4장, 1번을 입력하는 중엔 유지), 리듀서 `{type:'plus'}`, `resolveHardware` 가 `extras` 를 싣는다. 폼은 `components/islands/extra-gpus.tsx`(네이티브 select 줄 + 빼기, 고르기 전 줄은 컴포넌트 로컬 상태 — 1번 GPU 가 바뀌거나 합계 4장이면 버린다) — "GPU 수" select 와 함께 1번 GPU 입력 바로 아래 한 묶음(`[data-gpu-set]`). `run.ts` 는 여러 장이면 카드마다 이 구성의 `commandPlan` 명령을, 서로 다른 카드면 카드 한 장 구성으로 `assessQuant` 를 한 번 더 돌린 참고 줄(`singleGpu` — 실측 조인 포함, 계산기에 그 카드만 넣었을 때와 같은 값·라벨. 카탈로그 밖 모델은 이론 추정)을 붙인다. 허브·콤보·모델 모드 목록은 1장 그대로
- 코드 표: `app/[locale]/calculator/page.tsx`(서버 — 메타·JSON-LD·FAQ·noscript) · `components/calc-static.tsx` + `lib/starting-points.ts`(서버 렌더 예시·결과 읽는 법 — 클라이언트 JS 0, 허브 요약 + 계산기 추천순, PROGRESS §4 D73) · `components/islands/{calculator-island,hardware-form,custom-hardware-fields,detect-button,result-list,result-card,share-button,ctx-kv-controls,price-sort,mode-switch,model-form,gpu-result-list,gpu-result-row,hf-model-panel,manual-model-fields,extra-gpus}.tsx` · `lib/calc/{state,url,hardware,run,result-sort,run-model,gpu-match,detect-gpu,sort}.ts`(순수, DOM 없음 — `detect-gpu`만 브라우저 전용) · `lib/{i18n-lite,client-messages,calc-catalog,hydration,snippet-phrases,krw}.ts` · 훅·`cn` 없는 뷰 코어 `components/{verdict-chip,pill,speed-text}.tsx`·`ui/button-variants.ts` · `types/webgpu.d.ts`(최소 앰비언트 — 의존성 추가 없음).

## 6. 품질·성능 가드
- CI: typecheck + vitest(엔진 회귀 = 실측 대조 케이스) + zod 데이터 검증(**출처 없는 레코드 실패**) + Playwright(대표 페이지 6종 × 2언어 스모크 + 계산기·아일랜드 시나리오 — 하이드레이션 콘솔 에러 0·URL 동기·감지 스텁 양성/애매/음성·모바일 375px) + Lighthouse CI(`assertMatrix` — P1-2 D19·P1-3 D34·P1-4, PROGRESS §4 09-29, 11 URL — 가이드 en/ko 는 초안 noindex 라 콤보처럼 SEO 카테고리 대신 개별 감사 블록 `/(can-i-run|guides)/`): 전 URL 공통 performance·accessibility·best-practices ≥0.9 · CLS ≤0.1 / **비계산기 script ≤153,600B** / **계산기(`/calculator([?].*)?$` — 모델 모드 쿼리 URL 포함, D65) script ≤180,224B** + is-crawlable·canonical·hreflang·label = 1 + LCP warn 2.5s / 비콤보 SEO ≥0.9 + LCP warn 2.0s / **콤보 템플릿 LCP 랩 게이트 = error 2.5s**(web.dev "good"). LHCI는 11 URL만 보므로 **export 테스트가 3,304페이지 전부의 모듈 스크립트 gzip 합을 바이트 기준으로 검사**(비계산기 ≤150,000 · 계산기 ≤176,000 · 페이지 청크집합 − 홈 청크집합 ≤3,072 · 초기 집합 밖 청크 preload 0). 근거: Lighthouse Lantern 비관 그래프가 131KB Next 런타임을 렌더블로킹으로 취급해 5KB 홈도 ~2.0s가 바닥이라 콤보에 2.0s error는 걸 수 없다 — **`01` §7 "LCP < 2s"는 필드(RUM) 목표로 유지**. noindex 콤보는 `is-crawlable`(가중치 4)이 실패해 SEO 카테고리 ≈0.69라, 콤보 URL은 카테고리 대신 개별 감사(document-title·meta-description·canonical·hreflang·crawlable-anchors·link-text·image-alt·http-status-code = 1)를 단언한다.
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
| IndexNow 키(10-16 PROGRESS §4 D93) | `apps/web/lib/site.ts` `INDEXNOW_KEY` | 시크릿 아님 — 프로토콜상 사이트 루트 `/<키>.txt` 로 공개하는 값(검색엔진이 그 파일로 소유를 확인한다). 저장소가 공개라 다른 사람이 이 키를 써도 보낼 수 있는 것은 이 사이트의 URL 뿐이다. gitleaks 는 상수 선언 한 줄만 정규식으로 예외(`.gitleaks.toml`) |
| 검색엔진 소유 확인 값(GSC·네이버 메타 태그, 다음 웹마스터도구 robots 줄 — 10-19 D99) | `apps/web/lib/site.ts` `SEARCH_VERIFICATION`·`DAUM_WEBMASTER_LINE` | 시크릿 아님 — 각 서비스가 페이지·robots.txt 에 공개로 걸라고 주는 값이다. 다음 웹마스터도구 로그인 PIN 은 저장소에 넣지 않는다 |
| 로컬 개발 변수 | `.env.local` (gitignore) | `.env*` 커밋 금지, CI에 gitleaks 스캔 |

**Phase 2(Workers+D1) 추가 규칙**: 서버 시크릿은 `wrangler secret`으로만 주입 · D1은 prepared statement만(문자열 SQL 조립 금지) · 제출 입력은 파서가 숫자·열거형 화이트리스트로 정규화, 자유 텍스트는 렌더 시 이스케이프(XSS 차단) · URL 필드는 도메인 화이트리스트 + `rel="nofollow noopener"` · rate limit용 IP는 **솔트 해시로만 저장(원문 IP 저장 금지, TTL 24h)** — PII 미수집 설계로 GDPR·개인정보보호법 부담 최소화(프라이버시 페이지에 명시).

**운영**: 저장소는 시작 시 private 권장(공개 전환 시 GitHub secret scanning 활성화 + 히스토리 1회 스캔) → 2026-10-15 공개 전환 완료(Actions 무료 한도 초과 대응, secret scanning·push protection 켬 — `docs/PROGRESS.md` §4 D78). 의존성 lockfile 고정 + Dependabot. 배포는 GitHub → Cloudflare 단방향(로컬에서 프로덕션 직배포 금지).
