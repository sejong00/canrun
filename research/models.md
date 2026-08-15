# 모델·양자화 원자료 (수집 2026-08-09) — `data/models.json`·`model-quants.json`·`quants.json`의 sources[] 원천

> 파라미터 ⭐ = HF safetensors 메타데이터에서 직접 확인(정확), 그 외 = 공식 모델 카드. GGUF 크기 = 명기된 repo의 실제 파일(decimal GB), † = repo 게시표/동형 자매 repo 값(재확인 권장). KV KiB/tok = `4×kv_heads×head_dim×full_attn_layers/1024` (f16 K+V).

## 1. 모델 카탈로그

### 1A. Dense 소형 (≤5B)
| 모델 | HF repo | params | L/KV/hd | KV | ctx | 라이선스 | Q4_K_M | Q8_0 |
|---|---|---|---|---|---|---|---|---|
| Llama 3.2 1B | meta-llama/Llama-3.2-1B-Instruct | 1.24B | 16/8/64 | 32 | 131k | Llama 3.2 | 0.81† | 1.32† |
| Llama 3.2 3B | meta-llama/Llama-3.2-3B-Instruct | 3.21B | 28/8/128 | 112 | 131k | Llama 3.2 | 2.02 | 3.42 |
| Qwen3 0.6B/1.7B | Qwen/Qwen3-0.6B, -1.7B | 0.75/2.03B | 28/8/128 | 112 | 32k | Apache-2.0 | 0.48†/1.28† | 0.64†/2.17† |
| Qwen3 4B 2507 | Qwen/Qwen3-4B-Instruct-2507 | 4.0B | 36/8/128 | 144 | 262k | Apache-2.0 | 2.50† | 4.28† |
| Qwen3.5 4B (2026) | Qwen/Qwen3.5-4B | ⭐4.66B | 하이브리드 리니어 3:1 | 소 | 262k | Apache-2.0 | 2.83 | 4.61 |
| Qwen3.5 0.8B/2B | Qwen/Qwen3.5-0.8B, -2B | ⭐0.873/⭐2.274B | 〃 | 소 | 262k | Apache-2.0 | unsloth MTP-GGUF repo | |
| Gemma 3 1B/4B | google/gemma-3-1b/4b-it | 1.0/4.3B | SWA 5:1 (win 512/1024) | ~4/~24 | 32k/131k | Gemma | 0.80†/2.49† | 1.07†/4.13† |
| Gemma 3n E4B | google/gemma-3n-E4B-it | ~8B raw/4B eff (MatFormer+PLE) | 30/—/256 | 소 | 32k | Gemma | 4.54† | 7.35 (ggml-org) |
| Phi-4-mini | microsoft/Phi-4-mini-instruct | 3.84B | 32/8/128 | 128 | 131k | MIT | 2.49† | 4.08† |

### 1B. Dense 중형 (7~15B)
| 모델 | HF repo | params | L/KV/hd | KV | ctx | 라이선스 | Q4_K_M | Q8_0 | Q2_K | IQ4_XS |
|---|---|---|---|---|---|---|---|---|---|---|
| Llama 3.1 8B | meta-llama/Llama-3.1-8B-Instruct | 8.03B | 32/8/128 | 128 | 131k | Llama 3.1 | **4.92** | **8.54** | **3.18** | **4.45** |
| Qwen3 8B | Qwen/Qwen3-8B | 8.2B | 36/8/128 | 144 | 32k(Y131k) | Apache-2.0 | **5.03** | **8.71** | 3.28 | 4.58 |
| Qwen3 14B | Qwen/Qwen3-14B | 14.8B | 40/8/128 | 160 | 32k(Y131k) | Apache-2.0 | **9.00** | **15.70** | 5.75 | 8.14 |
| Qwen3.5 9B (2026) | Qwen/Qwen3.5-9B | ⭐9.65B | 32(8 full)/4/256 | **32**+state | 262k | Apache-2.0 | **5.87** | 9.79 | — | 5.47 |
| Gemma 3 12B | google/gemma-3-12b-it | 12.2B | 48/8/256 SWA | ~64 | 131k | Gemma | 7.30† | 12.98† | 4.77† | 6.60† |
| Gemma 4 12B (2026) | google/gemma-4-12B-it | ⭐11.96B | SWA 5:1 | 저 | 262k | Gemma | **7.12** | 12.67 | 4.66(Q2_K_XL) | 6.38 |
| Phi-4 | microsoft/phi-4 | 14.7B | 40/10/128 | 200 | 16k | MIT | **9.05** | **15.58** | — | Q6_K 12.03 |
| R1-Distill-Qwen-7B/14B | deepseek-ai/DeepSeek-R1-Distill-Qwen-7B/-14B | 7.62/14.8B | 28/4/128 · 48/8/128 | 56/192 | 131k | MIT | 4.68†/8.99† | 8.10†/15.70† | — | — |
| R1-Distill-Llama-8B | deepseek-ai/DeepSeek-R1-Distill-Llama-8B | 8.03B | 32/8/128 | 128 | 131k | MIT | 4.92† | 8.54† | — | — |

