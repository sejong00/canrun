# PROGRESS — 진행 상태·결정 기록

> **이 파일이 "지금 어디까지 왔는가"의 단일 진실 원천이다.** 세션 시작은 `/canrun-start`, 태스크 종료는 `/canrun-wrap`.
> 규칙은 `CLAUDE.md`, 스펙은 `docs/00~07`, 태스크 정의·AC는 `docs/06-roadmap-tasks.md`.
> 2026-09-27 Cowork(claude.ai) 기획 세션에서 Claude Code로 운영 이관 — 그 이전 기록은 §7 이력에 요약.

## 1. 현재 위치 (2026-09-29)

- **Phase 0: P0-1~P0-4b 완료 · P0-5(자체 실측, 사람 작업) 미실시** — own 0행 / AC ≥30행. P0-5는 `docs/06`상 병행 태스크라 P1 착수를 막지 않는다. **Phase 1: P1-1 허브 · P1-2 콤보 템플릿 완료 — 다음은 P1-3 계산기·홈.**
- 마지막 기능 커밋 `91fb743`(09-29, P1-2). 라이브: https://canrun.pages.dev — 홈 + GPU 허브 54 + 모델 허브 29 + **콤보 1,566**(`/can-i-run/{model}/on/{gpu}`), en·ko **3,302페이지**. 허브는 전체 index(§4 D1), **콤보는 전부 noindex**(`data/publish.json` currentBatch 0 — 배치 1 후보 10×6 등록, 공개는 P1-6 §4 D9). 조립 로직 `packages/data/src/{assess,combo,snippet,publish}.ts`(엔진 무변경), 페이지는 서버 컴포넌트만(JS 131KB gzip), 산출물 3,315파일/334MB(RSC 페이로드 프루닝 §4 D18)
- 데이터: 모델 29종(한국 9종) · 모델×quant 100행(`model-quants.json` — 09-29부터 실파일명 `fileName` 포함; QuantId 정의 13종은 `quants.json`) · GPU 프로필 54개(dGPU 39·통합 메모리 12·CPU 3) · 캘리브레이션 실측 52점(**own 0**)
- 자동화: 주간 data-sync PR(화 06:00 KST) · 주간 new-model 요약 이슈(월 06:30 KST — 출시 전) · Daily rebuild(03:00 KST) · CI 8게이트(typecheck·lint·test:coverage 90%·validate-data·build·test:export·Playwright 스모크 42·Lighthouse CI 6URL assertMatrix) + gitleaks(전 히스토리) · Dependabot(npm·actions 월간). 08-26 이후 실패 런 2건은 모두 `data/hf-sync` PR의 job 0개 CI 런(08-26·09-01 — 봇 PR의 알려진 동작, 게이트 실패 아님, §5), 09-28 Deploy 2건은 동시성 취소 — 그 외 전부 성공
- GitHub에 남은 것: PR #85 eslint 10.11(09-28 #4를 대체)·#5 typescript 6(보류 — 백로그) · new-model 열린 이슈 21건(높음 14 = 백로그 「카탈로그 확장」 입력, llama.cpp 본선 지원 대기 7)
- 운영 방식: 머지·트리아지·푸시 등 반복 잡일은 Claude에 위임(`CLAUDE.md` "세션 운영", 로컬 허용 규칙 `.claude/settings.local.json`)

## 2. 다음 할 일 큐 (위에서부터)

1. **P1-3 계산기·홈** (F4 + WebGPU 감지 + 공유 URL, `docs/06` AC: 모바일 실기기 테스트·감지 실패 시 무소음 폴백) + 이월분:
   - **콤보 인터랙션**(`docs/01` F3, §4 D11): 계산기의 클라이언트 엔진 아일랜드를 만든 뒤 콤보 페이지에 ctx 슬라이더·KV quant 토글로 끼워 넣는다. JS 예산 §4 D6(모듈 스크립트 gzip ≤150KB, 현재 131KB) — 번역은 서버에서 props 로 전달(클라이언트 프로바이더 금지)
   - **콤보 딥링크**: 계산기 결과 카드 → `/can-i-run/{model}/on/{gpu}`(`lib/links.ts comboHref`). 미공개 콤보로 가는 유일한 경로(`docs/04` §3) — 링크 규칙(공개 페이지는 공개 콤보만)은 계산기 결과엔 적용하지 않는다(사용자 세션 결과, noindex 계산기 페이지)
   - 모델 허브 GPU 표 가격 정렬 UI(`docs/01` F2, P1-1 이월)
   - 라이브 콤보 확인이 끝나면 외부 리뷰(§6) — 리뷰 범위 `fe21e98..HEAD`, 브리프 `docs/review-brief.md`(P1-2 갱신)
2. P1-4 에디토리얼(**가이드마다 공개 콤보 ≥N 인바운드 링크** — `docs/04` §2 ③, export 테스트로 강제) → **P1-5 출시 배치 0**(+ og:image — `docs/05` §1은 허브 포함 · "Data updated" 기준일 표시 — `docs/01` §7 · **sitemap-combos 는 `indexableCombos()`(공개 콤보만)** · robots.txt 는 `/can-i-run/` Disallow 금지 · `_redirects` 콤보 alias 없음) (+ new-model 알림을 매일로 되돌림 — `new-model-alert.yml` cron, 48h SLA `docs/04` §8) → **P1-6 배치 1 개방** = `data/publish.json` `currentBatch: 1` 커밋(규칙 5 게이트 승인) + sitemap-combos 제출·GSC 색인 요청, 4주 게이트는 재크롤 확인 시점부터 기산(`docs/04` §3) (`docs/06`)

