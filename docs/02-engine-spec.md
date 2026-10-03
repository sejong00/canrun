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
};
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
주의: Unsloth UD(*_XL) 변형과 네이티브 양자화 모델(gpt-oss, Kimi K2.6/K3, DeepSeek FP8)은 flat bpw에서 이탈 — 실제 크기 필수.

### 2.2 KV 캐시 (토큰당 바이트)
기본식(GQA): `kvBytesPerToken = 2 × n_layers × n_kv_heads × head_dim × bytesPerEl`
- bytesPerEl: f16=2, **q8_0=1.07, q4_0=0.57** (KV quant 토글; V-cache quant는 FA 필요 — 2026 기본 on)
- **아키텍처 보정 (2026 필수, 값은 03의 모델별 사전 계산 필드에 반영)**:
  - SWA(Gemma 3/4, gpt-oss): 슬라이딩 레이어는 window(512~1024, gpt-oss 128)에서 상한 → 긴 ctx에서 KV 거의 평탄. full-attn 레이어만 ctx 비례.
  - MLA(DeepSeek V3/R1, Kimi K2): `(kv_lora 512 + rope 64) × layers × 2B` ≈ 69 KiB/tok 수준.
  - 하이브리드 리니어(Qwen3.5/3.6, Kimi K3): full-attn 레이어(전체의 ~1/4)만 KV + 상수 recurrent state.
- 검증값: Llama-3.1-8B 128 KiB/tok(@16k f16 = 2.15GB), Qwen3-14B 160, Qwen3-32B 256, 70B 320, Qwen3-30B-A3B 96. **7종 전수 일치** (§7).

### 2.3 오버헤드·사용 가능 메모리
```
computeBuffer = 0.5GB + 0.3GB × (ctx/32k)      // llama.cpp 그래프·스크래치 근사
osReserve(kind, os, isDisplayGpu) = dgpu·display만 windows 0.6GB | linux 0.3GB — 그 외(headless·unified·cpu·macos) 0 (macOS는 unified ×0.70에 흡수)
usable(dgpu)   = vram − osReserve
usable(unified)= ram × 0.70                     // macOS wired limit 기본. sysctl 상향 툴팁
usable(cpu)    = usableRam = ram − 4GB (OS)     // usableRam = 모든 kind의 시스템 RAM측 한도 (cpu-moe expert·partial CPU측·cpu-only)
```

### 2.4 fit 판정 순서 (알고리즘)
정본은 `packages/engine/src/fit.ts` (불일치 시 코드 우선). 기본 ctx 8k, `need = resident + kv + buffer`, MoE 판정 = `activeParamsB`·`nonExpertGB` 둘 다 존재.
```
0. kind=cpu: 1~3 없이 곧바로 4 → 실패 시 5
1. full-gpu:  need ≤ usable(hw)  — dgpu vram−osReserve / unified ram×0.70 (통합 풀 전량 탑재도 full-gpu) → 최고 속도
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
```

### 3.2 효율 계수 (실측 70여 점에서 도출, 출처: llama.cpp 공식 스레드·LocalScore·hardware-corner)
| effClass | dense | MoE | 근거 범위 |
|---|---|---|---|
| nvidia (CUDA) | **0.70** | **0.45** | 0.62~0.80 (대역폭 클수록↓: 5090은 0.62, 3060은 0.80) |
| amd (RDNA3/4) | **0.78** | 0.50 | 0.76~0.82 |
| intel-arc | 0.59 | — | B580 실측 |
| apple (base/Pro/Max) | **0.60** | 0.30 | 0.55~0.72 |
| apple-ultra | 0.44 | 0.29 | 800GB/s급 비포화 |
| strix (Ryzen AI Max) | 0.65 | **0.53** | ROCm7/Vulkan |
| dgx-spark | 0.40 | 0.40 | |
| cpu | 0.50 | 0.43 | ≥8코어 전제, 코어 부족 시 ×0.7 |
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
- **명령(데이터 레이어 `snippet.ts`)**: `-ngl all --n-cpu-moe N` 으로 추정과 같은 배치를 명시한다(명시하면 llama.cpp fit 의 가중치 배치는 꺼진다). 각주는 두 가지다. 메모리 부족 시 1~2 올리라는 안내, 그리고 b7410+ 는 두 옵션 없이도 자동 배치된다는 안내다. Ollama 0.30+ 는 자동 배치라 명령을 보여 주되 버전을 안내한다.
- **이력**: 09-30(D55)은 RAM 몫을 라우팅 전문가만으로 고쳤다(이전 ~2.5× 과소). 10-01(D56)은 전문가 일부 GPU 배치를 넣고, 실측 분할로 gpt-oss(유도 0.65/0.81 vs 실측 1.30/1.69GB)·UD 파일의 비전문가 과소를 해소했다. 이로써 D23 의 +1층 여유를 `CPU_MOE_GPU_LAYER_MARGIN` 으로 일반화했다.

