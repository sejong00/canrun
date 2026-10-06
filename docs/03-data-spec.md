# 03. 데이터 명세 — 스키마·시드 데이터·파이프라인

> MVP 데이터는 저장소 `/data/*.json` (버전 관리·PR 리뷰 가능). Phase 2에서 제출 데이터만 D1(SQLite)로. **모든 레코드에 `sources: string[]` 필수.** 본 문서의 시드 표는 2026-08-09 리서치 실측·공식 스펙 기준 — 그대로 JSON화하면 시드 v1 완성.

## 1. 스키마 (zod로 구현, `packages/data/src/schema.ts`)

정본은 `packages/data/src/schema.ts` — 이 블록은 요약이며 불일치 시 코드가 우선. 초기 명세 대비 P0-3 이탈(`schema.ts` 헤더·PROGRESS §4 08-16): ① Gpu.kind에 `'cpu'` 추가(§2 CPU 프로필 3종, 엔진 `Hardware.kind`와 정합) ② unified/cpu는 `vramGB` 대신 `ramOptionsGB[]`(PRD "Mac은 칩+RAM 통합 선택") ③ BenchPoint.modelId·quant는 자유 문자열(카탈로그 외 캘리브레이션 모델·실측 quant 표기 보존 — §4).

```ts
// 공통: sources = URL[] (min 1 — Gpu·Model·ModelQuant·attnOverrides. BenchPoint는 sourceUrl 단일, QuantDef·Alias·PublishPlan은 없음)
//       날짜 = 'YYYY-MM-DD' · id = slug /^[a-z0-9][a-z0-9.-]*$/
Gpu { id, name, aliases[],  // 검색 별칭 + P1-3 계산기 콤보박스·GPU 감지 매칭 토큰(예 'radeon 8060s' — 렌더러 문자열 대응, PROGRESS §4 09-29 D30)
     vendor:'nvidia'|'amd'|'intel'|'apple'|'amd-apu'|'nvidia-dgx'|'generic',
     kind:'dgpu'|'unified'|'cpu', form:'desktop'|'laptop',
     vramGB?,            // dgpu 필수 (decimal GB)
     ramOptionsGB?: number[],   // unified/cpu 필수 — 선택 가능한 RAM 구성 GB (min 1)
     memBandwidthGBs, fp16Tflops?,   // FP16 크리플(GTX 10)이면 실효값
     effClass:'nvidia'|'amd'|'intel-arc'|'apple'|'apple-ultra'|'strix'|'dgx-spark'|'cpu',
     launchYear:2015..2026, msrpUSD?, streetUSD?, streetKRW?,
     priceAsOf?,         // streetUSD/KRW 존재 시 필수 (CLAUDE.md 규칙 2)
     popular:boolean, note?, sources[] }
Model { id, family, name, hfId, paramsB, activeParamsB?,   // moe ⇒ activeParamsB 필수
     arch:{layers, kvHeads, headDim, attnType:'full'|'swa'|'mla'|'hybrid', kvBytesPerTokenF16, experts?, topK?, expertLayers?},  // 바이트/tok f16 사전계산 (SWA/MLA/하이브리드 보정 반영)
     // experts·topK (10-01 D56): MoE 전용, 둘 다 있거나 둘 다 없음, topK < experts. validateAll 이 모든 MoE 모델에 요구하고 MOE_ARCH 와 대조.
     //   출처 config.json(num_experts·num_local_experts·n_routed_experts / num_experts_per_tok·top_k_experts·experts_per_token), GGUF expert_count·expert_used_count 로 교차 확인
     // expertLayers (10-03 D63): MoE 전용·선택 — 라우팅 전문가가 있는 층 번호(0부터, 트렁크만, 오름차순, 전체 층보다 적게). 일부 층에만 전문가가 있을 때만.
     //   출처 config.json(nemotron_h layers_block_type 의 moe 블록 · bailing_hybrid first_k_dense_replace) — add-model·HF 불러오기가 classifyArch 로 기록.
     //   엔진 입력 moeLayers = 이 길이, 명령의 --n-cpu-moe 는 엔진 N 번째 전문가 층까지 덮는 블록 수(snippet.ts cpuMoeFlagLayers)
     attnOverrides?:{kvBytesPerTokenF16, reason, sources[]},  // 비-full 전용, arch.kvBytesPerTokenF16과 일치(미러) — 존재 시 sync가 arch 자동 갱신 안 함 (§5.1)
     maxContext, license, moe:boolean, nonExpertGB?,   // MoE attention+shared GB (derive.ts 균등 bpw 유도) — 10-01 부터 행 실측(ModelQuant.nonExpertGB)이 우선, 이 값은 bpw 사다리 폴백
     category:('chat'|'coding'|'reasoning'|'vision')[] (min 1),
     korean?:boolean, popularity:1..5, hfDownloads30d?, hfDownloadsAsOf?, releasedAt, note?, sources[] }
     // hfDownloads30d·hfDownloadsAsOf (10-06 D68): 원본 저장소(hfId)의 Hugging Face 최근 30일 다운로드 수(정수)와 그 기준일 — `https://huggingface.co/api/models/<hfId>` 의 downloads
     //   (게이트 저장소도 메타데이터는 토큰 없이 읽힌다). GGUF 저장소 다운로드는 들어 있지 않다. 둘 다 있거나 둘 다 없음, 값이 있으면 sources 에 HF 모델 URL 필수(zod refine —
     //   값마다 API URL 을 sources 에 늘리지 않는다). sync-models 가 매주 갱신(§5.1 ⑥), add-model 이 추가할 때 채운다. 계산기 "다운로드 많은 순" 정렬·카드 줄(lite 카탈로그 키)
     // popularity (1~5, 10-06 D68 리뷰에서 정의를 적음): CanRun 편집 값 — 로컬 실행에서 얼마나 널리 쓰이는지. add-model 이 원본 저장소 30일 다운로드로 처음 값을 넣고
     //   (hf.ts popularityFrom: 500만↑ 5 · 100만↑ 4 · 20만↑ 3 · 3만↑ 2 · 그 밖 1, `--popularity` 로 덮어쓰기), 사람이 조정한다 — 10-06 기준 43종 중 25종이
     //   다운로드 기준과 다르다(예: 한국어 모델 9종은 모두 높게, 한국어가 아닌 1~2B 급은 낮게, 널리 알려진 옛 모델은 높게). sync-models 는 바꾸지 않는다 — 최신 다운로드 그대로의 순서는 hfDownloads30d("다운로드 많은 순")가 따로 진다.
     //   쓰는 곳: 홈 인기 모델(4 이상), 계산기 인기순·추천순(같은 크기 구간 안에서). 화면 안내도 "다운로드 수만이 아니라 국내 사용도 함께 본 다섯 단계 점수"로 밝힌다
