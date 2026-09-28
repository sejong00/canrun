# PROGRESS — 진행 상태·결정 기록

> **이 파일이 "지금 어디까지 왔는가"의 단일 진실 원천이다.** 세션 시작은 `/canrun-start`, 태스크 종료는 `/canrun-wrap`.
> 규칙은 `CLAUDE.md`, 스펙은 `docs/00~07`, 태스크 정의·AC는 `docs/06-roadmap-tasks.md`.
> 2026-09-27 Cowork(claude.ai) 기획 세션에서 Claude Code로 운영 이관 — 그 이전 기록은 §7 이력에 요약.

## 1. 현재 위치 (2026-09-28)

- **Phase 0: P0-1~P0-4b 완료 · P0-5(자체 실측, 사람 작업) 미실시** — own 0행 / AC ≥30행. P0-5는 `docs/06`상 병행 태스크라 P1 착수를 막지 않는다. **Phase 1 미착수 — 다음은 P1-1.**
- 마지막 기능 커밋 `8e46062`(08-26). 09-28 재개 점검으로 밀린 PR 3건 머지(data sync #31 · npm minor/patch #72 · peter-evans v8 #28) — CI·Deploy 초록. 라이브: https://canrun.pages.dev (en `/` + ko `/ko` 헬로 페이지만, sitemap 없음)
- 데이터: 모델 29종(한국 9종) · 모델×quant 100행(`model-quants.json`; QuantId 정의 13종은 `quants.json`) · GPU 프로필 54개(dGPU 39·통합 메모리 12·CPU 3) · 캘리브레이션 실측 52점(**own 0**)
- 자동화: 주간 data-sync PR(화 06:00 KST) · 주간 new-model 요약 이슈(월 06:30 KST — 출시 전) · Daily rebuild(03:00 KST) · CI 6게이트(typecheck·lint·test:coverage 90%·validate-data·build·test:export) + gitleaks(전 히스토리) · Dependabot(npm·actions 월간). 08-26 이후 실패 런 2건은 모두 `data/hf-sync` PR의 job 0개 CI 런(08-26·09-01 — 봇 PR의 알려진 동작, 게이트 실패 아님, §5), 09-28 Deploy 2건은 동시성 취소 — 그 외 전부 성공
- GitHub에 남은 것: PR #4 eslint 10·#5 typescript 6(보류 — 백로그) · new-model 열린 이슈 21건(높음 14 = 백로그 「카탈로그 확장」 입력, llama.cpp 본선 지원 대기 7)
- 운영 방식: 머지·트리아지·푸시 등 반복 잡일은 Claude에 위임(`CLAUDE.md` "세션 운영", 로컬 허용 규칙 `.claude/settings.local.json`)

## 2. 다음 할 일 큐 (위에서부터)

1. **P1-1 허브 템플릿** (GPU 허브·모델 허브) — `docs/06` AC + 추가 요구:
   - **첫 단계로 스펙 문서 동기화** (소규모 — 리뷰 브리프가 "문서가 스펙"이라 낡은 서술은 거짓 지적이나 잘못된 이식을 부른다):
     `docs/02` §2.4 partial-offload 식 `gpuFrac = usableVram/need` → 코드 정본(`packages/engine/src/fit.ts`, `c66f9ff`: gpuFrac = GPU 상주 가중치/전체 가중치) ·
     `docs/01` §3 신뢰 라벨과 `apps/web/messages/{en,ko}.json` `Home.estimateNotice`의 calibrated "±15%" → ±12%/±20%(`docs/02` §4, 규칙 3 — **라이브 노출 중**) ·
     `docs/03` §1 스키마 블록 ← `packages/data/src/schema.ts` 전체(P0-3 명세 이탈 3건(§4 08-16 행) + `attnOverrides`·`note`·Gpu.vendor `'generic'`)
   - verdict 공통 컴포넌트(S/A/B/F — 라벨·색 `docs/01` §3, 색+아이콘+텍스트 3중 표기), JSON-LD(`docs/04` §5), hreflang(`docs/04` §6)
   - 모델 허브에 **라이선스 배지**(`models.json` `license`는 자유 문자열 → UI 분류표로 NC·커스텀 라이선스 강조. NC 명시는 EXAONE 3종뿐)와 **GGUF 출처 배지**(공식/커뮤니티 — `model-quants.json` 행의 `ggufRepo` 소유자와 `models.json` `hfId` 소유자 비교. 별도 org 필드 없음, 스키마 변경 불필요. 현 데이터로는 공식 = EXAONE 3종뿐이라 `ggml-org`(gpt-oss) 취급은 계획 단계에서 결정)
   - CI에 Playwright 스모크(대표 페이지 3종×2언어)·Lighthouse CI 추가 — `docs/05` §6 스펙인데 미구현(`ci.yml` 헤더 주석이 P1-1로 유예). AC "Lighthouse 90+"와 직결
   - 플랜 모드로 계획 먼저
2. **P1-2 콤보 템플릿** (트래픽의 본체) — **가장 강한 모델로 진행.** `docs/06` AC + 추가 요구:
   - 실행 커맨드 스니펫에 **실제 파일명 변형 표기** — 플레인 파일이 없는 unsloth repo(Qwen3.5 MTP-GGUF 4종, research 표기상 gemma-4-26b-a4b도)의 `Q4_K_M` 등은 실파일이 `UD-*`(매처 UD 폴백, §5). **현재 데이터엔 실파일명·UD 여부 기록이 없다**(ModelQuant = fileGB·ggufRepo뿐, sync도 매칭 경로를 저장하지 않음) → 필드 추가와 sync 기록 방식부터 결정(스키마 변경 시 `docs/03` §1 동시 갱신)
   - `publishBatch` 필드 미구현(스키마·데이터·코드 0건) — 어느 레코드에 둘지 계획 단계에서 결정. 정의 `docs/05` §3, 배치 계획 `docs/04` §3, AC `docs/06` P1-2
   - 라이선스·GGUF 출처 배지 재사용, Ollama `OLLAMA_CONTEXT_LENGTH` 명시(`docs/01` §9)
   - 완료 후 외부 리뷰(§6) 강력 권장 — 페이지가 수백 개 생기는 첫 태스크
3. P1-3 계산기·홈 → P1-4 에디토리얼 → **P1-5 출시 배치 0** (+ new-model 알림을 매일로 되돌림 — `new-model-alert.yml` cron, 48h SLA `docs/04` §8) → P1-6 (`docs/06`)

**출시 후 백로그** (출시 전엔 손대지 않는다)
- **카탈로그 확장** — 높음 이슈 14건: #8 DeepSeek-V4-Flash-0731 · #10 Ling-3.0-tiny · #16 LFM2.5-2.6B · #18 Nemotron-3.5-Lightning-30B-A3B · #20 Ling-3.0-flash · #41 granite-4.2-30b · #42 Laguna-S-2.1 · #43 Spark-X2.5-4B · #45 K2-Horizon-MoVA-36B-A4B · #51 MiniCPM5-2B · #54 MiniCPM5-1B · #61 Llama-3.2-3B · #69 Llama-3.2-1B · #70 Xing4.0-29B-A4B (#42·#45·#70은 llama.cpp 본선 지원 확인 후) + 알림이 놓쳤던 원본(첫 요약 이슈에 함께 올라온다 — 30일 다운로드 순): **google/gemma-4-31B-it**(946만) · **Qwen/Qwen3.8-27B**(673만) · Qwen3.6-35B-A3B(325만) · Qwen3.8-Flash-Next(123만). **대기 목록**(llama.cpp 본선 지원 대기 — 이때 재확인): #19 Motif-3 · #22 maple-preview · #32 GLM-5.3-Flash · #44 Ouro-1.4B · #49 Nanbeige4.2-3B · #57 K2-Horizon-7B · #77 AliceAI-80B-A3B. 위 번호의 이슈는 이 태스크 때까지 열어 두고, `/canrun-start`는 재판정하지 않는다
- **TS 6 이행** (#5) — `packages/engine`·`packages/data` tsconfig에 `"types": ["node"]` 추가로 Typecheck 실패 해소(§5). 그 전까지 PR은 열어 둔다
- **eslint 10** (#4) — eslint-plugin-react·import·jsx-a11y의 eslint 10 지원 대기

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
| 매월 | Dependabot PR | npm minor/patch 그룹·GitHub Actions 액션 = CI 초록이면 머지(위임 — CI가 안 도는 워크플로의 액션이면 머지 후 `workflow_dispatch`로 확인) / npm 메이저 = 권고와 함께 보고 / eslint 10(#4)·typescript 6(#5)은 백로그 |
| 매주 (P1-6부터) | GSC 수치 → 저장소 기록 | **사람**이 수치 전달 → Claude가 기록. 인덱싱 ≥80% 게이트 (`docs/06` P1-6) |
| 마일스톤마다 | 외부 리뷰 (§6) | **사람**이 리뷰어에게 브리프 전달 → Claude가 판정·수정. P1-2 후 필수 권장 |

## 4. 결정 기록 (바꾸려면 근거와 함께 여기 갱신)

| 날짜 | 결정 | 근거 |
|---|---|---|
| 08-15 | Next.js 16.3 채택 (계획서의 15 대신) | 착수 시점 안정판. 기록: `docs/05` §1 |
| 08-15 | i18n A안: en 루트 + `/ko/` | next-intl as-needed + 빌드 후 평탄화 + `/en/*`→`/:splat` 301 안전망, `test/export-invariants` 재귀 검사. `docs/05` §1 |
| 08-15 | 실측 리그 = RTX 5060 Ti 16GB + RAM 16GB (5090 미보유 — 필요 시 클라우드 렌트로 스팟 검증) | 하이엔드는 공개 실측 시드로 커버, 16GB가 수요 최대 세그먼트 (`docs/03` §6) |
| 08-15→16 | calibrated 밴드 클래스별: NVIDIA·AMD dGPU dense(full-gpu) ±12% / 그 외·MoE·부분 오프로드 ±20% | 밴드가 검증 max 오차(17.1%, `docs/02` §7)보다 좁으면 안 됨 — 계획서 외부 리뷰. 계획서 `docs/02` §4에 이미 있었고, `66a42fb`에서 CLAUDE.md 규칙 3의 구 단일 ±15%를 정렬(`docs/01` §3·헬로 페이지 문구는 미정렬 → P1-1 첫 단계) |
| 08-16 | 부분 오프로드 CPU측 가중치 = weights − max(0, usableVram − kv − buffer) | 외부 리뷰 P1(거짓 양성, `c66f9ff`) — 반례 회귀 테스트로 고정. `docs/02` §2.4 식은 미갱신(P1-1 첫 단계) — 코드가 정본 |
| 08-16 | P0-3 스키마 명세 이탈: Gpu.kind `'cpu'` 추가 · unified/cpu는 vramGB 대신 `ramOptionsGB[]` · BenchPoint modelId/quant 자유 문자열 | `packages/data/src/schema.ts` 헤더 주석. `docs/03` §1 미갱신(P1-1 첫 단계) — 코드가 정본 |
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

## 5. 알려진 이슈·주의

- 플레인 파일이 없는 unsloth repo(Qwen3.5 MTP-GGUF 4종·gemma-4-26b-a4b)의 `Q4_K_M` 등 행은 매처가 `UD-*` 실파일 크기를 취한 값(`scripts/sync-models.ts` matchQuantFiles). 데이터엔 실파일명·UD 여부가 없다 → 스니펫·다운로드 안내 실파일명은 P1-2에서 필드 추가 필요
- qwen3.5-35b-a3b nonExpertGB(1.22)는 UD-Q4_K_M 유래 크기(22.63)에 bpw 균등 근사를 적용한 값. UD는 중요 레이어 bpw를 올리므로 비전문가 텐서가 과소 추정됐을 수 있다(cpu-moe 판정이 낙관 쪽, 미검증) → P0-5 실측으로 확인
- 재확인 플래그: HCX SEED Think 14B의 llama.cpp 구동 여부(커스텀 arch — P0-5 E그룹에서 실기 검증) · Kanana 1.5 A3B의 active 3B는 비공식 수치 · HCX SEED 1.5B ctx 카드 16k vs 미러 config 131k
- gated config 5종(meta-llama 2·gemma-3 2·HCX SEED 1.5B)은 수동값 — sync는 skipped로 리포트. HCX 1.5B arch는 llamafied 미러(minpeter) config 유래라 HF_TOKEN 도입 후 첫 런 리포트를 확인
- nonExpertGB 미확정: qwen3.5-122b-a10b · gemma-4-26b-a4b(experts/topK 미문서 → MOE_ARCH 미등록) · solar-open2-250b(320E top-8은 명기, 기준 quant Q4_K_M/MXFP4 GGUF 부재) — 근거 확보 전 생략 유지
- qwen3-8b·14b·32b maxContext: config 40960 vs 시드 32768(카드 명기 네이티브 ctx — YaRN 적용 시 131k). sync는 maxContext를 항상 manual로 리포트하니 시드 유지
- 스펙 문서 드리프트: `docs/02` §2.4 partial-offload 식 · `docs/01` §3·헬로 페이지 ±15% · `docs/03` §1 스키마 → P1-1 첫 단계
- new-model 필터는 이름 휴리스틱(`REPACK_PATTERN`·`ocr`)과 HF `base_model` 태그 기반이다 — 태그 없는 타 org 파인튠은 통과하고, 이름에 fp8·mlx 등이 든 원본은 빠질 수 있다. 요약 이슈 트리아지에서 보정하고, 반복되면 `scripts/new-model-alert.ts` 필터를 고친다
- PR #5 (typescript 5.9.3→6.0.3, 브랜치명은 7.0.2): Typecheck 실패 원인 확인됨(CI 런 31937998006 로그 — 보존 90일) — `packages/engine`·`packages/data` tsconfig에 `types`가 없어 TS 6에서 `@types/node`가 로드되지 않는다(TS2591 `node:fs`, TS2304 `structuredClone`·`console`, 연쇄 TS7006). 루트 `tsconfig.json`에만 `"types": ["node"]`가 있다
- `data/hf-sync` PR에 생기는 CI 런은 job이 0개라 로그가 없고, 대기하다 30일 경과·PR 종료 시 failure로 기록된다(08-26·09-01 런) — GITHUB_TOKEN이 만든 PR의 동작이라 게이트 실패가 아니다. 실패 건수에서 뺀다
- 이 PC의 Claude 세션 셸엔 `gh`가 PATH에 없을 수 있다(설치 전에 열린 세션) → Bash에서 `"/c/Program Files/GitHub CLI/gh.exe"`. 앱을 다시 시작하면 해소
- gitleaks: Windows 로컬엔 바이너리 없음(§4 09-28). Docker Desktop이 뜨면 CI와 같은 이미지로 돌릴 수 있다. ci.yml 명령은 그대로 쓰면 안 된다 — Git Bash는 MSYS 경로 변환이 `/repo` 인자를 망가뜨리고, PowerShell은 `"$PWD:"`를 파싱하지 못한다
  - Git Bash: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --config /repo/.gitleaks.toml --log-opts="--all" --redact`
  - PowerShell: `docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --config /repo/.gitleaks.toml --log-opts="--all" --redact`

## 6. 외부 리뷰 절차 (다른 모델로 교차 검증)

1. 커밋이 끝난 상태에서 격리 클론(로컬 클론은 커밋분만 복사 — 미커밋 수정은 빠진다): `git clone D:\workspace\canrun-plan C:\Temp\canrun-review-<N>` — 라이브 폴더 직접 검토 금지
2. 클론에 들어 있는 `docs/review-brief.md`를 리뷰어(Codex 등)에게 주고 "이 브리프 지시대로 검토" 요청
3. 결과를 Claude Code에 붙여넣어 P1/P2/P3 판정 → 수용분을 수정 태스크(예: P1-2b)로 한 세션에 처리 → §4·§7에 기록하고 아래 **리뷰 기준 커밋**을 이번 리뷰 대상 HEAD로 갱신
- **리뷰 기준 커밋: `fe21e98`** → 다음 리뷰 범위 `fe21e98..HEAD` (`66a42fb` P0-3 스키마·시드 v1과 `c66f9ff` 반영분은 미검토)
- 이력: 계획서 외부 리뷰 8건 중 7건 수용(v2~v4 — 저장소 밖 기획 단계, 저장소엔 최종본 `03337a8`만) · P0-1~P0-2 코드 리뷰(기준 `fe21e98`) 10건(P1 1·P2 5·P3 4) 전부 반영 `c66f9ff`

## 7. 이력 (최신이 위)

- **09-28** 재개 점검 완료 + 운영 위임 — PR #31(data sync, fileGB 12행 \|Δ\|≤3.63%)·#72(npm minor/patch 13건: next 16.3.5·react 19.3·zod 4.6 등)·#28(peter-evans v8, Data sync 수동 실행으로 확인) 머지 · new-model 71건 트리아지(50건 닫음, 21건 유지) · `a09a12f` 알림 요약 이슈 전환·필터 + Dependabot 월간 · `docs: 운영 위임 규칙 + 재개 점검 기록`(CLAUDE.md 위임 범위·명령 2종·HANDOFF·이 파일)
- **09-27** `docs: Claude Code 운영 이관` — Cowork → Claude Code 운영 이관(이 파일·`docs/review-brief.md`·커스텀 명령 `/canrun-start`·`/canrun-wrap` 도입). Cowork 초안을 저장소 실상과 대조해 정정(Phase 0 상태, gated 5종, attnOverrides 11종, 리뷰 기준 커밋, GitHub 조회 방식 등). 공백기 점검: 09-27 fetch 기준 origin/main 변동 없음, own 실측 0, 커스텀 도메인 미설정(코드·라이브 canonical 기준)
- **08-26** `8e46062` P0-4b 한국 모델 9종(EXAONE 4.5 포함 — models 20→29 · model-quants 68→100행) + `docs/03` §6 실측 매트릭스 E그룹(측정 계획) → Phase 0 코드·데이터 태스크 종료(P0-5 자체 실측만 남음)
- **08 하순** Data sync 첫 실행 실패(저장소 설정) → 설정 ON 후 그린, PR #31 생성 (09-28 확인: 08-19·08-24 실패 → 08-26 성공, #31은 08-26 생성)
- **08-19** `46a06fe` CLAUDE.md 한국어 규칙 · `450cd2e` P0-4 HF 동기화(sync-models·new-model-alert·워크플로 2종) · `9c77c98` 데이터 정리(UD quant·attnOverrides 8종) · `7008aea` 워크플로 액션 버전 정렬 · Dependabot actions 3건 머지
- **08-16** Cloudflare 토큰 등록 → Deploy 수동 실행으로 canrun.pages.dev 첫 배포 · `a69e349`→`fe21e98` P0-2 엔진 TDD(§7 검증 전 항목 재현) · `66a42fb` P0-3 스키마·시드 v1 · `c66f9ff` 외부 리뷰 10건 반영
- **08-15** `03337a8` 초기 계획 커밋(docs 00~07·MASTER_PLAN·research·구 HANDOFF 이관 절차·`verify_engine.py` 원본 — `fe21e98`에서 vitest로 이식 후 삭제) · `51092f3` P0-1 스캐폴드(모노레포·static export·i18n 스파이크·CI) — push 배포는 토큰 미등록으로 실패
