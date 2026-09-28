# PROGRESS — 진행 상태·결정 기록

> **이 파일이 "지금 어디까지 왔는가"의 단일 진실 원천이다.** 세션 시작은 `/canrun-start`, 태스크 종료는 `/canrun-wrap`.
> 규칙은 `CLAUDE.md`, 스펙은 `docs/00~07`, 태스크 정의·AC는 `docs/06-roadmap-tasks.md`.
> 2026-09-27 Cowork(claude.ai) 기획 세션에서 Claude Code로 운영 이관 — 그 이전 기록은 §7 이력에 요약.

## 1. 현재 위치 (2026-09-27)

- **Phase 0: P0-1~P0-4b 완료 · P0-5(자체 실측, 사람 작업) 미실시** — own 0행 / AC ≥30행. P0-5는 `docs/06`상 병행 태스크라 P1 착수를 막지 않는다. **Phase 1 미착수.**
- 마지막 기능 커밋 `8e46062`(08-26) — 09-27 fetch 기준 origin/main도 `8e46062`(원격 main 변동 없음). 라이브: https://canrun.pages.dev (en `/` + ko `/ko` 헬로 페이지만, sitemap 없음)
- 데이터: 모델 29종(한국 9종) · 모델×quant 100행(`model-quants.json`; QuantId 정의 13종은 `quants.json`) · GPU 프로필 54개(dGPU 39·통합 메모리 12·CPU 3) · 캘리브레이션 실측 52점(**own 0**)
- 자동화: 주간 data-sync PR(화 06:00 KST) · 일간 new-model 이슈(06:30 KST) · Daily rebuild(03:00 KST) · CI 6게이트(typecheck·lint·test:coverage 90%·validate-data·build·test:export) + gitleaks(전 히스토리) · Dependabot(npm·actions 주간)
- 08-26~09-27 공백 동안 GitHub 측 PR·이슈·Actions 상태는 미확인. 09-27 fetch로 보인 원격 브랜치: `data/hf-sync`(09-01 갱신) · Dependabot `peter-evans/create-pull-request` 8(08-22) · npm minor/patch 그룹(09-19) · eslint 10 · typescript → 큐 「재개 점검」

## 2. 다음 할 일 큐 (위에서부터)

1. **재개 점검** — 선행: `gh` CLI 설치·로그인(사람 작업). `/canrun-start`로 수행: fetch/ff-pull, 열린 PR·CI 상태, 08-26 이후 실패한 Actions 런, new-model 이슈 트리아지 표. 머지·닫기는 사용자 결정 후. 결정 반영이 끝나면 `/canrun-wrap`으로 닫는다(AC = 점검 보고 + 결정 반영, §1 '미확인' 줄·§3 Dependabot 행의 PR 번호·§4 '08 하순' 행 검증·§7 갱신).
2. **스펙 문서 동기화** (소규모, P1-1 전) — 리뷰 브리프가 "문서가 스펙"이라 낡은 서술은 거짓 지적이나 잘못된 이식을 부른다:
   - `docs/02` §2.4 partial-offload 식 `gpuFrac = usableVram/need` → 코드 정본(`packages/engine/src/fit.ts`, `c66f9ff`: gpuFrac = GPU 상주 가중치/전체 가중치)
   - `docs/01` §3 신뢰 라벨과 `apps/web/messages/{en,ko}.json` `Home.estimateNotice`의 calibrated "±15%" → ±12%/±20%(`docs/02` §4, 규칙 3). **라이브 헬로 페이지에 노출 중**
   - `docs/03` §1 스키마 블록 ← `packages/data/src/schema.ts` 전체(P0-3 명세 이탈 3건(§4 08-16 행) + `attnOverrides`·`note`·Gpu.vendor `'generic'`)