ModelQuant { modelId, quant:QuantId, fileGB, expertGB?, nonExpertGB?, offGpuGB?, mtpGB?, ggufRepo, fileName?, sources[] }   // 실제 GGUF 크기 (decimal GB, 분할 합산)
     // expertGB·nonExpertGB (10-01 D56): GGUF 헤더 실측(scripts/gguf-header.ts), MoE 행 전용, 둘 다 있거나 둘 다 없음,
     //   0.75×fileGB ≤ expertGB + nonExpertGB ≤ fileGB + 0.02 (validateAll — 하한 10-03).
     //   expertGB = 트렁크 층의 `_exps`·`_chexps` 텐서 합. nonExpertGB = GPU 상주분 — 입력층 제외(token_embd·per_layer_token_embd·position_embd·token_types,
     //   llama.cpp 는 입력층을 CPU 에 둔다, 출력층 없는 tied 모델은 token_embd 1회 포함), MTP·NextN 블록 제외(기본 로드 안 함). token_embd_norm 은 GPU.
     //   엔진 cpu-moe 배치·속도의 입력(docs/02 §3.3)이자 합이 full-gpu 의 그래픽카드 상주 가중치(docs/02 §2.4-1). sync-models 가 새 행·바뀐 파일만 다시 잰다(§5.1 ⑤)
     // offGpuGB (10-03 D62): dense 행 전용 GGUF 헤더 실측 — 파일 바이트 − (전문가 + 비전문가) = 입력층·MTP 블록·헤더 메타데이터. dGPU full-gpu 필요량 = fileGB − offGpuGB.
     //   MoE 행은 fileGB − expertGB − nonExpertGB 로 같은 값을 유도하므로 두지 않는다(진실 원천 하나). 0 ≤ 값 ≤ 0.25×fileGB (validateAll, 카탈로그 최대 MiniCPM5-1B Q8_0 18%).
     //   절대값(gpuResidentGB) 대신 차분을 저장 — 파일이 다시 올라와 재측정이 실패해도 오차가 차분 크기로 묶인다. 없으면 파일 전체(보수 폴백). 임베딩 공유 모델은 ≈0.01(헤더만).
     // mtpGB (10-03): MTP/NextN 블록 GB, 0 보다 클 때만 — 측정 행(offGpuGB 또는 분할)에만, GPU 밖 몫 + 0.02 이하(validateAll). 필요량에선 이미 빠져 있고
     //   분해 바·모델 허브 FAQ 가 "MTP 를 켜면 이만큼 + 그 KV 가 더 든다"고 안내한다(Qwen3.5/3.6·Qwen3.8·EXAONE 4.5 27행). 속도식(docs/02 §3.1)은 아직 안 씀
     // fileName (P1-2 D20, PROGRESS §4 09-29): repo 상대 실파일 경로 /^[^\s/][^\s]*\.gguf$/i — 분할이면 첫 조각 `…-00001-of-0000N.gguf`,
     //   UD 변형은 이름의 `UD-` 유지(플레인 파일이 없는 unsloth repo의 Q4_K_M 행 등). zod는 optional이지만 validateAll이 전 행 존재를
     //   강제(빌드가 호출), 값은 sync-models가 기록(§5.1 ④). 콤보 스니펫 `-hf {repo}:{tag}` 태그·다운로드 안내의 원천
     // 카탈로그 밖 모델(계산기 전용 — data/*.json 에 쓰지 않으므로 sources·zod 검증 대상 아님, 규칙 2 밖): 같은 코어 모양(ModelCore + ModelQuantCore[])을
     //   브라우저에서 조립해 고정 카드로만 쓴다. HF 불러오기 `buildHfModel`(hf.ts, D57 — 실파일 크기·fileName) · 직접 입력 `buildManualModel`
     //   (manual.ts, 10-03 D66 — fileGB = paramsB × bpw / 8 어림(Q2_K·IQ4_XS·Q4_K_M·Q8_0), ggufRepo '' · fileName 없음 → 명령 없음, nonExpertGB 는 derive.ts 유도,
     //   license 'unknown', 생각 모드 체크 시 thinking 'default-on'). 둘 다 이론 추정 고정(docs/02 §4)
