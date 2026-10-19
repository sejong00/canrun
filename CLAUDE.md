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
1. **엔진 상수는 출처 없이 변경 금지.** `packages/engine/src/constants.ts`의 모든 값에 `// source:` 주석 — 실측 유래 상수는 **https URL 필수**, 실측이 아닌 설계 결정(정책 임계값)만 `// source: docs/02 §N (policy)` 형식 허용. 테스트가 강제함. 변경 시 `verify-engine` 회귀 통과 필수. 테스트 기대값이 곧 스펙(`docs/02-engine-spec.md` §7~8).
2. **데이터 레코드는 `sources[]` 필수.** zod가 강제함. 실거래가는 `priceAsOf` 없이 표시 금지. 미출시 하드웨어(RTX 50 Super, B770 등 rumor) 등록 금지.
3. **추정치는 항상 밴드+신뢰 라벨** (`measured` / `calibrated` — NVIDIA·AMD dGPU dense ±12%, 그 외 클래스·MoE·부분 오프로드 ±20% (`docs/02` §4) / `theoretical ±30%`) (pp만 rough ±40%). 단정 표현 금지.
4. **i18n**: 사용자 노출 문자열은 전부 `messages/{en,ko}.json`. 하드코딩 금지. 페이지 추가 시 en/ko 동시 + hreflang 대칭(템플릿이 자동 생성 — 수기 태그 금지). 장문 기계번역 게시 금지(`docs/04` §6). 예외: 가이드·정적 페이지 **본문**은 로캘별로 따로 쓴 `apps/web/content/{en,ko}/{guides,pages}/*.mdx`(집필 규칙 `apps/web/content/AUTHORING.md`, PROGRESS §4 D39·D47) — 크롬·컴포넌트 라벨은 계속 messages.
5. **SEO 불변식**: 캐노니컬 자기참조, `data/publish.json`(currentBatch·배치 목록)로 인덱싱 게이트 제어(`docs/04` §3) — 게이트 승인 없이 배치 확대 금지. 콤보 페이지는 고유 데이터 8요소 충족(`docs/04` §4).
6. 엔진은 순수 함수(의존성·Date·random 금지). 포맷팅은 UI 레이어.
7. **시크릿 제로**: 정적 export 산출물은 전부 공개다. 키·토큰을 저장소/데이터/코드/빌드 출력 어디에도 넣지 않는다 — 배포·API 토큰은 GitHub Actions Secrets, P2 서버 시크릿은 `wrangler secret`만. `.env*`는 gitignore 유지, 커밋 전 gitleaks 통과(로컬 도구가 없을 때의 임시 절차: `docs/PROGRESS.md` §4 09-28). 공개 성격 값(AdSense pub ID·어필리에이트 태그·Sentry DSN·IndexNow 키·검색엔진 소유 확인 값)만 클라이언트 포함 허용. 상세: `docs/05` §8.

## 구조 (상세: docs/05)
`packages/engine`(계산) · `packages/data`(스키마) · `data/*.json`(시드) · `apps/web`(Next.js 16 static export — 버전 결정 기록: docs/05 §1) · `scripts/`(동기화·파서) 

## 세션 운영
- **현재 위치·다음 태스크·결정 기록은 `docs/PROGRESS.md`가 단일 진실 원천.** 세션 시작은 `/canrun-start`, 태스크 종료는 `/canrun-wrap`.
- 1세션 = 1태스크(`docs/06` 단위). AC 전부 충족 전 다음 태스크 금지. 규모 있는 태스크는 플랜 모드로 계획 먼저.
- **위임 — 확인 없이 처리하고 결과만 보고**: CI 초록인 Dependabot PR 머지(npm minor/patch 그룹, GitHub Actions 액션 — 메이저 포함, CI가 안 도는 워크플로의 액션이면 머지 후 `workflow_dispatch`로 확인) · 리포트 SUSPICIOUS 0·ERROR 0인 data-sync PR 머지(CI 확인용 close→reopen 포함) · new-model 이슈 트리아지·닫기 · 신모델 자동 추가 PR(브랜치 `data/new-models`, 10-06 사용자 위임) 머지 — 모델 카드와 자동 추정값(생각 모드·용도·표시 이름·라이선스·인기도)을 대조해 고친 뒤 전체 게이트 통과 시, 매일 도는 Claude 정기 작업 포함(사용자 확인 불필요) · `git push origin main` — 게이트 통과한 태스크 커밋, 그리고 `/canrun-start`의 운영 점검 기록 커밋(`docs/PROGRESS.md`만, 시크릿 스캔 후). 머지는 `gh pr merge <N> --merge` 형식만(브랜치 삭제·`--admin` 금지). 위임 명령은 Bash 도구로 실행한다(허용 규칙이 Bash 기준).
- **확인 필요**: npm 메이저 업데이트, SUSPICIOUS·manual 데이터 반영, 저장소 설정 변경, 브랜치·태그 삭제와 force push, 비용이 드는 일. 판단이 애매하면 확인 쪽으로.
- 설계 결정이나 스펙 이탈은 `docs/PROGRESS.md` §4에 근거와 함께 기록(스펙 문서를 고쳤다면 양쪽 모두).

## 스타일
TypeScript strict, 함수형 우선, 컴포넌트는 shadcn 패턴. 커밋은 conventional commits. 숫자 단위: 메모리 decimal GB(GiB 아님 — GGUF 관행), 속도 tok/s 소수 1자리.

사용자에게는 항상 한국어로 답한다.
