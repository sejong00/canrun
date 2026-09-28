# 03. 데이터 명세 — 스키마·시드 데이터·파이프라인

> MVP 데이터는 저장소 `/data/*.json` (버전 관리·PR 리뷰 가능). Phase 2에서 제출 데이터만 D1(SQLite)로. **모든 레코드에 `sources: string[]` 필수.** 본 문서의 시드 표는 2026-08-09 리서치 실측·공식 스펙 기준 — 그대로 JSON화하면 시드 v1 완성.

## 1. 스키마 (zod로 구현, `packages/data/schema.ts`)

```ts
Gpu { id, name, aliases[], vendor:'nvidia'|'amd'|'intel'|'apple'|'amd-apu'|'nvidia-dgx',
     kind:'dgpu'|'unified', form:'desktop'|'laptop', vramGB, memBandwidthGBs, fp16Tflops,
     effClass, launchYear, msrpUSD?, streetUSD?, streetKRW?, priceAsOf?, popular:boolean, sources[] }
Model { id, family, name, hfId, paramsB, activeParamsB?, arch:{layers,kvHeads,headDim,
     attnType:'full'|'swa'|'mla'|'hybrid', kvBytesPerTokenF16},  // 사전계산 저장
     maxContext, license, moe:boolean, nonExpertGB?, category:('chat'|'coding'|'reasoning'|'vision')[],
     korean?:boolean, popularity:1..5, releasedAt, sources[] }
ModelQuant { modelId, quant, fileGB, ggufRepo, sources[] }   // 실제 파일 크기
QuantDef { id, bpw, tier:'safe'|'ok'|'degraded'|'desperate', note }
BenchPoint { id, gpuId|hardwareDesc, modelId, quant, backend, backendVersion,
     ctx, ppTokS?, tgTokS, flags?, sourceUrl, sourceType:'official-thread'|'localscore'|'community'|'own',
     verified:boolean, measuredAt }
Submission (P2, D1) { BenchPoint + submitterHash, ip rate-limit fields, status:'pending'|'approved'|'rejected'|'flagged' }
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
2. 원본 repo `config.json` fetch → layers/kv_heads/head_dim/ctx → `kvBytesPerTokenF16` 재계산. 하이브리드/SWA/MLA는 `attnOverrides` 수동 필드 우선(자동 추출 불가 케이스).
3. diff 있으면 PR 자동 생성(리뷰 후 머지·배포 — 리포트 SUSPICIOUS·ERROR 0이면 Claude가 위임 처리, 그 외는 사람 승인. `docs/PROGRESS.md` §3) — 데이터 조작 방지 + 리뷰 기록.
### 5.2 `new-model-alert.ts` (출시 전 주 1회 → P1-5 출시부터 일 1회): HF trending + 지정 org 신규 릴리스 감지(`text-generation`·`image-text-to-text`) → 카탈로그·기보고·리팩·타 org 파생 제외 → 새 후보가 있으면 요약 GitHub issue 1건 생성("48h 내 페이지" SLA는 출시 후 — `04-seo-content-plan.md` §8).
### 5.3 가격 (`prices.json`): 주간 수동/반자동(정찰 소스: 아마존 표시가, 다나와 최저가). `priceAsOf` 없는 가격 표시 금지. TechPowerUp 등 DB **통째 스크래핑 금지**(개별 사실 확인·출처 기재만) — 법적 리스크 정책.

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
| GPU 신제품 | 발표 시 | 수동 (Super/B770 등 미출시 rumor는 절대 미등록) |
| 가격 | 주 1회 | 반자동 + priceAsOf |
| 효율 계수 | P2부터 주 1회 배치 | 제출 실측 n≥3 조합만 override |
| 환율(ko 표기) | 주 1회 | 공개 API |
