---
description: 세션 시작 — 현재 위치 파악, GitHub 운영 잡일 위임 처리(머지·트리아지), 점검 기록 커밋·푸시, 다음 태스크 제안
---
세션 시작 점검이야. `docs/PROGRESS.md` 외의 작업 파일은 수정하지 말고(허용: `git fetch`, fast-forward pull, 4단계의 PROGRESS 커밋·푸시) 아래를 수행해줘. 위임 범위는 CLAUDE.md "세션 운영"을 따르고, 위임 명령(`gh pr merge/close/reopen`·`gh issue close/comment`·`gh workflow run`·`git push origin main`)은 Bash 도구로 실행한다.

1. `docs/PROGRESS.md`를 읽고 §1 현재 위치 · §2 다음 할 일 큐·백로그 · §5 주의사항을 파악해.
2. `git fetch` 후 로컬·원격 main 차이를 확인해.
   - 뒤처지기만 했으면 `git pull --ff-only`(작업 트리가 깨끗할 때만).
   - 앞서 있기만 하면(미푸시 커밋): 게이트를 통과한 커밋이면 먼저 `git push origin main`, 아니면 3단계의 위임 머지를 보류하고 보고.
   - 갈라져 있으면(미푸시 로컬 커밋 + 원격 신규 커밋) pull하지 말고 보고 — 해소(`git pull --rebase`)는 내 확인 후.
3. GitHub 상태는 `gh` CLI로 본다(PATH에 없으면 Bash에서 `"/c/Program Files/GitHub CLI/gh.exe"`). `gh auth status`가 실패하면 이 단계는 건너뛰고 "미확인 — gh 로그인 필요"로 보고해. **git 자격증명·credential helper에서 토큰을 꺼내 쓰지 말 것.**
   - 열린 PR과 CI(`gh pr list --json number,title,headRefName,statusCheckRollup`) — 위임 범위는 바로 처리, 머지는 `gh pr merge <N> --merge`:
     - Dependabot npm minor/patch 그룹: CI 초록이면 머지
     - Dependabot GitHub Actions(메이저 포함): CI 초록이면 머지. CI가 안 도는 워크플로(data-sync·new-model-alert·deploy)의 액션이면 머지 후 `gh workflow run <워크플로>`로 한 번 돌려 성공 확인
     - data-sync PR: 본문 리포트가 SUSPICIOUS 0·ERROR 0이면 머지(P1-1 이후엔 `gh pr close`→`gh pr reopen`으로 CI를 돌려 초록을 본 뒤)
     - npm 메이저·SUSPICIOUS·manual 데이터는 권고와 함께 보고만
   - 실패한 Actions 런(`gh run list --status failure --limit 100` 중 `docs/PROGRESS.md` §7의 마지막 점검일 이후만, 총 건수 포함). 같은 워크플로의 반복 실패는 묶고, 원인은 `gh run view <id> --log-failed`에서 한 줄. `data/hf-sync` 브랜치의 job 0개 CI failure는 봇 PR의 알려진 동작(§5)이라 건수에서 빼고 한 줄로만 적어.
   - 열린 `new-model` 이슈(`gh issue list --label new-model --state open --limit 500`): **§2 백로그에 번호가 이미 있는 이슈는 건너뛴다**(카탈로그 확장 때 처리). 나머지(주로 요약 이슈)의 후보마다 HF 공개 API로 총 파라미터(`https://huggingface.co/api/models/<id>`의 `safetensors.total`, 활성은 모델 카드)와 GGUF 유무(`https://huggingface.co/api/models?search=<이름>&filter=gguf`)를 확인해. 조회 실패·gated면 "미확인"으로 적고 추측하지 마.
     판정: 높음 → 백로그 「카탈로그 확장」 목록에 추가 · 대기(llama.cpp 본선 미지원 등) → 같은 백로그의 대기 목록에 추가 · 보통·낮음 → 기록 없음. 판정을 옮긴 뒤 이슈는 사유 코멘트와 함께 닫는다(요약 이슈 포함).
   - 머지가 있었으면 다시 `git pull --ff-only`.
4. 위임 처리 결과가 있으면 `docs/PROGRESS.md` §1·§2·§7에 반영해 `docs(progress): 운영 점검 <날짜>`로 커밋해(작업 트리가 깨끗했을 때만, 변경 없으면 생략). 추가된 줄을 시크릿 패턴 정규식으로 스캔한 뒤 `git push origin main`.
5. 보고 형식: 현재 위치 3줄 → 처리한 것(한 줄씩, new-model 판정표 포함) → 결정이 필요한 것(권고 포함) → 다음 태스크 1개와 그 AC.

$ARGUMENTS
