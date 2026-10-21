/**
 * 엔진 입출력 타입 — docs/02-engine-spec.md §1.
 * 순수 데이터 타입만. 로더·검증(zod)은 @canrun/data 소관.
 */

/** GGUF 양자화 식별자. bpw 표는 constants.ts QUANT_BPW. */
export type QuantId =
  | 'IQ2_M'
  | 'Q2_K'
  | 'IQ3_XS'
  | 'Q3_K_M'
  | 'IQ4_XS'
  | 'Q4_K_M'
  | 'Q5_K_M'
  | 'Q6_K'
  | 'Q8_0'
  | 'MXFP4'
  | 'UD-Q2_K_XL'
  | 'UD-IQ2_M'
  | 'F16';

/** 효율 계수 클래스 — §3.2 표의 행. */
export type EffClass =
  | 'nvidia'
  | 'amd'
  | 'intel-arc'
  | 'apple'
  | 'apple-ultra'
  | 'strix'
  | 'dgx-spark'
  | 'cpu';

export type Os = 'windows' | 'linux' | 'macos';

/** KV 캐시 양자화 토글 — §2.2. */
export type KvQuant = 'f16' | 'q8_0' | 'q4_0';

/**
 * dGPU 카드 1장 — 서로 다른 카드 섞기(§6 베타, 10-03 D67)의 `Hardware.gpus` 원소. 효율은 `effOverride ?? EFF[effClass]`.
 */
export type GpuUnit = {
  vramGB: number;
  memBandwidthGBs: number;
  effClass: EffClass;
  effOverride?: number;
  /** 이 카드가 화면 출력을 담당 (OS 예약 VRAM, §2.3) — 보통 1번 카드만 */
  isDisplayGpu?: boolean;
};

export type Hardware = {
  kind: 'dgpu' | 'unified' | 'cpu';
  /** osReserve 산출·실행 커맨드 스니펫 분기 (PRD 입력 항목) */
  os: Os;
  /** dgpu 전용 (decimal GB) */
  vramGB?: number;
  /** 스펙 대역폭 (GB/s) — dgpu는 VRAM, unified는 통합 메모리 */
  memBandwidthGBs: number;
  /** pp 추정용 (선택) */
  fp16Tflops?: number;
  /**
   * 행렬 코어 FP16 처리량(dense) — 제조사가 벡터 FP16 과 따로 밝힐 때(AMD "Peak Half Precision (FP16 Matrix)"). 있으면 pp 가
   * `fp16Tflops` 대신 이 값을 쓴다(§3.5, 10-16 D91 — RDNA4 는 행렬 FP16 이 카탈로그 fp16Tflops 의 2배, RDNA3 는 같다)
   */
  fp16MatrixTflops?: number;
  /**
   * GPU 코어마다 행렬곱 가속기(Apple M5 계열 Neural Accelerator) — pp 추정이 클래스 계수 대신 `PP_COEF_NEURAL_ACCEL` 을 쓴다
   * (§3.5, 10-16 D86). tg 는 대역폭 식 그대로
   */
  neuralAccel?: boolean;
  /** 시스템 RAM (cpu-moe/오프로드) */
  ramGB: number;
  ramBandwidthGBs: number;
  effClass: EffClass;
  /** 실측 누적 시 기기별 학습 계수 (Phase 2) — 클래스 기본값을 대체 */
  effOverride?: number;
  /** OS 예약 차감 여부 (디스플레이 출력 담당 GPU) */
  isDisplayGpu?: boolean;
  /**
   * dgpu 전용: 같은 GPU 장수 (기본 1, §6 베타). VRAM 은 합산, 연산 버퍼는 GPU 마다, OS 예약은 화면 출력 GPU 1장분.
   * 속도는 층 나눠 올리기(llama.cpp 기본 -sm layer) — 토큰마다 GPU 를 차례로 지나므로 대역폭은 합산되지 않는다
   */
  gpuCount?: number;
  /**
   * dgpu 전용: 카드 목록(1~4장, 서로 달라도 된다 — §6 베타, 10-03 D67). 있으면 장수·VRAM·대역폭·효율·화면 출력은 이 목록을 따르고
   * `gpuCount`·위의 vramGB·memBandwidthGBs·effOverride·isDisplayGpu 는 무시한다(위 필드는 1번 카드 값 — 밴드 클래스·pp·호출부 호환).
   * 층은 카드마다 남은 메모리(VRAM − 화면 출력 예약)에 비례해 나뉘고, 토큰마다 카드를 차례로 지난다
   */
  gpus?: readonly GpuUnit[];
};