PublishPlan (data/publish.json, 단일 객체 — P1-2 D9) { currentBatch:int ≥ 0,
     batches:[{ batch:int ≥ 1, gpuIds:GpuId[], modelIds:ModelId[], plannedAt?:date, note? }] }
     // 검증: 항목 안 id 중복 거부 · gpuIds/modelIds는 카탈로그 FK(validateAll) · batches가 비면 currentBatch 0만, 아니면 ≤ max(batch)
     // 콤보 배치 = 쌍을 포함하는 항목들의 최소 batch, indexable ⇔ batch ≤ currentBatch (`04` §3) — 조회 `packages/data/src/publish.ts`
QuantId = 'IQ2_M'|'Q2_K'|'IQ3_XS'|'Q3_K_M'|'IQ4_XS'|'Q4_K_M'|'Q5_K_M'|'Q6_K'|'Q8_0'|'MXFP4'|'UD-Q2_K_XL'|'UD-IQ2_M'|'F16'
QuantDef { id:QuantId, bpw, tier:'safe'|'ok'|'degraded'|'desperate', note }   // bpw = 엔진 QUANT_BPW (consistency 테스트)
BenchPoint { id, gpuId?|hardwareDesc?,   // 둘 중 하나 필수 (카탈로그 외 하드웨어는 hardwareDesc)
     modelId:string, quant:string,       // 자유 문자열 — 캘리브레이션 id(llama-2-7b)·실측 표기(Q4_0, Q4_K_XL) 허용
     backend:'llama.cpp'|'ollama'|'lm-studio'|'mlx'|'llamafile', backendVersion?,
     ctx, ppTokS?, tgTokS, flags?, sourceUrl:URL, sourceType:'official-thread'|'localscore'|'community'|'own',
     verified:boolean, measuredAt }