### 1C. Dense 대형 (23~70B)
| 모델 | HF repo | params | L/KV/hd | KV | ctx | 라이선스 | Q4_K_M | Q8_0 | Q2_K | IQ4_XS |
|---|---|---|---|---|---|---|---|---|---|---|
| Mistral Small 3.2 24B | mistralai/Mistral-Small-3.2-24B-Instruct-2506 | 23.6B | 40/8/128 | 160 | 131k | Apache-2.0 | **14.33** | **25.05** | 8.89 | 12.76 |
| Magistral Small 2509 / Devstral 2507 | mistralai/… | 23.6B 동형 | 〃 | 160 | 131k | Apache-2.0 | 14.3† | 25.1† | — | — |
| Gemma 3 27B | google/gemma-3-27b-it | 27.4B | 62/16/128 SWA | ~80 | 131k | Gemma | **16.55** | **28.71** | 10.50 | 14.77 |
| Gemma 4 31B (2026) | google/gemma-4-31B-it | ⭐32.68B | 60(12 full+48 SWA)/16/256 | 192 | 262k | Gemma | **18.32** | 32.64 | — | 16.37 |
| Qwen3 32B | Qwen/Qwen3-32B | 32.8B | 64/8/128 | 256 | 32k(Y131k) | Apache-2.0 | **19.76** | **34.82** | 12.34 | 17.69 |
| Qwen3.5 27B (2026) | Qwen/Qwen3.5-27B | ⭐27.78B | 하이브리드 3:1, 4KV/256 | 저 | 262k(Y~1M) | Apache-2.0 | **16.86** | 28.63 | 11.91(UD-Q2_XL) | 15.51 |
| Qwen3.6 27B (2026-06/07 refresh, 멀티모달) | Qwen/Qwen3.6-27B | ~27.8B 동형 | 〃 | 저 | 262k | Apache-2.0 | ≈16.9† | ≈28.6† | — | — |
| QwQ-32B | Qwen/QwQ-32B | 32.8B | 64/8/128 | 256 | 131k | Apache-2.0 | 19.85† | 34.82† | 12.31† | — |
| R1-Distill-Qwen-32B | deepseek-ai/… | 32.8B | 64/8/128 | 256 | 131k | MIT | **19.85** | **34.82** | **12.31** | Q6_K 26.89 |
| Llama 3.3 70B | meta-llama/Llama-3.3-70B-Instruct | 70.6B | 80/8/128 | 320 | 131k | Llama 3.3 | **42.52** | **74.98** | **26.38** | **37.90** (IQ2_M 24.12) |
| Llama 3.1 70B / R1-Distill-70B | meta-llama/…, deepseek-ai/… | 70.6B | 〃 | 320 | 131k | Llama/MIT | 42.5† | 75.0† | — | — |

