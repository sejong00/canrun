# 02. 계산 엔진 명세 (`@canrun/engine`)

> 순수 TypeScript 패키지. 부작용 없음, 브라우저/빌드 양쪽에서 동일 실행. **본 명세의 모든 상수는 2026-08-09 실측 대조 검증 완료** (§7). 상수 변경 시 반드시 출처 주석 + 테스트 갱신.

## 1. 입력/출력 타입 (요약)

```ts
type Hardware = {
  kind: 'dgpu' | 'unified' | 'cpu';
  os: 'windows' | 'linux' | 'macos';  // osReserve 산출·실행 커맨드 스니펫 분기 (PRD 입력 항목)
  vramGB?: number;            // dgpu
  memBandwidthGBs: number;    // 스펙 대역폭
  fp16Tflops?: number;        // pp 추정용
  ramGB: number; ramBandwidthGBs: number; // 시스템 RAM (cpu-moe/오프로드)
  effClass: EffClass;         // 'nvidia'|'amd'|'intel-arc'|'apple'|'apple-ultra'|'strix'|'dgx-spark'|'cpu'
  effOverride?: number;       // 실측 누적 시 기기별 학습 계수 (Phase 2)
  isDisplayGpu?: boolean;     // OS 예약 차감 여부
  gpuCount?: number;          // dgpu: 같은 GPU 장수 (§6, D58)
  gpus?: GpuUnit[];           // dgpu: 카드 목록 1~4장, 서로 달라도 된다 (§6, 10-03 D67) — 있으면 장수·VRAM·대역폭·효율·화면 출력은 이것을 따른다
};
type GpuUnit = { vramGB: number; memBandwidthGBs: number; effClass: EffClass; effOverride?: number; isDisplayGpu?: boolean };
type ModelQuant = {
  paramsB: number; activeParamsB?: number;         // MoE면 active 존재
  fileGB?: number;                                  // 실제 GGUF 크기(있으면 최우선)
  quant: QuantId;                                   // bpw 폴백 계산용
  kvBytesPerToken: number;                          // 사전 계산값 (03-data-spec)
  attnType: 'full'|'swa'|'mla'|'hybrid';           // KV 스케일링 표시용
  nonExpertGB?: number;                             // MoE: attention+shared 텐서 크기 (cpu-moe 판정)
  expertGB?: number;                                // MoE: 라우팅 전문가 텐서 (GGUF 헤더 실측 — 있으면 nonExpertGB 도 실측)
  activeExpertFrac?: number; moeLayers?: number;    // MoE: topK/experts, 전문가 층 수 (§3.3·§2.4-2)
  offGpuGB?: number;                                // dense: 파일 중 그래픽카드에 안 올리는 GB (헤더 실측, §2.4-1 — 10-03 D62)
  maxContext: number;
};
type Result = {
  verdict: 'S'|'A'|'B'|'F';
  mode: 'full-gpu'|'cpu-moe'|'partial-offload'|'cpu-only';
  vram: { weights: number; kv: number; buffer: number; osReserve: number; total: number; limit: number };
  tgTokS: { est: number; low: number; high: number };  // low/high = est × (1∓오차)
  ppTokS?: { est: number };
  confidence: 'measured' | 'calibrated' | 'theoretical';
  bestQuant?: QuantId;  // 요청 quant가 불가일 때 대안
};
```

## 2. 메모리 모델

### 2.1 가중치 크기
1순위: DB의 **실제 GGUF 파일 크기**(HF에서 수집, decimal GB). 2순위(폴백): `paramsB × bpw(quant) / 8`.

| quant | bpw | GB/1B params | 비고 |
|---|---|---|---|
| IQ2_M | 2.9294 | 0.37 | 2비트 중 최선 |
| Q2_K | 3.1593 | 0.39 | UD-Q2_K_XL 권장 표기 |
| IQ3_XS | 3.4977 | 0.44 | 저VRAM 스위트스폿 |
| Q3_K_M | 3.9960 | 0.50 | |
| IQ4_XS | 4.4597 | 0.56 | 4비트 최고 효율 |
| **Q4_K_M** | **4.8944** | **0.61** | **기본 추천값·Ollama 기본** |
| Q5_K_M | 5.7036 | 0.71 | |
| Q6_K | 6.5633 | 0.82 | 준무손실 |
| Q8_0 | 8.5008 | 1.06 | 사실상 무손실 |
| MXFP4 | 4.25 | — | gpt-oss/Kimi K3 네이티브. **반드시 실제 파일 크기 사용**(bpw 환산 금지) |

출처: llama.cpp `tools/quantize/README.md` 공식 실측표(Llama-3.1-8B). **검증: 실제 파일 11종 대조 MAE 0.7%, 최대 1.6%** (§7).
2순위를 쓰는 곳: bestQuant 사다리의 미등록 quant(§2.4-5)와 계산기 "모델 값 직접 입력"(10-03 D66 — 실제 파일이 없다, §4 이론 추정 고정).
주의: Unsloth UD(*_XL) 변형과 네이티브 양자화 모델(gpt-oss, Kimi K2.6/K3, DeepSeek FP8)은 flat bpw에서 이탈 — 실제 크기 필수.