export type ModelQuant = {
  paramsB: number;
  /** MoE면 존재 (활성 파라미터 B) */
  activeParamsB?: number;
  /** 실제 GGUF 크기 (decimal GB, HF 수집) — 있으면 bpw 폴백보다 최우선 (§2.1) */
  fileGB?: number;
  /** bpw 폴백 계산용 */
  quant: QuantId;
  /** f16 기준 사전 계산값 (docs/03 kvBytesPerTokenF16) — KV quant 스케일은 엔진이 적용 */
  kvBytesPerToken: number;
  /** KV 스케일링 표시용 (SWA/MLA/하이브리드 보정은 사전 계산값에 반영됨) */
  attnType: 'full' | 'swa' | 'mla' | 'hybrid';
  /**
   * MoE: GPU 에 상주하는 비전문가 텐서 GB(어텐션·공유 전문가·라우터·출력층 — llama.cpp 는 token_embd 를 CPU 에 둔다).
   * `expertGB` 와 함께 오면 그 GGUF 파일 헤더 실측값, 없으면 기준 양자화에서 균등 bpw 로 유도한 값(§3.3).
   */
  nonExpertGB?: number;
  /** MoE: 라우팅 전문가 텐서 합 GB (GGUF 헤더 실측, MTP 블록 제외) — 있으면 nonExpertGB 도 실측값 */
  expertGB?: number;
  /** MoE: 토큰당 쓰는 전문가 비율 topK/experts — 전문가 읽기량 = expertGB × 이 값 (§3.1·§3.3) */
  activeExpertFrac?: number;
  /** MoE: 전문가가 있는 층 수 — `--n-cpu-moe` 층 단위 배치(§2.4-2). 없으면 전문가 전부 RAM 가정 */
  moeLayers?: number;
  /** MoE: 토큰당 쓰는 라우팅 전문가 수(arch.topK) — 토큰당 고정 시간 = moeLayers × topK × 클래스 값 (§3.1, 10-16 D88) */
  topK?: number;
  /**
   * dense: 파일 중 llama.cpp 가 그래픽카드에 올리지 않는 GB (GGUF 헤더 실측, §2.4-1·§3.3, 10-03 D62) —
   * 입력 임베딩 token_embd(입력층은 항상 CPU: https://github.com/ggml-org/llama.cpp/blob/cb7934c/src/llama-model.cpp#L1605-L1607,
   * 임베딩 공유 모델은 출력층 사본이 GPU 에 가므로 0)·기본 미적재 MTP/NextN 블록(TENSOR_SKIP)·헤더 메타데이터.
   * dGPU full-gpu 필요량 = fileGB − 이 값. 없으면 MoE 실측 분할(expertGB + nonExpertGB)로 유도, 그것도 없으면 파일 전체.
   */
  offGpuGB?: number;
  /**
   * dense: 층별 임베딩 표 `per_layer_token_embd` GB (PLE — Gemma 4 E2B·E4B, GGUF 헤더 실측, 10-21 D112). 입력층이라 offGpuGB 안에
   * 들어 있고(시스템 RAM), llama.cpp 는 토큰마다 이 표에서 한 줄만 읽는다(get_rows) — 속도식의 읽기 바이트에서 뺀다(§3.1).
   * 부분 오프로드 gpuFrac 의 분모도 파일 − 이 값(처음부터 CPU 라 나눠 올리는 대상이 아니다 — §2.4-3)
   * 출처: https://github.com/ggml-org/llama.cpp/blob/9a3b91c6801e68f412fcf1b6f8e153aa562b8536/src/llama-arch.cpp#L1031 ·
   * https://github.com/ggml-org/llama.cpp/blob/9a3b91c6801e68f412fcf1b6f8e153aa562b8536/src/llama-model.cpp#L1684-L1686
   */
  pleGB?: number;
  /**
   * MoE: 값 전문가(MoVA — K2-Horizon `attn_v_exps`) 텐서 GB (GGUF 헤더 실측, 10-21 D113). `nonExpertGB` 안에 들어 있다 — llama.cpp
   * `--n-cpu-moe`·`--fit` 은 FFN 전문가만 옮겨 값 전문가는 늘 그래픽카드에 있으므로 배치·VRAM 은 비전문가 그대로다(§2.4·§3.3).
   * 토큰마다 고른 값 전문가만 곱해(top-k 선택 → mul_mat_id) 읽기 바이트에서는 `valueExpertFrac` 밖의 몫을 뺀다(§3.1).
   * 출처: https://github.com/ggml-org/llama.cpp/blob/4625240437c6821ee5c2da99e12d4817c6a8f07f/src/models/k2-horizon.cpp#L161 ·
   * https://github.com/ggml-org/llama.cpp/blob/4625240437c6821ee5c2da99e12d4817c6a8f07f/src/models/k2-horizon.cpp#L186 ·
   * https://github.com/ggml-org/llama.cpp/blob/4625240437c6821ee5c2da99e12d4817c6a8f07f/src/llama-graph.cpp#L1588-L1593
   */
  valueExpertGB?: number;
  /** MoE: 토큰당 쓰는 값 전문가 비율 valueTopK/valueExperts — 값 전문가 읽기량 = valueExpertGB × 이 값 (§3.1, 10-21 D113) */
  valueExpertFrac?: number;
  maxContext: number;
};