Alias { from, to }   // alias 경로 → canonical 301 (_redirects). 경로 /^\/[^\s?#]*$/ + 제어문자 거부 (build-redirects.ts와 동일)
Submission (P2, D1 — 미구현) { BenchPoint + submitterHash, ip rate-limit fields, status:'pending'|'approved'|'rejected'|'flagged' }
```

## 2. 시드: GPU (dgpu 32종 + 통합 10종, `data/gpus.json`)

값: VRAM GB / 대역폭 GB/s / FP16 TFLOPS / 출시가 / 실거래가(2026-08, DRAM 대란 반영). 출처: TechPowerUp DB·공식 스펙시트·MLQ/Tom's 가격 트래커 (원본 URL은 리서치 노트 `research/hardware.md` 참조, 각 레코드 sources에 복사).

| id | VRAM | BW | FP16 | MSRP | Street 26-08 | 비고 |
|---|---|---|---|---|---|---|
| rtx-5090 | 32 | 1792 | 104.8 | $1,999 | ~$4,200 | |
| rtx-5080 | 16 | 960 | 56.3 | $999 | ~$1,256 | |
| rtx-5070-ti | 16 | 896 | 44.1 | $749 | ~$949 | |
| rtx-5070 | 12 | 672 | 30.9 | $549 | ~$629 | |
| rtx-5060-ti-16gb | 16 | 448 | 23.7 | $429 | ~$569 | 가성비 주력 |
| rtx-5060-ti-8gb | 8 | 448 | 23.7 | $379 | ~$429 | |
| rtx-5060 | 8 | 448 | 19.2 | $299 | ~$339 | |
| rtx-4090 | 24 | 1008 | 82.6 | $1,599 | ~$2,755 신품/~$2,400 중고 | |
| rtx-4080-super | 16 | 736 | 52.2 | $999 | 중고 | |
| rtx-4080 | 16 | 717 | 48.7 | $1,199 | 중고 | |
| rtx-4070-ti-super | 16 | 672 | 44.1 | $799 | 중고 | |
| rtx-4070-super | 12 | 504 | 35.5 | $599 | 중고 | |
| rtx-4070 | 12 | 504 | 29.1 | $599 | 중고 | |
| rtx-4060-ti-16gb | 16 | 288 | 22.1 | $499 | 중고 | 대역폭 협소 주의 |
| rtx-4060-ti-8gb | 8 | 288 | 22.1 | $399 | 중고 | |
| rtx-4060 | 8 | 272 | 15.1 | $299 | 중고 | 최다 검색 SKU |
| rtx-3090-ti | 24 | 1008 | 40.0 | $1,999 | 중고 | |
| rtx-3090 | 24 | 936 | 35.6 | $1,499 | ~$1,050 중고 | 중고 가성비 왕 |
| rtx-3080-12gb | 12 | 912 | 30.6 | $799 | 중고 | |
| rtx-3080-10gb | 10 | 760 | 29.8 | $699 | 중고 | |
| rtx-3070 | 8 | 448 | 20.3 | $499 | 중고 | |
| rtx-3060-12gb | 12 | 360 | 12.7 | $329 | ~$250 | 입문 기본값 |
| rtx-3050-8gb | 8 | 224 | 9.1 | $249 | 중고 | |
| rtx-2080-ti | 11 | 616 | 26.9 | $999 | 중고 | |
| gtx-1080-ti | 11 | 484 | FP16 크리플 | $699 | 중고 | cpu 폴백 판정 |
| rx-9070-xt | 16 | 645 | 97.3(peak) | $599 | ~$689 | tg 효율 우수 |
| rx-9070 | 16 | 645 | 72.3 | $549 | ~$639 | |
| rx-9060-xt-16gb | 16 | 322 | 51.3 | $349 | ~$449 | |
| rx-7900-xtx | 24 | 960 | 122.8 | $999 | 중고 | |
| rx-7900-xt | 20 | 800 | 103.0 | $899 | 중고 | |
| rx-7800-xt | 16 | 624 | 74.7 | $499 | 중고 | |
| arc-b580 | 12 | 456 | 27.3 | $249 | ~$250-330 | pp 약함 |
| **랩톱**: rtx-5090-laptop 24/896 · 5080-laptop 16/896 · 5070-ti-laptop 12/672 · 4090-laptop 16/576 · 4080-laptop 12/432 · 4070-laptop 8/256 · 4060-laptop 8/256 | | | | | | 데스크톱과 별개 SKU + 경고 배지 |

통합 메모리 (kind:'unified', usable = ram×0.7):

| id | BW | RAM 구성 | 비고 |
|---|---|---|---|
| apple-m4 / m4-pro / m4-max | 120 / 273 / 410~546 | 16-32 / 24-64 / 36-128 | m4-max GPU 코어수로 BW 분기 |
| apple-m5 / m5-pro / m5-max | 153.6 / 307 / 460~614 | 12-32 / 24-64 / 36-128 | M5 Pro/Max 2026-03 출시 |
| apple-m3-ultra / m2-ultra | 819 / 800 | 96-512 / 64-192 | effClass 'apple-ultra' |
| amd-strix-halo (Ryzen AI Max+ 395) | 256 | ~128 | Framework Desktop $1,999 |
| nvidia-dgx-spark | 273 | 128 | $3,999 |
| cpu-ddr5-5600-2ch / ddr5-6000 / ddr4-3200 | 89.6 / 96 / 51.2 | — | CPU-only 프로필 |

주의 데이터(정기 확인): RTX 50 Super = **2027 연기(미출시)**, Intel B770 = 미출시, 가격은 `priceAsOf` 필수·주간 갱신.

## 3. 시드: 모델 카탈로그 (`data/models.json`, 1차 20종 ★ + 확장 후보)

KV = KiB/tok(f16). 파일 크기 = 실측 GGUF(decimal GB), 출처 repo 명기.

### 1차 20종 (Phase 1 콤보 생성 대상 — 2026-08 실사용 빈도 기준)
| id | params(act) | L/KV헤드/hd | KV KiB | ctx | Q4_K_M GB | 비고 |
|---|---|---|---|---|---|---|
| llama-3.1-8b ★ | 8.03 | 32/8/128 | 128 | 128k | 4.92 (bartowski) | 벤치 표준 |
| llama-3.3-70b ★ | 70.6 | 80/8/128 | 320 | 128k | 42.52 | |
| qwen3-8b ★ | 8.2 | 36/8/128 | 144 | 32k(YaRN128k) | 5.03 | |
| qwen3-14b ★ | 14.8 | 40/8/128 | 160 | 32k | 9.00 | |
| qwen3-32b ★ | 32.8 | 64/8/128 | 256 | 32k | 19.76 | |
| qwen3-30b-a3b-2507 ★ | 30.5(3.3) | 48/4/128·MoE | 96 | 256k | 18.6 | 소비자 MoE 표준 |
| qwen3.5-9b ★ | 9.65 | hybrid(8full/4/256) | 32+state | 256k | 5.87 (unsloth MTP) | 2026 신형 |
| qwen3.5-27b ★ | 27.78 | hybrid | low | 256k | 16.86 | |
| qwen3.5-35b-a3b ★ | 35.95(~3) | hybrid·MoE | 20+state | 256k | 22.63 | r/LocalLLaMA 기본픽(3.6 refresh 병기) |
| qwen3.5-122b-a10b | 125.1(10) | hybrid·MoE | low | 256k | 78.3 | 프로슈머 |
| gpt-oss-20b ★ | 20.9(3.6) | 24(12swa128)/8/64 | 24 | 128k | **MXFP4 12.11** (ggml-org) | 네이티브 quant |
| gpt-oss-120b ★ | 116.8(5.1) | 36(18swa)/8/64 | 36 | 128k | **MXFP4 63.39** | cpu-moe 대표 |
| gemma-3-12b ★ | 12.2 | 48/8/256·SWA | ~64 | 128k | 7.30 | |
| gemma-3-27b ★ | 27.4 | 62/16/128·SWA | ~80 | 128k | 16.55 | |
| gemma-4-12b ★ | 11.96 | SWA 5:1 | low | 256k | 7.12 (unsloth) | 2026 |
| gemma-4-26b-a4b | 26.54(~4) | SWA·MoE | low | 256k | 16.95(UD) | 구글 첫 오픈 MoE |
| phi-4 ★ | 14.7 | 40/10/128 | 200 | 16k | 9.05 (lmstudio) | |
| mistral-small-3.2-24b ★ | 23.6 | 40/8/128 | 160 | 128k | 14.33 | Magistral/Devstral 동형 |
| deepseek-r1-distill-32b ★ | 32.8 | 64/8/128 | 256 | 128k | 19.85 | 리즈닝 ×1.5 플래그 |
| deepseek-r1-distill-8b ★ | 8.03 | 32/8/128 | 128 | 128k | 4.92 | |

### 확장 후보(P1.5~P2에서 추가): llama-3.2-1b/3b(2.02GB), qwen3-4b-2507(2.50), qwen3.5-4b(2.83), gemma-3-4b(2.49), phi-4-mini(2.49), qwen3-coder-30b-a3b, glm-4.5-air(106B/12B, UD-Q4 67.7), llama-4-scout(109/17, 65.4), mistral-small-4-119b-a6.5b(73.8, **KV 576 KiB 주의 — MHA 32 kv헤드**), deepseek-v4-flash(284/13, UD-Q4 155, DSA), qwen3-235b-a22b(142), glm-4.6(216), minimax-m3(427/23, 264), kimi-k2.6(1T/32B, 584), kimi-k3(2.78T/104B, 1510)

### 한국 모델 (ko 차별화 — **P0-4b 완료, 시드 9종 등재**)
| 후보 | 상태 |
|---|---|
| EXAONE 4.0(32B/1.2B)·4.5-33B, Kanana 1.5(8B/15.7B-A3B), HyperCLOVA X SEED(1.5B/Think 14B), Solar Open(100B/Open 2 250B) | 시드 등재 완료(`korean: true`) — config·GGUF 실측은 research/models.md §1G. ko 페이지 우선 노출, en에도 포함(글로벌에 없는 콘텐츠 = 백링크 유인) |

### quant 목록(콤보 페이지당 표시): Q2_K(UD-XL 표기)·IQ3_XS·Q3_K_M·IQ4_XS·Q4_K_M(기본)·Q5_K_M·Q6_K·Q8_0 + 모델 네이티브(MXFP4 등). bpw 표는 `02-engine-spec.md` §2.1.

## 4. 시드: 캘리브레이션 실측 (`data/benchmarks.json`, 발췌 — 전체 ~70점은 research/hardware.md에서 이관)

| HW | 모델·quant | ctx | pp | tg | 출처 |
|---|---|---|---|---|---|
| RTX 5090 | L2-7B Q4_0 | 짧음 | 14,073 | 290.0 | llama.cpp 공식 #15013 |
| RTX 4090 | 〃 | 〃 | 11,993 | 186.2 | 〃 |
| RTX 3090 | 〃 | 〃 | 5,175 | 158.2 | 〃 |
| RTX 3060 | 〃 | 〃 | 2,138 | 75.6 | 〃 |
| RTX 5090/4090/3090 | Qwen3-8B Q4 | 16k | — | 145.3/104.3/87.5 | hardware-corner llama-bench |
| RTX 5090/4090/3090 | Qwen3-30B-A3B Q4 | 16k | — | 141.6/139.7/113.8 | 〃 |
| RTX 4090 | gpt-oss-20b MXFP4 | 2k | 8,078 | 225.2 | llama.cpp #15396 |
| RTX 5060 Ti 16GB | 〃 | 2k | 3,821 | 111.6 | 〃 |
| RTX 4060 | L3.1-8B Q4_K_M | 가중 | 1,528 | 38.1 | LocalScore acc/137 |
| RTX 3060 12GB | Qwen2.5-14B Q4_K_M | 가중 | 753 | 26.4 | LocalScore acc/43 |
| M4 Max 40c | L2-7B Q4_0 | 짧음 | 886 | 83.1 | llama.cpp #4167 |
| M3 Ultra | gpt-oss-20b | 2k | 2,816 | 115.5 | #15396 |
| M3 Max 128GB | L3.3-70B Q4_K_M | — | — | 9.8 | Ollama 실측 블로그 |
| Strix Halo | gpt-oss-120b MXFP4 | 2k | 707 | 50.2 | quozul.dev ROCm7 |
| DGX Spark | gpt-oss-120b | 2k | 1,717 | ~35 | llama.cpp #16578 |
| 2×RTX 3090 | L3-70B Q4_K_M | — | ~85 | 14~16 | compute-market |
| CPU DDR5-5600 | Mistral-7B Q4_K_M | — | — | 11.2 | llamafile #450 |
| CPU DDR5-5600 | Qwen3-30B-A3B Q4 | — | — | 18~20 | hardware-corner |
| RTX 3060 12GB+DDR5 | Qwen3.6-35B-A3B (cpu-moe) | — | — | 51~53 | openclawdc 2026-07 |

## 5. 데이터 파이프라인 (`scripts/`)

### 5.1 `sync-models.ts` (주 1회 + 신모델 수시, GitHub Actions)
1. 후보 GGUF repo(bartowski, unsloth, lmstudio-community, ggml-org) HF API `GET /api/models/{repo}/tree/main` → quant별 실제 파일 크기 갱신 (분할 파일 합산).
2. 원본 repo `config.json` fetch → layers/kv_heads/head_dim/ctx → `kvBytesPerTokenF16` 재계산. 하이브리드/SWA/MLA는 `attnOverrides` 수동 필드 우선(자동 추출 불가 케이스). 새 모델 추가(`add-model`)는 같은 config 로 `classifyArch` 가 보정값을 계산해 `attnOverrides` 를 쓴다 — 10-03 D63 부터 상수 상태 층 하이브리드(Mamba2·short-conv·KDA+MLA)도 층 지도가 있으면 계산하고, 산식 근거(llama.cpp 소스 URL)를 `attnOverrides.sources` 에 config 와 함께 남긴다(docs/02 §2.2).
3. diff 있으면 PR 자동 생성(리뷰 후 머지·배포 — 리포트 SUSPICIOUS·ERROR 0이면 Claude가 위임 처리, 그 외는 사람 승인. `docs/PROGRESS.md` §3) — 데이터 조작 방지 + 리뷰 기록.
4. **`fileName` 기록(P1-2 D20)**: quant별로 매칭된 파일의 repo 상대 경로를 `fileName`에 기록(1의 크기 갱신과 같은 매칭 결과). **드래프트 파일은 제외** — basename 접두 `mmproj-`·`mtp-`·`eagle3-`는 매칭·크기 합산 모두에서 뺀다(gemma-4 MTP/EAGLE 드래프트가 fileGB에 합산되던 버그 교정 — repo 이름의 `MTP`는 무관). 단일 파일이거나 일관된 분할 세트(`-0000N-of-0000M`, 첫 조각을 기록)가 아니면 `error`(ambiguous match)로 리포트하고 반영하지 않는다. 레코드 키 순서는 `ggufRepo` 뒤에 `fileName`(한 레코드 한 줄 직렬화 유지).
5. **행별 헤더 재측정(10-01 D56 MoE 분할 → 10-03 D62 dense 까지)**: 실측 값이 없거나 이번 동기화에서 fileGB·fileName 이 바뀐 행, 새 양자화 행의 GGUF 헤더를 Range 로 읽어(파일당 4~16MB, 분할은 조각마다) 다시 잰다. MoE 행은 리포트 field `split`(`expertGB`·`nonExpertGB`), dense 행은 field `offgpu`(`offGpuGB`), 둘 다 MTP 블록이 있으면 `mtpGB` 를 함께 기록한다(키는 fileGB 바로 뒤, 새 측정에 MTP 가 없으면 옛 `mtpGB` 삭제). 값이 없던 행의 측정 실패는 manual(다음 동기화 재시도 — 그동안 그 행은 파일 전체로 판정, 보수). **값이 있던 행의 파일이 바뀌었는데 재측정이 실패·보류되면 suspicious**(옛 값이 남으므로 위임 머지를 멈춤). 보류 조건: 측정한 파일 크기(Content-Range)가 fileGB 와 0.02 넘게 다름, MoE 분할 합 > fileGB + 0.02 또는 < 0.75×fileGB, dense offGpuGB > 0.25×fileGB — 다른 파일을 잰 것. config 의 experts/topK 변화는 manual. 첫 채움(10-03)은 일반 sync 와 섞지 않은 대상 한정 백필(트리·config 미조회, 같은 `planSplitChanges`·`applyChanges`)로 130행 auto·suspicious 0 — scratch 실측표와 ±0.01 일치.

6. **다운로드 수(10-06 D68)**: 원본 repo 마다 `GET /api/models/{hfId}` 의 `downloads`(최근 30일)를 다시 읽어 `hfDownloads30d`·`hfDownloadsAsOf`(실행일)를 Δ 임계 없이 쓴다(키는 `popularity` 바로 뒤). 리포트에는 모델별 행 없이 요약 한 줄("다운로드 수(원본 저장소 최근 30일) N종 갱신, 기준일 …")만 — 위임 머지 기준(SUSPICIOUS·ERROR 0)과 무관. 읽기 실패한 모델은 기존 값·기준일 유지 + 같은 줄에 실패 수(ERROR 아님). sources 에 HF 모델 URL(`https://huggingface.co/<hfId>`)이 없는 모델(손으로 쓴 레코드)은 값을 쓰지 않고 같은 줄에 "건너뜀"으로 적는다 — 그대로 쓰면 refine 이 쓰기 전 자가검증을 터뜨려 그 주 동기화 전체가 멈춘다(10-06 리뷰 반영). 다운로드 수만 바뀐 동기화는 `data/meta.json` 기준일을 올리지 않는다(페이지 내용이 그대로인데 사이트맵 lastmod·푸터 기준일이 매주 바뀌지 않게 — 다운로드 기준일은 `hfDownloadsAsOf`).