### 1D. MoE 소비자급 (8~24GB VRAM Q4 또는 cpu-moe)
| 모델 | HF repo | tot/act | 구조 | KV | ctx | 라이선스 | 크기 |
|---|---|---|---|---|---|---|---|
| **gpt-oss-20b** | openai/gpt-oss-20b | 20.9/3.6B (⭐21.5) | 24L(12 full+12 SWA win128)/8/64, 32E top-4 | 24 | 131k | Apache-2.0 | **MXFP4 12.11** (ggml-org, 네이티브 전용) |
| Qwen3 30B-A3B 2507 | Qwen/Qwen3-30B-A3B-Instruct-2507 | 30.5/3.3B | 48/4/128, 128E top-8 | 96 | 262k | Apache-2.0 | Q4_K_M **18.6** · Q8_0 32.5 · Q2_K 11.3 · IQ4_XS 16.4 |
| Qwen3-Coder-30B-A3B | Qwen/Qwen3-Coder-30B-A3B-Instruct | 동형 | 〃 | 96 | 262k | Apache-2.0 | 18.6† |
| Qwen3.5 35B-A3B (2026) | Qwen/Qwen3.5-35B-A3B | ⭐35.95/~3B | 40L(10 full)/2/256, 256E top-8+1shared, 리니어 3:1 | **20**+state | 262k(Y~1M) | Apache-2.0 | Q4_K_M **22.63** · Q8_0 37.80 · Q2_K_XL 12.57 · IQ4_XS 18.17 |
| Qwen3.6 35B-A3B (r/LocalLLaMA 기본픽, MTP GGUF) | Qwen/Qwen3.6-35B-A3B | 동형 | 〃 | 20 | 262k | Apache-2.0 | ≈22.6† (MTP로 tg 대폭 가속) |
| Gemma 4 26B-A4B (구글 첫 오픈 MoE) | google/gemma-4-26B-A4B-it | ⭐26.54/~4B | SWA 중심 | 저 | 262k | Gemma | UD-Q4_K_M **16.95** · Q8_0 26.86 · UD-Q2_K_XL 10.55 (UD-IQ4_XS 9.92 표기는 이상치 — repo 재확인) |

### 1E. MoE 프로슈머 (48~128GB급)
| 모델 | tot/act | 비고 | ctx | 라이선스 | 크기 |
|---|---|---|---|---|---|
| **gpt-oss-120b** (openai) | ⭐116.8/5.1B | 36L(18 SWA win128)/8/64, KV 36 | 131k | Apache-2.0 | **MXFP4 63.39** (ggml-org) |
| Llama 4 Scout (meta-llama) | 109/17B | 48/8/128, iRoPE, KV 192 | 10M | Llama 4 | Q4 **65.4** · IQ2_XXS 37.4 · IQ1_S 32.5 (unsloth) |
| GLM-4.5-Air (zai-org) | 106/12B | 46L/8/128, KV 184 | 131k | MIT | UD-Q4_K_XL **67.7** · Q2_K_XL 47.4 |
| Qwen3.5 122B-A10B | ⭐125.09/10B | 하이브리드 | 262k(Y1M) | Apache-2.0 | UD-Q4_K_M **78.3** · UD-Q2_K_XL 42.8 |
| Mistral Small 4 119B (2026-03) | ⭐119.4/6.5B | 36L/**32KV**/128 MHA — **KV 576 KiB/tok 주의** | 262k | Apache-2.0(카드 확인 권장) | **73.8** · IQ3_XXS 42.8 · IQ1_M 32.3 |
| Llama 4 Maverick | 400/17B | 48/8/128, 128E | 1M | Llama 4 | UD-Q4_K_XL ~243† |

### 1F. MoE 플래그십 (멀티GPU/서버급 — 카탈로그 후순위, 페이지는 생성 가치 있음)
gpt급 요약: Qwen3-235B-A22B-2507 (235/22B, Q4 142, KV 188) · Qwen3-Coder-480B (Q4 ~276†) · Qwen3.5-397B-A17B (⭐403.4/17B) · DeepSeek-R1-0528 & V3.1 (671/37B, MLA ~69 KiB, Q4 405, TQ1_0 162~170) · **DeepSeek-V4-Flash (2026-04, ⭐290.9/13B, DSA sparse, 1M ctx, UD-Q4 155, MIT — "로컬용 DeepSeek")** · V4-Pro (⭐1.599T/49B) · GLM-4.6 (357/32B, Q4 216) · **GLM-5/5.1/5.2 (⭐753.9/~40B, GlmMoeDsa, 5.2 Q4 466)** · Kimi K2-Instruct/Thinking (⭐1.03T/32B, MLA, 네이티브 INT4) · K2.5/2.6/2.7-Code (K2.6 UD-Q4 584) · **Kimi K3 (2026-07-16, ⭐2.78T/104B, KDA+MLA, 네이티브 MXFP4, 1M ctx, UD-Q4 1510)** · MiniMax M2/2.5 (⭐228.7/10B) · M3 (⭐427/~23B, MSA, UD-Q4 264) · Mistral Medium 3.5 (~128B dense)

