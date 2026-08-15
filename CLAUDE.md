# CLAUDE.md — CanRun ("내 PC로 돌릴 수 있을까?")

LLM 하드웨어 계산기 + 프로그래매틱 SEO 사이트 (en + /ko/). GPU/RAM 입력 → 구동 가능 모델·quant·예상 tok/s. 전체 계획은 `docs/00-overview.md`부터.

## 명령
```
pnpm i && pnpm build          # 전체 빌드 (정적 export)
pnpm test                     # vitest — 엔진 회귀 포함
pnpm run verify-engine        # 실측 대조 검증 (docs/02 §7)
pnpm run sync-models -- --dry # HF 데이터 동기화 드라이런
```

## 절대 규칙
1. **엔진 상수는 출처 없이 변경 금지.** `packages/engine/src/constants.ts`의 모든 값에 `// source: URL` 주석. 변경 시 `verify_engine` 회귀 통과 필수. 테스트 기대값이 곧 스펙(`docs/02-engine-spec.md` §7~8).
2. **데이터 레코드는 `sources[]` 필수.** zod가 강제함. 실거래가는 `priceAsOf` 없이 표시 금지. 미출시 하드웨어(RTX 50 Super, B770 등 rumor) 등록 금지.
3. **추정치는 항상 밴드+신뢰 라벨** (`measured`/`calibrated ±15%`/`theoretical ±30%`). 단정 표현 금지.
4. **i18n**: 사용자 노출 문자열은 전부 `messages/{en,ko}.json`. 하드코딩 금지. 페이지 추가 시 en/ko 동시 + hreflang 대칭(템플릿이 자동 생성 — 수기 태그 금지). 장문 기계번역 게시 금지(`docs/04` §6).
5. **SEO 불변식**: 캐노니컬 자기참조, `publishBatch` 필드로 인덱싱 게이트 제어(`docs/04` §3) — 게이트 승인 없이 배치 확대 금지. 콤보 페이지는 고유 데이터 8요소 충족(`docs/04` §4).
6. 엔진은 순수 함수(의존성·Date·random 금지). 포맷팅은 UI 레이어.
7. **시크릿 제로**: 정적 export 산출물은 전부 공개다. 키·토큰을 저장소/데이터/코드/빌드 출력 어디에도 넣지 않는다 — 배포·API 토큰은 GitHub Actions Secrets, P2 서버 시크릿은 `wrangler secret`만. `.env*`는 gitignore 유지, 커밋 전 gitleaks 통과. 공개 성격 값(AdSense pub ID·어필리에이트 태그·Sentry DSN)만 클라이언트 포함 허용. 상세: `docs/05` §8.

## 구조 (상세: docs/05)
`packages/engine`(계산) · `packages/data`(스키마) · `data/*.json`(시드) · `apps/web`(Next.js 16 static export — 버전 결정 기록: docs/05 §1) · `scripts/`(동기화·파서) 

## 작업 순서
`docs/06-roadmap-tasks.md`의 태스크 단위로. 각 태스크의 AC 전부 충족 후 다음으로. 현재 Phase는 저장소 이슈/보드 참조.

## 스타일
TypeScript strict, 함수형 우선, 컴포넌트는 shadcn 패턴. 커밋은 conventional commits. 숫자 단위: 메모리 decimal GB(GiB 아님 — GGUF 관행), 속도 tok/s 소수 1자리.