3. **P1-1 허브 템플릿** (GPU 허브·모델 허브) — `docs/06` AC + 추가 요구:
   - verdict 공통 컴포넌트(S/A/B/F — 라벨·색 `docs/01` §3, 색+아이콘+텍스트 3중 표기), JSON-LD(`docs/04` §5), hreflang(`docs/04` §6)
   - 모델 허브에 **라이선스 배지**(`models.json` `license`는 자유 문자열 → UI 분류표로 NC·커스텀 라이선스 강조. NC 명시는 EXAONE 3종뿐)와 **GGUF 출처 배지**(공식/커뮤니티 — `model-quants.json` 행의 `ggufRepo` 소유자와 `models.json` `hfId` 소유자 비교. 별도 org 필드 없음, 스키마 변경 불필요. 현 데이터로는 공식 = EXAONE 3종뿐이라 `ggml-org`(gpt-oss) 취급은 계획 단계에서 결정)
   - CI에 Playwright 스모크(대표 페이지 3종×2언어)·Lighthouse CI 추가 — `docs/05` §6 스펙인데 미구현(`ci.yml` 헤더 주석이 P1-1로 유예). AC "Lighthouse 90+"와 직결
   - 플랜 모드로 계획 먼저
4. **P1-2 콤보 템플릿** (트래픽의 본체) — **가장 강한 모델로 진행.** `docs/06` AC + 추가 요구:
   - 실행 커맨드 스니펫에 **실제 파일명 변형 표기** — 플레인 파일이 없는 unsloth repo(Qwen3.5 MTP-GGUF 4종, research 표기상 gemma-4-26b-a4b도)의 `Q4_K_M` 등은 실파일이 `UD-*`(매처 UD 폴백, §5). **현재 데이터엔 실파일명·UD 여부 기록이 없다**(ModelQuant = fileGB·ggufRepo뿐, sync도 매칭 경로를 저장하지 않음) → 필드 추가와 sync 기록 방식부터 결정(스키마 변경 시 `docs/03` §1 동시 갱신)
   - `publishBatch` 필드 미구현(스키마·데이터·코드 0건) — 어느 레코드에 둘지 계획 단계에서 결정. 정의 `docs/05` §3, 배치 계획 `docs/04` §3, AC `docs/06` P1-2
   - 라이선스·GGUF 출처 배지 재사용, Ollama `OLLAMA_CONTEXT_LENGTH` 명시(`docs/01` §9)
   - 완료 후 외부 리뷰(§6) 강력 권장 — 페이지가 수백 개 생기는 첫 태스크
5. P1-3 계산기·홈 → P1-4 에디토리얼 → P1-5 출시 배치 0 → P1-6 (`docs/06`)

**사람 작업 (YOO)**
- [ ] **`gh` CLI 설치·로그인** — 큐 「재개 점검」 선행(`winget install GitHub.cli` → `gh auth login`). Claude는 git 자격증명에서 토큰을 꺼내지 않는다(§4 09-27)
- [ ] 도메인 결정·구매 — P1-5 전까지 (후보·기준: `MASTER_PLAN.md` §10). 연결 = CF Pages 커스텀 도메인 + `NEXT_PUBLIC_SITE_URL`(기본값 `https://canrun.pages.dev`, `apps/web/lib/site.ts`). 빌드가 Actions(`deploy.yml` → wrangler Direct Upload)라 **CF 대시보드 env는 효과 없음** — `deploy.yml` Build 스텝 env로 주입하는 코드 변경 필요(daily-rebuild는 deploy.yml 재사용). 전환 후 pages.dev → 커스텀 도메인 리다이렉트 검토
- [ ] P0-5 자체 실측 — RTX 5060 Ti 16GB(`rtx-5060-ti-16gb`) + RAM 16GB, `docs/03` §6 A~E그룹. AC(`docs/06`): own ≥30행 + gpt-oss-20b 111.6 tok/s ±15% 재현. 결과는 `data/benchmarks.json`에 sourceType `own`으로 — 스키마상 `sourceUrl`(URL) 필수라 원시 로그 공개 위치를 입력 전에 정해 §4에 기록. 출시 전 "실측 배지"의 원천
- [ ] P1-4 에디토리얼 감수 (특히 ko)
- [ ] P1-5 출시 주: GSC·네이버 서치어드바이저 소유 확인·사이트맵 제출(본인 계정 — Claude는 확인용 메타태그·파일까지). P1-6부터 주간 GSC 수치 전달(인덱싱 게이트 기록용)
- [ ] 커뮤니티 게시(아카라이브·r/LocalLLaMA)는 본인 계정으로만 — `docs/04` §8 ⑥·`docs/06` Phase 1.5 (Claude는 초안까지)
- [ ] (선택) HF read 토큰을 Actions Secret `HF_TOKEN`으로 — 워크플로·스크립트 배선은 완료(`data-sync.yml` env). 토큰 계정으로 gated 5종 라이선스 동의 필요. 효과: full attention 3종(llama 2·HCX SEED 1.5B)은 arch 자동 검증, gemma-3 2종(swa·override 없음)은 manual 리포트까지

