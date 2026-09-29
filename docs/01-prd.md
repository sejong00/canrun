# 01. PRD — 제품 요구사항 명세

> 범위: MVP(Phase 1)를 중심으로, Phase 2~3 기능은 설계 제약으로만 반영. 로드맵 매핑은 `06-roadmap-tasks.md`.

## 1. 페르소나와 JTBD

| 페르소나 | 상황 | Job to be done | 진입 검색어 예 |
|---|---|---|---|
| P1. 입문자 (최다) | RTX 4060 노트북/데스크톱 보유, Ollama 설치 직전 | "내 PC로 뭐가 돌아가는지, 얼마나 빠른지 알고 싶다" | "rtx 4060 llm", "로컬 llm 사양" |
| P2. 모델 지정형 | 특정 모델(신모델 포함)을 돌리고 싶음 | "gpt-oss-120b 최소 사양이 뭔가" | "gpt-oss hardware requirements", "qwen3.5 사양" |
| P3. 구매 검토자 | GPU 업그레이드/맥 구매 고민 | "70B급 돌리려면 뭘 사야 하나, 아니면 빌려야 하나" | "best gpu for local llm 2026" |
| P4. 파워유저 | 이미 돌리는 중, 세팅 최적화 | "이 조합 실측이 몇 tok/s인지, KV quant·cpu-moe 쓰면?" | r/LocalLLaMA·아카라이브에서 유입 |

## 2. 핵심 사용자 플로우 (MVP)

### F1. 하드웨어 → 모델 목록 ("My PC" 플로우)
1. 하드웨어 선택: GPU 검색 드롭다운(별칭 포함 fuzzy: "4060", "4060 laptop", "M4 Pro") + RAM 용량/타입 + OS. Mac은 칩+RAM 통합 선택. **WebGPU 자동 감지 버튼**(가능한 브라우저에서 GPU명 프리필, 실패 시 조용히 수동 폴백).
2. 결과: 모델 카탈로그 전체를 4단계 판정으로 정렬한 카드 목록. 카드당: 모델명, 추천 quant, 예상 tg tok/s(±범위), 필요 VRAM/RAM, 컨텍스트 여유, `실측 N건` 배지(있으면).
3. 필터: 용도(챗/코딩/리즈닝/비전), 판정 등급, 파라미터 규모.
4. 각 카드 → 해당 콤보 페이지로 링크(SEO 내부링크 핵심).

### F2. 모델 → 하드웨어 요구사항 ("Model" 플로우)
1. 모델 선택(검색) → 모델 허브 페이지.
2. quant × 컨텍스트 매트릭스: 각 셀 = 필요 메모리. 아래에 "이 모델이 돌아가는 GPU" 표(보유 GPU DB 전체 판정 + 예상 tok/s, 가격 정렬 가능).
3. "최저 비용으로 돌리기": 쾌적 등급 최저가 GPU + 중고 옵션 언급 + (P3) 클라우드 렌트 CTA.

### F3. 콤보 페이지 (SEO 랜딩, 트래픽의 본체)
- URL: `/can-i-run/{model}/on/{gpu}` — 검색 "can i run qwen3 14b on rtx 4060" 직격.
- 즉답 헤더: **판정 배지 + 한 문장** ("❌ Q4_K_M은 VRAM 1.7GB 부족 → ✅ IQ3_XS로는 가능, 예상 21 tok/s").
- 본문(페이지당 고유 데이터 ≥8개 — `04-seo-content-plan.md` §4의 스팸 방어 요건): quant별 fit 표, VRAM 구성 분해 바(가중치+KV+버퍼+OS예약), 컨텍스트 슬라이더별 변화, 예상 pp/tg, 실측 있으면 실측 표, 대안 3종(더 작은 모델/더 낮은 quant/cpu-moe 세팅), 실행 커맨드 스니펫(ollama/llama.cpp 플래그 포함), FAQ 3개(자동 생성이되 수치 기반).
- 인터랙션: P1-2 시점엔 **클라이언트 JS 0** — 컨텍스트(8k~모델 최대 계단) × KV quant(f16/q8_0/q4_0) 변화는 정적 표(메모리 GB + tg 밴드 + 판정)로 싣는다. 토글·엔진 재계산은 P1-3 계산기 아일랜드에서(하이드레이션은 그 섬만 — JS 예산 §7, PROGRESS §4 09-29 D6·D11).