### 3.4 partial-offload (dense) — 절벽 경고
`tg ≈ 1 / (gpuFrac/tg_gpu + (1−gpuFrac)/tg_cpu)` (조화 평균). gpuFrac < 0.9면 B등급 상한.
주의(10-03 D62): full-gpu 경계는 상주량(파일 − 입력 임베딩·MTP)으로 판정하지만 gpuFrac 분모는 파일 전체라, 경계 바로 바깥 셀의 gpuFrac 상한은 `resident / file` 이다(Qwen3.5-9B Q4 0.872·Q8_0 0.862, MiniCPM5-1B 0.826, MiniCPM5-2B Q8_0 0.89 — 0.9 미만). 이런 모델은 S(full-gpu)에서 A 를 건너뛰고 B(cap-partial)로 바로 떨어진다. 실제로는 층 대부분이 GPU 에 있는 상태라 보수 쪽이며, 스니펫 `-ngl floor(gpuFrac × layers)` 도 그만큼 덜 올린다. 분모를 상주량으로 바꾸는 안(판정 41건 변화)은 부분 오프로드 실측 검증이 없어 보류. UI에 "dense 모델 부분 오프로드는 급감" 고정 경고 + 실측 예시(gpt-oss-120b: 5090 naive 3.4 vs cpu-moe 9.6 tok/s).

### 3.5 프롬프트 처리(pp) — 연산 지배
`pp ≈ ppCoef × fp16Tflops` — NVIDIA 140/TFLOP, Apple 45, AMD/Intel 30~40 (Vulkan 페널티, 7900 XTX 실측 근거). 표기는 "대략" 수준으로만(±40%) — P1-2부터 **범위 est×0.6~1.4 + 4번째 신뢰 라벨 `rough`(pp 전용, §4)**로 표시한다. 식이 fp16 연산 전제라 **full-gpu(통합 메모리 포함) fit일 때만** 표시하고 부분 오프로드·cpu-moe·cpu-only에선 생략(사유 한 줄). 밴드 상수는 데이터 레이어 정책(`packages/data` `PP_BAND = 0.4`, `// source: docs/02 §3.5 (policy)`) — 엔진 `Result.ppTokS`는 est만 반환(무변경, PROGRESS §4 09-29 D13). 장문 RAG 유저용 참고치.

### 3.6 컨텍스트 감쇠
kvRead 항이 자연 반영 (예: 4090 Qwen3-8B: 8k에서 118 → 16k에서 95 → 32k에서 68 tok/s). tg128 단문 실측과 비교 시 이 항 제외 조건 일치 확인.

## 4. 신뢰 라벨
- `measured`: 동일 (기기, 모델, quant) 실측 n≥1 존재 → 실측 중앙값 표시, 추정은 보조
- `calibrated`: 클래스 계수 검증 범위 내 조합 → **클래스별 밴드: NVIDIA·AMD dGPU dense ±12% / 그 외 클래스·모든 MoE·부분 오프로드 ±20%** (§7 검증 최대 오차 17.1%를 상회하도록 설정 — 밴드가 검증값보다 좁으면 안 됨). 실측 누적 시 기기별로 축소
- `rough`: **pp(프롬프트 처리) 전용** 4번째 라벨 — **±40%**(§3.5, est×0.6~1.4). tg·판정에는 쓰지 않으며, 엔진 `Result.confidence`(§1)에는 없고 데이터 레이어가 pp 표시에만 붙인다(P1-2 D13, PROGRESS §4 09-29)
- `theoretical`: 신형 기기/특이 아키텍처 등 검증 밖 → **±30%** 밴드 + "제출로 검증에 참여" CTA
  - 판정 주체는 데이터 레이어(`EvaluateOptions.theoretical`). P1-1 규칙(`packages/data/src/assess.ts` `isTheoretical`): ① MoE × MoE 계수가 없는 클래스(현재 intel-arc — §3.2) ② mode = cpu-moe(10-01 부분 배치 개정 후에도 유지 — NVIDIA 공개 실측 35점 평균 오차 10.3%·±20% 안 89% 지만 최대 40% 라 보정 추정(±20%, 검증 최대 오차 이상이어야 함)을 못 단다. 가장 넓은 라벨 ±30% 를 쓰고, 그 표시 범위 밖 공개 점 4개는 모두 과소 추정(실제가 더 빠름) — verify-regression 5 가 "표시 범위를 넘는 과대 추정 없음"을 강제) ③ 비전문가 크기(행 실측·모델 유도 둘 다)가 없는 MoE가 부분 오프로드로 떨어진 경우(엔진이 dense 경로로 계산) ④ llama.cpp 구동이 검증되지 않은 커스텀 아키텍처(HyperCLOVA X SEED Think 14B) ⑤ FP16 크리플 GPU(`fp16Tflops` < 1 — GTX 10, 계수 도출 표본 밖. `01` §9 P1-1 개정: GPU 판정 유지 + 주의 배지) ⑥ 통합 메모리 칩의 cpu-only(cpu 계수 검증점은 데스크톱 DDR5뿐 — CPU측 대역폭은 `01` §3 `unifiedCpuBandwidth`로 GPU 경로 이하로 제한)

