# HANDOFF — Claude Code 운영 가이드 (YOO용)

> 초기 이관(2026-08-15)은 끝났다 — 당시 절차·첫 세션 프롬프트 원문은 `git show 03337a8:HANDOFF.md`. **2026-09-27부터는 Claude Code에서 직접 운영한다.**
> 진행 상태의 단일 진실 원천: `docs/PROGRESS.md` · 작업 규칙: `CLAUDE.md`(자동 로드) · 태스크 정의: `docs/06-roadmap-tasks.md`

## 0. 구조 한 줄 (오해 방지)

내 PC = 개발·빌드·실측 머신이지 서버가 아니다. 서비스는 정적 파일로 빌드되어 Cloudflare Pages가 서빙하고, 계산은 방문자 브라우저에서 돈다. PC를 켜둘 필요도, 포트를 열 필요도 없다. 상세: `docs/05` §8.

## 1. 매 세션의 흐름

1. 저장소 폴더(`D:\workspace\canrun-plan`)에서 `claude` 실행
2. **`/canrun-start`** — 현재 위치, 쌓인 PR·이슈, 다음 태스크를 보고받는다 (fast-forward pull 외 파일 수정 없음. GitHub 점검엔 `gh` CLI 로그인이 필요 — `docs/PROGRESS.md` §2 사람 작업)
3. 진행 지시 — 예: `P1-1 진행해줘`. 규모가 있으면 플랜 모드 계획이 먼저 뜨니 훑어보고 승인
4. 끝나면 **`/canrun-wrap`** — AC 표를 확인하고, 전부 충족이면 `푸시해`
5. 다음 태스크는 **`/clear` 후 새 세션**에서 (1세션 = 1태스크)

모델: 대부분 기본값으로 충분. **P1-2(콤보 템플릿)처럼 핵심 로직 태스크는 `/model`로 가장 강한 모델을 고른다.**

## 2. 주간 루틴 (15분)

- 화요일 아침: data-sync PR 확인 → 머지 (CI 체크가 안 붙어 있는 게 정상. P1-1 이후엔 PR을 close→reopen해 CI를 돌린 뒤 머지)
- new-model 이슈 훑기 → 추가할 모델만 남기고 닫기 (출시 후엔 매일 — 48h 플레이북)
- 리포트 판독·Dependabot PR 처리 기준: `docs/PROGRESS.md` §3
- 판단이 애매하면 `/canrun-start`의 권고를 보고 결정

## 3. 교차 검증 (마일스톤마다, 특히 P1-2 후)

`docs/PROGRESS.md` §6 절차대로 격리 클론 + `docs/review-brief.md`로 다른 모델(Codex 등)의 리뷰를 받는다. 결과는 Claude Code에 "이 리뷰를 판정해서 수용분을 수정 태스크로 처리해줘"로 넘긴다.

## 4. 사람 작업

`docs/PROGRESS.md` §2 "사람 작업" 체크리스트 — `gh` CLI 로그인, 도메인, P0-5 실측, 에디토리얼 감수, GSC·네이버 소유 확인, 커뮤니티 게시, (선택) HF_TOKEN.

## 5. 보안 (요약 — 상세 `docs/05` §8, `CLAUDE.md` 규칙 7)

- 토큰·키는 GitHub Actions Secrets / `wrangler secret`에만 둔다. 파일이나 채팅에 붙여넣지 않는다 (Cloudflare 배포 토큰 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`는 08-15 첫 배포 때 등록 — 라이브 사이트 기준, Actions 런은 재개 점검에서 확인. 교체할 때도 Actions Secrets만)
- GitHub 조회는 `gh` CLI 로그인으로 한다 — Claude Code가 git 자격증명에서 토큰을 꺼내 쓰지 않게 한다
- 저장소 공개 전환 시: secret scanning 활성화 + 전체 히스토리 스캔 1회
- 자격증명으로 저장소 설정을 바꾸는 작업은 Claude Code가 멈추고 확인을 구한다 — 정상 동작이니 브라우저에서 직접 하거나 승인한다
