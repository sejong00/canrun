# 하드웨어 원자료 (수집 2026-08-09) — `data/gpus.json`·`data/benchmarks.json`의 sources[] 원천

> 스펙은 TechPowerUp GPU DB·제조사 공식 페이지에서 개별 확인. 가격은 2026-08 DRAM 대란 반영(변동성 큼 — priceAsOf 필수). 실측은 원문 URL 그대로.

## 1. NVIDIA 데스크톱 (FP16 = shader TFLOPS, TechPowerUp 기준)

| GPU | VRAM | BW GB/s | FP16 | MSRP | Street 26-08 |
|---|---|---|---|---|---|
| RTX 5090 | 32 GDDR7 | 1,792 | 104.8 | $1,999 | $4,200~4,288 |
| RTX 5080 | 16 GDDR7 | 960 | 56.3 | $999 | ~$1,256 |
| RTX 5070 Ti | 16 GDDR7 | 896 | 44.1 | $749 | ~$949 |
| RTX 5070 | 12 GDDR7 | 672 | 30.9 | $549 | ~$629 |
| RTX 5060 Ti 16GB | 16 GDDR7 | 448 | 23.7 | $429 | ~$569 |
| RTX 5060 Ti 8GB | 8 GDDR7 | 448 | 23.7 | $379 | ~$429 |
| RTX 5060 | 8 GDDR7 | 448 | 19.2 | $299 | ~$339 |
| RTX 4090 | 24 GDDR6X | 1,008 | 82.6 | $1,599 | ~$2,755 신품 / ~$2,400 중고 |
| RTX 4080 Super | 16 | 736 | 52.2 | $999 | EOL |
| RTX 4080 | 16 | 717 | 48.7 | $1,199 | EOL |
| RTX 4070 Ti Super | 16 | 672 | 44.1 | $799 | EOL |
| RTX 4070 Super | 12 | 504 | 35.5 | $599 | EOL |
| RTX 4070 | 12 | 504 | 29.1 | $599 | EOL |
| RTX 4060 Ti 16GB | 16 | 288 | 22.1 | $499 | EOL |
| RTX 4060 Ti 8GB | 8 | 288 | 22.1 | $399 | EOL |
| RTX 4060 | 8 | 272 | 15.1 | $299 | EOL |
| RTX 3090 Ti | 24 | 1,008 | 40.0 | $1,999 | 중고 |
| RTX 3090 | 24 | 936 | 35.6 | $1,499 | ~$1,050 중고 |
| RTX 3080 12GB | 12 | 912 | 30.6 | $799 | 중고 |
| RTX 3080 10GB | 10 | 760 | 29.8 | $699 | 중고 |
| RTX 3070 | 8 | 448 | 20.3 | $499 | 중고 |
| RTX 3060 12GB | 12 | 360 | 12.7 | $329 | ~$250 |
| RTX 3050 8GB | 8 | 224 | 9.1 | $249 | 중고 |
| RTX 2080 Ti | 11 | 616 | 26.9 | $999 | 중고 |
| GTX 1080 Ti | 11 GDDR5X | 484 | FP16 크리플(0.18) | $699 | 중고 |
| GTX 1660 Super | 6 | 336 | 10.1 | $229 | 중고 |

**미출시 확인(2026-08)**: RTX 50 Super — 파트너 통보로 무기 연기(3GB GDDR7 단가 3배 문제), 2027 전망. RTX 60도 연기. Arc B770 — 보드 파트너 "여전히 없음" 확인. → **rumor SKU는 DB 등록 금지.**

## 2. NVIDIA 랩톱 (별개 SKU로 등록)

| Laptop GPU | VRAM | 버스 | BW GB/s |
|---|---|---|---|
| RTX 5090 Laptop | 24 GDDR7 | 256-bit | 896 |
| RTX 5080 Laptop | 16 | 256-bit | 896 |
| RTX 5070 Ti Laptop | 12 | 192-bit | 672 |
| RTX 5070 Laptop | 8 | 128-bit | 448 |
| RTX 4090 Laptop | 16 GDDR6 | 256-bit | 576 |
| RTX 4080 Laptop | 12 | 192-bit | 432 |
| RTX 4070 Laptop | 8 | 128-bit | 256 |
| RTX 4060 Laptop | 8 | 128-bit | 256 |

실측 예: RTX 4060 Mobile tg128 59.5 vs 데스크톱급 3060 75.9 (Vulkan 동일 모델).