### F4. 인터랙티브 계산기 (`/calculator`)
- F1+F2 통합 자유 조작 UI. 임의 파라미터 수동 입력 모드(카탈로그에 없는 모델: 파라미터 수·레이어·kv_heads 직접 입력 or HF repo id 입력 → 클라이언트에서 HF API fetch).
- 결과 공유: URL 쿼리 직렬화 + **공유 카드 이미지**(og:image, Reddit/커뮤니티 확산용).

## 3. 판정 체계 (Verdict) — 사이트 전체 공통 언어

| 등급 | 라벨(en/ko) | 기준 (기본 ctx 8k, 상세 `02-engine-spec.md` §5) | 색 |
|---|---|---|---|
| S | Runs great / 쾌적 | 풀 오프로드 + 예상 tg ≥ 20 tok/s | green |
| A | Runs well / 원활 | 풀 오프로드 + 8~20 tok/s, 또는 MoE cpu-moe로 ≥ 20 | teal |
| B | Runs slowly / 겨우 가능 | 부분 오프로드/CPU, 2~8 tok/s | amber |
| F | Won't run / 불가 | 최저 quant도 미탑재 or < 2 tok/s | red |

- 모든 수치에 신뢰 라벨: `측정됨(실측 N건)` > `보정된 추정`(NVIDIA·AMD dGPU dense ±12% / 그 외 클래스·모든 MoE·부분 오프로드 ±20% — `02-engine-spec.md` §4) > `이론 추정(±30%)`. **pp(프롬프트 처리)만 4번째 라벨 `대략(rough) ±40%`**(범위 est×0.6~1.4 — `02` §3.5, P1-2 D13): pp 식은 fp16 연산 전제라 **full-GPU(통합 메모리 포함) fit일 때만 표시**하고 부분 오프로드·cpu-moe·CPU 전용에선 생략 사유 한 줄. **오차를 숨기지 않는 것이 브랜드 전략** (경쟁사 willitrunai의 약점이 과장 추정).
- 등급 산출 기본값: Q4_K_M 기준. 카드에는 "이 quant면 가능" 최적 quant를 병기.

