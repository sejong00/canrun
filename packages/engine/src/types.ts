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
  /** 시스템 RAM (cpu-moe/오프로드) */
  ramGB: number;
  ramBandwidthGBs: number;
  effClass: EffClass;
  /** 실측 누적 시 기기별 학습 계수 (Phase 2) — 클래스 기본값을 대체 */
  effOverride?: number;
  /** OS 예약 차감 여부 (디스플레이 출력 담당 GPU) */
  isDisplayGpu?: boolean;
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
  /** MoE: attention+shared 텐서 크기 GB (cpu-moe 판정) */
  nonExpertGB?: number;
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