### 5.2 `new-model-alert.ts` (출시 전 주 1회 → P1-5 출시부터 일 1회): HF trending + 지정 org 신규 릴리스 감지(`text-generation`·`image-text-to-text`) → 카탈로그·기보고·리팩(추측 디코딩 드래프트 dflash·dspark 포함)·OCR 전용·타 org 파생 제외 → 새 후보가 있으면 요약 GitHub issue 1건 생성("48h 내 페이지" SLA는 출시 후 — `04-seo-content-plan.md` §8). 탐지 함수(`fetchDetectionSources`·`filterCandidates`)는 §5.3 자동 추가가 같이 쓴다.

### 5.3 `auto-add-models.ts` — 신모델 자동 추가 ① (10-06 D71, 매일 — `.github/workflows/new-model-add.yml`, New model alert 다음)
역할 분담: **①(GitHub Actions, 무료)** 이 후보를 골라 `add-model` 로 레코드를 만들고 추정값을 채워 검사를 통과하면 PR 을 연다 — 자동 머지·main 푸시는 하지 않는다. **②(Claude 정기 클라우드 작업, 매일)** 가 PR 의 추정값을 모델 카드와 대조해 고치고 전체 검사 통과 시 머지한다(CLAUDE.md 위임, `docs/PROGRESS.md` §3).
1. **후보**: §5.2 와 같은 탐지 함수 — 조회 org 는 감시 org ∪ 아래 허용 목록 ∪ 카탈로그 제작사, org 릴리스 창 14일. 최근 14일 안에 생성됐고(trending 포함) 카탈로그·스킵 목록에 없는 것. 이슈 이력의 기보고 제외는 쓰지 않는다 — 매일 다시 평가한다(출시 직후 다운로드가 적던 모델이 며칠 뒤 기준을 넘을 수 있다).
2. **선별 기준**(정책 상수 — 코드 주석 `// source: docs/03 §5.3 (policy)`): ① 공식 제작사 허용 목록(`OFFICIAL_ORGS` — Qwen·meta-llama·google·mistralai·microsoft·openai·nvidia·deepseek-ai·ibm-granite·LGAI-EXAONE·naver-hyperclovax·kakaocorp·upstage·skt·K-intelligence·trillionlabs·Motif-Technologies·LiquidAI·inclusionAI·allenai·CohereLabs·moonshotai·zai-org·MiniMaxAI·tencent·baidu·HuggingFaceTB·tiiuae·stepfun-ai, 10-06 HF API 로 표기 확인 + 카탈로그 hfId 제작사) **또는** 최근 30일 다운로드 ≥ 20,000(`AUTO_MIN_DOWNLOADS`) ② 드래프트(태그 `draft-model`·`speculative-decoding`)·Base·용도 특화(이름에 화자 분리·guard·safety·reward·embed·rerank·ASR·TTS·시계열 등)는 넣지 않고 "확인 필요" ③ add-model 구조 분류가 보류가 아니고 Q4_K_M GGUF 가 있으며 라이선스가 배지 맵(`license.ts`)에 있을 것 ④ 한 번에 최대 3종(`AUTO_MAX_ADD`, 30일 다운로드 → likes 큰 순), 시도는 최대 8번(`AUTO_MAX_ATTEMPTS`) — 남은 후보는 다음 날.
3. **자동 추정**(add-model 옵션으로 넘기고 PR 본문에 근거와 함께 "추정"으로 표시): **생각 모드** — 채팅 템플릿(`chat_template.jinja` → `tokenizer_config.json` 의 `chat_template`, 게이트 저장소는 unsloth 미러)에서 enable_thinking 기본값(`| default(…)`·`… else True|False`, 없으면 "끄라고 할 때만 끈다" = default-on / "켜라고 할 때만 켠다" = default-off) → reasoning_effort(생각 블록을 비우는 분기가 없으면 always, 있으면 default-on) → 응답 시작에 `<think>` 를 열어 두면 always → 표지 없음은 미지정. 확실하지 않으면 **최선의 값을 넣고 "확인 필요"** 를 단다 — 판정은 생각 모드가 있는지만 본다(×1.5, D59)라 미지정이 더 위험하다(생각하는 모델을 낙관적으로 판정). 카탈로그 43종 템플릿으로 맞춤: 확정한 36종 모두 카탈로그와 같고 7종이 확인 필요(그중 MiniCPM5 2종·HCX SEED Think 는 실제로 auto). **용도** — chat 기본 + 이름·태그 code/coder → coding, image-text-to-text·vision 태그 또는 config 비전 인코더 → vision, always → reasoning. **한국어** — 한국 제작사 org(`KOREAN_ORGS`) → korean. 표시 이름·인기도·최대 컨텍스트는 add-model 기본값(②가 카드와 대조).
4. **검사**: 후보를 하나씩 add-model 함수(`planAddition`·`applyAddition`)로 추가 → `pnpm validate-data` → 공유 카드 글꼴 테스트가 새 글자로 실패하면 `scripts/og-font.ts` 로 다시 받음 → `pnpm test`. 깨지면 그 후보가 쓴 파일만 되돌리고 "확인 필요(검사 실패)". 마지막에 `pnpm build`·`pnpm run test:export` 한 번 — 실패하면 PR 없이 보고서를 그날 요약 이슈에 코멘트하고 런을 실패로 남긴다.
5. **PR(②와의 계약 — 이름을 바꾸지 않는다)**: 브랜치 `data/new-models`(매 실행 main 에서 다시 만든다 — 열린 PR 은 갱신), 라벨 `new-model-add`, 제목 `feat(catalog): 신모델 자동 추가 (YYYY-MM-DD)`, 본문 = 보고서(추가한 모델 표: hfId·구조·기준 GGUF·파라미터·추정값과 근거·add-model 경고 → "② 가 확인할 것" → "확인 필요" 표 → 마커 `<!-- new-model-add: <hfId,…> -->`). 커밋 경로 `data/*.json`·`packages/data/src/index.ts`(MoE `MOE_ARCH`)·`apps/web/assets/og/*`. 추가가 0 이면 PR 없이 요약 이슈에 코멘트. GITHUB_TOKEN 이 만든 PR 이라 CI job 이 돌지 않는다(§5.1 data-sync 와 같음) — ② 가 close→reopen 으로 CI 를 본 뒤 머지.
6. **스킵 목록** `scripts/new-model-skips.json` — `[{ "hfId", "decision": "skip" | "wait", "reason", "decidedAt" }]`(zod `NewModelSkipSchema`, 테스트가 검증). ① 은 여기 있는 hfId 를 후보에서 빼고, ② 가 "넣지 않음·대기" 판단을 여기에 적는다. 사이트에 나가는 데이터가 아니라 운영 메모라 `data/` 밖에 둔다(sources[] 규칙 대상 아님). 첫 내용 = `docs/PROGRESS.md` §2 「카탈로그 확장」의 엔진 후속 대기 4·llama.cpp 본선 대기 4·제외 3.