### 허브 판정 규칙 (P1-1 — 정본 `packages/data/src/assess.ts`, 결정 기록 `docs/PROGRESS.md` §4 09-29)
- **가정 하드웨어**: dGPU = 시스템 RAM 32GB DDR5-5600 듀얼채널(대역폭은 `gpus.json` `cpu-ddr5-5600-2ch`에서 조회) · Windows에서 화면 출력 담당(OS 예약 0.6GB) · ctx 8k · KV f16. 통합 메모리·CPU 프로필은 `ramOptionsGB` 구성마다 평가. 가정은 페이지에 명시한다. 통합 메모리 칩의 CPU 경로(wired limit 초과 → cpu-only) 대역폭은 `통합 대역폭 × min(1, 클래스 계수/CPU 계수)`(dense·MoE 각각, 엔진 상수에서 유도 — 새 상수 없음)로 깎는다: CPU 경로가 같은 칩의 GPU 경로보다 빠르게 추정되는 역전 방지(P1-1 리뷰, `unifiedCpuBandwidth`).
- **기준 quant**: Q4_K_M → 없으면 MXFP4(네이티브) → 없으면 Q4_K_M bpw에 가장 가까운 등록 quant. 판정 배지·등급 카운트·정렬은 기준 판정.
- **추천 quant("이 quant면 가능")**: 기준이 비-desperate quant의 최고 판정에 이미 도달하면 기준 그대로 / 아니면 그 판정의 비-desperate quant 중 파일이 가장 큰 것 / desperate 티어는 비-desperate가 전부 F일 때만 / 전부 F면 추천 없음. 같은 판정 안에서 더 큰 quant로 올리는 "품질 상향 추천"은 하지 않는다(속도·컨텍스트를 잃는다).
- **최후 수단**: desperate quant가 추천보다 높은 판정을 내면 "품질 손실 큼" 힌트로 따로 표시.
- **실측 조인**: (gpuId, modelId, quant) 정확 일치(`Q4_K_XL` ≠ `Q4_K_M`) + 가정 하드웨어에서 fit 성립 + dGPU는 full-gpu일 때만(호스트 RAM·오프로드 플래그가 조인 키에 없음). 실측을 보일 때도 보정 추정 밴드를 병기(n=1이면 실측 밴드 폭이 0 — 규칙 3).
- **리즈닝 임계 ×1.5**(`02` §5): `category`에 `reasoning`이 있는 모델.
- **F 사유**: 미탑재(필요 메모리 vs 가용 표시, 속도 숨김) / 너무 느림(밴드 표시).
- **판정 사유**: 같은 속도를 full-gpu로 냈을 때보다 등급이 낮으면, 실제로 판정을 묶은 규칙을 표기(`02` §5·§3.4): A에서 멈춤 = "S는 모델 전체가 GPU에 있어야 함"(cpu-moe ≥ 20 tok/s, 부분 오프로드 GPU 비율 ≥ 90%) / 부분 오프로드 GPU 비율 < 90% → B 상한 / cpu-moe 8~20 tok/s → B("원활은 20 이상", 리즈닝 30) / CPU 전용 → B 상한.
- **desperate 티어 표기**: 2비트(desperate) quant를 추천·인용할 때는 항상 "품질 손실 큼"을 붙인다. FAQ "가장 큰 모델"은 기준 또는 비-desperate 추천 quant로만 답한다.
- **최대 컨텍스트**: 표시 quant가 같은 모드·같은 판정을 유지하는 최대 ctx 계단(8k~256k, 모델 maxContext 이하).
- **RAM 힌트**(dGPU): 기준 판정이 64/96/128GB RAM에서 개선되면 그 최소 RAM과 판정.
- **최저가 옵션**(모델 허브): dGPU 실거래가(`priceAsOf` 동반)만 순위. 쾌적(S) 최저가 + 그보다 싼 원활(A) 최저가(있으면)를 함께 보인다 — S가 없으면 A 최저가만. MSRP는 "출시가" 라벨로 표시만 하고 순위에 쓰지 않는다. 통합 메모리 기기는 가격 순위 제외.
- **GGUF 출처 배지**: 공식(GGUF repo owner = 모델 `hfId` owner) / llama.cpp 팀(`ggml-org`) / 커뮤니티(업로더명 표시).
- **라이선스 배지**: `license` 정확 문자열 → 오픈 / 별도 약관 / 비상업 분류(`packages/data/src/license.ts`, 미분류는 테스트 실패). 권리 판단이 아니라 "약관 확인 필요도" 표시.

## 4. 기능 목록

### MVP (Phase 1) — 정적, DB 쓰기 없음
- [F1][F2][F3][F4] 위 플로우 전부
- GPU 허브 페이지(`/gpu/{slug}`), 모델 허브(`/model/{slug}`), 콤보 페이지 생성(카탈로그 전 조합 — 인덱싱은 배치 게이트, `04` §3)
- en/ko 전체 i18n(라우팅·문자열·SEO 태그), 다크모드
- 공유 카드(빌드 타임 og:image, 상위 페이지), 사이트맵 자동 생성, JSON-LD
- 에디토리얼 섹션 `/guides/` (MDX, 출시 시 en 10편 + ko 10편)
- "이번 주 신모델" 박스(데이터 JSON 갱신으로 자동)