## 3. AMD·Intel (AMD FP16은 dual-issue peak — 보수적으론 절반)

| GPU | VRAM | BW | FP16 peak | MSRP | Street |
|---|---|---|---|---|---|
| RX 9070 XT | 16 | 645 | 97.3 | $599 | $689~720 |
| RX 9070 | 16 | 645 | 72.3 | $549 | ~$639 |
| RX 9060 XT 16GB | 16 | 322 | 51.3 | $349 | ~$449 |
| RX 7900 XTX | 24 | 960 | 122.8 | $999 | 중고 |
| RX 7900 XT | 20 | 800 | 103.0 | $899 | 중고 |
| RX 7800 XT | 16 | 624 | 74.7 | $499 | 중고 |
| RX 7600 XT / 7600 | 16 / 8 | 288 | 45.1 / 43.5 | $329 / $269 | 중고 |
| Arc B580 / B570 | 12 / 10 | 456 / 380 | 27.3 / ~23 | $249 / $219 | $250~330 |
| Arc A770 16GB | 16 | 560 | 39.3(XMX) | $349 | EOL |

## 4. Apple Silicon·통합 메모리·시스템 RAM

| 칩/플랫폼 | BW GB/s | RAM 구성 | 비고 |
|---|---|---|---|
| M2 / Pro / Max / Ultra | 100 / 200 / 400 / 800 | 8-24 / 16-32 / 32-96 / 64-192 | |
| M3 / Pro / Max / Ultra | 100 / 150 / 300-400 / 819 | 8-24 / 18-36 / 36-128 / 96-512 | M3 Max 30c=300, 40c=400 |
| M4 / Pro / Max | 120 / 273 / 410-546 | 16-32 / 24-64 / 36-128 | M4 Max 32c=410, 40c=546 |
| M5 (2025-10) | 153.6 | 12-32 | LPDDR5X-9600 |
| M5 Pro / Max (2026-03 출시) | 307 / 460-614 | 24-64 / 36-128 | M5 Max 32c=460, 40c=614 |
| Ryzen AI Max+ 395 Strix Halo | 256 | ~128 LPDDR5X-8000 256-bit | Framework Desktop $1,999 등 |
| NVIDIA DGX Spark (GB10) | 273 | 128 | $3,999 (ASUS 클론 $2,999) |
| DDR4-3200 2ch / DDR5-5600 / DDR5-6000 | 51.2 / 89.6 / 96.0 | — | 이론치 |

## 5. 실측 벤치마크 전체 (~70점, pp/tg tok/s)

### 5.1 llama.cpp 공식 CUDA 스레드 — Llama 2 7B Q4_0 (3.83GB), pp512/tg128, FA off [S1]
5090 14,073/290.0 · 4090 11,993/186.2 · 5080 8,297/182.0 · 4080S 8,125/148.3 · 5070Ti 6,952/176.9 · 4070TiS 6,925/132.3 · 3090Ti 6,567/171.2 · 3090 5,175/158.2 · 5070 5,185/127.5 · 3080-10G 5,014/139.7 · 5060Ti16 3,737/90.9 · 4060Ti8 3,395/63.9 · 3060 2,138/75.6
(10-15 D81 — 레코드마다 제출 댓글로 고정: 값은 모두 제출의 fa 0 줄과 같다. 빌드 b6002~b7293, 제출일 2025-08-01~12-07 — 옛 measuredAt 2025-08-01 일괄은 토론 개설일 근사. 5070 은 빌드 미기재)

### 5.2 gpt-oss(MXFP4 MoE) 공식 가이드 — pp2048/tg128 [S2]
20b: 5090 9,841/282.3 · 4090 8,078/225.2 · 5080 7,469/204.9 · 5070Ti 6,326/189.5 · 4080S 8,111/186.4 · 3090 5,143/162.0 · 5060Ti16 3,821/111.6 · 7900XT(ROCm) 4,252/101.9 · M3 Ultra 2,816/115.5 · M4 Max 36GB(=32코어 410GB/s) 1,277/92.4
120b: M2 Ultra 1,245/79.7
(10-15 D81 — 제출 댓글로 고정: NVIDIA 6종은 victorapm 2025-08-20 b6208·b6210 의 ub 4096 줄, 4080S 는 2025-08-29 b6316, M3 Ultra 는 2025-08-28 b6310, M4 Max·M2 Ultra 는 가이드 원글 2025-08-18 b6123. **M4 Max 36GB 는 32코어 GPU 구성뿐**이라 레코드를 40코어 → 32코어로 옮겼다. **7900XT 는 직접 변환한 파일**(llama-bench 표기 BF16 12.83 GiB — 전문가 MXFP4·나머지 BF16)이라 quant 를 BF16 으로 고쳐 MXFP4 행 실측 조인에서 뺐다. 같은 토론의 Apple MoE: M4 Max 36GB b6293 95.88 · M4 Pro 64GB 63.34 · M1 Max 64GB 75.15 · M1 Pro 32GB 45.68 · M3 Max 128GB 64.26(개발자가 열 스로틀링으로 봄) — AMD MXFP4: RX 7900 GRE ROCm b6829 121.09)

