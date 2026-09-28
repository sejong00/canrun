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
정본은 `packages/engine/src/fit.ts` (불일치 시 코드 우선). 기본 ctx 8k, `need = weights + kv + buffer`, MoE 판정 = `activeParamsB`·`nonExpertGB` 둘 다 존재.
```
0. kind=cpu: 1~3 없이 곧바로 4 → 실패 시 5
1. full-gpu:  need ≤ usable(hw)  — dgpu vram−osReserve / unified ram×0.70 (통합 풀 전량 탑재도 full-gpu) → 최고 속도
   unified는 실패 시 곧바로 4 (2·3은 dgpu 전용)
2. cpu-moe (dgpu + MoE만): nonExpertGB + kv + buffer ≤ usable(dgpu) && (weights − nonExpertGB) ≤ usableRam
   → VRAM 상주 = nonExpert+kv+buffer. 속도는 RAM 대역폭 지배 (§3.3). 12~16GB 카드로 120B MoE 구동하는 2026 표준 경로
3. partial-offload (dgpu + MoE 아님 — dense와 nonExpertGB 없는 MoE): kv+buffer는 GPU 상주, 가중치만 분할
   gpuW = min(weights, usable(dgpu) − kv − buffer)   // > 0 이어야 함
   cpuW = weights − gpuW ≤ usableRam
   gpuFrac = gpuW / weights   … 속도 절벽 경고 (§3.4)
   (c66f9ff 외부 리뷰 정정: 구식 need 비례식 gpuFrac = usable/need, cpuW = weights×(1−gpuFrac)는
    kv·buffer 일부가 CPU로 간다고 가정해 CPU측을 과소평가 → 거짓 양성. 반례 Qwen3-14B Q4·8GB GPU·RAM 7GB
    (usableRam 3GB — 구식 cpuW ≈2.9 탑재 / 정정 ≈3.5 불가)를 fit.test.ts 회귀로 고정)
4. cpu-only:  weights + kv ≤ usableRam   // MoE(nonExpertGB 有)는 2 실패 시 3을 건너뛰고 여기로
5. 전부 실패 → F. 더 낮은 quant 루프로 bestQuant 탐색 (IQ2_M까지):
   사다리 IQ2_M…Q8_0 중 요청 quant보다 bpw 낮은 것을 높은 품질부터, weights = paramsB×bpw/8
   (bpw 폴백 — 실파일 크기는 데이터 레이어 몫), MoE nonExpertGB도 같은 비율로 축소 → 0~4 첫 성공 quant.
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
`tg ≈ eff_cpu × ramBandwidthGBs / expertBytesPerToken` (attention은 GPU라 병목 아님, 상한은 full-gpu 값)
실측 앵커: RTX 3060 12GB + DDR5로 Qwen3.6-35B-A3B ≈ 51~53 tok/s, gpt-oss-120b + 5090 + `--n-cpu-moe 21` = 8~9.6 tok/s(DDR4 서버).

### 3.4 partial-offload (dense) — 절벽 경고
`tg ≈ 1 / (gpuFrac/tg_gpu + (1−gpuFrac)/tg_cpu)` (조화 평균). gpuFrac < 0.9면 B등급 상한. UI에 "dense 모델 부분 오프로드는 급감" 고정 경고 + 실측 예시(gpt-oss-120b: 5090 naive 3.4 vs cpu-moe 9.6 tok/s).

### 3.5 프롬프트 처리(pp) — 연산 지배
`pp ≈ ppCoef × fp16Tflops` — NVIDIA 140/TFLOP, Apple 45, AMD/Intel 30~40 (Vulkan 페널티, 7900 XTX 실측 근거). 표기는 "대략" 수준으로만(±40%). 장문 RAG 유저용 참고치.

### 3.6 컨텍스트 감쇠
kvRead 항이 자연 반영 (예: 4090 Qwen3-8B: 8k에서 118 → 16k에서 95 → 32k에서 68 tok/s). tg128 단문 실측과 비교 시 이 항 제외 조건 일치 확인.

## 4. 신뢰 라벨
- `measured`: 동일 (기기, 모델, quant) 실측 n≥1 존재 → 실측 중앙값 표시, 추정은 보조
- `calibrated`: 클래스 계수 검증 범위 내 조합 → **클래스별 밴드: NVIDIA·AMD dGPU dense ±12% / 그 외 클래스·모든 MoE·부분 오프로드 ±20%** (§7 검증 최대 오차 17.1%를 상회하도록 설정 — 밴드가 검증값보다 좁으면 안 됨). 실측 누적 시 기기별로 축소
- `theoretical`: 신형 기기/특이 아키텍처 등 검증 밖 → **±30%** 밴드 + "제출로 검증에 참여" CTA
  - 판정 주체는 데이터 레이어(`EvaluateOptions.theoretical`). P1-1 규칙(`packages/data/src/assess.ts` `isTheoretical`): ① MoE × MoE 계수가 없는 클래스(현재 intel-arc — §3.2) ② mode = cpu-moe(속도 검증점 0 — §3.3 앵커 3060+Qwen3.6-35B-A3B ~52 tok/s 대비 엔진 추정이 약 2.5× 낮다, PROGRESS §5) ③ `nonExpertGB` 없는 MoE가 부분 오프로드로 떨어진 경우(엔진이 dense 경로로 계산) ④ llama.cpp 구동이 검증되지 않은 커스텀 아키텍처(HyperCLOVA X SEED Think 14B) ⑤ FP16 크리플 GPU(`fp16Tflops` < 1 — GTX 10, 계수 도출 표본 밖. `01` §9 P1-1 개정: GPU 판정 유지 + 주의 배지) ⑥ 통합 메모리 칩의 cpu-only(cpu 계수 검증점은 데스크톱 DDR5뿐 — CPU측 대역폭은 `01` §3 `unifiedCpuBandwidth`로 GPU 경로 이하로 제한)

## 5. 판정 임계값 (ctx 8k, Q4_K_M 기준)
```
S: mode=full-gpu && tg ≥ 20
A: (full-gpu && 8 ≤ tg < 20) || (cpu-moe && tg ≥ 20)
B: 2 ≤ tg < 8 (모드 불문) || (cpu-moe && 8 ≤ tg < 20)
F: tg < 2 || 모든 quant 미탑재
```
부분 오프로드(§3.4): gpuFrac < 0.9면 B 상한, ≥ 0.9면 8 tok/s 이상에서 A까지(S는 full-gpu 전용) — `verdict.ts`가 정본.
근거: 20 tok/s ≈ 읽는 속도 상회(쾌적 체감), 8 ≈ 인내 가능, 2 미만 = 실사용 불가. 리즈닝 모델(R1류)은 사고 토큰 때문에 임계 ×1.5 상향 플래그.

## 6. 멀티 GPU (P1은 베타 표기)
VRAM 합산 − GPU당 buffer 중복. tg ≈ 단일 카드 계수 × 0.68 (2×3090 NVLink 70B 실측 14~16 tok/s 근거). 이종 조합은 P2에서.

## 7. 검증 결과 (2026-08-09 — CI 회귀 테스트로 이식 완료)

> **이식 기록 (P0-2, 2026-08-16)**: 원본 `verify_engine.py` 는 `packages/engine/test/verify-regression.test.ts` 로 assertion 이식 후 삭제(git 히스토리에 보존). `pnpm run verify-engine` 으로 단독 실행, CI 에서 상시 회귀. 아래 수치가 테스트 기대값이다.
- 가중치: 실제 GGUF 11종 대조 **MAE 0.7% / max 1.6%**
- KV: 아키텍처 7종 공식값 **전수 일치**
- 속도: 실측 12점 대조 **MAE 6.3% / max 17.1%** (worst: M4 Pro −17%, 5060Ti MoE −15% → 클래스 계수 한계, Phase 2 기기별 보정 대상)
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