## 5. 판정 임계값 (ctx 8k, Q4_K_M 기준)
```
S: mode=full-gpu && tg ≥ 20
A: (full-gpu && 8 ≤ tg < 20) || (cpu-moe && tg ≥ 20)
B: 2 ≤ tg < 8 (모드 불문) || (cpu-moe && 8 ≤ tg < 20)
F: tg < 2 || 모든 quant 미탑재
```
부분 오프로드(§3.4): gpuFrac < 0.9면 B 상한, ≥ 0.9면 8 tok/s 이상에서 A까지(S는 full-gpu 전용) — `verdict.ts`가 정본.
근거: 20 tok/s ≈ 읽는 속도 상회(쾌적 체감), 8 ≈ 인내 가능, 2 미만 = 실사용 불가. 생각 모드가 있는 모델(`thinking` 필드 — 늘 생각·기본 켜짐·기본 꺼짐·자동. 끌 수 있어도 포함)은 사고 토큰 때문에 임계 ×1.5 상향(S ≥ 30 · A ≥ 12 · B ≥ 3 tok/s). 생각 모드가 없는 모델(phi-4 등)은 제외 — PROGRESS §4 D59(10-01, 옛 `category: reasoning` 기준 대체).

## 6. 멀티 GPU (베타 — 계산기만, 10-01 D58)
같은 GPU N 장(`Hardware.gpuCount`, 2~4). usable = vramGB × N − osReserve(화면 출력 1장분), 연산 버퍼는 GPU 마다(×N), 물리 한도 = vramGB × N.
tg = 단일 카드 식 그대로 × `MULTI_GPU_TG_FACTOR`(= 1) — 층 나눠 올리기(llama.cpp 기본 `-sm layer`)는 토큰마다 GPU 를 차례로 지나므로 대역폭이 합산되지 않는다.
- 근거(공개 실측 10점, `test/fixtures.ts` MULTI_GPU_CASES): 70B급 2~4장의 실효 대역폭은 카드 1장 피크의 75~90%(2×3090 16.57 · 2×4090 19.22 · 4×4090 21.25 tok/s) — 단일 카드 클래스 계수 0.70 보다 높아 추가 감속 없음이 10점 전부 보수 쪽(−22~0%, MAE ~12%). 같은 모델 1장 → N장 손실은 CUDA 최근 빌드 0~3%(A40 1→3장 동일).
- 옛 표기 "단일 카드 계수 × 0.68" 은 근거(2×3090 70B 14~16 tok/s)를 잘못 옮긴 것 — 그 실측은 0.68~0.75 실효 계수에 해당한다(10-01 정정).
- 실측 조인 없음(1장 기준 실측), 라벨은 이론 추정 고정. AMD·Vulkan 은 장수 손실 편차가 크다(7900 XTX ROCm −7.5%·Vulkan −25%). `-sm tensor`(2026-04, PR #19378)는 dense 1.2~2.3× — 모델링하지 않고 안내만. `-sm row` 는 CUDA 에서 제거(PR #24216). 허브·콤보는 1장 기준, 이종 조합은 범위 밖.

## 7. 검증 결과 (2026-08-09 — CI 회귀 테스트로 이식 완료)

> **이식 기록 (P0-2, 2026-08-16)**: 원본 `verify_engine.py` 는 `packages/engine/test/verify-regression.test.ts` 로 assertion 이식 후 삭제(git 히스토리에 보존). `pnpm run verify-engine` 으로 단독 실행, CI 에서 상시 회귀. 아래 수치가 테스트 기대값이다.
- 가중치: 실제 GGUF 11종 대조 **MAE 0.7% / max 1.6%**
- KV: 아키텍처 7종 공식값 **전수 일치**
- 속도: 실측 12점 대조 **MAE 6.3% / max 17.1%** (worst: M4 Pro −17%, 5060Ti MoE −15% → 클래스 계수 한계, Phase 2 기기별 보정 대상)
- cpu-moe(09-30 → 10-01): 전문가 전부 RAM 공개 실측 3점(3060 Ti+DDR5-6800 gpt-oss-120b 24.85 · 5080+DDR5-4800 Qwen3.5-35B-A3B Q4_K_M 51.0·Q8_0 35.7) 각 ±20% 이내 + 전문가 일부 GPU 배치(`--n-cpu-moe N`)를 포함한 공개 실측 전체 MAE < 12%·±20% 안 ≥ 80%·전부 ±40% 안 (verify-regression 5)
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
- cpu-moe 의 `--n-cpu-moe` 는 층 평균 전문가 크기로 정한다 — Q4_K_M 류 혼합 레시피는 층마다 ffn_down 정밀도가 달라 층 크기가 최대 ~1.15× 차이(GPU 에 남는 뒤쪽 층이 무겁다) → 여유 1층(`CPU_MOE_GPU_LAYER_MARGIN`).