### 5.3 Apple 공식 스레드 — 7B Q4_0 Metal pp512/tg128 [S3]
M3 Ultra 80c 1,471/92.1 · M2 Ultra 76c 1,238/94.3 · M4 Max 40c 886/83.1 · M3 Max 40c 760/66.3 · M4 Pro 20c 440/50.7 · M4 10c 221/24.1
(10-15 D81 — 모두 토론 기준 빌드 b1550(8e672ef, 2023-11-21, FA 없음)으로 잰 값. 제출일 M2 Ultra 2023-11-22(원글) · M4 Pro 2024-11-08 · M4 2024-11-10 · M4 Max 2024-11-13 · M3 Ultra 2025-03-23. 같은 본문의 M2 Ultra 빌드별 tg: b1550 94.27 → 2026-08 c1d0e7a00+FA 125.21 — 지금 빌드는 3분의 1쯤 빠르다)
**지금 빌드 값(10-15 D83 — 계수 근거)**: 2026-08-25 토론 안내가 c1d0e7a00(b10621, -hf ggml-org 파일 3.53 GiB, llama-bench 기본 FA auto = Metal 켬)으로 바뀌었다. M5 10c b10621 723/31.9 · M5 Pro 16c b11046 1,340/67.6 · M5 Pro 20c(빌드 줄 없음, 표 c1d0e7a) 1,621/66.3 · M5 Max 40c b10621 3,220/119.9(다른 기기 b9754 119.1) · M2 Ultra 76c c1d0e7a00+FA 1,489/125.2 · M1 Ultra 64c b10621 1,180/113.8 · M5 Ultra 80c b10621 4,945/179.1 · M3 Max 40c(원글에 단 답글, 기기 설명 없음) 890/81.6 · 옛 빌드: M4 Max 32c b5440(FA 끔) 763/72.3(같은 기기 b1550 69.2), M5 Pro 16c b8509(FA 끔) 63.9(같은 기기 b1550 60.0), M5 10c b6817(FA 끔) 31.0(같은 기기 b1550 29.6). M4·M4 Pro·M4 Max 40c·M3 Ultra 는 지금 빌드 값이 없다. b1550 → 지금 빌드: M5 1.08 · M5 Pro 1.13 · M5 Max 1.17 · M3 Max 1.23 · Ultra 1.33~1.36배(같은 기기 비교는 M2 Ultra 1.33, 옛 빌드 FA 끔 비교는 1.04~1.06)

### 5.4 Vulkan 스레드 — 7B Q4_0 [S4]
7900XTX 3,727/182.6(10-15 D79 갱신 — 표의 현재 값 b10868. 옛 3,532/191.3 은 b6957) · 9070XT 5,048/131.5(10-15 D80 — 제출 댓글 fa 0 줄 b7825. 표의 no-FA 칸 5,036/137.1 은 같은 제출의 FA 켬 줄) · 9070 3,164/119.7(b6188) · 7800XT 2,017/118.3(b7875) · B580 621/70.1(b6527) · A770 1,074/52.6 · 3060(Vulkan) 1,816/75.9 · 4060 Laptop 2,136/59.5

