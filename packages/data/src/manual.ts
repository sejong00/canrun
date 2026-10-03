/**
 * 계산기 "모델 값 직접 입력" (계산기 P2, docs/01 F4, PROGRESS §4 D66) — 모델 카드·config.json 의 숫자 → 엔진 입력 레코드.
 * HF 불러오기(D57 `buildHfModel`)와 같은 모양(ModelCore + ModelQuantCore[])이라 계산기의 고정 카드 경로
 * (이론 추정 고정, 카운트·필터 밖)에 그대로 들어간다. 엔진은 바꾸지 않는다 — 이미 있는 순수 함수만 쓴다:
 * 가중치 = `weightsGBFromBpw`(bpw 환산, docs/02 §2.1 2순위), KV = `kvBytesPerToken`(GQA 기본식, §2.2), MoE 비전문가 = `deriveNonExpertGB`.
 *
 * 순수·브라우저 안전 — 값 import 는 `@canrun/engine`·`./derive` 뿐(hf.ts·gguf.ts 는 쓰지 않는다: client-entry 테스트).
 */
import { kvBytesPerToken, weightsGBFromBpw, type QuantId } from '@canrun/engine';
import type { ModelCore, ModelQuantCore } from './core';
import { deriveNonExpertGB } from './derive';

/** 방문자가 넣는 값 — 입력 도중에도 상태로 들고 다니므로 전부 선택. 범위 검사는 `manualIssues`·URL 파서가 한다 */
export type ManualSpec = {
  /** 전체 파라미터 수 (B) */
  paramsB?: number;
  /** MoE 활성 파라미터 수 (B) */
  activeParamsB?: number;
  /** MoE 층당 전문가 수 (config `num_experts` · `num_local_experts` · `n_routed_experts`) */
  experts?: number;
  /** MoE 토큰당 쓰는 전문가 수 (`num_experts_per_tok`) */
  topK?: number;
  /** 층 수 (`num_hidden_layers`) */
  layers?: number;
  /** KV 헤드 수 (`num_key_value_heads`, 없으면 `num_attention_heads`) */
  kvHeads?: number;
  /** 헤드 차원 (`head_dim`, 없으면 hidden_size ÷ num_attention_heads) */
  headDim?: number;
  /** 전체 어텐션 층 수 — 슬라이딩 윈도·선형 어텐션 층이 섞인 모델만(`layer_types` 의 full_attention 개수). 없으면 모든 층 */
  fullAttnLayers?: number;
  /** 모델 최대 컨텍스트 — 모르면 비운다 */
  maxContext?: number;
  /** 생각 모드가 있는 모델 — 판정 기준 ×1.5 (D59) */
  thinking?: boolean;
};

export type ManualNumberField = 'paramsB' | 'activeParamsB' | 'experts' | 'topK' | 'layers' | 'kvHeads' | 'headDim' | 'fullAttnLayers';

/** 필드 검사 순서 = 오류를 하나만 고를 때의 우선순위 */
export const MANUAL_NUMBER_FIELDS: readonly ManualNumberField[] = ['paramsB', 'activeParamsB', 'experts', 'topK', 'layers', 'kvHeads', 'headDim', 'fullAttnLayers'];
export const MANUAL_REQUIRED: readonly ManualNumberField[] = ['paramsB', 'layers', 'kvHeads', 'headDim'];
export const MANUAL_MOE_FIELDS: readonly ManualNumberField[] = ['activeParamsB', 'experts', 'topK'];

/**
 * 입력 범위 — 카탈로그 범위(파라미터 1.08~250B, 16~80층, KV 헤드 2~32, 헤드 차원 64~256, 전문가 32~512·top-k 4~10, data/models.json 10-03)를
 * 넉넉히 감싼 정책값. 정수 칸은 소수를 받지 않는다. 전체 어텐션 층 수의 상한은 층 수(`manualIssues`)
 */
// source: docs/01 F4 (policy)
export const MANUAL_LIMITS: Readonly<Record<ManualNumberField, { min: number; max: number; integer: boolean }>> = Object.freeze({
  paramsB: { min: 0.1, max: 2000, integer: false },
  activeParamsB: { min: 0.1, max: 2000, integer: false },
  experts: { min: 2, max: 1024, integer: true },
  topK: { min: 1, max: 256, integer: true },
  layers: { min: 1, max: 256, integer: true },
  kvHeads: { min: 1, max: 256, integer: true },
  headDim: { min: 16, max: 1024, integer: true },
  fullAttnLayers: { min: 1, max: 256, integer: true },
});

/** 만드는 양자화 행 — HF 불러오기 행 구성(Q4_K_M·IQ4_XS·Q8_0·Q2_K)과 같다. UD 는 bpw 환산 금지(NATIVE_QUANTS)라 없다 */
// source: docs/01 F4 (policy)
export const MANUAL_QUANTS: readonly QuantId[] = Object.freeze(['Q2_K', 'IQ4_XS', 'Q4_K_M', 'Q8_0']);