### Phase 2 — 커뮤니티 실측 (백엔드 추가)
- 벤치마크 제출: **llama-bench 마크다운/JSON, Ollama `--verbose` 출력 붙여넣기 → 자동 파싱**(킬러 UX). 폼 수동 입력은 폴백.
- 익명 제출 허용 + 스팸 방어(rate limit, honeypot, 엔진 추정 대비 ±3배 이탈 자동 플래그) + 관리자 승인 큐(초기 수동)
- 콤보/GPU 페이지에 실측 표시(중앙값, n=, 백엔드·플래그별), `측정됨` 배지 전환
- 실측 누적 → 기기별 효율 계수 자동 재보정 배치(주 1회)
- 제출 인센티브: 기여자 리더보드, 페이지 크레딧

### Phase 3 — 수익 고도화·확장
- Build Advisor(목표: 모델+tok/s → 최저 비용 하드웨어 조합, 신품/중고/클라우드 3열 비교) — `07-monetization.md`
- 비교 페이지(`/compare/{gpu}-vs-{gpu}` LLM 관점), 임베드 배지/위젯(백링크 엔진), 공개 API(rate-limited), Danawa/쿠팡 가격 연동(ko)

## 5. 페이지 인벤토리와 콘텐츠 소스

| 페이지 | 라우트 | 생성 방식 | 1차 수량(×2 언어) |
|---|---|---|---|
| 홈(=간이 계산기) | `/` | 정적 | 1 |
| 계산기 | `/calculator` | 정적+CSR | 1 |
| GPU 허브 | `/gpu/{slug}` | SSG from JSON | 카탈로그 전체 (현 54 — CPU 프로필 포함) |
| 모델 허브 | `/model/{slug}` | SSG | 카탈로그 전체 (현 29) |
| 콤보 | `/can-i-run/{model}/on/{gpu}` | SSG | 카탈로그 전 조합(현 1,566 = GPU 54 × 모델 29) 생성 — 인덱싱은 `data/publish.json` 배치 게이트(`04` §3, P1-2) |
| 가이드 | `/guides/{slug}` | MDX | 10 |
| 방법론 | `/methodology` | 정적 | 1 |
| 벤치마크(P2) | `/benchmarks` | 동적 | — |
| about/privacy/contact | 정적 | AdSense 필수 | 3 |

## 6. i18n 요구사항 (동시 출시 확정)

- 라우팅: en 루트(`/gpu/rtx-4060`), ko 서브디렉토리(`/ko/gpu/rtx-4060`). 슬러그는 언어 불변(영문 유지) — hreflang 매핑 단순화.
- 모든 UI 문자열·템플릿 문장은 사전 파일(en.json/ko.json). **장문 자동 번역 금지**(구글 스팸 정책이 '번역만 한 페이지'를 명시 — `04-seo-content-plan.md` §6). 템플릿 문장은 사람이 다듬은 유한 세트이므로 안전.
- ko 전용 요소: 한국어 용어(양자화, 그래픽카드), 원화 가격 표기(환율 주간 갱신), 쿠팡 링크(P3), 한국 모델 섹션(EXAONE·HyperCLOVA X SEED·Kanana — 카탈로그에 포함, ko 페이지에서 우선 노출), 커뮤니티 링크(아카라이브 로컬 채널 등).
- 에디토리얼은 언어별 별도 집필(번역 아님, 주제는 공유 가능).

## 7. 비기능 요구사항

- 성능: 콤보 페이지 LCP < 2.0s(모바일 4G), JS < 150KB(계산기 제외 페이지 — 모듈 스크립트 gzip 전송량 기준, Lighthouse `resource-summary:script:size`. P1-1 기준선 131KB: React·Next 런타임만, next-intl 클라이언트 번들 미포함), 광고 도입 후에도 CLS < 0.1(슬롯 고정 높이).
- 접근성: 판정을 색+아이콘+텍스트 3중 표기(색맹 대응).
- 정확성 거버넌스: 엔진 상수 변경은 반드시 출처 커밋(`02-engine-spec.md` §8), 스펙 데이터는 `sources` 필드 필수(`03-data-spec.md`).
- 모든 페이지에 데이터 기준일 표시("Data updated: 2026-08-09") — 신뢰 + freshness 신호.