기타 2025-26: Qwen3-Next-80B-A3B, Ministral-8B, Granite 4.0, Olmo 3, Leanstral-1.5, Qwen3-VL, Phi-4-reasoning-plus. **Meta는 2025-04 이후 신규 릴리스 없음(org 리스팅 확인).**

## 2. GGUF quant 포맷 (llama.cpp 공식 실측표, Llama-3.1-8B 기준 — 엔진 상수 원천)

| quant | bpw | 8B 파일(GiB) | GB/1B | 등급 |
|---|---|---|---|---|
| IQ1_S / IQ1_M | 2.0042 / 2.1460 | 1.87 / 2.01 | 0.27/0.29 | 최후수단(거대 MoE+UD만) |
| IQ2_XXS / XS / S / M | 2.3824 / 2.5882 / 2.7403 / 2.9294 | 2.23~2.74 | 0.32~0.39 | IQ2_M이 2비트 최선 |
| Q2_K | 3.1593 | 2.95 | 0.42 | 열화 — UD-Q2_K_XL 권장 |
| IQ3_XXS / XS / S / M | 3.2548 / 3.4977 / 3.6606 / 3.7628 | 3.04~3.52 | 0.44~0.51 | 저VRAM 스위트스폿 |
| Q3_K_S / M / L | 3.6429 / 3.9960 / 4.2979 | 3.41~4.02 | 0.49~0.58 | 소형 모델엔 열화 가시 |
| **IQ4_XS** | 4.4597 | 4.17 | 0.60 | 4비트 최고 효율 |
| Q4_0 / Q4_K_S / IQ4_NL | ~4.55 / 4.6672 / 4.6818 | 4.24~4.38 | 0.61~0.63 | Q4_0은 ARM 리팩용 레거시 |
| **Q4_K_M** | 4.8944 | 4.58 | 0.66(GiB)/0.61(GB) | **기본 추천·Ollama 기본** |
| Q5_K_S / **Q5_K_M** | 5.5704 / 5.7036 | 5.21 / 5.33 | 0.75/0.77 | Q6_K 근접 |
| **Q6_K** | 6.5633 | 6.14 | 0.88 | 준무손실 |
| **Q8_0** | 8.5008 | 7.95 | 1.14 | 사실상 무손실 |
| F16 | 16.0005 | 14.96 | 2.15 | 기준 |
| **MXFP4** | 4.25 (e2m1+공유스케일/32) | 20b→12.11GB | ~0.58 | gpt-oss·K3 네이티브 — 실파일 크기만 사용 |
| TQ1_0 / TQ2_0 | 1.6875 / 2.0625 | R1-671B→162GB | ~0.24 | 거대 MoE+UD 믹스만 |

검증: 8.03B×4.8944/8 = 4.91 vs 실제 4.92GB. 주의: UD(*_XL)와 네이티브 quant는 flat bpw 이탈 · "M" k-quant는 attn.v/ffn.down 일부 Q6_K 승격 · MoE는 저비트 내성↑, <4B dense는 Q4 미만 급락.

## 3. 런타임 생태계 (2026-08 상태 — 계산기 로직에 반영)