### 5.5 8B급 Q4_K_M·대형·MoE 혼합
| HW | 모델·quant·ctx | pp / tg | 출처 |
|---|---|---|---|
| 4090 | L3.1-8B Q4_K_M ctx가중 | 6,697 / 91.0 | [S5] |
| 4060 | 〃 | 1,528 / 38.1 | [S6] |
| 3060 | 〃 | 1,488 / 51.6 | [S7] |
| 3060 | Qwen2.5-14B Q4_K_M | 753 / 26.4 | [S7] |
| 5090 | L3.1-8B Q4_K_M (제출 평균, 이상치 포함 주의) | 6,297 / 66.3 | [S8] |
| 5090/4090/3090/3060 | Qwen3-8B Q4_K_XL @16k | tg 145.3 / 104.3 / 87.5 / 42.0 | [S9] |
| 5090/4090/3090 | Qwen3-30B-A3B Q4_K_XL @16k | tg 141.6 / 139.7 / 113.8 | [S9] |
| 5060Ti16 | Qwen3.5-35B-A3B Q4_K_M @100k(Q8 KV) | 1,305 / 44 | [S10] |
| 5090 | Qwen3.6-27B Q4 / 35B-A3B | tg ~62(32k에서 44) / ~234 | [S10 가이드] |
| 4060 | llama3.1:8b Ollama 기본 | — / 41.7 | [S11] |
| 2×3090 NVLink | L3-70B Q4_K_M 레이어 분할 | ~85 / 14~16 | [S12] |
| 2×4090 | 〃 | ~120 / 20~24 | [S12] |
| 5090+EPYC DDR4 | gpt-oss-120b --n-cpu-moe 21 | 85~448 / 8.1~9.6 | [S13] |
| 3090+EPYC DDR4 | 〃 --n-cpu-moe 27 | 48~246 / 1.4~1.8 | [S13] |
| M3 Max 128GB | L3.3-70B Q4_K_M Ollama | — / 9.8 | [S14] |
| M2 Ultra 192GB | 〃 | — / ~14 | [S14] |

### 5.6 통합 메모리·CPU
| HW | 모델 | pp / tg | 출처 |
|---|---|---|---|
| Strix Halo (ROCm 7.0.2, mmap 끔) | gpt-oss-120b MXFP4 전 레이어 pp512/tg128 (10-15 D80 — 옛 표기 ROCm7.1 은 글의 후속 갱신 절) | 707 / 50.2 | [S15] |
| Strix Halo (Evo-X2) | gpt-oss-120b / 20b / Qwen3-Coder-30B Q8 | 818/46.1 · 1,622/65.7 · 773/50.2 | [S16] |
| Strix Halo (Vulkan) | Qwen3-30B-A3B / 7B Q4_0 / 70B dense Q4 | 605/66.3 · 998/46.5 · 94.7/4.5 | [S17] |
| Strix Halo (Framework) | gpt-oss-120b LM Studio | — / ~45 | [S18] |
| DGX Spark | gpt-oss-120b / 20b / Qwen3-30B-A3B Q8 (개발진 결과 파일 b7941, 깊이 0 — 10-15 D79 갱신) | 2,444/58.7 · 4,506/83.4 · 2,987/61.1 | [S19] |
| Ryzen 9 7940HS DDR5-5600 CPU | Mistral-7B Q4_K_M | ~103(bf16 pp) / 11.2 | [S20] |
| 데스크톱 DDR5-5600 / 6000 CPU | Qwen3-30B-A3B Q4 / Q8 (컨텍스트·CPU 미기재 범위값 — 10-15 D79 에 실측 레코드에서 뺌) | — / 18~20 · ~25 | [S21] |
| RTX 3060 12GB + DDR5 | Qwen3.6-35B-A3B cpu-moe | — / 51~53 | [S22] |

## 6. 효율 계수 도출 (tg × bytes/tok ÷ 스펙 BW)

dense bytes/tok = 파일 크기, MoE = 파일 × active/total (gpt-oss-20b 2.08GB, 120b 2.76GB, Qwen3-30B-A3B Q4 2.01GB).