export type Mode = 'full-gpu' | 'cpu-moe' | 'partial-offload' | 'cpu-only';
export type Verdict = 'S' | 'A' | 'B' | 'F';
export type Confidence = 'measured' | 'calibrated' | 'theoretical';

export type VramBreakdown = {
  /** GPU(또는 통합 풀)에 상주하는 가중치 GB — partial이면 GPU 몫만 */
  weights: number;
  kv: number;
  buffer: number;
  osReserve: number;
  /** weights + kv + buffer + osReserve */
  total: number;
  /** 물리 한도 (dgpu: vramGB, unified: ramGB, cpu: ramGB) */
  limit: number;
};

export type TgEstimate = {
  est: number;
  /** est × (1 − 밴드) */
  low: number;
  /** est × (1 + 밴드) */
  high: number;
};

export type Result = {
  verdict: Verdict;
  mode: Mode;
  vram: VramBreakdown;
  tgTokS: TgEstimate;
  ppTokS?: { est: number };
  confidence: Confidence;
  /** cpu-moe: 전문가를 CPU(시스템 RAM)에 두는 층 수 — `--n-cpu-moe` 값 (§2.4-2) */
  cpuMoeLayers?: number;
  /** 요청 quant가 불가(F)일 때 탐색된 대안 */
  bestQuant?: QuantId;
};

export type EvaluateOptions = {
  /** 기본 8192 (§5 판정 기준 ctx) */
  ctx?: number;
  /** 기본 'f16' */
  kvQuant?: KvQuant;
  /** 리즈닝 모델(R1류): 판정 임계 ×1.5 (§5) */
  reasoning?: boolean;
  /**
   * 동일 (기기, 모델, quant) 실측 tok/s — 데이터 레이어가 조인해 주입 (§4).
   * 존재하면 confidence='measured', est=중앙값.
   */
  measuredTgTokS?: number[];
  /** 검증 밖 조합(신형 기기·특이 아키텍처) 표시 — 데이터 레이어가 판단 (§4) */
  theoretical?: boolean;
};