## 8. 비목표 (Non-goals, MVP에서 하지 않음)

- 로그인/계정(P2도 익명 제출로 시작), 파인튜닝/학습 VRAM 계산(수요 작고 apxml 영역 — P3 검토), 이미지 생성 모델(별도 버티컬로 추후), 네이티브 감지 앱(웹 WebGPU로 충분, SRL식 다운로드 앱은 P3 검토), 실시간 가격 크롤링(주간 수동/반자동 갱신으로 시작).

## 9. 엣지 케이스 (엔진·UI 공통 처리 목록)

- 멀티 GPU(2×3090 등): VRAM 합산은 되지만 대역폭은 합산 안 됨 — P1은 "멀티 GPU는 베타: VRAM 합산, 속도는 단일 GPU 기준 ~0.68×" 명시(`02-engine-spec.md` §6).
- 통합 메모리(Mac/Strix Halo): "VRAM" 대신 사용 가능 메모리 = RAM × 기본 0.7 (macOS wired limit 안내 툴팁).
- 노트북 GPU: 데스크톱과 별개 SKU로 취급(예: "RTX 4090 Laptop"은 16GB·576GB/s — 혼동 방지 경고 배지).
- iGPU/구형 GPU(FP16 미지원 GTX 10 등): ~~CPU 추론 권장 판정으로 폴백~~ → P1-1: GPU 판정 유지 + theoretical(±30%) 라벨 + "FP16 성능 낮음 — 프롬프트 처리 매우 느림" 주의 배지(`fp16Tflops` < 1). tg는 대역폭 지배라 Pascal에서도 GPU가 CPU보다 빠르다 — CPU 폴백은 사용자를 더 느린 경로로 보낸다(PROGRESS §4 09-29).
- 카탈로그에 없는 신모델: HF repo id 입력 경로(F4) + "모델 추가 요청" 링크(GitHub issue).
- Ollama 기본 컨텍스트(VRAM 24GB 미만이면 4k)로 인한 체감 차이: 콤보 페이지 커맨드 스니펫에 항상 `OLLAMA_CONTEXT_LENGTH` 명시 — **P1-2 구현 완료**: 서버 env(`OLLAMA_CONTEXT_LENGTH` — PowerShell `$env:…; ollama serve` / bash) + REPL `/set parameter num_ctx` 병기. Ollama는 분할 GGUF·전문가 오프로드(`--n-cpu-moe`) 미지원이라 그 경우 Ollama 블록은 생략 사유만 표시.
- 실행 커맨드의 오프로드 플래그(P1-2, PROGRESS §4 09-29): dense 부분 오프로드 `-ngl` = `floor(gpuFrac × layers)` — llama.cpp는 출력층을 먼저 올리고 입력층은 항상 CPU라 floor가 안전(4,183 partial 조합에서 엔진 예산 초과 0), 각주 "실제로는 ±1~2층 직접 조정". MoE cpu-moe는 `--n-cpu-moe N`에 **N = layers(엔진 `02` §3.3 가정 — 추정치 기준)와 N_min(VRAM에 맞는 최소 N, 더 빠름)**을 함께 표시. **네이티브 quant(MXFP4) 파일과 Unsloth Dynamic(UD) 파일은 N_min에 +1층 여유(D23)**: gpt-oss는 비전문가 텐서가 Q8_0이라 bpw 균등 유도 `nonExpertGB`(0.65/0.81GB)가 실제 GPU 상주분(1.30/1.69GB)보다 작아 최소값이 1층 OOM, UD 파일도 어텐션·공유 텐서를 평균 bpw보다 높게 둬 같은 방향 — 정확한 해결(GGUF 텐서 목록 기반)은 백로그 「엔진 후속」④.