주요 관측: 5090 0.62 · 4090 0.71 · 3090 0.65 · 3060 0.80 · 4060 0.69 · 7900XTX 0.76 · 9070XT 0.82(FA 켬 값 기준 — no-FA 131.5 면 0.79) · B580 0.59 · M4 Max 0.58 · M4 Pro 0.71 · M3 Ultra 0.43(이상 Apple 은 b1550 값 — 10-15 D83 지금 빌드: M5 0.80 · M5 Pro 0.83~0.85 · M5 Max 0.75 · M3 Max 0.79 · M4 Max 32c b5440 0.69 · M2 Ultra 0.61 · M1 Ultra 0.55 · M5 Ultra 0.56) · MoE: 4090 0.47 · 5060Ti 0.52 · M3 Ultra 0.29 · M2 Ultra(120b) 0.28 · Apple base/Pro/Max(gpt-oss-20b, 10-15 D81) M4 Max 32c 0.48~0.50 · M4 Pro 0.50 · M1 Max 0.40 · M1 Pro 0.49 (M3 Max 0.34 스로틀링 의심) · Strix(120b) 0.54 · DGX Spark(120b) 0.35(옛 값 — 10-15 재보정 후 b7941 기준 MoE 0.60~0.83·dense 0.72~0.89) · CPU 7B 0.55 · CPU 30B-A3B 0.43 · 멀티GPU 70B ~0.68(단일 BW 기준).
채택 클래스 기본값: NVIDIA 0.70(MoE 0.45) · AMD 0.78(0.50)(→ 10-15 dense 0.77 → D80 0.76) · Arc 0.59 · Apple 0.60(0.30 → 10-15 D81 0.44)(→ 10-15 D83 dense 0.76) · Apple Ultra 0.44(0.29)(→ 10-15 D83 dense 0.57) · Strix 0.65(0.53) · Spark 0.40(→ 10-15 dense 0.78·MoE 0.68) · CPU 0.50(0.43).
pp 보조 규칙: NVIDIA ≈ 135~145 tok/s per FP16 TFLOP (4090 145, 5090 134, 3090 145). Apple·AMD Vulkan은 크게 낮음(7900XTX pp 3,532 vs 122 TFLOPS).
주의: ①tg128 단문은 베스트케이스 — 16~32k에서 25~50% 감소 ②LocalScore 페이지는 제출 평균이라 이상치 포함(5090 66.3 사례) — 캘리브레이션은 llama-bench 스레드 우선 ③partial offload 절벽(120b: 5090 naive 3.4 vs cpu-moe 9.6).

## 7. 출처 URL

- [S1] github.com/ggml-org/llama.cpp/discussions/15013 · [S2] …/discussions/15396 · [S3] …/discussions/4167 · [S4] …/discussions/10879 · [S19] …/discussions/16578
- [S5~S8] localscore.ai/accelerator/77 · /137 · /43 · /155
- [S9] hardware-corner.net/gpu-ranking-local-llm/ · [S13] hardware-corner.net/gpt-oss-offloading-moe-layers/ · [S21] hardware-corner.net/guides/qwen3-hardware-requirements/
- [S10] insiderllm.com/guides/rtx-5060-ti-local-ai-benchmarks/ · insiderllm.com/guides/rtx-5090-local-ai-benchmarks/
- [S11] databasemart.com/blog/ollama-gpu-benchmark-rtx4060 · [S12] compute-market.com/blog/multi-gpu-local-llm-setup-guide-2026
- [S14] heyuan110.com/posts/ai/2026-04-14-mac-apple-silicon-ai-workstation/ · [S15] quozul.dev/posts/2025-10-27-gpt-oss-120b-on-ryzen-ai-max-395/ · [S16] nishtahir.com/gmktec-evo-x2-ryzen-ai-max-395-benchmarks/ · [S17] forum.level1techs.com/t/strix-halo-ryzen-ai-max-395-llm-benchmark-results/233796 · [S18] servethehome.com/framework-desktop-review-a-solid-amd-strix-halo/4/ · [S20] github.com/mozilla-ai/llamafile/discussions/450 · [S22] openclawdc.com/blog/llama-cpp-moe-offload-flags-explained/
- 스펙: techpowerup.com/gpu-specs/ · nvidia.com/en-us/geforce/news/rtx-50-series-graphics-cards-gpu-laptop-announcements/ · tomshardware.com (RTX 50 laptop specs) · support.apple.com/en-us/126319 (M5 Pro/Max) · en.wikipedia.org/wiki/Apple_M5 · apple.com/newsroom/2026/03/apple-debuts-m5-pro-and-m5-max… · lmsys.org/blog/2025-10-13-nvidia-dgx-spark/ · theregister.com/2025/10/14/dgx_spark_review/ · techpowerup.com/349212 (Ryzen AI Halo 발표)
- 가격: mlq.ai/news/gpu-price-tracker-rtx-5090-tops-4200… · tomshardware.com GPU prices 2026 · bestvaluegpu.com/history/new-and-used-rtx-3090(4090)-price-history · techtimes.com/articles/320169 (5090 >$4,300)
- 미출시: techpowerup.com/346010 (Super 없음) · tomshardware.com (3GB GDDR7 3배 단가) · tweaktown.com/news/109694 (Super 무기연기) · tweaktown.com/news/109721 (B770 없음 확인)