**출시 후 백로그** (출시 전엔 손대지 않는다)
- **카탈로그 확장** — 높음 이슈 14건: #8 DeepSeek-V4-Flash-0731 · #10 Ling-3.0-tiny · #16 LFM2.5-2.6B · #18 Nemotron-3.5-Lightning-30B-A3B · #20 Ling-3.0-flash · #41 granite-4.2-30b · #42 Laguna-S-2.1 · #43 Spark-X2.5-4B · #45 K2-Horizon-MoVA-36B-A4B · #51 MiniCPM5-2B · #54 MiniCPM5-1B · #61 Llama-3.2-3B · #69 Llama-3.2-1B · #70 Xing4.0-29B-A4B (#42·#45·#70은 llama.cpp 본선 지원 확인 후) + 알림이 놓쳤던 원본(첫 요약 이슈에 함께 올라온다 — 30일 다운로드 순): **google/gemma-4-31B-it**(946만) · **Qwen/Qwen3.8-27B**(673만) · Qwen3.6-35B-A3B(325만) · Qwen3.8-Flash-Next(123만). **대기 목록**(llama.cpp 본선 지원 대기 — 이때 재확인): #19 Motif-3 · #22 maple-preview · #32 GLM-5.3-Flash · #44 Ouro-1.4B · #49 Nanbeige4.2-3B · #57 K2-Horizon-7B · #77 AliceAI-80B-A3B. 위 번호의 이슈는 이 태스크 때까지 열어 두고, `/canrun-start`는 재판정하지 않는다
- **TS 6 이행** (#5) — `packages/engine`·`packages/data` tsconfig에 `"types": ["node"]` 추가로 Typecheck 실패 해소(§5). 그 전까지 PR은 열어 둔다
- **eslint 10** (#85 — 09-28 Dependabot이 #4를 닫고 10.11.0으로 새로 올림) — eslint-plugin-react·import·jsx-a11y의 eslint 10 지원 대기
- **엔진 후속** (P1-1에서 발견, §5 — P0-5 실측이 들어오면 출시 전이라도 착수 가능, 상수 변경은 규칙 1): ① cpu-moe 속도 모델 교정(엔진이 `docs/02` §3.3 앵커 대비 ~2.5× 과소) ② §3.4 B 상한이 nonExpertGB 없는 MoE에도 걸림(스펙은 dense 한정) ③ 리즈닝 ×1.5 대상 정밀화 — `category`의 reasoning ≠ 사고 토큰 방출(phi-4 과엄격), `thinking` 필드 검토(카탈로그 확장과 함께) ④ **gpt-oss `nonExpertGB` 과소**(P1-2 §5): GGUF 텐서 목록 기반 비전문가 크기(모델별 override + validateAll 허용 오차) — 그때까지 `--n-cpu-moe` 최소값은 +1층 여유(§4 D23)
- **원화 가격**(ko, `docs/01` §6) — `streetKRW` 데이터 0건, 환율 주간 갱신 파이프라인과 함께

**사람 작업 (YOO)**
- [ ] 도메인 결정·구매 — P1-5 전까지 (후보·기준: `MASTER_PLAN.md` §10). 연결 = CF Pages 커스텀 도메인 + `NEXT_PUBLIC_SITE_URL`(기본값 `https://canrun.pages.dev`, `apps/web/lib/site.ts`). 빌드가 Actions(`deploy.yml` → wrangler Direct Upload)라 **CF 대시보드 env는 효과 없음** — `deploy.yml` Build 스텝 env로 주입하는 코드 변경 필요(daily-rebuild는 deploy.yml 재사용). 전환 후 pages.dev → 커스텀 도메인 리다이렉트 검토
- [ ] P0-5 자체 실측 — RTX 5060 Ti 16GB(`rtx-5060-ti-16gb`) + RAM 16GB, `docs/03` §6 A~E그룹. AC(`docs/06`): own ≥30행 + gpt-oss-20b 111.6 tok/s ±15% 재현. 결과는 `data/benchmarks.json`에 sourceType `own`으로 — 스키마상 `sourceUrl`(URL) 필수라 원시 로그 공개 위치를 입력 전에 정해 §4에 기록. 출시 전 "실측 배지"의 원천
- [ ] P1-4 에디토리얼 감수 (특히 ko)
- [ ] P1-5 출시 주: GSC·네이버 서치어드바이저 소유 확인·사이트맵 제출(본인 계정 — Claude는 확인용 메타태그·파일까지). P1-6부터 주간 GSC 수치 전달(인덱싱 게이트 기록용)
- [ ] 커뮤니티 게시(아카라이브·r/LocalLLaMA)는 본인 계정으로만 — `docs/04` §8 ⑥·`docs/06` Phase 1.5 (Claude는 초안까지)
- [ ] (선택) HF read 토큰을 Actions Secret `HF_TOKEN`으로 — 워크플로·스크립트 배선은 완료(`data-sync.yml` env). 토큰 계정으로 gated 5종 라이선스 동의 필요. 효과: full attention 3종(llama 2·HCX SEED 1.5B)은 arch 자동 검증, gemma-3 2종(swa·override 없음)은 manual 리포트까지
- [ ] (선택) 로컬 gitleaks 설치(winget) — 규칙 7 "커밋 전 gitleaks"를 로컬에서 지키게 된다(§4 09-28). 허락하면 Claude가 설치

## 3. 운영 루틴 (대부분 위임 — Claude가 `/canrun-start`에서 처리하고 결과만 보고. 사람 몫은 행에 표시)

| 주기 | 할 일 | 처리 기준 |
|---|---|---|
| 매주 화 06:00 KST 이후 | data-sync PR(`chore(data): weekly HF sync`, 브랜치 `data/hf-sync`) | 리포트가 SUSPICIOUS 0·ERROR 0이면 머지(위임), 아니면 보고. GITHUB_TOKEN이 만든 PR이라 CI job이 돌지 않는 게 정상(job 0개 런이 대기하다 failure로 기록됨 — §5) — sync job은 validate-data·`pnpm test`(엔진 회귀)만 사전 수행하고 typecheck·lint·build·test:export는 돌지 않는다. **P1-1 이후(데이터가 페이지를 생성)엔 PR을 close→reopen해 CI 초록을 본 뒤 머지**(`data-sync.yml` 헤더 주석). 리포트 action 열: `auto` 중 model-quants fileGB 행은 \|Δ\|≤5%라 정상, models.json 쪽 auto 행(arch.*·kvBytesPerTokenF16·nonExpertGB)은 Δ 임계 없이 반영되니 값 변화·출처 확인 · `auto ⚠SUSPICIOUS`(fileGB \|Δ\|>5%)도 이미 반영된 값이라 머지 전 출처 확인 · `manual`·`skipped`는 미반영 — §5 상시 항목 외 새 manual 행은 별도 데이터 태스크로. 새 PR이 없으면 ① 열린 `data/hf-sync` PR이 갱신됐는지(같은 브랜치라 기존 PR에 쌓임) ② 변경 0 ③ job 실패(ERROR 행·검증 실패 시 exit 1) 순으로 확인 |
| 매주 월 06:30 KST (P1-5부터 매일) | new-model 요약 이슈 | 후보마다 HF 공개 API로 파라미터·GGUF 확인 → 가치 판정 → 높음은 백로그 「카탈로그 확장」, 본선 미지원은 그 대기 목록에 추가, 이슈는 사유 코멘트와 함께 닫기(위임). 백로그에 번호가 있는 이슈는 재판정하지 않는다. 알림 자체가 카탈로그·기보고·리팩·OCR·타 org 파생을 거르므로 남은 후보만 보면 된다 |
| 매월 | Dependabot PR | npm minor/patch 그룹·GitHub Actions 액션 = CI 초록이면 머지(위임 — CI가 안 도는 워크플로의 액션이면 머지 후 `workflow_dispatch`로 확인) / npm 메이저 = 권고와 함께 보고 / eslint 10(#85)·typescript 6(#5)은 백로그 |
| 매주 (P1-6부터) | GSC 수치 → 저장소 기록 | **사람**이 수치 전달 → Claude가 기록. 인덱싱 ≥80% 게이트 (`docs/06` P1-6) |
| 마일스톤마다 | 외부 리뷰 (§6) | **사람**이 리뷰어에게 브리프 전달 → Claude가 판정·수정. P1-2 후 필수 권장 |

## 4. 결정 기록 (바꾸려면 근거와 함께 여기 갱신)

| 날짜 | 결정 | 근거 |
|---|---|---|
| 08-15 | Next.js 16.3 채택 (계획서의 15 대신) | 착수 시점 안정판. 기록: `docs/05` §1 |
| 08-15 | i18n A안: en 루트 + `/ko/` | next-intl as-needed + 빌드 후 평탄화 + `/en/*`→`/:splat` 301 안전망, `test/export-invariants` 재귀 검사. `docs/05` §1 |
| 08-15 | 실측 리그 = RTX 5060 Ti 16GB + RAM 16GB (5090 미보유 — 필요 시 클라우드 렌트로 스팟 검증) | 하이엔드는 공개 실측 시드로 커버, 16GB가 수요 최대 세그먼트 (`docs/03` §6) |
| 08-15→16 | calibrated 밴드 클래스별: NVIDIA·AMD dGPU dense(full-gpu) ±12% / 그 외·MoE·부분 오프로드 ±20% | 밴드가 검증 max 오차(17.1%, `docs/02` §7)보다 좁으면 안 됨 — 계획서 외부 리뷰. 계획서 `docs/02` §4에 이미 있었고, `66a42fb`에서 CLAUDE.md 규칙 3의 구 단일 ±15%를 정렬(`docs/01` §3·헬로 페이지 문구는 09-29 P1-1에서 정렬) |
| 08-16 | 부분 오프로드 CPU측 가중치 = weights − max(0, usableVram − kv − buffer) | 외부 리뷰 P1(거짓 양성, `c66f9ff`) — 반례 회귀 테스트로 고정. `docs/02` §2.4 식은 09-29 P1-1에서 코드 기준으로 갱신 |
| 08-16 | P0-3 스키마 명세 이탈: Gpu.kind `'cpu'` 추가 · unified/cpu는 vramGB 대신 `ramOptionsGB[]` · BenchPoint modelId/quant 자유 문자열 | `packages/data/src/schema.ts` 헤더 주석. `docs/03` §1은 09-29 P1-1에서 동기화 — 코드가 정본 |
| 08-19 | Q2_K 유령 5행 → `UD-Q2_K_XL` 실파일 행으로 교체. QuantId에 `UD-Q2_K_XL`·`UD-IQ2_M` 추가(NATIVE_QUANTS 취급, fileGB 필수 — UD-IQ2_M 데이터 행은 아직 0) | 재라벨 기각 — 사용자가 받을 파일명과 일치해야 함 |
| 08-19 | 비-full attention 모델의 `attnOverrides` = config `layer_types` 실측 (08-19 8종 → 08-26 EXAONE 4.0-32B·4.5-33B·Solar Open2 추가로 현 11종. gemma-3 2종은 gated라 override 없음) | gemma-4-12b KV 2.7× 교정 등. 근거 없는 상수 금지 — nonExpertGB 미문서 모델은 생략 |
| 08-19 | 매처: 플레인 quant 우선, 없으면 UD 폴백 (repo 종류 무관) | UD 전용 MTP repo 대응 + 동시 배포 repo 합산 오염 방지 |
| 08 하순 | 저장소 설정 "Allow GitHub Actions to create and approve pull requests" ON | data-sync PR 자동 생성에 필요. 09-28 API로 확인(`can_approve_pull_request_reviews: true`) |
| 08-26 | 한국 모델 9종 등재 (EXAONE 4.0/4.5·Kanana 1.5·HCX SEED·Solar Open) | 글로벌 경쟁 도구 커버리지 0 — `/ko/` 고유 콘텐츠. K-EXAONE·Kanana 2 보류(`research/models.md` §1G) |
| 08-26 | 특이 라이선스(EXAONE NC 등)는 "표시 정보" | 사이트 리스크 아님 — 배지로 사용자 가치화 |
| 09-27 | GitHub 조회는 `gh` CLI 로그인으로만 — git 자격증명·credential helper에서 토큰 추출 금지 | 추출한 토큰이 도구 출력·대화 기록에 남는다(규칙 7 취지). `gh` 미설치 시 GitHub 항목은 "미확인"으로 보고 |
| 09-27 | 외부 리뷰 기준 커밋 = `fe21e98` (Cowork 초안의 "c66f9ff 이후"를 정정) | `c66f9ff`는 fe21e98 리뷰의 반영분이고, 그 사이 `66a42fb`(P0-3 스키마·시드 v1)와 반영분 자체는 리뷰를 받지 않았다 |
| 09-28 | **운영 위임**: 반복 잡일(Dependabot·data-sync 머지, new-model 트리아지·닫기, 게이트 통과 커밋 푸시)은 Claude가 확인 없이 처리 — 범위는 `CLAUDE.md` "세션 운영". 자동 모드 허용 규칙은 `.claude/settings.local.json`(개인, 커밋 안 됨, force push 거부) | 사용자 요청 — 사람 개입을 사람만 할 수 있는 일(결제·본인 계정·실측·감수)로 한정. 자동 모드는 허용 규칙 없이는 리뷰 없는 머지·외부 쓰기를 막는다 |
| 09-28 | new-model 알림: 매일 모델별 이슈 → 새 후보가 있을 때만 요약 이슈 1건, 출시 전 주 1회(P1-5부터 매일). LLM 파이프라인에 `image-text-to-text` 추가, 리팩·OCR·타 org `base_model` 파생 자동 제외, 기보고 id 정확 일치 제외(`a09a12f`, `docs/03` §5.2 갱신) | 한 달 71건 중 57건이 트리아지 탈락, Qwen3.6+ 원본은 멀티모달 태그라 한 번도 감지되지 않았다. 48h SLA는 출시 후에만 의미 |
| 09-28 | Dependabot 주간 → 월간 (`a09a12f`) | 출시 전 잡일 축소 |
| 09-28 | 큐 정리: 스펙 문서 동기화는 P1-1 첫 단계로 흡수, 카탈로그 확장·TS 6·eslint 10은 출시 후 백로그 | 출시 크리티컬 패스(P1-1~P1-5)에 집중 |
| 09-27 | ~~로컬 gitleaks를 못 돌리면 `/canrun-wrap`은 커밋 전에 멈추고 사용자 확인~~ → 09-28 대체 | 규칙 7 "커밋 전 통과" 유지 목적이었으나 이 PC에선 매 태스크가 멈췄다 |
| 09-28 | 로컬 gitleaks 도구가 없거나 실행이 실패하면 추가 줄 시크릿 정규식 스캔 + 푸시 후 CI gitleaks 확인으로 대신한다 | 이 PC엔 gitleaks 바이너리가 없고 Docker 데몬도 뜨지 않는다. 규칙 7 "커밋 전 gitleaks"의 **임시 예외**(CLAUDE.md 규칙 7에 이 행 참조) — 로컬 gitleaks를 설치하면 해제. 한계: CI gitleaks는 같은 push의 Deploy를 막지 못하는 사후 확인이다 |
| 09-28 | 재개 점검 트리아지: new-model 71건 → 높음 14 유지(백로그 입력) · 본선 지원 대기 7 유지 · 50건 닫기(이슈별 사유 코멘트) | 기준: 원본 여부 · 소비자 HW 구동 가능성 · GGUF/llama.cpp 본선 지원 · 카탈로그 중복 |
| 09-29 | **D1 허브 전체 생성·index** (GPU 54 + 모델 29 = 83 × 2언어) — `publishBatch`는 콤보 전용. 배포 즉시 pages.dev에서 index 가능(사이트맵·GSC 제출은 P1-5, 도메인 전환 때 캐노니컬 호스트 이동) | 사용자 승인(P1-1 계획, 규칙 5 배치 확대 — 계획상 "허브 50"은 GPU 30+모델 20 시절 수치). 허브마다 모델/GPU 수십 행의 고유 계산 데이터라 스케일드 콘텐츠 위험 낮음. `docs/04` §3·`docs/01` §5·`docs/05` §3 동시 갱신 |
| 09-29 | **D2 dGPU 허브 가정** = 시스템 RAM 32GB DDR5-5600 2ch(대역폭은 `cpu-ddr5-5600-2ch` 조회) · Windows 디스플레이 GPU · ctx 8k · KV f16. 64/96/128GB에서 판정이 나아지면 RAM 힌트 | 사용자 승인. 판정이 RAM에 좌우되는 cpu-moe·부분 오프로드 때문에 기본값이 필요했으나 문서가 없었다(engine-smoke만 32GB). `docs/01` §3 |
| 09-29 | **D3 GGUF 출처 3단**: 공식(repo owner = `hfId` owner) / llama.cpp 팀(`ggml-org`) / 커뮤니티(+업로더명) | 사용자 승인. 제작사 공식이라고 단정하지 않으면서 ggml-org의 신뢰도는 살린다. naver-ellm은 HF 미인증 org → 커뮤니티(§5) |
| 09-29 | **D4 허브 판정 조립 규칙** (`packages/data/src/assess.ts`, `docs/01` §3 「허브 판정 규칙」): 기준 quant(Q4_K_M→MXFP4→bpw 최근접) · 추천 quant(품질 상향 금지, desperate는 비-desperate 전부 F일 때만, 표기엔 "품질 손실 큼") · 실측 조인(정확 일치 + fit + dGPU는 full-gpu만) · theoretical 6조건(`docs/02` §4) · 판정 사유 = 실제로 걸린 규칙 · 최저가 = 쾌적 최저가 + 더 싼 원활 · 통합 메모리 CPU 경로 대역폭은 기존 계수 비율로 제한 | 계획 검토(전 카탈로그 2,378 구성 시뮬레이션)가 원안의 품질 상향 추천 1,027건·desperate 추천 341건을 잡았고, 구현 후 5관점 적대적 리뷰가 17건(P1 4)을 확정 — 사유 문구·배지 모순 80행, 통합 메모리 cpu-only 역전 12건 등. 엔진 상수는 무변경(규칙 1) |
| 09-29 | **D5 리즈닝 ×1.5 대상 = `category`에 reasoning** (engine-smoke 관례) | 대안(`thinking` 필드)은 모델 카드별 검증이 필요해 P1-1 범위 밖 — phi-4는 과엄격(보수 쪽). 백로그 「엔진 후속」③ |
| 09-29 | **D6 JS 예산 = 모듈 스크립트 gzip 전송량**(LHCI `resource-summary:script:size` ≤150KB). `NextIntlClientProvider` 제거, 내부 링크는 `<a>`, 서버 페이지는 `i18n/navigation.ts`(createNavigation) import 금지 → `lib/links.ts` `localeHref` | 기준선 홈 148KB → 131KB. createNavigation을 import만 해도 next-intl 클라이언트 Link가 끌려와 intl-messageformat(13.7KB)이 전 페이지에 실렸다. `docs/01` §7 |
| 09-29 | **D7 브레드크럼 2단**(홈 › 허브) — `/gpu`·`/model` 인덱스 페이지 없음 · **D8 FAQPage 유지하되 리치 결과 기대 안 함** | Google은 마지막 외 항목에 URL 요구. FAQ 리치 결과는 2023~ 정부·보건 한정. FAQ 답 = 화면 텍스트(export 테스트 강제). `docs/04` §5 |
| 09-29 | FP16 크리플 GPU(GTX 10)는 CPU 폴백 대신 **GPU 판정 + theoretical + 주의 배지** — `docs/01` §9 개정 | tg는 대역폭 지배라 Pascal에서도 GPU가 CPU보다 빠르다. CPU 폴백은 더 느린 경로로 안내한다(스펙 이탈 — 리뷰 지적) |
| 09-29 | 산출물 테스트 확장(9→19): 허브 전수 존재·JSON-LD(BreadcrumbList URL·FAQ 텍스트 일치)·수치 문장의 밴드 동반·title/description 유일·고아 0(스위처 링크 제외)·ko 내부 링크 /ko만·en 페이지 한글 0 + Playwright 18·LHCI 4URL×3회 median | AC "대칭 hreflang 테스트"는 기존 불변식이 166허브에 자동 적용 — 확장분은 규칙 3·4·5 회귀 방지 |
| 09-29 | **D9 콤보 전 조합 생성(1,566 × 2언어) + `data/publish.json` 인덱싱 게이트** — `{ currentBatch, batches[{batch, gpuIds, modelIds}] }`, 콤보 배치 = 쌍을 포함하는 항목의 최소 batch, indexable ⇔ batch ≤ currentBatch. 출시값 currentBatch 0(전부 noindex,follow), 배치 1 후보 10 GPU × 6 모델 등록. 미공개 콤보는 허브·홈에서 링크 0(계산기 딥링크·미공개끼리 인접 링크로만), 공개 페이지는 공개 콤보로만 링크 | 사용자 승인(P1-2 계획). "수요 없는 콤보는 생성하되 noindex"(`docs/04` §3). 내부 nofollow 비권장·3.3K는 크롤 예산 우려 규모 미만(계획 리뷰). `docs/04` §3·`docs/05` §3·`docs/03` §1·CLAUDE.md 규칙 5 갱신 |
| 09-29 | **D10 콤보 브레드크럼 3단**(홈 › 모델 허브 › 콤보) · **D11 콤보 클라이언트 JS 0** — ctx×KV(f16/q8_0/q4_0) 정적 표, 토글은 P1-3 · **D12 허브 → 공개 콤보 "상세" 링크**는 판정 셀 배지 아래(`data-combo-link`) | 사용자 승인(인터랙션 이월). 중간 crumb 에 URL 필요(Google). `docs/01` F3 |
| 09-29 | **D13 pp 는 full-gpu(통합 포함)·fit 일 때만** 표시, `docs/02` §3.5 "대략 ±40%" → **4번째 신뢰 라벨 `rough`(pp 전용)** + 범위 표기. 밴드 상수 `PP_BAND`는 packages/data 정책 | `ppEstimate`는 fp16 연산식이라 partial/cpu-moe/CPU 엔 성립하지 않음(계획 리뷰: 316+188+104행이 오도). CLAUDE.md 규칙 3·`docs/01` §3·`docs/02` §4 갱신 |
| 09-29 | **D14 콤보 제목·판정 문장**: `Can I run {model} on the {gpu}? {verdict}` / `{gpu}에서 {model} 돌릴 수 있을까? {verdict}` — 제목 판정은 기준 비-F → 판정 / F + 추천(desperate 포함 — 본문 표시 quant 와 같은 답) → "{verdict} at {quant}" / RAM 힌트 → "{verdict} with N GB RAM" / 그 외 F. 콤보 제목은 `absoluteTitle` + `shortGpuName`(브랜드 접두·마케팅 괄호명·"dual-channel" 제거, "(N-core GPU)"→"N-core"). 판정 문장 = 헤더·description·FAQ Q1 단일 출처, 이모지 없음 | 기준 판정만 쓰면 "IQ3_XS 로는 원활" 페이지 제목이 Won't run 으로 거짓(계획 리뷰). desperate 추천을 제목에서 빼면 본문("UD-Q2_K_XL 가능")과 제목("RAM 64GB 면")이 모순(구현 리뷰). 실측 최장 제목 82자(DeepSeek R1 Distill Qwen 32B × 4060 Laptop, 72자 초과 120건 — 검색 결과는 ~60자에서 잘리므로 판정은 긴 이름에서 어차피 뒤로 밀린다) |
| 09-29 | **D15 깊이 테스트** = GPU명·id·별칭·shortGpuName·GpuName 오버라이드 마스킹 후 숫자 다중집합 지문이 로케일 내 1,566 콤보에서 유일 + mulberry32(20260929) 3페이지 기록 · **D16 보일러플레이트** = 콤보 ≥50%에 나타나는 문장 단위(p/li/h/td/th/dt/dd/caption/code, 이름 마스킹, 8자 미만 제외) 글자 비율 < 0.6 — 실측 en max 0.39 / ko 0.31 · **D17 export 테스트 lazy facts**(HTML 즉시 폐기, 3,302페이지 ~5s) | `docs/06` P1-2 AC·`docs/04` §4. 쌍둥이 GPU 7그룹(§5)은 FP16·pp·가격·인접 GPU 로 구분 |
| 09-29 | **D18 postbuild RSC 페이로드 프루닝**(`__next.*` 디렉터리 + 허용목록 `robots.txt|ads.txt|llms.txt` 외 `*.txt`, 평탄화 전) — 3,302페이지 = 3,315파일(Cloudflare Pages 한도 20,000의 17%; 프루닝 없이는 ~16,500) | 앱은 `<a>`만 쓰고 next/link·router 없음 — Next 16.3.6 클라이언트가 `.txt`를 요청하는 경로는 `fetchServerResponse`(navigate/prefetch/refresh)뿐, 뒤로가기 복원은 CacheNode 재사용(소스 확인). 안전망: export 파일 위생 테스트 + E2E goBack 실패 요청 0. `docs/05` §3 |
| 09-29 | **D19 LHCI `assertMatrix`**: 전 URL performance·accessibility·best-practices ≥0.9·script ≤150KB·CLS ≤0.1 / 비콤보 SEO ≥0.9 + LCP warn 2.0s / **콤보 LCP error 2.5s + 개별 SEO 감사 8종 = 1**(noindex 로 `is-crawlable` 실패 → SEO 카테고리 0.63) — `docs/05` §6 "LCP < 2s"는 필드 목표 | Lantern 비관 그래프가 131KB Next 런타임을 렌더블로킹 취급 → 5KB 홈도 ~2.0s 바닥(콤보 실측 1.9s). 개별 감사는 Edge 로컬 실측 전부 1 |
| 09-29 | **D20 `ModelQuant.fileName`**(zod optional, validateAll 이 전 행 존재 강제, sync-models 가 기록 — 분할은 첫 조각, UD 는 이름 유지) + 매처 드래프트 제외(`mmproj`·`mtp-`·`eagle3-` basename 접두) + 애매 매칭 error | 스니펫의 HF 태그·다운로드 안내 정본. 드래프트 합산 버그로 gemma-4-12b Q8_0 13.13→12.67·gemma-4-26b-a4b Q8_0 27.32→26.86 교정(sync 리포트 auto 102·suspicious 0·error 0). `docs/03` §1·§5.1 |
| 09-29 | **D21 `generateBuildId: () => GITHUB_SHA ?? 'local'`** — 두 번 빌드 `diff -rq` 0건(바이트 동일) 확인 후 채택 | 매일 리빌드가 3.3K HTML(~230MB)을 전량 재업로드하지 않게. 청크는 내용 해시 |
| 09-29 | **D22 쌍둥이 GPU**(메모리 구성 동일 7그룹) 페이지에 형제 문장 + pp 비교, 같은 배치에 쌍둥이 금지 · **D23 `nCpuMoeMin` 네이티브 quant(MXFP4)·Unsloth Dynamic(UD) 파일 +1층 여유** | gpt-oss 비전문가 텐서는 Q8_0(GGUF 헤더 파싱: 20b 1.30GB·120b 1.69GB GPU 상주) vs 균등 bpw 유도 0.65/0.81 — 여유 없이는 4060×gpt-oss-20b N_min 12가 0.24GB 초과. UD 도 어텐션·공유 텐서를 평균 bpw 보다 높게 둬 같은 방향(구현 리뷰). 백로그 「엔진 후속」④ |
| 09-29 | **표시 필요량 = 엔진 비교량** `MemoryNeed.needGB`·`CtxCell.needGB`: CPU 경로(CPU 프로필·cpu-only 모드)는 가중치+KV, GPU 경로는 +연산 버퍼(`totalNeedGB`). 콤보·허브의 "필요 vs 가용" 문장과 ctx 표가 이 값을 쓴다 · F+RAM 힌트 페이지는 메모리·ctx·속도·FAQ 문장마다 힌트 구성(예 96GB)을 명시 | 브라우저 확인에서 CPU 페이지가 "6.6GB 필요"(버퍼 포함)와 "RAM 6.0GB에서 실행"을 나란히 보였음 — 엔진 §2.4 ④는 가중치+KV 만 비교. 힌트 페이지는 32GB 페이지에 96GB 수치가 무표기로 섞였음 |
| 09-29 | 스니펫 규칙: `-ngl all`(full/unified) · partial `floor(gpuFrac×layers)`(4,183 조합 예산 초과 0 — llama.cpp 는 출력층 우선·입력층 CPU) · cpu-moe `-ngl all --n-cpu-moe {layers}`(엔진 §3.3 가정) + N_min · Ollama 는 `hf.co/{repo}:{tag}` + `OLLAMA_CONTEXT_LENGTH` 서버 env/`/set parameter num_ctx`, cpu-moe·분할 GGUF 는 생략(전문가 오프로드 플래그 없음·분할 미지원 매니페스트 400 확인) | llama-server README·HF ollama 문서 인용은 `packages/data/src/snippet.ts` 헤더 |

## 5. 알려진 이슈·주의

- 플레인 파일이 없는 unsloth repo(Qwen3.5 MTP-GGUF 4종·gemma-4-26b-a4b)의 `Q4_K_M` 등 행은 매처가 `UD-*` 실파일 크기를 취한 값(`scripts/sync-models.ts` matchQuantFiles). 데이터엔 실파일명·UD 여부가 없다 → 스니펫·다운로드 안내 실파일명은 P1-2에서 필드 추가 필요
- qwen3.5-35b-a3b nonExpertGB(1.22)는 UD-Q4_K_M 유래 크기(22.63)에 bpw 균등 근사를 적용한 값. UD는 중요 레이어 bpw를 올리므로 비전문가 텐서가 과소 추정됐을 수 있다(cpu-moe 판정이 낙관 쪽, 미검증) → P0-5 실측으로 확인
- 재확인 플래그: HCX SEED Think 14B의 llama.cpp 구동 여부(커스텀 arch — P0-5 E그룹에서 실기 검증) · Kanana 1.5 A3B의 active 3B는 비공식 수치 · HCX SEED 1.5B ctx 카드 16k vs 미러 config 131k
- gated config 5종(meta-llama 2·gemma-3 2·HCX SEED 1.5B)은 수동값 — sync는 skipped로 리포트. HCX 1.5B arch는 llamafied 미러(minpeter) config 유래라 HF_TOKEN 도입 후 첫 런 리포트를 확인
- nonExpertGB 미확정: qwen3.5-122b-a10b · gemma-4-26b-a4b(experts/topK 미문서 → MOE_ARCH 미등록) · solar-open2-250b(320E top-8은 명기, 기준 quant Q4_K_M/MXFP4 GGUF 부재) — 근거 확보 전 생략 유지
- qwen3-8b·14b·32b maxContext: config 40960 vs 시드 32768(카드 명기 네이티브 ctx — YaRN 적용 시 131k). sync는 maxContext를 항상 manual로 리포트하니 시드 유지
- new-model 필터는 이름 휴리스틱(`REPACK_PATTERN`·`ocr`)과 HF `base_model` 태그 기반이다 — 태그 없는 타 org 파인튠은 통과하고, 이름에 fp8·mlx 등이 든 원본은 빠질 수 있다. 요약 이슈 트리아지에서 보정하고, 반복되면 `scripts/new-model-alert.ts` 필터를 고친다
- PR #5 (typescript 5.9.3→6.0.3, 브랜치명은 7.0.2): Typecheck 실패 원인 확인됨(CI 런 31937998006 로그 — 보존 90일) — `packages/engine`·`packages/data` tsconfig에 `types`가 없어 TS 6에서 `@types/node`가 로드되지 않는다(TS2591 `node:fs`, TS2304 `structuredClone`·`console`, 연쇄 TS7006). 루트 `tsconfig.json`에만 `"types": ["node"]`가 있다
- `data/hf-sync` PR에 생기는 CI 런은 job이 0개라 로그가 없고, 대기하다 30일 경과·PR 종료 시 failure로 기록된다(08-26·09-01 런) — GITHUB_TOKEN이 만든 PR의 동작이라 게이트 실패가 아니다. 실패 건수에서 뺀다
- **쌍둥이 GPU 7그룹**(VRAM·대역폭·클래스 동일, FP16 만 다름): RX 9070/9070 XT · RTX 4090/3090 Ti · 5070 Ti/5080 Laptop · 5070/5070 Ti Laptop · 4070/4070 Super · 5060/5060 Ti 8GB/3070 · 4060 Laptop/4070 Laptop — 콤보 페이지가 근접 중복이라 형제 문장·같은 배치 금지(§4 D22). 카탈로그 확장 때 `twinGpus` 로 재확인
- **gpt-oss `nonExpertGB` 과소**(0.65/0.81 vs 실제 GPU 상주 1.30/1.69GB): fit 판정은 안 뒤집히지만 `--n-cpu-moe` 최소값이 1층 OOM → +1층 여유(§4 D23). 근본 해결은 백로그 「엔진 후속」④
- **Lighthouse LCP 바닥 ~2.0s**(Lantern 비관 그래프 + 131KB Next 런타임): 5KB 홈도 2.04s. 콤보 게이트는 2.5s(§4 D19). 런타임을 줄이지 않는 한 2.0s error 는 걸 수 없다
- **오래 noindex 였던 URL 은 재크롤이 느리다**: P1-6 배치 개방 후 sitemap 제출·GSC 색인 요청, 4주 게이트 기산은 재크롤 확인 시점(`docs/04` §3). robots.txt 가 `/can-i-run/` 을 Disallow 하면 noindex 를 못 읽는다 — 금지
- 콤보 export 테스트(`test/export-invariants.spec.ts` + `test/export-facts.ts`): 콤보 0건이면 조용히 통과하지 않고 실패한다. 허브 범례 `<dd>`("20 tok/s 이상")는 임계값 문장이라 규칙 3 범위 검사에서 제외 — 콤보엔 범례를 넣지 않는다
- **cpu-moe 속도 과소 추정**: 엔진 cpu-moe tg가 `docs/02` §3.3 앵커(3060 12GB + DDR5, Qwen3.6-35B-A3B ~52 tok/s) 대비 약 2.5× 낮다(qwen3.5-35b-a3b 20.4). 교정 전까지 cpu-moe는 theoretical ±30%로 표시(`assess.ts` isTheoretical) — 판정은 보수 쪽(8~20 → B). P0-5 B그룹 실측으로 교정(백로그 「엔진 후속」①)
- 엔진 `verdict.ts`의 §3.4 B 상한(gpuFrac < 0.9)이 nonExpertGB 없는 MoE(gemma-4-26b-a4b·qwen3.5-122b-a10b·solar-open2)에도 적용된다 — 스펙은 dense 한정. 해당 조합은 theoretical로 표시 중(백로그 「엔진 후속」②)
- naver-ellm(HyperCLOVA X SEED Think 14B GGUF)은 HF 미인증 org라 "커뮤니티"로 표시 — 네이버 공식 여부 확인되면 `HUB_POLICY.llamaCppOrgs`처럼 공식 매핑 추가 검토
- 로컬 E2E·Lighthouse(이 PC엔 Chrome·Playwright 브라우저 없음 → 설치된 Edge 사용): `pnpm build` → `pnpm serve-out`(백그라운드) → Playwright는 저장소 설정을 상속하고 `projects[0].use.channel = 'msedge'`로 바꾼 임시 설정(`webServer`는 저장소 루트 cwd가 필요하니 서버를 먼저 띄워 재사용), Lighthouse는 `CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"` + `node <lighthouse>/cli/index.js <url> --chrome-flags=--headless=new`. `lhci autorun`은 Windows에서 chrome-launcher 임시 프로필 정리 EPERM으로 실패 처리된다(LHR은 생성) — CI(ubuntu)가 기준
- Next 16.3 static export on **Windows**: 세그먼트 프리페치 파일이 `__next.$d$locale/__PAGE__.txt`처럼 중첩 경로로 기록돼 next/link 프리페치가 404(Linux 빌드는 평탄 — 미확인). 현재는 next/link를 쓰지 않아 무영향(D6), 클라이언트 네비게이션을 도입하면 재확인
- Cloudflare Pages의 점 포함 슬러그(`/model/qwen3.5-9b` → `.html`) 매핑은 문서에 없다 — 09-29 라이브 확인: 200(ko·`llama-3.1-8b` 포함), `/en/*` 301 정상. 향후 404가 보이면 postbuild가 `_redirects` 200 rewrite를 생성하도록 고친다
- 이 PC의 Claude 세션 셸엔 `gh`가 PATH에 없을 수 있다(설치 전에 열린 세션) → Bash에서 `"/c/Program Files/GitHub CLI/gh.exe"`. 앱을 다시 시작하면 해소
- gitleaks: Windows 로컬엔 바이너리 없음(§4 09-28). Docker Desktop이 뜨면 CI와 같은 이미지로 돌릴 수 있다. ci.yml 명령은 그대로 쓰면 안 된다 — Git Bash는 MSYS 경로 변환이 `/repo` 인자를 망가뜨리고, PowerShell은 `"$PWD:"`를 파싱하지 못한다
  - Git Bash: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --config /repo/.gitleaks.toml --log-opts="--all" --redact`
  - PowerShell: `docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --config /repo/.gitleaks.toml --log-opts="--all" --redact`

## 6. 외부 리뷰 절차 (다른 모델로 교차 검증)

1. 커밋이 끝난 상태에서 격리 클론(로컬 클론은 커밋분만 복사 — 미커밋 수정은 빠진다): `git clone D:\workspace\canrun-plan C:\Temp\canrun-review-<N>` — 라이브 폴더 직접 검토 금지
2. 클론에 들어 있는 `docs/review-brief.md`를 리뷰어(Codex 등)에게 주고 "이 브리프 지시대로 검토" 요청
3. 결과를 Claude Code에 붙여넣어 P1/P2/P3 판정 → 수용분을 수정 태스크(예: P1-2b)로 한 세션에 처리 → §4·§7에 기록하고 아래 **리뷰 기준 커밋**을 이번 리뷰 대상 HEAD로 갱신
- **리뷰 기준 커밋: `fe21e98`** → 다음 리뷰 범위 `fe21e98..HEAD` (`66a42fb` P0-3 스키마·시드 v1과 `c66f9ff` 반영분, P1-1·P1-2 전체가 미검토 — P1-2 완료 후 외부 리뷰 권장, `docs/review-brief.md` 갱신됨)
- 이력: 계획서 외부 리뷰 8건 중 7건 수용(v2~v4 — 저장소 밖 기획 단계, 저장소엔 최종본 `03337a8`만) · P0-1~P0-2 코드 리뷰(기준 `fe21e98`) 10건(P1 1·P2 5·P3 4) 전부 반영 `c66f9ff`

## 7. 이력 (최신이 위)

- **09-29** `91fb743` **P1-2 콤보 템플릿** — `/can-i-run/{model}/on/{gpu}` 1,566 × en/ko(총 3,302페이지), 전부 noindex(`data/publish.json` currentBatch 0, 배치 1 후보 10×6). 8요소: quant×fit 표·VRAM 분해 바·ctx×KV(f16/q8_0/q4_0) 정적 표·tg/pp 밴드·실측 표·대안 0~3·llama.cpp/Ollama 스니펫(`-ngl`·`--n-cpu-moe` N/N_min·실파일명 태그)·FAQ 3 + 인접 콤보 4·양쪽 허브·3단 브레드크럼. 데이터: `fileName` 100행 백필 + 드래프트 파일 합산 버그 교정 2행. 인프라: RSC 페이로드 프루닝(3,315파일), `generateBuildId`, export 불변식 lazy facts 32(깊이·보일러플레이트 en 0.39/ko 0.31·noindex·링크 규칙·파일 위생), Playwright 42(goBack 포함), LHCI 6URL assertMatrix. 설계 검토 3 + 계획 리뷰 3(확정 반영) + 구현 후 5관점 적대적 리뷰 25건(3표 검증: 확정 6 · 기각 19 — 기각 대부분은 검증 전에 이미 수정된 항목, 전부 반영) + 브라우저 확인 2건(필요량 표기·RAM 힌트 가정). 결정 D9~D23(§4). 로컬 게이트 전부 통과(단위 297 · export 32 · E2E 42 · LH 콤보 perf 1.0·a11y 1.0, LCP ~1.9s — Edge 절차 §5)
- **09-29** `9dab66e`·`4419aa1` **P1-1 허브 템플릿** — GPU 허브 54·모델 허브 29 × en/ko(168페이지). 판정 조립 `packages/data/src/assess.ts`(엔진 무변경) · 판정 배지·밴드+신뢰 라벨·JSON-LD·페이지별 로케일 전환 · next-intl 클라이언트 번들 제거(JS 146→131KB) · CI에 Playwright 18·LHCI(4 URL × 3회 median) + serve-out, export 불변식 9→19. 스펙 동기화(docs/01·02·03) + 결정 D1~D8(§4). 계획 교차 검증 3건 + 구현 후 5관점 적대적 리뷰(확정 17 · 기각 10) + 재검증 반영. 로컬 게이트 전부 통과(단위 251 · export 19 · E2E 18 · LHCI 4 카테고리 0.99~1.0 — Edge 대체 절차 §5), gitleaks는 로컬 도구 없어 정규식 스캔 0건. 푸시 후 CI(Playwright·LHCI·gitleaks 포함)·Deploy 초록, 라이브 허브 200
- **09-28** 재개 점검 완료 + 운영 위임 — PR #31(data sync, fileGB 12행 \|Δ\|≤3.63%)·#72(npm minor/patch 13건: next 16.3.5·react 19.3·zod 4.6 등)·#28(peter-evans v8, Data sync 수동 실행으로 확인) 머지 · new-model 71건 트리아지(50건 닫음, 21건 유지) · `a09a12f` 알림 요약 이슈 전환·필터 + Dependabot 월간 · `6b6fcbf` 운영 위임 규칙 + 재개 점검 기록(CLAUDE.md 위임 범위·명령 2종·HANDOFF·이 파일) — 푸시 후 CI(gitleaks 포함)·Deploy 초록 · dependabot.yml 변경으로 Dependabot 재실행 → #84(npm minor/patch 7건: next 16.3.6 등) 위임 머지, #85(eslint 10.11)는 #4를 대체해 보류
- **09-27** `docs: Claude Code 운영 이관` — Cowork → Claude Code 운영 이관(이 파일·`docs/review-brief.md`·커스텀 명령 `/canrun-start`·`/canrun-wrap` 도입). Cowork 초안을 저장소 실상과 대조해 정정(Phase 0 상태, gated 5종, attnOverrides 11종, 리뷰 기준 커밋, GitHub 조회 방식 등). 공백기 점검: 09-27 fetch 기준 origin/main 변동 없음, own 실측 0, 커스텀 도메인 미설정(코드·라이브 canonical 기준)
- **08-26** `8e46062` P0-4b 한국 모델 9종(EXAONE 4.5 포함 — models 20→29 · model-quants 68→100행) + `docs/03` §6 실측 매트릭스 E그룹(측정 계획) → Phase 0 코드·데이터 태스크 종료(P0-5 자체 실측만 남음)
- **08 하순** Data sync 첫 실행 실패(저장소 설정) → 설정 ON 후 그린, PR #31 생성 (09-28 확인: 08-19·08-24 실패 → 08-26 성공, #31은 08-26 생성)
- **08-19** `46a06fe` CLAUDE.md 한국어 규칙 · `450cd2e` P0-4 HF 동기화(sync-models·new-model-alert·워크플로 2종) · `9c77c98` 데이터 정리(UD quant·attnOverrides 8종) · `7008aea` 워크플로 액션 버전 정렬 · Dependabot actions 3건 머지
- **08-16** Cloudflare 토큰 등록 → Deploy 수동 실행으로 canrun.pages.dev 첫 배포 · `a69e349`→`fe21e98` P0-2 엔진 TDD(§7 검증 전 항목 재현) · `66a42fb` P0-3 스키마·시드 v1 · `c66f9ff` 외부 리뷰 10건 반영
- **08-15** `03337a8` 초기 계획 커밋(docs 00~07·MASTER_PLAN·research·구 HANDOFF 이관 절차·`verify_engine.py` 원본 — `fe21e98`에서 vitest로 이식 후 삭제) · `51092f3` P0-1 스캐폴드(모노레포·static export·i18n 스파이크·CI) — push 배포는 토큰 미등록으로 실패