### 2.2 KV 캐시 (토큰당 바이트)
기본식(GQA): `kvBytesPerToken = 2 × n_layers × n_kv_heads × head_dim × bytesPerEl`
- bytesPerEl: f16=2, **q8_0=1.07, q4_0=0.57** (KV quant 토글; V-cache quant는 FA 필요 — 2026 기본 on)
- **아키텍처 보정 (2026 필수, 값은 03의 모델별 사전 계산 필드에 반영)**:
  - SWA(Gemma 3/4, gpt-oss): 슬라이딩 레이어는 window(512~1024, gpt-oss 128)에서 상한 → 긴 ctx에서 KV 거의 평탄. full-attn 레이어만 ctx 비례.
  - MLA(DeepSeek V3/R1, Kimi K2): `(kv_lora 512 + rope 64) × layers × 2B` ≈ 69 KiB/tok 수준.
  - 하이브리드 리니어(Qwen3.5/3.6, Kimi K3): full-attn 레이어(전체의 ~1/4)만 KV + 상수 recurrent state.
  - **상수 상태 층 하이브리드(10-03 D63, D53 대체)**: Mamba2(Nemotron-H)·short-conv(LFM2)·KDA(Ling-3.0) 층도 하이브리드 리니어와 같이 컨텍스트와 무관한 고정 상태 — **KV 는 어텐션 층만** 계상하고 상태(모델당 ≤ ~75MB)는 미계상(연산 버퍼 근사 0.5GB+ 여유 안). llama.cpp 가 KV 를 두는 층: 기본 하이브리드 필터 `!is_recr(il)`(https://github.com/ggml-org/llama.cpp/blob/master/src/llama-memory-hybrid.cpp), Nemotron-H 는 전용 필터 `!is_recr(il) && n_ff(il) == 0` 으로 Mamba·MoE 전용 블록 제외(https://github.com/ggml-org/llama.cpp/blob/master/src/llama-model.cpp).
  - **KDA+MLA 혼합(Ling-3.0)**: MLA 층에만 `(kv_lora_rank + qk_rope_head_dim) × 2B` — **V 캐시 없음**(`has_v = !is_mla`, https://github.com/ggml-org/llama.cpp/blob/master/src/llama-kv-cache.cpp). MLA 층 = 변환기 `is_full_attention`(https://github.com/ggml-org/llama.cpp/blob/master/conversion/bailingmoe3.py) — nextn(MTP) 층 포함(BAILINGMOE3 는 nextn 층 필터가 없어 KV 를 둔다 — 보수 쪽). 예: Ling-3.0-flash 8 × 1152 = 9,216 B/tok.
  - 엔진 입력은 그대로 `kvBytesPerTokenF16` 하나 — 위 산식은 데이터 계층(`packages/data/src/hf.ts` classifyArch → `attnOverrides`)이 계산한다. **계속 보류**: 반복 층(Nanbeige num_loops·Ouro — 가중치 읽기·KV ×N), 디스크에서 읽는 n-gram·PLE 임베딩(Qwen3.8-Flash-Next — TENSOR_READ_LAZY), 압축 어텐션(DeepSeek V4 compress_ratios), 3진 가중치.
- 검증값: Llama-3.1-8B 128 KiB/tok(@16k f16 = 2.15GB), Qwen3-14B 160, Qwen3-32B 256, 70B 320, Qwen3-30B-A3B 96. **7종 전수 일치** (§7).

### 2.3 오버헤드·사용 가능 메모리
```
computeBuffer = 0.5GB + 0.3GB × (ctx/32k)      // llama.cpp 그래프·스크래치 근사
osReserve(kind, os, isDisplayGpu) = dgpu·display만 windows 0.6GB | linux 0.3GB — 그 외(headless·unified·cpu·macos) 0 (macOS는 unified ×0.70에 흡수)
usable(dgpu)   = vram − osReserve               // 여러 장(§6): Σ vram_i − 화면 출력 카드의 osReserve
usable(unified)= ram × 0.70                     // macOS wired limit 기본. sysctl 상향 툴팁
usable(cpu)    = usableRam = ram − 4GB (OS)     // usableRam = 모든 kind의 시스템 RAM측 한도 (cpu-moe expert·partial CPU측·cpu-only)
```

### 2.4 fit 판정 순서 (알고리즘)
정본은 `packages/engine/src/fit.ts` (불일치 시 코드 우선). 기본 ctx 8k, `need = resident + kv + buffer`, MoE 판정 = `activeParamsB`·`nonExpertGB` 둘 다 존재.
```
0. kind=cpu: 1~3 없이 곧바로 4 → 실패 시 5
1. full-gpu:  need ≤ usable(hw)  — dgpu vram−osReserve / unified ram×0.70 (통합 풀 전량 탑재도 full-gpu) → 최고 속도
   여러 장(§6): buffer = computeBuffer × 장수, usable = Σ vram_i − 화면 출력 예약, 물리 한도 limit = Σ vram_i.
   서로 다른 카드(10-03 D67)도 모든 카드에 나눠 올린다(llama.cpp 기본) — 빠른 카드 한 장에 들어가는 모델도 카드를 고르지 않는다
   resident(dgpu) = gpuResidentGBFor(mq) = weights − offGpuGB  (dense 헤더 실측)
                  | expertGB + nonExpertGB                       (MoE 헤더 실측 분할)
                  | weights                                      (실측 없음 — 보수)   … [0, weights] 로 묶음
   resident(unified·cpu) = weights (파일 전체)
   (10-03 D62, 엔진 0.6.0) llama.cpp 는 입력층(token_embd 등)을 항상 CPU 에 두고
   (https://github.com/ggml-org/llama.cpp/blob/cb7934c/src/llama-model.cpp#L1605-L1607), MTP/NextN 층은 load_mtp=false(기본)면
   TENSOR_SKIP 으로 할당하지 않는다(src/models/qwen35.cpp#L36-L38 · qwen35moe.cpp#L41,
   llama-model-loader.cpp#L1177-L1185, 기본값 llama-model.cpp#L2943, common/common.cpp#L1661 — `--spec-type draft-mtp` 일 때만 켬).
   exaone4(EXAONE 4.5)는 load_mtp 와 상관없이 NextN 층을 늘 TENSOR_SKIP 한다(exaone4.cpp#L39-L44 "not executed yet") — 켤 수 없음.
   임베딩 공유(tied) 모델은 출력층 사본이 GPU 에 가므로(llama-model-loader.cpp#L1161-L1168) 절감 0. 통합 메모리는 Metal 이 mmap 의
   [first,last] 범위를 백엔드 버퍼로 감싸(llama-model.cpp#L1856-L1870) 이 바이트가 GPU 범위에 들어갈 수 있어 파일 전체로 둔다.
   unified는 실패 시 곧바로 4 (2·3은 dgpu 전용)
2. cpu-moe (dgpu + MoE만): nonExpertGB + kv + buffer ≤ usable(dgpu) 이면, 남는 VRAM 에 전문가 층을 채운다 (10-01 D56)
   perLayer  = expertGB / moeLayers
   gpuLayers = clamp(floor((usable − nonExpert − kv − buffer) / perLayer) − CPU_MOE_GPU_LAYER_MARGIN(1), 0, moeLayers − 1)
   N(= --n-cpu-moe) = moeLayers − gpuLayers,  RAM 조건: perLayer × N + (weights − expertGB − nonExpertGB) ≤ usableRam
   → VRAM 상주 = nonExpert + GPU 전문가 + kv + buffer. moeLayers 가 없는 입력은 N = 전부(전문가 전량 RAM, 09-30 가정).
   llama.cpp b7410(2025-12-15, PR #16653) 이후 기본 `--fit on` 과 Ollama 0.30+(llama-server 위임)가 같은 방향으로
   자동 배치한다(비전문가 우선 → 남는 VRAM 만큼 전문가 층 → 나머지 층 전문가만 CPU). 12~16GB 카드로 30B~120B MoE 구동하는 표준 경로
3. partial-offload (dgpu + MoE 아님 — dense와 nonExpertGB 없는 MoE): kv+buffer는 GPU 상주, 가중치만 분할
   gpuW = min(weights, usable(dgpu) − kv − buffer)   // > 0 이어야 함 (1 이 실패했으니 gpuW < resident ≤ weights — 상한은 그대로)
   cpuW = weights − gpuW ≤ usableRam
   gpuFrac = gpuW / weights   … 속도 절벽 경고 (§3.4). 분모는 파일 전체(입력 임베딩·MTP 포함 — 보수, §9)
   (c66f9ff 외부 리뷰 정정: 구식 need 비례식 gpuFrac = usable/need, cpuW = weights×(1−gpuFrac)는
    kv·buffer 일부가 CPU로 간다고 가정해 CPU측을 과소평가 → 거짓 양성. 반례 Qwen3-14B Q4·8GB GPU·RAM 7GB
    (usableRam 3GB — 구식 cpuW ≈2.9 탑재 / 정정 ≈3.5 불가)를 fit.test.ts 회귀로 고정)
4. cpu-only:  weights + kv ≤ usableRam   // MoE(nonExpertGB 有)는 2 실패 시 3을 건너뛰고 여기로
5. 전부 실패 → F. 더 낮은 quant 루프로 bestQuant 탐색 (IQ2_M까지):
   사다리 IQ2_M…Q8_0 중 요청 quant보다 bpw 낮은 것을 높은 품질부터, weights = paramsB×bpw/8
   (bpw 폴백 — 실파일 크기는 데이터 레이어 몫), MoE nonExpertGB도 같은 비율로 축소 → 0~4 첫 성공 quant.
   헤더 실측(offGpuGB·expertGB)은 요청 파일 전용이라 비운다 — 다른 quant 는 resident = weights.
   네이티브(MXFP4·UD-*)·F16은 사다리 제외
```

## 3. 속도 모델

### 3.1 토큰 생성(tg) — 대역폭 지배
```
bytesPerToken = weightsReadGB + kvReadGB(ctx)
  dense: weightsReadGB = fileGB
  MoE:   weightsReadGB = fileGB × (activeParamsB / paramsB)   // 근사(공유 텐서 과소 → 계수에 흡수됨)
  kvReadGB(ctx) = kvBytesPerToken × ctx / 1e9                 // FA에서 전체 KV 읽음
tg = eff × memBandwidthGBs / bytesPerToken
여러 장(§6): eff × memBandwidthGBs 자리에 GPU 처리량 T 를 쓴다 (`gpuThroughputGBs`)
  같은 카드 N 장: T = eff × BW × MULTI_GPU_TG_FACTOR(1)
  서로 다른 카드(10-03 D67): T = MULTI_GPU_TG_FACTOR / Σ_i ( s_i / (eff_i × BW_i) ),  s_i = (vram_i − osReserve_i) / Σ_j (vram_j − osReserve_j)
```

### 3.2 효율 계수 (실측 70여 점에서 도출, 출처: llama.cpp 공식 스레드·LocalScore·hardware-corner)
| effClass | dense | MoE | 근거 범위 |
|---|---|---|---|
| nvidia (CUDA) | **0.70** | **0.45** | 0.62~0.80 (대역폭 클수록↓: 5090은 0.62, 3060은 0.80) |
| amd (RDNA3/4) | **0.76** | 0.50 | 0.72~0.79 (Vulkan no-FA 4점, 값은 제출 댓글의 fa 0 줄 — 10-15 D79 에 0.78 → 0.77, D80 에 9070 XT 를 no-FA 값으로 고쳐 0.76) |
| intel-arc | 0.59 | — | B580 실측 |
| apple (base/Pro/Max) | **0.76** | **0.44** | dense 0.69~0.85 (토론 #4167 의 지금 빌드 Llama 2 7B Q4_0 — M5·M5 Pro 2·M5 Max 2 + M4 Max 32코어 b5440. 10-15 D83 에 0.60 → 0.76: 옛 0.60 은 요약 표의 2023 빌드 b1550 값(0.55~0.72)에 맞춘 값이었다) · MoE 0.40~0.50 (gpt-oss 가이드 #15396 의 gpt-oss-20b 5점 — M4 Max 36GB 는 32코어 GPU 410GB/s. 10-15 D81 에 0.30 → 0.44: 옛 0.30 은 그 값을 40코어 546GB/s 에 붙인 레코드와 Ultra 값에 기댄 값이었다. 개발자가 열 스로틀링으로 본 M3 Max 0.34 는 제외) |
| apple-ultra | **0.57** | 0.29 | 800GB/s급 비포화. dense 0.55~0.61 (#4167 지금 빌드 M2 Ultra c1d0e7a00+FA·M1 Ultra·M5 Ultra — 10-15 D83 에 0.44 → 0.57, 옛 값은 b1550 0.44~0.46) (MoE: 같은 가이드의 M3 Ultra·M2 Ultra gpt-oss 3점 0.28~0.31 — 10-15 D81 재확인) |
| strix (Ryzen AI Max) | 0.65 | **0.53** | ROCm7/Vulkan |
| dgx-spark | **0.78** | **0.68** | dense 0.72~0.89 · MoE 0.60~0.83 (개발진 결과 파일 b7941, 깊이 0·8192 — 10-15 D79. 옛 0.40 은 출처와 맞지 않던 한 점에 맞춘 값) |
| cpu | 0.50 | 0.43 | ≥8코어 전제, 코어 부족 시 ×0.7. MoE 0.43 의 근거(hardware-corner "DDR5-5600 · Qwen3 Q4 · 18–20")는 컨텍스트·CPU 미기재라 10-15 D79 에 실측 레코드에서 뺐다 — 값은 유지 |
- Phase 2: 기기×모델급 실측이 n≥3 쌓이면 `effOverride`로 대체(주간 배치 재학습). 그때까지 위 표 = 클래스 기본값.

### 3.3 cpu-moe 모드 속도
**10-01 개정(PROGRESS §4 D56, 엔진 0.4.0)** — 전문가 일부 GPU 배치. 토큰 시간 = RAM 몫 + GPU 몫(직렬):
```
routed = expertGB × activeExpertFrac(= topK / experts)              // 토큰당 읽는 라우팅 전문가
f      = N / moeLayers                                              // CPU 에 둔 전문가 층 비율 (§2.4-2 의 N)
t = routed × f / (CPU_MOE_RAM_EFF × ramBandwidthGBs)                 // CPU_MOE_RAM_EFF = 0.5
  + (nonExpertGB + routed × (1 − f) + kvReadGB) / (eff_gpu(moe) × memBandwidthGBs)
tg = min(1 / t, full-gpu 값)
```
- **입력 정의(GGUF 헤더 실측, 데이터 레이어 `model-quants.json` 행 필드)**: `expertGB` = 이름에 `_exps` 가 든 라우팅 전문가 텐서 합(트렁크 층만). `nonExpertGB` = GPU 에 상주하는 나머지(어텐션·공유 전문가·라우터·출력층·dense FFN·`token_embd_norm`). llama.cpp 는 입력층(`token_embd`·`per_layer_token_embd`·`position_embd`·`token_types` — LLM_TENSOR_LAYER_INPUT)을 항상 CPU 에 두므로 제외한다. 다만 출력층이 없는 tied 모델은 GPU 에 출력층으로 복제되므로 포함한다. MTP·NextN 블록은 기본 로드가 아니라(`load_mtp=false` → TENSOR_SKIP) 둘 다에서 뺀다. 파싱 합계 = 파일 크기 ±0.02GB 로 33행 검증. `expertGB + nonExpertGB` 가 곧 full-gpu 의 그래픽카드 상주 가중치다(§2.4-1). dense 행은 같은 헤더 읽기로 `offGpuGB`(= 파일 − GPU 상주, 97행)를 둔다(10-03 D62).
- **실측이 없는 입력(bpw 사다리·엔진 단독 호출)**: `nonExpertGB` 는 기준 양자화에서 균등 bpw 로 유도한 값이다. 더 큰 양자화는 bpw 비율로 키우고 줄이지는 않는다(`nonExpertGBFor`). `expertGB` = 파일 − 비전문가. `activeExpertFrac` 도 없으면 09-30 식(`활성 슬라이스 − 비전문가` 를 전부 RAM 에서)으로 계산한다.
- **보정**: `CPU_MOE_RAM_EFF` = 0.5. 공개 실측에 N 을 적힌 그대로 넣고 맞췄다(η 0.45·0.55 보다 편향이 작다). 회귀 42점 기준으로 전체 평균 오차는 11.1%, 편향 −2.4%, ±20% 안 35점, 최대 39.7%다. NVIDIA(CUDA) 35점은 평균 10.3%, ±20% 안 89%, AMD ROCm 7점은 평균 14.9%, 최대 27.7%다. Vulkan(−31~+84%)·8채널 서버 RAM(CPU 연산 한계로 +30% 일관)·32k 이상 깊은 컨텍스트 서버 측정은 제외했다. 목록은 `packages/engine/test/fixtures.ts` `CPU_MOE_CASES`.
- **명령(데이터 레이어 `snippet.ts`)**: `-ngl all --n-cpu-moe N` 으로 추정과 같은 배치를 명시한다(명시하면 llama.cpp fit 의 가중치 배치는 꺼진다). **예외 — GPU 여러 장(같은 카드 D58·서로 다른 카드 D67, 10-03 정정)**: `-ngl`·`--n-cpu-moe` 를 빼고 `--fit`(b7410+ 기본)에 맡긴다(`LlamaCppPlan.ngl = 'auto'`). 층은 카드마다 남은 메모리 비율로 나뉘는데 `--n-cpu-moe N` 은 앞쪽 N 층만 CPU 로 보내므로, GPU 에 남는 전문가가 뒤쪽 층을 맡은 마지막 카드에 몰린다 — 엔진은 합산 용량만 보므로 그 카드가 메모리 부족이 될 수 있다. `--fit` 은 장치마다 여유(기본 1024MiB)를 두고 카드를 차례로 채운다(https://github.com/ggml-org/llama.cpp/blob/2145525a4081d66ff1a87cf43ef809f95a85ac0c/common/fit.cpp#L660-L750, 사용자가 -ngl·텐서 배치를 주면 멈춘다 #L463-L485). 계산기 카드가 이 명령과 각주("카드마다 1GB 남짓 비워 두고 알아서 나눠 올린다" — 화면 문구는 decimal GB)를 보인다. **전문가 층 단위 ≠ 블록 단위(10-03 D63)**: 라우팅 전문가가 일부 블록에만 있는 모델(데이터 `arch.expertLayers` — Nemotron-H 의 Mamba·어텐션 블록 사이 MoE 블록, Ling-3.0 의 앞쪽 dense 층)은 엔진 입력 `moeLayers` = 전문가 층 수(`expertLayers` 길이)이고, 명령 값은 엔진 N 번째 전문가 층까지 덮는 블록 수(`expertLayers[N−1] + 1`, `cpuMoeFlagLayers`)로 바꾼다 — `--n-cpu-moe` 가 "앞 N 블록"이라 그대로 쓰면 GPU 에 전문가가 더 남는다(Nemotron 실배치 기준 균등 근사 대비 최대 +1.03GB, 여유 1층 0.44GB 초과). 각주가 GPU 에 남는 층을 셀 때도 블록이 아니라 전문가 층으로 센다(`gpuExpertLayerCount` — 판정 문장과 같은 값). 각주 안내는 두 가지다. 메모리 부족 시 올릴 다음 값(전문가 층을 하나씩 더 RAM 으로 보내는 값 1~2개, `nextCpuMoeFlags` — 모든 블록에 전문가가 있으면 N+1·N+2, Nemotron 처럼 띄엄띄엄 있으면 전문가 없는 블록을 건너뛴 값), 그리고 b7410+ 는 두 옵션 없이도 자동 배치된다는 안내다. Ollama 0.30+ 는 자동 배치라 명령을 보여 주되 버전을 안내한다.
- **이력**: 09-30(D55)은 RAM 몫을 라우팅 전문가만으로 고쳤다(이전 ~2.5× 과소). 10-01(D56)은 전문가 일부 GPU 배치를 넣고, 실측 분할로 gpt-oss(유도 0.65/0.81 vs 실측 1.30/1.69GB)·UD 파일의 비전문가 과소를 해소했다. 이로써 D23 의 +1층 여유를 `CPU_MOE_GPU_LAYER_MARGIN` 으로 일반화했다.

### 3.4 partial-offload (dense) — 절벽 경고
`tg ≈ 1 / (gpuFrac/tg_gpu + (1−gpuFrac)/tg_cpu)` (조화 평균). gpuFrac < 0.9면 B등급 상한.
주의(10-03 D62): full-gpu 경계는 상주량(파일 − 입력 임베딩·MTP)으로 판정하지만 gpuFrac 분모는 파일 전체라, 경계 바로 바깥 셀의 gpuFrac 상한은 `resident / file` 이다(Qwen3.5-9B Q4 0.872·Q8_0 0.862, MiniCPM5-1B 0.826, MiniCPM5-2B Q8_0 0.89 — 0.9 미만). 이런 모델은 S(full-gpu)에서 A 를 건너뛰고 B(cap-partial)로 바로 떨어진다. 실제로는 층 대부분이 GPU 에 있는 상태라 보수 쪽이며, 스니펫 `-ngl floor(gpuFrac × layers)` 도 그만큼 덜 올린다. 분모를 상주량으로 바꾸는 안(판정 41건 변화)은 부분 오프로드 실측 검증이 없어 보류. UI에 "dense 모델 부분 오프로드는 급감" 고정 경고 + 실측 예시(gpt-oss-120b: 5090 naive 3.4 vs cpu-moe 9.6 tok/s).

### 3.5 프롬프트 처리(pp) — 연산 지배
`pp ≈ ppCoef × fp16Tflops` — NVIDIA 140/TFLOP, Apple 27(10-16 D85 — 옛 45), **GPU 코어마다 행렬곱 가속기가 있는 칩(Apple M5 계열 Neural Accelerator, GPU 레코드 `neuralAccelerators` → `Hardware.neuralAccel`)은 클래스 계수 대신 `PP_COEF_NEURAL_ACCEL` 78**, AMD/Intel 30~40 (Vulkan 페널티, 7900 XTX 실측 근거 — 10-15 D79 재확인: 현재 표 pp512 3727 = 30/TFLOP, AMD 35 유지). Apple 두 계수는 토론 #4167 Llama 2 7B Q4_0 pp512 ÷ 카탈로그 fp16Tflops 로 정했다 — M5 계열은 지금 빌드 70~88/TFLOP, 그 밖의 칩은 새 빌드 27.6~28.0(b1550 은 23~26) 이라 한 계수로는 ±40% 밴드에 둘 다 넣을 수 없다(§7). 표기는 "대략" 수준으로만(±40%) — P1-2부터 **범위 est×0.6~1.4 + 4번째 신뢰 라벨 `rough`(pp 전용, §4)**로 표시한다. 식이 fp16 연산 전제라 **full-gpu(통합 메모리 포함) fit일 때만** 표시하고 부분 오프로드·cpu-moe·cpu-only에선 생략(사유 한 줄). 밴드 상수는 데이터 레이어 정책(`packages/data` `PP_BAND = 0.4`, `// source: docs/02 §3.5 (policy)`) — 엔진 `Result.ppTokS`는 est만 반환(무변경, PROGRESS §4 09-29 D13). 장문 RAG 유저용 참고치.

### 3.6 컨텍스트 감쇠
kvRead 항이 자연 반영 (예: 4090 Qwen3-8B: 8k에서 118 → 16k에서 95 → 32k에서 68 tok/s). tg128 단문 실측과 비교 시 이 항 제외 조건 일치 확인.

## 4. 신뢰 라벨
- `measured`: 동일 (기기, 모델, quant) 실측 n≥1 존재 → 실측 중앙값 표시, 추정은 보조
- `calibrated`: 클래스 계수 검증 범위 내 조합 → **클래스별 밴드: NVIDIA·AMD dGPU dense ±12% / 그 외 클래스·모든 MoE·부분 오프로드 ±20%** (§7 검증 최대 오차 15.4%(10-15 D83 전 17.1%)를 상회하도록 설정 — 밴드가 검증값보다 좁으면 안 됨). 실측 누적 시 기기별로 축소
- `rough`: **pp(프롬프트 처리) 전용** 4번째 라벨 — **±40%**(§3.5, est×0.6~1.4). tg·판정에는 쓰지 않으며, 엔진 `Result.confidence`(§1)에는 없고 데이터 레이어가 pp 표시에만 붙인다(P1-2 D13, PROGRESS §4 09-29)
- `theoretical`: 신형 기기/특이 아키텍처 등 검증 밖 → **±30%** 밴드 + "제출로 검증에 참여" CTA
  - 판정 주체는 데이터 레이어(`EvaluateOptions.theoretical`). P1-1 규칙(`packages/data/src/assess.ts` `isTheoretical`): ① MoE × MoE 계수가 없는 클래스(현재 intel-arc — §3.2) ② mode = cpu-moe(10-01 부분 배치 개정 후에도 유지 — NVIDIA 공개 실측 35점 평균 오차 10.3%·±20% 안 89% 지만 최대 40% 라 보정 추정(±20%, 검증 최대 오차 이상이어야 함)을 못 단다. 가장 넓은 라벨 ±30% 를 쓰고, 그 표시 범위 밖 공개 점 4개는 모두 과소 추정(실제가 더 빠름) — verify-regression 5 가 "표시 범위를 넘는 과대 추정 없음"을 강제) ③ 비전문가 크기(행 실측·모델 유도 둘 다)가 없는 MoE가 부분 오프로드로 떨어진 경우(엔진이 dense 경로로 계산) ④ llama.cpp 구동이 검증되지 않은 커스텀 아키텍처(HyperCLOVA X SEED Think 14B), 또는 구동은 되지만 속도 모델(대역폭 계수)이 검증되지 않은 상수 상태 층 하이브리드(Mamba2·short-conv·KDA+MLA — Nemotron 3.5 Lightning·LFM2.5·Ling-3.0 Tiny·Flash, PROGRESS §4 10-03 D63, 실측이 생기면 뺀다) ⑤ FP16 크리플 GPU(`fp16Tflops` < 1 — GTX 10, 계수 도출 표본 밖. `01` §9 P1-1 개정: GPU 판정 유지 + 주의 배지) ⑥ 통합 메모리 칩의 cpu-only(cpu 계수 검증점은 데스크톱 DDR5뿐 — CPU측 대역폭은 `01` §3 `unifiedCpuBandwidth`로 GPU 경로 이하로 제한)
  - **카탈로그 밖 모델은 항상 `theoretical`**(위 규칙과 별개로 호출자가 고정 — `apps/web/lib/calc/run.ts`·`run-model.ts` 의 `theoretical: true`): 계산기 HF 불러오기(D57 — 레코드가 검증 밖, 실측 조인 0)와 **직접 입력(10-03 D66)** — 가중치는 §2.1 2순위(`paramsB × bpw / 8`, 엔진 `weightsGBFromBpw`), KV 는 §2.2 기본식(`kvBytesPerToken`, 전체 어텐션 층 수를 넣으면 그 층만), MoE 비전문가는 `derive.ts` 유도. bpw 어림은 카탈로그 실파일 대비 dense 행 −8.7%~+6.5%(평균 |오차| 2.0%), MoE 행 −8.0%~+12.6%(평균 |오차| 3.2%) — 예외로 전문가 FFN 폭이 256 배수가 아니어서 K-quant 가 큰 형식으로 대체된 Nemotron 3.5 Lightning 은 Q2_K −34%·Q4_K_M −24%(2026-10-03, data/model-quants.json). 엔진 무변경(스펙 버전 유지)

## 5. 판정 임계값 (ctx 8k, Q4_K_M 기준)
```
S: mode=full-gpu && tg ≥ 20
A: (full-gpu && 8 ≤ tg < 20) || (cpu-moe && tg ≥ 20)
B: 2 ≤ tg < 8 (모드 불문) || (cpu-moe && 8 ≤ tg < 20)
F: tg < 2 || 모든 quant 미탑재
```
부분 오프로드(§3.4): gpuFrac < 0.9면 B 상한, ≥ 0.9면 8 tok/s 이상에서 A까지(S는 full-gpu 전용) — `verdict.ts`가 정본.
근거: 20 tok/s ≈ 읽는 속도 상회(쾌적 체감), 8 ≈ 인내 가능, 2 미만 = 실사용 불가. 생각 모드가 있는 모델(`thinking` 필드 — 늘 생각·기본 켜짐·기본 꺼짐·자동. 끌 수 있어도 포함)은 사고 토큰 때문에 임계 ×1.5 상향(S ≥ 30 · A ≥ 12 · B ≥ 3 tok/s). 생각 모드가 없는 모델(phi-4 등)은 제외 — PROGRESS §4 D59(10-01, 옛 `category: reasoning` 기준 대체).

## 6. 멀티 GPU (베타 — 계산기만, 10-01 D58 · 10-03 D67)
같은 GPU N 장(`Hardware.gpuCount`, 2~4) 또는 카드 목록(`Hardware.gpus: GpuUnit[]`, 서로 다른 카드 — 10-03 D67, 엔진 0.7.0). usable = Σ vram − osReserve(화면 출력 카드 몫 — 같은 카드면 1장분), 연산 버퍼는 GPU 마다(×N), 물리 한도 = Σ vram.
층 나눠 올리기(llama.cpp 기본 `-sm layer`)는 층과 그 층의 KV 가 맡은 카드에만 있고 토큰이 카드를 차례로 지나므로 대역폭이 합산되지 않는다. `-ts` 가 없으면 카드마다 남은 메모리 비율로 층을 나눈다(입력층은 CPU, 출력층은 마지막 장치 — https://github.com/ggml-org/llama.cpp/blob/99b95488cac0f00ce3f05af113a8c1e287753f87/src/llama-model.cpp#L1558-L1616, 메인테이너 설명 https://github.com/ggml-org/llama.cpp/discussions/6046, 문서 https://github.com/ggml-org/llama.cpp/blob/b9afc19cb409be990784200ded9e007093beb607/docs/multi-gpu.md).
- **같은 카드**: tg = 단일 카드 식 그대로 × `MULTI_GPU_TG_FACTOR`(= 1). 카드 목록이라도 카드가 전부 같으면(`isUniformGpus`) 같은 연산이라 출력이 바이트까지 같다(fit.test 가 회귀 10점 전부에서 고정).
  - 근거(공개 실측 10점, `test/fixtures.ts` MULTI_GPU_CASES): 70B급 2~4장의 실효 대역폭은 카드 1장 피크의 75~90%(2×3090 16.57 · 2×4090 19.22 · 4×4090 21.25 tok/s) — 단일 카드 클래스 계수 0.70 보다 높아 추가 감속 없음이 10점 전부 보수 쪽(−22~0%, MAE ~12%). 같은 모델 1장 → N장 손실은 CUDA 최근 빌드 0~3%(A40 1→3장 동일).
  - 옛 표기 "단일 카드 계수 × 0.68" 은 근거(2×3090 70B 14~16 tok/s)를 잘못 옮긴 것 — 그 실측은 0.68~0.75 실효 계수에 해당한다(10-01 정정).
- **서로 다른 카드(10-03 D67)**: 토큰 1개 시간 = 카드별 (그 카드가 읽는 바이트 ÷ 그 카드 처리량)의 합 → GPU 처리량 T = factor / Σ s_i/(eff_i × BW_i), s_i = 남은 메모리 비율(§3.1). cpu-moe 의 GPU 몫·부분 오프로드의 GPU 쪽도 같은 T(넘치는 모드는 카드가 모두 차서 카드별 메모리 몫이 용량 비율에 가깝다 — 속도 배분은 근사). **대표 추정은 모든 카드에 나눠 올린 llama.cpp 기본 동작**이다 — 빠른 카드 한 장에 들어가는 작은 모델도 느린 카드에 몫이 가서 느려진다(3090 + 3060 × Qwen3 8B: 3090 한 장 105 → 두 장 68 tok/s). 그 카드만 쓰는 경우(`--device`)는 판정에 넣지 않고 계산기 카드의 참고 줄로만 보인다(데이터 레이어 `assessQuant` 로 카드 한 장 구성을 한 번 더 평가 — 계산기에 그 카드만 넣었을 때와 같은 값·라벨이라 8k·f16 이면 실측 조인, 엔진 무관. D67 리뷰 반영). 카드 부분집합을 고르는 안은 판정이 사용자 설정(`--device`)에 기대게 돼 버렸다(적대적 검토 — 기본값 실측 39.2 대 부분집합 추정 54.9, ±30% 밖).
  - 근거 3점(`test/fixtures.ts` HETERO_GPU_CASES, verify-regression 7): ① RTX 5070 Ti + RTX 3060 12GB, Gemma 4 31B Q4_K_M 18.81GB, CUDA `-ngl 99`·`-ts` 없음, tg128 실측 21.8 → 클래스 계수(nvidia 0.70) 추정 20.3, **−6.8%(보수 쪽)** (https://github.com/ggml-org/llama.cpp/discussions/21112) ② RTX 3060 12GB + Tesla P100 16GB, 카드별 단일 실측(9B 깊이 0: 3060 54.9 · P100 33.5 tok/s)으로 effOverride 를 맞추면 층 분할 9B 39.2 → 추정 40.2 **+2.6%**, 같은 처리량으로 27B(16.8GB) 13.81 → 13.6 **−1.5%** (https://github.com/kuraneko1/llama-split-bench/blob/272b0dee42afd60b823e769dd896630e6b13a402/examples/results-3060-p100.md) — 식만 검증, 클래스 계수 검증은 ①뿐.
  - 반례(범위 밖): RX 7800 XT + RX 580, Vulkan, Qwen3.6-35B-A3B Q4_K_M `-ts 28/15` tg128 48.59 — 클래스 계수 추정 약 112(+131%) (https://github.com/ggml-org/llama.cpp/discussions/22183). 2017년 카드·Vulkan 은 계수 표본 밖이고, P100 도 9B 단일 실측의 실효 계수가 약 0.26 으로 클래스 값 0.70 과 거리가 멀다.
  - **섞기 자격(데이터 레이어 정책, `canMixWith` — `// source: docs/02 §6 (policy)`)**: 두 카드 모두 카탈로그 데스크톱 dGPU · 같은 계열(nvidia 끼리 또는 amd 끼리 — `MIXABLE_GPU_CLASSES`) · FP16 크리플 아님(GTX 10 — 위 Pascal 반례). 제조사를 섞으려면 Vulkan 같은 다른 백엔드가 필요한데 그 계수는 표본 밖이다(같은 카드 여러 장도 Vulkan 은 −25%). 노트북·Arc·통합 메모리·CPU·커스텀 입력은 1번 카드가 될 수 없다. 합계 최대 4장(계산기).
  - **검증점이 없는 곳**: 서로 다른 카드의 MoE(전량 탑재·cpu-moe) 0점, AMD(ROCm) 0점, 3장 이상 0점. cpu-moe 는 `--fit` 이 dense 부분만 있는 층을 뒤에서부터 채운 뒤 앞쪽부터 전문가 층으로 바꿔(common/fit.cpp L660-L750) 토큰마다 읽는 바이트의 카드별 분포가 용량 비율과 다를 수 있고, 장치마다 비워 두는 1GiB 도 엔진은 모델링하지 않는다(cpuMoeLayers 가 낙관적일 수 있다).
- 공통: 실측 조인 없음(1장 기준 실측), 라벨은 이론 추정 고정. AMD·Vulkan 은 장수 손실 편차가 크다(7900 XTX ROCm −7.5%·Vulkan −25%). `-sm tensor`(2026-04, PR #19378)는 dense 1.2~2.3× — 모델링하지 않고 안내만(같은 카드). `-sm row` 는 CUDA 에서 제거(PR #24216). 허브·콤보는 1장 기준. 여러 장 cpu-moe 명령은 `--fit` 자동 배치(§3.3). pp(`ppEstimate`)는 1번 카드 값 그대로다 — 계산기는 pp 를 보이지 않는다(콤보 페이지는 1장).

## 7. 검증 결과 (2026-08-09 — CI 회귀 테스트로 이식 완료)

> **이식 기록 (P0-2, 2026-08-16)**: 원본 `verify_engine.py` 는 `packages/engine/test/verify-regression.test.ts` 로 assertion 이식 후 삭제(git 히스토리에 보존). `pnpm run verify-engine` 으로 단독 실행, CI 에서 상시 회귀. 아래 수치가 테스트 기대값이다.
- 가중치: 실제 GGUF 11종 대조 **MAE 0.7% / max 1.6%**
- KV: 아키텍처 7종 공식값 **전수 일치**
- 속도: 실측 12점 대조 **MAE 6.3% / max 17.1%** (worst: M4 Pro −17%, 5060Ti MoE −15% → 클래스 계수 한계, Phase 2 기기별 보정 대상). **10-15 D83**: Apple 2점(M4 Max 40코어 83.1·M4 Pro 50.7)은 토론 #4167 기준 빌드 b1550(2023-11) 값이라 지금 빌드 값(M5 Max 40코어 b10621 119.92 · M5 Pro 16코어 b11046 67.59, 3.53 GiB 파일)으로 바꿨다 — M4 는 지금 빌드 값이 없다. 계수 0.76 으로 +0.9%·−10.5%, 12점 **MAE 5.6% / max 15.4%**(5060Ti MoE). 10-15 D80 에 Strix Halo 점의 ctx 를 출처(pp512/tg128)대로 2048 → 512 로 고쳐 그 점 오차 −3.2% → −1.2%, MAE 6.2%
- cpu-moe(09-30 → 10-01): 전문가 전부 RAM 공개 실측 3점(3060 Ti+DDR5-6800 gpt-oss-120b 24.85 · 5080+DDR5-4800 Qwen3.5-35B-A3B Q4_K_M 51.0·Q8_0 35.7) 각 ±20% 이내 + 전문가 일부 GPU 배치(`--n-cpu-moe N`)를 포함한 공개 실측 전체 MAE < 12%·±20% 안 ≥ 80%·전부 ±40% 안 (verify-regression 5)
- 클래스 계수 재보정(10-15 D79·D80·D81·D83, verify-regression 8 — 31점): AMD Vulkan no-FA 4점(7900 XTX b10868 182.63 · 9070 XT b7825 131.54 · 9070 b6188 119.71 · 7800 XT b7875 118.27 — 각 제출 댓글의 fa 0 줄) 각 ±12% 안·MAE 3.7%(최대 +5.1% 9070) — amd dense 0.78 → 0.77(D79) → 0.76(D80: 표가 9070 XT 의 FA 켬 줄 137.11 을 no-FA 칸에 넣어 두었다). DGX Spark 개발진 결과 파일(b7941, `-fa 1 -mmp 0`) 5모델 × 깊이 0·8192 10점 각 ±20% 안·MAE 10.0%(최대 −18.2% Qwen3-30B-A3B Q8_0 깊이 0) — dgx-spark 0.40/0.40 → dense 0.78·MoE 0.68. Apple MoE(10-15 D81): gpt-oss 가이드(#15396, `-fa 1 -ub 2048` tg128) gpt-oss-20b 5점(M4 Max 36GB=32코어 b6123 92.36·b6293 95.88 · M4 Pro 64GB 63.34 · M1 Max 64GB 75.15 · M1 Pro 32GB 45.68) 각 ±20% 안·MAE 10.2%(최대 −11.9% M4 Max b6293) — apple MoE 0.30 → 0.44. 같은 가이드의 Ultra 3점(M3 Ultra 20b 115.52 · M2 Ultra 20b 116.08 · 120b 79.68)은 apple-ultra MoE 0.29 로 각 ±7% 안·MAE 4.2%. 반례(회귀 밖): MacBook Pro M3 Max 128GB 64.26 은 0.44 로 +28% — 개발자가 열 스로틀링으로 봤다. 부수 효과: `unifiedCpuBandwidth`(통합 메모리 칩의 CPU 경로를 GPU 경로 이하로 깎는 계수 비율)가 apple 에서 min(1, 0.6/0.5, 0.30/0.43)=0.70 → 1.0 이 되어 맥의 cpu-only 이론 추정이 1.43배로 올랐다(CPU 경로 dense 0.5·MoE 0.43 이 GPU 경로 0.6·0.44 아래라 역전 없음) Apple dense(10-15 D83): 토론 #4167 Llama 2 7B Q4_0 tg128 의 새 빌드 값 — base/Pro/Max 6점(M5 10코어 b10621 31.88 · M5 Pro 20코어 66.33 · M5 Pro 16코어 b11046 67.59 · M5 Max 40코어 b10621 119.92·b9754 119.08 · M4 Max 32코어 b5440 FA 끔 72.26)이 같은 식에서 0.69~0.85 → minimax 0.768 을 내림한 **0.76**, 각 ±11% 안·MAE 6.1%(최대 +10.7% M4 Max 32코어). Ultra 3점(M2 Ultra c1d0e7a00+FA 125.21 · M1 Ultra b10621 113.79 · M5 Ultra b10621 179.10)이 0.55~0.61 → minimax 0.580 을 내림한 **0.57**, MAE 3.9%(최대 −6.5% M2 Ultra). 요약 표의 M1~M4 행은 기준 빌드 b1550(2023-11, FA 없음) 값이라 쓰지 않았다 — 같은 M2 Ultra 가 b1550 94.27 → c1d0e7a00+FA 125.21(1.33배). b1550 → 지금 빌드 배수는 칩마다 다르다(M5 1.08 · M5 Pro 1.13 · M5 Max 1.17 · Ultra 1.33~1.36 — b1550 에서 비포화가 컸던 칩일수록 크다). M4·M4 Pro·M4 Max 40코어·M3 Ultra 는 지금 빌드 값이 없어, M4 칩 추정은 새 칩 값과 M4 Max 32코어 b5440 한 점에 기댄다. 회귀 밖 참고점 M3 Max 40코어(원글에 단 답글, 기기 설명 없음) c1d0e7a00 81.57 은 −3.4%. `unifiedCpuBandwidth` 비율은 그대로다(apple 1.0, apple-ultra 는 MoE 비율 0.29/0.43 이 정한다)
- pp(§3.5, 10-16 D85 — verify-regression 9, 12점): 토론 #4167 Llama 2 7B Q4_0 pp512 ÷ 카탈로그 fp16Tflops. M5 계열(Neural Accelerator) 지금 빌드 5점(M5 10코어 b10621 722.79 = 72.3 · M5 Pro 16코어 b11046 1,340.44 = 70.5 · 20코어 1,620.64 = 85.3 — 카탈로그 M5 Pro 는 한 행 19 TFLOPS · M5 Max 40코어 b10621 3,219.99 = 84.7 · b9754 3,347.44 = 88.1) → minimax 78.3 을 내림한 **78**, 각 ±12% 안(최대 −11.5% M5 Max b9754). 옛 Apple 45 로는 추정이 M5 실측의 0.51~0.64배 — 표시 범위(est×0.6~1.4)의 위 끝보다 실측이 12~40% 높았다. 출시 직후 빌드(M5 b6817 FA 켬 650.65 = 65)도 78 로 +20% — 빌드가 아니라 칩 차이다(애플: GPU 코어마다 Neural Accelerator). 그 밖의 Apple 칩 새 빌드 2점(M2 Ultra c1d0e7a00+FA 1,488.81 = 27.6 · M4 Max 32코어 b5440 762.81 = 28.0) → minimax 27.8 을 내림한 **27**(apple·apple-ultra), 각 ±4% 안. 요약 표 b1550 5점(M4 221.29 · M4 Pro 20코어 439.78 · M4 Max 40코어 885.68 · M3 Ultra 1,471.24 · M2 Ultra 1,238.48)은 +4~+18% 로 ±40% 안 — 옛 45 로는 이 7점이 실측의 1.6~2배(실측이 밴드 아래 경계 0.51~0.62배)였다. 카탈로그 밖 M1 Ultra b10621 1,179.89 도 같은 수준
- 멀티 GPU(§6): 같은 카드 2~4장 공개 실측 10점 전부 ±30% 안·과대 5% 이하·MAE < 15%(verify-regression 6) + 서로 다른 카드 3점(5070 Ti + 3060 −6.8% · 3060 + P100 카드별 계수 +2.6%·−1.5%, verify-regression 7 — 10-03 D67)
- 판정: RTX 4060 8GB에서 8B Q4_K_M "가능"(실측 38~42 tok/s로 확인) / 14B Q4_K_M "풀 오프로드 불가" — 커뮤니티 통념과 일치
- CI 이식 시 print 스크립트가 아닌 **assertion 테스트로 변환**할 것 (Windows cp949 콘솔 인코딩 이슈가 외부 리뷰에서 재현됨)

## 8. 구현 규칙
1. TDD: 아래 케이스를 vitest로 먼저 작성. §7 수치가 곧 기대값(허용 오차 명시).
2. 상수 파일(`constants.ts`)의 모든 항목에 `// source:` URL 주석 필수. 출처 없는 상수 변경 PR 금지.
3. 엔진은 i18n/포맷팅 미포함(숫자만 반환). 반올림·단위는 UI 레이어.
4. 결정론: 같은 입력 → 같은 출력. Date/random 사용 금지.

### 테스트 케이스 시드 (발췌 — 전체는 §7 스크립트 이식)
```
expect(weightsGB(8.03, 'Q4_K_M')).toBeCloseTo(4.91, 1)          // actual 4.92
expect(kvPerTok({L:32,kv:8,hd:128})).toBe(131072)               // Llama-3.1-8B
expect(tg(rtx4090, qwen3_8b_q4, {ctx:16384}).est).toBeWithin(88, 115)  // meas 104.3
expect(fit(rtx4060_8gb, qwen3_14b_q4).mode).not.toBe('full-gpu')
expect(fit(rtx3060_12gb, qwen35_35b_a3b_q4).mode).toBe('cpu-moe')      // meas ~51 tok/s
expect(['A','B']).toContain(fit(m4max_128, llama33_70b_q4).verdict)    // meas 9.8 tok/s → B
```

## 9. 알려진 한계 (방법론 페이지에 공개할 것)
- MoE bytes/token 근사는 공유 텐서를 과소평가 → 계수에 흡수(§3.2), 고속 소형 MoE에서 오차↑(5090에서 30B-A3B는 오버헤드 지배로 대역폭 모델 상한 이탈 — 235 tok/s 상한 캡 적용).
- LocalScore류 컨텍스트 가중 수치와 tg128 단문 수치는 조건이 다름 — 실측 수집 시 ctx 필드 필수.
- 열/전력 제한(노트북), 듀얼채널 미구성 RAM 등 사용자 환경 편차는 밴드로만 흡수.
- dGPU full-gpu 필요량은 그래픽카드 상주 가중치(파일 − 입력 임베딩·MTP 블록, GGUF 헤더 실측)로 계산한다(10-03 D62, 엔진 0.6.0 — 그 전엔 파일 전체). 남은 한계:
  - **MTP 를 켜면**(`--spec-type draft-mtp`, unsloth `*-MTP-GGUF` 행이 유도 — qwen35·qwen35moe 아키텍처만, 데이터 레이어 `MTP_LOADABLE_MODELS`) MTP 블록(`mtpGB`, Qwen3.6 Q4 0.90GB)과 MTP 컨텍스트 KV 가 더 든다 — 계산하지 않고 분해 바 각주로 안내한다. EXAONE 4.5(exaone4)는 켤 수 없어 "아직 안 쓴다"고만 쓴다. cpu-moe·부분 오프로드의 RAM 몫(파일 − GPU 가중치)에는 MTP 블록이 그대로 들어 있다(보수 — cpu-moe 각주가 밝힌다).
  - **llama.cpp `--fit`(Ollama 0.30+ 도 -ngl 없이 llama-server 를 띄워 같은 경로)** 은 장치마다 1024MiB 를 비워 둔다(https://github.com/ggml-org/llama.cpp/blob/cb7934c/common/common.h#L485). 16GB 이하 카드에서 새로 full-gpu 가 된 빠듯한 셀(예: 8GB × Qwen3.5-9B 32k 필요 6.99 vs 사용 가능 7.4)은 Ollama 에서 부분 오프로드가 될 수 있다(추정) — 가이드·방법론이 `ollama ps` 확인을 안내한다. `llama-server -ngl all` 은 vramGB 가 표기 용량(실제는 GiB — 8GB 카드 = 8.59 decimal GB)이라 여유가 있어 OOM 위험이 낮다.
  - **통합 메모리(맥)는 파일 전체**(Metal mmap 범위, §2.4-1) — 32GB 맥의 Qwen3.5/3.6-35B-A3B 는 여전히 cpu-only(보수).
  - **partial-offload gpuFrac 분모는 파일 전체**(§3.4 주의) — 경계 바로 바깥이 B 로 떨어지는 절벽.
  - **속도는 여전히 파일 바이트**(§3.1 `bytesPerToken = fileGB`) — MTP 블록이 있는 dense 모델(Qwen3.5-9B/27B, Qwen3.8-27B, EXAONE 4.5)은 토큰마다 읽지 않는 MTP 바이트만큼 과소 추정(보수). `mtpGB` 를 쓰는 후속 과제.
  - 실측(llama-server 로그의 `CPU_Mapped model buffer` 에 token_embd, MTP `unused tensor … ignoring` 경고)으로는 아직 대조하지 못했다(하드웨어 없음 — PROGRESS §5).
- cpu-moe 의 `--n-cpu-moe` 는 층 평균 전문가 크기로 정한다 — Q4_K_M 류 혼합 레시피는 층마다 ffn_down 정밀도가 달라 층 크기가 최대 ~1.15× 차이(GPU 에 남는 뒤쪽 층이 무겁다) → 여유 1층(`CPU_MOE_GPU_LAYER_MARGIN`). 앞쪽 dense 층이 있는 기존 MoE(`arch.expertLayers` 미기록)는 전문가 층 수를 전체 층으로 근사한다 — 10-03 이후 추가 모델은 config 가 층 지도를 주면 기록한다(D63).