/** 직접 입력 모델 id — 카탈로그 id(slug)·HF 접두(`hf-`)와 겹치지 않는다 */
// source: docs/01 F4 (policy)
export const MANUAL_MODEL_ID = 'manual';

/**
 * 최대 컨텍스트를 모를 때 — 컨텍스트 계단 최대(262,144)보다 커서 줄이기(클램프)나 "(모델 최대)" 표기가 생기지 않는다
 */
// source: docs/01 F4 (policy)
export const MANUAL_UNKNOWN_MAX_CONTEXT = 1_048_576;

export type ManualIssue =
  | { code: 'range'; min: number; max: number; integer: boolean }
  | { code: 'active-too-large' }
  | { code: 'active-too-small'; min: number }
  | { code: 'topk-too-large' }
  /** top-k 가 전문가 수에 너무 가까워 활성 파라미터를 어떤 값으로 넣어도 비전문가 크기가 0 이 되는 경우(작은 모델) — 불가능한 최소값을 안내하지 않는다 */
  | { code: 'topk-no-room' };

export type ManualBuild =
  | { kind: 'ok'; model: ModelCore; rows: ModelQuantCore[] }
  | { kind: 'incomplete'; missing: ManualNumberField[] }
  | { kind: 'invalid'; field: ManualNumberField; issue: ManualIssue };

const round2 = (x: number): number => Math.round(x * 100) / 100;
/** 소수 둘째 자리 올림 — 부동소수 잡음(1.91 이 1.9100000001 로 계산되는 것)은 먼저 걷어 낸다 */
const ceil2 = (x: number): number => Math.ceil(Math.round(x * 1e6) / 1e4) / 100;

/** 한 칸의 고정 범위·정수 검사 (다른 칸과 엮인 검사는 `manualIssues`) */
export function manualRangeIssue(field: ManualNumberField, value: number): ManualIssue | undefined {
  const r = MANUAL_LIMITS[field];
  const ok = Number.isFinite(value) && value >= r.min && value <= r.max && (!r.integer || Number.isInteger(value));
  return ok ? undefined : { code: 'range', min: r.min, max: r.max, integer: r.integer };
}

/** MoE 로 볼 입력인가 — 활성·전문가 수·top-k 중 하나라도 있으면 */
export function isManualMoe(spec: ManualSpec): boolean {
  return MANUAL_MOE_FIELDS.some((f) => spec[f] !== undefined);
}

/** 기준(Q4_K_M) 행 파일 크기 — 비전문가 유도의 분모 */
const baseFileGB = (paramsB: number): number => round2(weightsGBFromBpw(paramsB, 'Q4_K_M'));

/**
 * 비전문가 크기(반올림 뒤 0.01GB 이상)가 나오는 최소 활성 파라미터. 유도식 N = (A − T·k/E) / (1 − k/E) 에서
 * N × fileGB / T ≥ 0.005 ⇔ A ≥ T·k/E + θ(1 − k/E), θ = 0.005·T / fileGB. 둘째 자리로 올린 뒤 실제 유도로 확인한다
 * (안내한 값을 넣었는데 같은 오류가 다시 나오지 않게 — 적대적 검토 반영)
 */
function minActiveParamsB(paramsB: number, experts: number, topK: number): number {
  const fileGB = baseFileGB(paramsB);
  const s = topK / experts;
  let min = ceil2(paramsB * s + ((0.005 * paramsB) / fileGB) * (1 - s));
  for (let i = 0; i < 100 && !(round2(deriveNonExpertGB({ totalParamsB: paramsB, activeParamsB: min, experts, topK }, fileGB)) > 0); i += 1) {
    min = round2(min + 0.01);
  }
  return min;
}