## 3. 운영 루틴

| 주기 | 할 일 | 메모 |
|---|---|---|
| 매주 화 06:00 KST 이후 | data-sync PR(`chore(data): weekly HF sync`, 브랜치 `data/hf-sync`) 리뷰·머지 | GITHUB_TOKEN이 만든 PR이라 CI가 안 붙는 게 정상 — sync job은 validate-data·`pnpm test`(엔진 회귀)만 사전 수행하고 typecheck·lint·build·test:export는 돌지 않는다. **P1-1 이후(데이터가 페이지를 생성)엔 PR을 close→reopen해 CI를 돌린 뒤 머지**(`data-sync.yml` 헤더 주석). 리포트 action 열: `auto` 중 model-quants fileGB 행은 \|Δ\|≤5%라 정상, models.json 쪽 auto 행(arch.*·kvBytesPerTokenF16·nonExpertGB)은 Δ 임계 없이 반영되니 값 변화·출처 확인 · `auto ⚠SUSPICIOUS`(fileGB \|Δ\|>5%)도 이미 반영된 값이라 머지 전 출처 확인 · `manual`·`skipped`는 미반영 — §5 상시 항목 외 새 manual 행은 별도 데이터 태스크로. 새 PR이 없으면 ① 열린 `data/hf-sync` PR이 갱신됐는지(같은 브랜치라 기존 PR에 쌓임) ② 변경 0 ③ job 실패(ERROR 행·검증 실패 시 exit 1) 순으로 확인 |
| 매일 (P1-5 출시 전엔 주 1회 몰아서 OK) | `new-model` 이슈 트리아지 | 추가 가치 높은 것만 카탈로그 태스크로, 나머지 닫기(`--state all` 제목 검색으로 중복 제거 — 닫아도 재등장 없음). 출시 후엔 48h 플레이북(`docs/04` §8) SLA라 당일 트리아지 |
| 수시 | Dependabot PR | npm minor/patch 그룹 PR·actions 개별 PR = CI 초록이면 머지 / `peter-evans/create-pull-request` 메이저 = 머지 후 Data sync `workflow_dispatch`로 검증 / **eslint 10 메이저 PR = 보류**(eslint 플러그인 peer ≤9 — 지원 대기, #4에 보류 코멘트 — `c66f9ff` 메시지) / **typescript 메이저 PR = 대상 버전 확인 후 판단**(브랜치명은 7.0.2, 로컬 ref `fb3833e`는 6.0.3 — 7.x면 typescript-eslint 8.x peer TS <6.1 밖이라 보류, 6.0.x면 peer 범위 안이라 CI 초록 시 머지 검토. PR 번호 미기록). `dependabot.yml`에 ignore가 없는 수동 보류라 PR은 열린 채 갱신된다 → 둘 다 큐 「재개 점검」에서 확인 |
| 매주 (P1-6부터) | GSC 수치 → 저장소 기록 | 인덱싱 ≥80% 게이트 (`docs/06` P1-6) |
| 마일스톤마다 | 외부 리뷰 (§6) | P1-2 후 필수 권장 |

## 4. 결정 기록 (바꾸려면 근거와 함께 여기 갱신)

| 날짜 | 결정 | 근거 |
|---|---|---|
| 08-15 | Next.js 16.3 채택 (계획서의 15 대신) | 착수 시점 안정판. 기록: `docs/05` §1 |
| 08-15 | i18n A안: en 루트 + `/ko/` | next-intl as-needed + 빌드 후 평탄화 + `/en/*`→`/:splat` 301 안전망, `test/export-invariants` 재귀 검사. `docs/05` §1 |
| 08-15 | 실측 리그 = RTX 5060 Ti 16GB + RAM 16GB (5090 미보유 — 필요 시 클라우드 렌트로 스팟 검증) | 하이엔드는 공개 실측 시드로 커버, 16GB가 수요 최대 세그먼트 (`docs/03` §6) |
| 08-15→16 | calibrated 밴드 클래스별: NVIDIA·AMD dGPU dense(full-gpu) ±12% / 그 외·MoE·부분 오프로드 ±20% | 밴드가 검증 max 오차(17.1%, `docs/02` §7)보다 좁으면 안 됨 — 계획서 외부 리뷰. 계획서 `docs/02` §4에 이미 있었고, `66a42fb`에서 CLAUDE.md 규칙 3의 구 단일 ±15%를 정렬(`docs/01` §3·헬로 페이지 문구는 미정렬 → 큐 「스펙 문서 동기화」) |
| 08-16 | 부분 오프로드 CPU측 가중치 = weights − max(0, usableVram − kv − buffer) | 외부 리뷰 P1(거짓 양성, `c66f9ff`) — 반례 회귀 테스트로 고정. `docs/02` §2.4 식은 미갱신(큐 「스펙 문서 동기화」) — 코드가 정본 |
| 08-16 | P0-3 스키마 명세 이탈: Gpu.kind `'cpu'` 추가 · unified/cpu는 vramGB 대신 `ramOptionsGB[]` · BenchPoint modelId/quant 자유 문자열 | `packages/data/src/schema.ts` 헤더 주석. `docs/03` §1 미갱신(큐 「스펙 문서 동기화」) — 코드가 정본 |
| 08-19 | Q2_K 유령 5행 → `UD-Q2_K_XL` 실파일 행으로 교체. QuantId에 `UD-Q2_K_XL`·`UD-IQ2_M` 추가(NATIVE_QUANTS 취급, fileGB 필수 — UD-IQ2_M 데이터 행은 아직 0) | 재라벨 기각 — 사용자가 받을 파일명과 일치해야 함 |
| 08-19 | 비-full attention 모델의 `attnOverrides` = config `layer_types` 실측 (08-19 8종 → 08-26 EXAONE 4.0-32B·4.5-33B·Solar Open2 추가로 현 11종. gemma-3 2종은 gated라 override 없음) | gemma-4-12b KV 2.7× 교정 등. 근거 없는 상수 금지 — nonExpertGB 미문서 모델은 생략 |
| 08-19 | 매처: 플레인 quant 우선, 없으면 UD 폴백 (repo 종류 무관) | UD 전용 MTP repo 대응 + 동시 배포 repo 합산 오염 방지 |
| 08 하순 | 저장소 설정 "Allow GitHub Actions to create and approve pull requests" ON | data-sync PR 자동 생성에 필요 (Cowork 기록 — 로컬 검증 불가, 큐 「재개 점검」에서 확인) |
| 08-26 | 한국 모델 9종 등재 (EXAONE 4.0/4.5·Kanana 1.5·HCX SEED·Solar Open) | 글로벌 경쟁 도구 커버리지 0 — `/ko/` 고유 콘텐츠. K-EXAONE·Kanana 2 보류(`research/models.md` §1G) |
| 08-26 | 특이 라이선스(EXAONE NC 등)는 "표시 정보" | 사이트 리스크 아님 — 배지로 사용자 가치화 |
| 09-27 | GitHub 조회는 `gh` CLI 로그인으로만 — git 자격증명·credential helper에서 토큰 추출 금지 | 추출한 토큰이 도구 출력·대화 기록에 남는다(규칙 7 취지). `gh` 미설치 시 GitHub 항목은 "미확인"으로 보고 |
| 09-27 | 외부 리뷰 기준 커밋 = `fe21e98` (Cowork 초안의 "c66f9ff 이후"를 정정) | `c66f9ff`는 fe21e98 리뷰의 반영분이고, 그 사이 `66a42fb`(P0-3 스키마·시드 v1)와 반영분 자체는 리뷰를 받지 않았다 |
| 09-27 | 로컬 gitleaks = Docker로 CI와 같은 이미지 실행(§5 명령). 못 돌리면 `/canrun-wrap`은 커밋 전에 멈추고 사용자 확인 | Windows용 바이너리 미설치 — 규칙 7 "커밋 전 통과"를 유지하기 위한 절차. 원격 CI gitleaks job은 푸시 후 사후 게이트일 뿐 |

## 5. 알려진 이슈·주의

- 플레인 파일이 없는 unsloth repo(Qwen3.5 MTP-GGUF 4종·gemma-4-26b-a4b)의 `Q4_K_M` 등 행은 매처가 `UD-*` 실파일 크기를 취한 값(`scripts/sync-models.ts` matchQuantFiles). 데이터엔 실파일명·UD 여부가 없다 → 스니펫·다운로드 안내 실파일명은 P1-2에서 필드 추가 필요
- qwen3.5-35b-a3b nonExpertGB(1.22)는 UD-Q4_K_M 유래 크기(22.63)에 bpw 균등 근사를 적용한 값. UD는 중요 레이어 bpw를 올리므로 비전문가 텐서가 과소 추정됐을 수 있다(cpu-moe 판정이 낙관 쪽, 미검증) → P0-5 실측으로 확인
- 재확인 플래그: HCX SEED Think 14B의 llama.cpp 구동 여부(커스텀 arch — P0-5 E그룹에서 실기 검증) · Kanana 1.5 A3B의 active 3B는 비공식 수치 · HCX SEED 1.5B ctx 카드 16k vs 미러 config 131k
- gated config 5종(meta-llama 2·gemma-3 2·HCX SEED 1.5B)은 수동값 — sync는 skipped로 리포트. HCX 1.5B arch는 llamafied 미러(minpeter) config 유래라 HF_TOKEN 도입 후 첫 런 리포트를 확인
- nonExpertGB 미확정: qwen3.5-122b-a10b · gemma-4-26b-a4b(experts/topK 미문서 → MOE_ARCH 미등록) · solar-open2-250b(320E top-8은 명기, 기준 quant Q4_K_M/MXFP4 GGUF 부재) — 근거 확보 전 생략 유지
- qwen3-8b·14b·32b maxContext: config 40960 vs 시드 32768(카드 명기 네이티브 ctx — YaRN 적용 시 131k). sync는 maxContext를 항상 manual로 리포트하니 시드 유지
- 스펙 문서 드리프트: `docs/02` §2.4 partial-offload 식 · `docs/01` §3·헬로 페이지 ±15% · `docs/03` §1 스키마 → 큐 「스펙 문서 동기화」
- new-model 중복 검사는 `in:title` 구문 검색의 첫 결과만 보고 제목 정확 일치는 비교하지 않는다(`new-model-alert.yml:44`) — 더 긴 기존 제목(`…-8B-Instruct`)이 접두 id(`…-8B`) 후보를 가릴 수 있다(검색 의미론 미검증). 트리아지 때 같은 계열 변형 누락 주의
- gitleaks: Windows 로컬엔 바이너리 없음 → Docker Desktop을 켜고 CI와 같은 이미지로(§4 09-27). ci.yml 명령은 그대로 쓰면 안 된다 — Git Bash는 MSYS 경로 변환이 `/repo` 인자를 망가뜨리고, PowerShell은 `"$PWD:"`를 파싱하지 못한다
  - Git Bash: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --config /repo/.gitleaks.toml --log-opts="--all" --redact`
  - PowerShell: `docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --config /repo/.gitleaks.toml --log-opts="--all" --redact`

## 6. 외부 리뷰 절차 (다른 모델로 교차 검증)

1. 커밋이 끝난 상태에서 격리 클론(로컬 클론은 커밋분만 복사 — 미커밋 수정은 빠진다): `git clone D:\workspace\canrun-plan C:\Temp\canrun-review-<N>` — 라이브 폴더 직접 검토 금지
2. 클론에 들어 있는 `docs/review-brief.md`를 리뷰어(Codex 등)에게 주고 "이 브리프 지시대로 검토" 요청
3. 결과를 Claude Code에 붙여넣어 P1/P2/P3 판정 → 수용분을 수정 태스크(예: P1-2b)로 한 세션에 처리 → §4·§7에 기록하고 아래 **리뷰 기준 커밋**을 이번 리뷰 대상 HEAD로 갱신
- **리뷰 기준 커밋: `fe21e98`** → 다음 리뷰 범위 `fe21e98..HEAD` (`66a42fb` P0-3 스키마·시드 v1과 `c66f9ff` 반영분은 미검토)
- 이력: 계획서 외부 리뷰 8건 중 7건 수용(v2~v4 — 저장소 밖 기획 단계, 저장소엔 최종본 `03337a8`만) · P0-1~P0-2 코드 리뷰(기준 `fe21e98`) 10건(P1 1·P2 5·P3 4) 전부 반영 `c66f9ff`

## 7. 이력 (최신이 위)

- **09-27** `docs: Claude Code 운영 이관` — Cowork → Claude Code 운영 이관(이 파일·`docs/review-brief.md`·커스텀 명령 `/canrun-start`·`/canrun-wrap` 도입). Cowork 초안을 저장소 실상과 대조해 정정(Phase 0 상태, gated 5종, attnOverrides 11종, 리뷰 기준 커밋, GitHub 조회 방식 등). 공백기 점검: 09-27 fetch 기준 origin/main 변동 없음(PR·이슈·Actions는 큐 「재개 점검」), own 실측 0, 커스텀 도메인 미설정(코드·라이브 canonical 기준)
- **08-26** `8e46062` P0-4b 한국 모델 9종(EXAONE 4.5 포함 — models 20→29 · model-quants 68→100행) + `docs/03` §6 실측 매트릭스 E그룹(측정 계획) → Phase 0 코드·데이터 태스크 종료(P0-5 자체 실측만 남음)
- **08 하순** Data sync 첫 실행 실패(저장소 설정) → 설정 ON 후 그린, PR #31 생성 (Cowork 기록 — `data/hf-sync` 브랜치는 09-01까지 갱신 확인)
- **08-19** `46a06fe` CLAUDE.md 한국어 규칙 · `450cd2e` P0-4 HF 동기화(sync-models·new-model-alert·워크플로 2종) · `9c77c98` 데이터 정리(UD quant·attnOverrides 8종) · `7008aea` 워크플로 액션 버전 정렬 · Dependabot actions 3건 머지
- **08-16** `a69e349`→`fe21e98` P0-2 엔진 TDD(§7 검증 전 항목 재현) · `66a42fb` P0-3 스키마·시드 v1 · `c66f9ff` 외부 리뷰 10건 반영
- **08-15** `03337a8` 초기 계획 커밋(docs 00~07·MASTER_PLAN·research·구 HANDOFF 이관 절차·`verify_engine.py` 원본 — `fe21e98`에서 vitest로 이식 후 삭제) · `51092f3` P0-1 스캐폴드(모노레포·static export·i18n 스파이크·CI) · canrun.pages.dev 첫 배포
