---
description: 세션 시작 — docs/PROGRESS.md 기준 현재 위치 파악, GitHub 상태 점검, 다음 태스크 제안 (fast-forward pull 외 파일 수정 없음)
---
세션 시작 점검이야. 작업 파일은 수정하지 말고(허용: `git fetch`, fast-forward pull) 아래를 수행해 보고해줘.

1. `docs/PROGRESS.md`를 읽고 §1 현재 위치 · §2 다음 할 일 큐 · §5 주의사항을 파악해.
2. `git fetch` 후 로컬·원격 main 차이를 확인해. 뒤처지기만 했으면 `git pull --ff-only`(작업 트리가 깨끗할 때만). 갈라져 있으면(미푸시 로컬 커밋 + 원격 신규 커밋) pull하지 말고 보고해 — 해소(`git pull --rebase`)는 내 확인 후.
3. `gh` CLI로 GitHub 상태를 요약해줘. `gh auth status`가 실패하면 이 단계는 건너뛰고 "미확인 — gh 설치·로그인 필요(사람 작업)"로 보고해. **git 자격증명·credential helper에서 토큰을 꺼내 쓰지 말 것.**
   - 열린 PR과 각 CI 상태(`gh pr list --json number,title,author,statusCheckRollup`) → `docs/PROGRESS.md` §3 운영 루틴 기준 권고(머지/보류/닫기)
   - 실패한 Actions 런(`gh run list --status failure --limit 100` 중 `docs/PROGRESS.md` §1·§7의 마지막 점검일 이후만, 총 건수 포함. 같은 워크플로의 반복 실패는 묶고, 원인은 `gh run view <id> --log-failed`에서 한 줄)
   - `new-model` 라벨의 열린 이슈(`gh issue list --label new-model --state open --limit 500`, 총 건수 포함) → 표: 모델 · 총/활성 파라미터 · GGUF 유무 · 카탈로그 추가 가치(높음/보통/낮음) · 한 줄 이유
     이슈 본문엔 HF 링크·likes·downloads뿐이다. 총 파라미터는 HF 공개 API `https://huggingface.co/api/models/<id>`의 `safetensors.total`(활성은 모델 카드), GGUF 유무는 `https://huggingface.co/api/models?search=<이름>&filter=gguf`로 확인해. 조회 실패·gated면 "미확인"으로 적고 추측하지 마.
4. 보고 형식: 현재 위치 3줄 → 처리 필요 항목(권고 포함) → 다음 태스크 1개와 그 AC.
   머지·이슈 닫기·설정 변경은 하지 말고 내 결정을 기다려.

$ARGUMENTS