### 5.4 가격 (`prices.json`): 주간 수동/반자동(정찰 소스: 아마존 표시가, 다나와 최저가). `priceAsOf` 없는 가격 표시 금지. TechPowerUp 등 DB **통째 스크래핑 금지**(개별 사실 확인·출처 기재만) — 법적 리스크 정책.

## 6. 자체 실측 프로토콜 (리그: RTX 5060 Ti 16GB + RAM 16GB, "own" sourceType)

> 전략: 하이엔드(5090/4090) 캘리브레이션은 공개 실측이 풍부해 §4 시드에 이미 포함 — 자체 리그는 **구매 수요가 가장 큰 16GB 미드레인지 세그먼트 + 신모델 48h 실측**을 커버한다(P1·P3 타깃 페르소나와 정확히 일치). 하이엔드 스팟 검증이 필요하면 클라우드 렌트(RunPod 등 5090 ~$1/h × 1~2h)로 충분하며, 렌트 경험 자체가 "못 돌리면 빌리기" CTA의 1차 콘텐츠가 된다. (선택) RAM 64GB 증설 시 gpt-oss-120b·GLM-4.5-Air cpu-moe 측정이 열리지만 2026 DRAM 대란 가격을 감안해 필수 아님.
표준 커맨드(제출 가이드 페이지에도 동일 게재):
```
llama-bench -m {model.gguf} -p 512,2048 -n 128 -ngl 99 -fa 1        # 기본
llama-bench -m {model.gguf} -p 2048 -n 128 -d 8192,16384             # 컨텍스트 감쇠 측정
# MoE cpu-moe: llama-bench -m {model} -ngl 99 --n-cpu-moe {N} …
기록: GPU/드라이버, llama.cpp 빌드 해시, ctx, 플래그, 전력 제한 여부
```
1차 측정 매트릭스 (VRAM 16GB·RAM 16GB 기준, 목표 ≥30행 — A그룹만으로 충족 가능):
- **A. 풀 오프로드 dense**: llama-3.1-8b·qwen3-8b·qwen3.5-9b(MTP)·r1-distill-8b {Q4_K_M, Q8_0} / qwen3-14b·phi-4·gemma-3-12b·gemma-4-12b {Q4_K_M, Q6_K} / mistral-small-3.2 {IQ4_XS 기본; Q4_K_M(14.33GB)은 KV q8_0·4k 조건부} / gemma-3-27b {IQ3_XS·Q3_K_M} / qwen3-32b {Q2_K} — 각 ctx {2k, 16k}
- **B. MoE (16GB 카드의 킬러 콘텐츠)**: gpt-oss-20b MXFP4(풀 GPU, 공개 실측 111.6 tok/s 재현 대조) / qwen3-30b-a3b-2507 Q4_K_M(`--n-cpu-moe` 최소 스필 ~4GB) / qwen3.5-35b-a3b Q4_K_M(스필 ~9GB — RAM 16GB에선 저ctx 조건부, **실패해도 그 기록이 데이터**)
- **C. 교육용 절벽 데모**: qwen3-32b Q4_K_M `-ngl` 스윕(부분 오프로드 감속 곡선) + KV f16 vs q8_0 비교 1종
- **D. 불가 판정 실증**: llama-3.3-70b Q4_K_M — "안 됨"을 실측으로 못박는 콤보 페이지용
- **E. 한국 모델 5종 (ko 차별화 — 글로벌에 공개 실측 전무 = 백링크 유인, P0-4b 시드)**: kanana-1.5-8b {Q4_K_M, Q8_0} / hyperclovax-seed-think-14b Q4_K_M(단일 배포, 리즈닝 — 감쇠 측정 포함) / kanana-1.5-15.7b-a3b Q4_K_M(10.44GB — 16GB 풀 GPU MoE) / hyperclovax-seed-1.5b Q8_0(온디바이스급 대조) / exaone-4.5-33b IQ4_XS(18.03GB — `-ngl` 부분 오프로드, C그룹 절벽 곡선과 교차 검증) — 각 ctx {2k, 16k}
→ 출시 시 16GB 세그먼트에 "실측 배지" 달린 페이지 확보.

## 7. 갱신 케이던스 요약
| 데이터 | 주기 | 방법 |
|---|---|---|
| 모델 파일 크기·신모델 | 주 1회 + 알림 시 즉시 | 파이프라인 PR |
| 신모델 레코드 | 매일 | 자동 추가 PR(①) → Claude 정기 작업(②) 검토·머지 (§5.3, D71) |
| 모델 HF 다운로드 수(최근 30일) | 주 1회 | 파이프라인 PR (자동 반영, 리포트 요약 한 줄 — D68) |
| GPU 신제품 | 발표 시 | 수동 (Super/B770 등 미출시 rumor는 절대 미등록) |
| 가격 | 주 1회 | 반자동 + priceAsOf |
| 효율 계수 | P2부터 주 1회 배치 | 제출 실측 n≥3 조합만 override |
| 환율(ko 표기) | 주 1회 | 공개 API |