- **llama.cpp**: FA 기본 on(PR #15434) · KV quant `--cache-type-k/v` f16/q8_0/q5_1/q4_0 (V는 FA 필요; "메모리 기능이지 속도 기능 아님") · **`--cpu-moe`/`--n-cpu-moe N`** (PR #15077) = 12~16GB 카드로 대형 MoE 구동 표준 경로(3060 12GB+DDR5 ≈ 51~53 tok/s @35B-A3B급, 4080 ≈ 60) · **MTP 머지**(PR #22673, Qwen3.5/3.6 MTP GGUF → tg 대폭 가속) · SWA-aware KV(슬라이딩 레이어는 window 상한, `--swa-full`로 해제) · 하이브리드/MLA/DSA 아키텍처 GGUF 구동 가능
- **Ollama** (v0.32.x): **기본 컨텍스트 VRAM 티어제 — <24GiB→4k, 24~48→32k, ≥48→256k** (`OLLAMA_CONTEXT_LENGTH` 오버라이드, `ollama ps`로 확인) · 라이브러리 기본 quant Q4_K_M(gpt-oss는 MXFP4) · `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0` · Mac 백엔드 MLX 전환 보도(2026-03, 하드코딩 전 재확인)
- **LM Studio** (v0.4.16): GGUF+MLX 듀얼 엔진(M시리즈에서 MLX 10~40% 빠름) · 기본 ctx 8k · MTP 안정(0.4.14) · 텐서 병렬 멀티GPU(0.4.15) · 다운로드 후 fit 배지(우리는 다운로드 전을 커버)
- **MLX/Apple**: 4/5/6/8비트+DWQ · "VRAM" = wired limit(기본 ~65~75%, `sudo sysctl iogpu.wired_limit_mb` 상향) · M5 뉴럴 액셀러레이터 MLX 지원

## 4. 재확인 플래그 (시드 JSON화 시 체크)
Gemma-4-26B-A4B UD-IQ4_XS 9.92GB(이상치 의심) · Mistral Small 4 라이선스(카드 재확인) · Maverick/480B/397B/M2.5 크기(† 값) · Kimi K3 active 104B(일부 언론 ~50B 오보) · 모든 † 값.

## 5. 출처 URL (계열별)
- quant 표: github.com/ggml-org/llama.cpp → tools/quantize/README.md (bpw·GiB 원표) · k-quants PR #1684 · i-quants PR #4773
- 런타임: llama.cpp PR #15434(FA)·#15077(cpu-moe)·#22673(MTP)·tools/server/README.md(KV quant) · docs.ollama.com/context-length · unsloth.ai/docs/models/qwen3.6 · openclawdc.com/blog/llama-cpp-moe-offload-flags-explained · convly.ai/lm-studio-complete-guide-2026 · machinelearning.apple.com/research/exploring-llms-mlx-m5
- Llama: huggingface.co/meta-llama(리스팅) · bartowski/Meta-Llama-3.1-8B-Instruct-GGUF · bartowski/Llama-3.3-70B-Instruct-GGUF · unsloth/Llama-4-Scout-17B-16E-Instruct-GGUF · unsloth/Llama-3.2-3B-Instruct-GGUF(tree API)
- Qwen: Qwen/Qwen3.5-9B·-35B-A3B raw config.json · api/models?author=Qwen&search=Qwen3.5(3.6)&expand[]=safetensors · unsloth/Qwen3.5-{4B,9B,27B,35B-A3B,122B-A10B}-MTP-GGUF tree · unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF · unsloth/Qwen3-{8B,14B}-GGUF · bartowski/Qwen_Qwen3-32B-GGUF · unsloth/Qwen3-235B-A22B-Instruct-2507-GGUF
- DeepSeek: deepseek-ai/DeepSeek-V4-Flash raw config · recipes.vllm.ai/deepseek-ai/DeepSeek-V4-Flash · unsloth/DeepSeek-{V4-Flash,R1-0528,V3.1}-GGUF · unsloth/DeepSeek-R1-Distill-Qwen-32B-GGUF
- gpt-oss: ggml-org/gpt-oss-{20b,120b}-GGUF tree · huggingface.co/openai/gpt-oss-20b
- Gemma: unsloth/gemma-4-31B-it raw config · unsloth/gemma-4-{12b,26B-A4B,31B}-it-GGUF tree · bartowski/google_gemma-3-27b-it-GGUF · ggml-org/gemma-3n-E4B-it-GGUF
- Mistral: api/models?author=mistralai · mistralai/Mistral-Small-4-119B-2603 raw config · recipes.vllm.ai/mistralai/Mistral-Small-4-119B-2603 · mistral.ai/news/mistral-small-4 · unsloth/Mistral-Small-4-119B-2603-GGUF · bartowski/mistralai_Mistral-Small-3.2-24B-Instruct-2506-GGUF
- GLM/Kimi/MiniMax: zai-org/GLM-5 raw config · recipes.vllm.ai/zai-org/GLM-5.2 · unsloth/GLM-{5.2,4.6,4.5-Air}-GGUF · moonshotai/Kimi-K3 raw config · unsloth/Kimi-{K3,K2.6}-GGUF · marktechpost.com 2026-07-16(K3 릴리스) · MiniMaxAI/MiniMax-M2.5 raw config · unsloth/MiniMax-M3-GGUF
- Phi: lmstudio-community/phi-4-GGUF tree · microsoft/phi-4
- 2026 지형 개관: fazm.ai/t/latest-open-source-llm-releases-2026 · thundercompute.com/blog/best-open-source-llms · insiderllm.com/guides/best-local-coding-models-2026