/** 칸별 문제 — 화면이 칸마다 안내 문장을 단다. 범위를 벗어난 칸이 있으면 그 칸과 엮인 검사는 건너뛴다 */
export function manualIssues(spec: ManualSpec): Partial<Record<ManualNumberField, ManualIssue>> {
  const out: Partial<Record<ManualNumberField, ManualIssue>> = {};
  for (const field of MANUAL_NUMBER_FIELDS) {
    const value = spec[field];
    if (value === undefined) continue;
    const issue = manualRangeIssue(field, value);
    if (issue) out[field] = issue;
  }
  const ok = (f: ManualNumberField): boolean => spec[f] !== undefined && out[f] === undefined;
  if (ok('fullAttnLayers') && ok('layers') && spec.fullAttnLayers! > spec.layers!) {
    out.fullAttnLayers = { code: 'range', min: MANUAL_LIMITS.fullAttnLayers.min, max: spec.layers!, integer: true };
  }
  if (ok('topK') && ok('experts') && spec.topK! >= spec.experts!) out.topK = { code: 'topk-too-large' };
  // 최소 활성값이 전체 파라미터(반올림)에 닿으면 "활성 < 전체" 와 모순 — 활성 칸 대신 top-k 칸에 알린다 (리뷰 반영: 1B·128 전문가·top-k 127)
  if (ok('topK') && ok('experts') && ok('paramsB') && minActiveParamsB(spec.paramsB!, spec.experts!, spec.topK!) >= round2(spec.paramsB!)) {
    out.topK = { code: 'topk-no-room' };
  }
  if (ok('activeParamsB') && ok('paramsB')) {
    const total = spec.paramsB!;
    const active = spec.activeParamsB!;
    // HF 경로(hf.ts)와 같은 비교 — 레코드에 들어가는 반올림 값으로
    if (round2(active) >= round2(total)) out.activeParamsB = { code: 'active-too-large' };
    else if (ok('experts') && ok('topK')) {
      const arch = { totalParamsB: total, activeParamsB: active, experts: spec.experts!, topK: spec.topK! };
      if (!(round2(deriveNonExpertGB(arch, baseFileGB(total))) > 0)) {
        out.activeParamsB = { code: 'active-too-small', min: minActiveParamsB(total, arch.experts, arch.topK) };
      }
    }
  }
  return out;
}

/**
 * 입력 → 엔진 입력 레코드. 문제가 있으면 첫 칸(MANUAL_NUMBER_FIELDS 순서)의 문제, 필수 값이 비면 incomplete.
 * - 가중치: 양자화 4종을 paramsB × bpw / 8 로 어림(실제 파일이 없다 — 카탈로그 대조 평균 2% 안팎, docs/01 F4)
 * - KV: 2 × (전체 어텐션 층 수 ?? 층 수) × KV 헤드 × 헤드 차원 × 2B. 전체 어텐션 층 수를 넣으면 attnType 'hybrid'(표시용 — 엔진은 KV 값만 쓴다)
 * - MoE: 비전문가 크기 = 기준(Q4_K_M) 행 크기로 bpw 균등 유도(derive.ts — 카탈로그 유도 경로와 같은 한계)
 * - 이름은 비워 둔다(화면이 messages 로 채운다). 라이선스 'unknown', 생각 모드는 체크했을 때만 'default-on'(존재 여부만 판정에 쓰인다)
 */
export function buildManualModel(spec: ManualSpec): ManualBuild {
  const issues = manualIssues(spec);
  const bad = MANUAL_NUMBER_FIELDS.find((f) => issues[f] !== undefined);
  if (bad) return { kind: 'invalid', field: bad, issue: issues[bad]! };
  const moe = isManualMoe(spec);
  const missing = [...MANUAL_REQUIRED, ...(moe ? MANUAL_MOE_FIELDS : [])].filter((f) => spec[f] === undefined);
  if (missing.length > 0) return { kind: 'incomplete', missing };

  const paramsB = spec.paramsB!;
  const { layers, kvHeads, headDim } = spec as Required<Pick<ManualSpec, 'layers' | 'kvHeads' | 'headDim'>>;
  const rows: ModelQuantCore[] = MANUAL_QUANTS.map((quant) => ({
    modelId: MANUAL_MODEL_ID,
    quant,
    fileGB: round2(weightsGBFromBpw(paramsB, quant)),
    ggufRepo: '',
  }));
  const kv = kvBytesPerToken({ layers: spec.fullAttnLayers ?? layers, kvHeads, headDim }, 'f16');
  const nonExpertGB = moe
    ? round2(
        deriveNonExpertGB(
          { totalParamsB: paramsB, activeParamsB: spec.activeParamsB!, experts: spec.experts!, topK: spec.topK! },
          baseFileGB(paramsB),
        ),
      )
    : undefined;
  /** 키 순서 = MODEL_CORE_KEYS (toCatalogLite·buildHfModel 결과와 같은 모양) */
  const model: ModelCore = {
    id: MANUAL_MODEL_ID,
    name: '',
    hfId: '',
    paramsB: round2(paramsB),
    ...(moe ? { activeParamsB: round2(spec.activeParamsB!) } : {}),
    arch: {
      layers,
      kvHeads,
      headDim,
      attnType: spec.fullAttnLayers !== undefined ? 'hybrid' : 'full',
      kvBytesPerTokenF16: kv,
      ...(moe ? { experts: spec.experts!, topK: spec.topK! } : {}),
    },
    maxContext: spec.maxContext ?? MANUAL_UNKNOWN_MAX_CONTEXT,
    license: 'unknown',
    moe,
    ...(nonExpertGB !== undefined ? { nonExpertGB } : {}),
    category: ['chat'],
    ...(spec.thinking ? { thinking: 'default-on' as const } : {}),
    korean: false,
    popularity: 1,
  };
  return { kind: 'ok', model, rows };
}
