---
description: 태스크 종료 — AC 검증, 전체 게이트, docs/PROGRESS.md 갱신, 커밋 (푸시는 확인 후)
---
방금 태스크를 마무리해줘.

1. 해당 태스크의 AC(`docs/06-roadmap-tasks.md` + `docs/PROGRESS.md` §2의 추가 요구)를 항목별로 충족/미충족 + 증거로 표 보고해.
   **미충족이 있으면 여기서 멈추고** 알려줘.
2. `git fetch` → 뒤처지기만 했으면 `git pull --ff-only`(lockfile이 바뀌었으면 `pnpm install`). 미푸시 로컬 커밋이 있는데 원격도 앞서 있으면 멈추고 보고(해소는 내 확인 후).
   전체 게이트 = `.github/workflows/ci.yml`의 게이트 스텝을 같은 순서로 로컬 실행(현재: `pnpm run typecheck` · `pnpm run lint` · `pnpm run test:coverage`(엔진 회귀 + 커버리지 90%) · `pnpm run validate-data` · `pnpm build` · `pnpm run test:export`). **하나라도 실패하면 멈추고** 원인을 보고해. gitleaks는 `docs/PROGRESS.md` §5의 셸별 Docker 명령으로 돌리고, 못 돌리면 **커밋 전에 멈추고** 내 확인을 받아(§4 09-27).
3. `docs/PROGRESS.md` 갱신:
   - §1 현재 위치, §2 큐(완료 항목 제거, 새로 생긴 후속 작업 추가 — 다른 절에서 큐 항목은 번호 대신 「이름」으로 참조)
   - §4 결정 기록 (설계 결정·스펙 이탈이 있었다면 근거와 함께 — 스펙 문서를 고쳤다면 양쪽 모두), §5 주의사항 (새로 알게 된 함정)
   - §7 이력 맨 위에 한 줄: 날짜 · 커밋 · 무엇을 했는지
4. conventional commit으로 커밋: 코드·데이터 변경을 먼저 커밋 → 그 해시로 §7을 채워 PROGRESS.md를 `docs(progress): <태스크 ID> 기록`으로 커밋. 변경이 문서뿐이면 한 커밋으로 하고 §7엔 해시 대신 커밋 제목을 적어. **푸시는 내 확인 후.**

$ARGUMENTS
