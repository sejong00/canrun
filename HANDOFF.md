# HANDOFF — Claude Code 이관 가이드

> 이 폴더 전체가 저장소의 초기 커밋이 된다. 계획은 `docs/00`부터, 작업 규칙은 `CLAUDE.md`(Claude Code가 자동 로드), 태스크는 `docs/06`.

## 0. 구조 한 줄 정리 (오해 방지)

**내 PC = 개발·빌드·벤치마크 머신. 서버 아님.** 서비스는 정적 파일로 빌드되어 Cloudflare CDN이 서빙하고, 계산은 방문자 브라우저에서 실행된다. PC에 포트를 열거나 상시 켜둘 필요가 없다. 로컬에서 도는 것: `pnpm dev`(개발 미리보기 localhost:3000), `pnpm build`(정적 산출물 생성), llama-bench(5060 Ti 16GB 실측). 상세: `docs/05` §8.

## 1. 사전 준비물

git · Node.js 20+ · pnpm(`corepack enable`) · Claude Code · GitHub 계정 · Cloudflare 계정(무료) · (첫 주 내) 도메인

## 2. 이관 절차

1. GitHub에서 **private 저장소** 생성 (예: `canrun`)
2. 이 폴더 내용물을 저장소 루트로 복사 → `git add -A && git commit -m "docs: initial plan" && git push`
   (`.gitignore` 포함되어 있음 — `.env*`는 애초에 커밋되지 않는 구조)
3. 저장소 루트에서 `claude` 실행
4. 아래 "첫 세션 프롬프트" 붙여넣기 → 이후 태스크 단위로 반복
5. Cloudflare Pages 연결 시: API 토큰은 **GitHub → Settings → Secrets and variables → Actions**에만 등록 (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) — 파일로 저장 금지

## 3. 프롬프트

**첫 세션 (P0-1):**
```
docs/06-roadmap-tasks.md의 P0-1(저장소 스캐폴드)을 수행해줘.
참조: docs/05-architecture.md 전체(§8 보안 포함).
규모가 있으니 플랜 모드로 계획을 먼저 보여준 뒤 진행하고,
완료 기준(AC)을 항목별로 충족 여부와 함께 보고해줘.
i18n 스파이크(en 루트 + /ko/ 정적 산출 확인) 결과는 docs/05에 결정 기록으로 남겨줘.
```

**범용 템플릿 (이후 모든 태스크):**
```
docs/06-roadmap-tasks.md의 {태스크 ID}를 수행해줘. 참조: {해당 ref 문서}.
AC 전부 충족 후 항목별 보고. 미충족 항목이 있으면 다음 태스크로 넘어가지 말 것.
```

**세션 시작 시 상태 파악용:**
```
docs/06 기준으로 현재 완료된 태스크와 다음 태스크를 git log·코드 상태로 판단해서 알려줘.
```

## 4. 사람(YOO) 작업 체크리스트 — Claude Code가 못 하는 것

- [ ] 도메인 결정·구매 (MASTER_PLAN §10)
- [ ] Cloudflare Pages 연결 + Actions Secrets 등록 (위 §2-5)
- [ ] 자체 실측 1차 — RTX 5060 Ti 16GB (`docs/03` §6 프로토콜·매트릭스, P0-5)
- [ ] 에디토리얼 감수 (특히 ko 12편, P1-4)
- [ ] 출시 주: GSC·네이버 서치어드바이저 소유 확인
- [ ] 커뮤니티 활동(아카라이브·레딧)은 본인 계정으로

## 5. 보안 체크리스트 (요약 — 상세 `docs/05` §8)

- 이 계획 폴더에는 키·토큰·개인정보 없음 확인 완료 (2026-08-10 스캔; 유일한 개인 표기는 문서 작성자 "YOO" 핸들 3곳)
- 시크릿은 Actions Secrets / `wrangler secret`에만 — 저장소·데이터·빌드 출력은 전부 공개 전제
- P0-1에서 gitleaks CI 스텝 포함할 것 (CLAUDE.md 규칙 7)
- 저장소 공개 전환 시: secret scanning 활성화 + 히스토리 스캔 1회
