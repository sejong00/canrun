/**
 * Hugging Face 모델 수집 — 순수 코어 (브라우저 진입점 `@canrun/data/hf`).
 *
 * 데이터 동기화 스크립트(`scripts/sync-models.ts`·`scripts/add-model.ts`)와 계산기의 "카탈로그 밖 모델을 HF id 로 확인"
 * 기능이 같은 코드를 쓴다: 구조 분류(classifyArch) · GGUF 파일 매칭(matchQuantFiles·quantRowsFrom) · GGUF 헤더 실측(./gguf).
 * `buildHfModel` 이 HF 응답(config·트리·모델 정보·기준 양자화 헤더 실측)을 엔진이 바로 쓰는 카탈로그 레코드
 * (ModelCore + ModelQuantCore[])로 조립한다 — assessCombo 등 조립 함수가 특별 취급 없이 받는다.
 *
 * 브라우저 안전: node API·zod 없음(스키마는 type-only), 모듈 최상위 부수효과 없음, 외부 의존성은 @canrun/engine 뿐 —
 * `test/client-entry.test.ts` 가 import 그래프로 강제한다. 계산기 메인 번들(`./client`)에는 넣지 않는다(dynamic import 전용).
 * 네트워크(HF API 트리·config·모델 정보 요청)는 호출자 몫 — 여기서는 GGUF 헤더 Range 읽기(./gguf)만 fetch 를 주입받아 한다.
 */

import type { ModelCore, ModelQuantCore } from './core';
import { deriveNonExpertGB } from './derive';
import type { ModelQuantRecord } from './schema';

export * from './gguf';

type QuantId = ModelQuantRecord['quant'];

const round2 = (x: number): number => Math.round(x * 100) / 100;
const hfUrl = (repo: string): string => `https://huggingface.co/${repo}`;
const posInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;

/** HF 트리 API(`/api/models/{repo}/tree/main?recursive=true`) 항목 */
export type TreeEntry = {
  type: string;
  path: string;
  size?: number;
};

// ---------------------------------------------------------------------------
// 입력 해석
// ---------------------------------------------------------------------------

const NAME = '[A-Za-z0-9][A-Za-z0-9._-]*';
const BARE_RE = new RegExp(`^(${NAME})/(${NAME})$`);
/** 호스트 형식 — 뒤에 Ollama 태그(`:Q4_K_M`) 또는 하위 경로·쿼리·해시(`/tree/main`, `/blob/main/x.gguf`, `?…`, `#…`) */
const URL_RE = new RegExp(
  `^(?:https?://)?(?:www\\.)?(?:huggingface\\.co|hf\\.co)/(${NAME})/(${NAME})(?::[A-Za-z0-9._-]+|[/?#].*)?$`,
  'i',
);
/** URL·호스트로 시작하면 호스트 형식만 허용 (`huggingface.co/org` 를 org/repo 로 오해하지 않게) */
const HOST_PREFIX = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:www\.)?(?:huggingface|hf)\.co(?:[/:?#]|$))/i;
/** 모델이 아닌 HF 경로의 첫 세그먼트 — 데이터셋·스페이스 URL 등 */
const RESERVED_OWNERS: ReadonlySet<string> = new Set([
  'datasets',
  'spaces',
  'models',
  'api',
  'docs',
  'blog',
  'collections',
  'papers',
  'organizations',
  'settings',
  'posts',
  'buckets',
]);

/**
 * 사용자 입력 → HF 모델 id(`org/repo`). 받는 형식: `org/repo` · `https://huggingface.co/org/repo[/tree/main|/blob/…|?…]`
 * · `huggingface.co/org/repo` · `hf.co/org/repo` · `hf.co/org/repo:Q4_K_M`(Ollama). 앞뒤 공백 무시.
 * 그 외(데이터셋·스페이스 URL, 다른 호스트, 세그먼트 하나뿐인 입력)는 undefined.
 */
export function parseHfInput(text: string): string | undefined {
  const s = text.trim();
  const m = URL_RE.exec(s) ?? (HOST_PREFIX.test(s) ? null : BARE_RE.exec(s));
  if (!m) return undefined;
  const [, owner = '', repo = ''] = m;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return undefined;
  return `${owner}/${repo}`;
}

// ---------------------------------------------------------------------------
// GGUF 파일 매칭 (scripts/sync-models.ts 에서 이동)
// ---------------------------------------------------------------------------

/**
 * tree 항목에서 quant 파일 매칭 — 경계 규칙으로 근접 오매칭 차단:
 * 앞 경계 ^|-|_|.|/ (IQ2_K 의 'I' 는 경계 아님 → Q2_K 미매칭),
 * 뒤 경계 -|.|/ 또는 끝 ('_' 제외 → Q4_K_M_L 미매칭). 대소문자 무시(mxfp4).
 * 비-UD quant 는 플레인 파일 우선, 플레인이 없으면 UD- 접두 변형(unsloth Dynamic)으로 폴백 —
 * 둘 다 배포하는 repo 의 합산 오염은 막고, UD 만 배포하는 repo(MTP 계열)는 실파일을 취한다.
 * 드래프트·보조 파일은 모델 가중치가 아니므로 제외 (basename 접두, 대소문자 무시):
 * mmproj-*(비전 프로젝터) · mtp-*(MTP 드래프트 헤드) · eagle3-*(EAGLE 드래프트) · dflash-*(DFlash 투기적 디코딩 드래프트 —
 * 10-20, ggml-org/Qwen3.6-27B-GGUF 의 dflash-Qwen3.6-27B-Q8_0.gguf 가 본 파일과 겹쳐 Q8_0 행을 못 골랐다 — D98·PROGRESS §5) — P1-2 에서
 * 드래프트 합산 버그(gemma-4 Q8_0 에 mtp 0.46GB 합산)를 고쳤다. repo 이름의 'MTP' 는 무관.
 */
const DRAFT_FILE_PREFIX = /^(?:mmproj|mtp-|eagle3-|dflash-)/i;

export function matchQuantFiles(entries: readonly TreeEntry[], quant: QuantId): TreeEntry[] {
  const esc = quant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[-_./])${esc}(?:[-./]|$)`, 'i');
  const udRe = quant.startsWith('UD-')
    ? undefined
    : new RegExp(`(?:^|[-_./])UD-${esc}(?:[-./]|$)`, 'i');
  const candidates = entries.filter((entry) => {
    if (entry.type !== 'file') return false;
    const path = entry.path;
    if (!path.toLowerCase().endsWith('.gguf')) return false;
    const base = path.split('/').at(-1) ?? path;
    if (DRAFT_FILE_PREFIX.test(base)) return false;
    return re.test(path);
  });
  if (udRe === undefined) return candidates;
  const plain = candidates.filter((entry) => !udRe.test(entry.path));
  return plain.length > 0 ? plain : candidates;
}

const SHARD_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;

export type PrimaryFile = { path: string; shards: number };

/**
 * 매칭 파일들 → 대표 실파일 (model-quants `fileName` 의 정본, docs/03 §5.1 ④).
 * 단일 파일이면 그것, 전부 `-0000N-of-0000M` 조각이고 M 이 같으며 개수 == M 이면 00001 조각.
 * 그 외(비-분할 2개 이상, 조각 누락·혼합)는 애매 → 호출자가 error 로 보고 (조용한 합산 금지).
 */
export function primaryFile(files: readonly TreeEntry[]): PrimaryFile | { error: string } {
  const names = files.map((f) => f.path);
  if (files.length === 1) return { path: names[0]!, shards: 1 };
  const parsed = names.map((path) => {
    const m = SHARD_RE.exec(path);
    return m ? { path, index: Number(m[1]), total: Number(m[2]) } : undefined;
  });
  const totals = new Set(parsed.map((p) => p?.total));
  const consistent =
    parsed.every((p) => p !== undefined) && totals.size === 1 && files.length === [...totals][0];
  if (!consistent) return { error: `ambiguous match: ${names.join(', ')}` };
  const first = parsed.find((p) => p?.index === 1);
  if (!first) return { error: `shard 00001 missing: ${names.join(', ')}` };
  return { path: first.path, shards: files.length };
}

/** 분할 파일 합산 → decimal GB 2자리. size 누락 항목이 있으면 NaN. */
export function sumFileGB(entries: readonly TreeEntry[]): number {
  let bytes = 0;
  for (const entry of entries) {
    if (entry.size === undefined) return Number.NaN;
    bytes += entry.size;
  }
  return round2(bytes / 1e9);
}

// ---------------------------------------------------------------------------
// config.json 해석 (scripts/sync-models.ts 에서 이동)
// ---------------------------------------------------------------------------

export type ExtractedArch = {
  arch?: { layers: number; kvHeads: number; headDim: number };
  maxContext?: number;
  missing: string[];
};

/** 멀티모달 래퍼는 text_config 우선 */
function textConfig(config: object): Record<string, unknown> {
  const top = config as Record<string, unknown>;
  const nested = top['text_config'];
  return typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : top;
}

/**
 * config.json → arch 추출. 멀티모달 래퍼는 text_config 우선.
 * head_dim 폴백 = hidden_size / num_attention_heads, kvHeads 폴백 = num_attention_heads(MHA).
 * 추출 불가 필드는 missing 으로 보고 — 추측 금지(CLAUDE.md 규칙 3).
 */
export function extractArch(config: unknown): ExtractedArch {
  if (typeof config !== 'object' || config === null) {
    return { missing: ['config'] };
  }
  const top = config as Record<string, unknown>;
  const cfg = textConfig(config);

  const layers = posInt(cfg['num_hidden_layers']);
  const attnHeads = posInt(cfg['num_attention_heads']);
  const kvHeads = posInt(cfg['num_key_value_heads']) ?? attnHeads;
  const hiddenSize = posInt(cfg['hidden_size']);
  let headDim = posInt(cfg['head_dim']);
  if (headDim === undefined && hiddenSize !== undefined && attnHeads !== undefined) {
    const derived = hiddenSize / attnHeads;
    if (Number.isInteger(derived) && derived > 0) headDim = derived;
  }
  const maxContext = posInt(cfg['max_position_embeddings'] ?? top['max_position_embeddings']);

  const missing: string[] = [];
  if (layers === undefined) missing.push('num_hidden_layers');
  if (kvHeads === undefined) missing.push('num_key_value_heads');
  if (headDim === undefined) missing.push('head_dim');

  if (layers === undefined || kvHeads === undefined || headDim === undefined) {
    return { maxContext, missing };
  }
  return { arch: { layers, kvHeads, headDim }, maxContext, missing };
}

/**
 * config.json → MoE 구조 (라우팅 전문가 수 · 토큰당 활성 수). 모델마다 키 이름이 달라 알려진 별칭을 순서대로 본다:
 * experts = num_experts(Qwen·Gemma 4) · num_local_experts(gpt-oss·kanana) · n_routed_experts(Solar Open),
 * topK = num_experts_per_tok · top_k_experts(Gemma 4) · experts_per_token(gpt-oss). 하나라도 없으면 undefined(추측 금지).
 */
export function extractMoe(config: unknown): { experts: number; topK: number } | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const cfg = textConfig(config);
  const experts = posInt(cfg['num_experts'] ?? cfg['num_local_experts'] ?? cfg['n_routed_experts']);
  const topK = posInt(cfg['num_experts_per_tok'] ?? cfg['top_k_experts'] ?? cfg['experts_per_token']);
  return experts !== undefined && topK !== undefined ? { experts, topK } : undefined;
}

// ---------------------------------------------------------------------------
// 구조 분류·이름·라이선스 (scripts/add-model.ts 에서 이동)
// ---------------------------------------------------------------------------

/**
 * 선례가 있는 텍스트 model_type (09-30 카탈로그 config 에서 수집). 여기 없는 구조는 자동 추가하지 않는다.
 * gpt_oss(MXFP4 네이티브 — 기준 양자화가 다름)·solar_open2(하이브리드 특수)는 의도적으로 제외.
 * 10-03 D63: spark2_5·laguna(SWA 선례) · nemotron_h(Mamba2 하이브리드) · lfm2(short-conv 하이브리드) ·
 * bailing_hybrid(KDA + MLA — BailingMoeV3 만) — 셋은 아래 전용 분기가 층 지도를 얻을 때만 통과한다.
 * 10-20: muse_glimmer_text(Meta Muse Glimmer — layer_types 3:1 SWA, 비전은 mmproj 별도. model_type 은 text_config 값,
 * llama.cpp https://github.com/ggml-org/llama.cpp/pull/26841) · mellum(JetBrains Mellum2·2.1 — SWA 3:1 + MoE, 전 층 MoE 만,
 * https://github.com/ggml-org/llama.cpp/pull/23966) · kolibri1(Aleph Alpha Kolibri-1 — SWA 4:1 + MoE,
 * https://github.com/ggml-org/llama.cpp/pull/30673) — 셋 다 기존 슬라이딩 윈도 경로(Laguna·Spark 선례).
 */
export const KNOWN_MODEL_TYPES: ReadonlySet<string> = new Set([
  'llama',
  'mistral',
  'mixtral',
  'qwen2',
  'qwen3',
  'qwen3_moe',
  'qwen3_5_text',
  'qwen3_5_moe_text',
  'gemma3_text',
  'gemma4_text',
  'gemma4_unified_text',
  'phi3',
  'granite',
  'exaone4',
  'exaone4_5_text',
  'hyperclovax',
  'solar_open',
  'spark2_5',
  'laguna',
  'nemotron_h',
  'lfm2',
  'bailing_hybrid',
  'muse_glimmer_text',
  'mellum',
  'kolibri1',
]);

/**
 * 상수 상태 층 하이브리드의 전용 분기 (D63). config 의 구조 키는 자기 분기 안에서만 허용한다 — 다른 model_type 에
 * 같은 키가 있으면 여전히 unsupported(층 지도가 없으면 KV 를 셀 수 없다).
 */
type StateBranch = 'mamba' | 'conv' | 'mla';
/** 이 키가 config 에 있으면 해당 분기에서만 계산한다 — 그 밖에서는 엔진이 모델링하지 않는 구조 */
const BRANCH_KEYS: Readonly<Record<string, StateBranch>> = {
  ssm_state_size: 'mamba',
  mamba_num_heads: 'mamba',
  hybrid_override_pattern: 'mamba',
  conv_L_cache: 'conv',
  kv_lora_rank: 'mla',
};
/** 늘 거부 — 압축 어텐션(DeepSeek V4 의 층별 압축 비율) */
const ALWAYS_UNSUPPORTED_KEYS = ['compress_ratios'];
const KNOWN_LAYER_TYPES: ReadonlySet<string> = new Set(['full_attention', 'sliding_attention', 'linear_attention']);
/** 상수 상태 층(선형 어텐션·short-conv) — KV 가 없고 상태 크기가 컨텍스트와 무관하다 */
const STATE_LAYER_TYPES: ReadonlySet<string> = new Set(['linear_attention', 'conv']);

/** KV 계상 근거 — attnOverrides.sources 에 config 와 함께 남긴다 (llama.cpp 가 실제로 KV 를 두는 층) */
const LLAMA_CPP_SRC = 'https://github.com/ggml-org/llama.cpp/blob/master';
const KV_REFS: Readonly<Record<StateBranch, readonly string[]>> = {
  // NEMOTRON_H(_MOE) 전용 필터 `!is_recr(il) && n_ff(il) == 0` — Mamba·MoE 전용 블록 제외, 어텐션 블록만
  mamba: [`${LLAMA_CPP_SRC}/src/llama-model.cpp`],
  // 기본 하이브리드 필터 `!is_recr(il)` — conv 층은 순환(상태) 층
  conv: [`${LLAMA_CPP_SRC}/src/llama-memory-hybrid.cpp`],
  // MLA 층 = 변환기 is_full_attention(nextn 층 포함), V 캐시 없음(`has_v = !is_mla`), BAILINGMOE3 는 nextn 층 필터 없음
  mla: [`${LLAMA_CPP_SRC}/conversion/bailingmoe3.py`, `${LLAMA_CPP_SRC}/src/llama-kv-cache.cpp`, `${LLAMA_CPP_SRC}/src/llama-model.cpp`],
};

export type ArchResult =
  | {
      kind: 'ok';
      modelType: string;
      attnType: 'full' | 'swa' | 'hybrid';
      arch: { layers: number; kvHeads: number; headDim: number; kvBytesPerTokenF16: number };
      /** swa·hybrid — 전체 어텐션 층만 KV (선례와 같은 산식). refs = 산식 근거(llama.cpp 소스) — attnOverrides.sources 에 덧붙인다 */
      override?: { kvBytesPerTokenF16: number; reason: string; refs?: readonly string[] };
      maxContext: number;
      moe?: { experts: number; topK: number };
      /**
       * MoE 인데 라우팅 전문가가 일부 층에만 있을 때 그 층 번호(0부터, 트렁크만) — Mamba·어텐션 블록 사이에 섞인 MoE 블록(nemotron_h),
       * 앞쪽 dense 층(bailing_hybrid first_k_dense_replace). `--n-cpu-moe N` 이 "앞 N 층"이라 엔진 근사(전문가 균등 분포)와 어긋나는 것을 막는다
       */
      expertLayers?: number[];
      vision: boolean;
    }
  | { kind: 'unsupported'; reason: string };

/** Mamba 하이브리드 층 지도 → 블록 종류(attention·mamba·moe·mlp). 구형 hybrid_override_pattern 문자열('*' 어텐션·'M' Mamba2·'E' MoE·'-' MLP) 도 받는다 */
function mambaBlocks(cfg: Record<string, unknown>): string[] | undefined {
  const list = cfg['layers_block_type'];
  if (Array.isArray(list)) {
    const names: Record<string, string> = { attention: 'attention', full_attention: 'attention', mamba: 'mamba', moe: 'moe', mlp: 'mlp' };
    const out = list.map((v) => names[String(v)]);
    return out.every((v): v is string => v !== undefined) ? out : undefined;
  }
  const pattern = cfg['hybrid_override_pattern'];
  if (typeof pattern === 'string' && pattern.length > 0) {
    const chars: Record<string, string> = { '*': 'attention', M: 'mamba', E: 'moe', '-': 'mlp' };
    const out = [...pattern].map((c) => chars[c]);
    return out.every((v): v is string => v !== undefined) ? out : undefined;
  }
  return undefined;
}

/**
 * BailingMoeV3(Ling-3.0) MLA 층 번호 — llama.cpp 변환기 `is_full_attention` 과 같은 규칙(GGUF `head_count_kv` 가 1 인 층):
 * (bid + 1) % g == 0 · 마지막 묶음의 나머지 층(bid ≥ ⌊L/g⌋·g) · nextn(MTP) 층(bid ≥ L). 나머지는 KDA 층.
 * 출처: https://github.com/ggml-org/llama.cpp/blob/master/conversion/bailingmoe3.py
 */
export function bailingMlaLayers(layers: number, groupSize: number, nextn: number): number[] {
  const lastGroup = Math.floor(layers / groupSize) * groupSize;
  return Array.from({ length: layers + nextn }, (_, bid) => bid).filter(
    (bid) => bid >= layers || (bid + 1) % groupSize === 0 || bid >= lastGroup,
  );
}

/**
 * config.json → 엔진이 모델링하는 구조인지 분류 — **선례가 있는 구조만**(PROGRESS §4 D53, D63 개정): 전체 어텐션 ·
 * 슬라이딩 윈도(layer_types) · 하이브리드 선형(layer_types) · 상수 상태 층 하이브리드(Mamba2·short-conv·KDA+MLA — 전용 분기, D63).
 * 처음 보는 model_type, 반복 층·디스크 임베딩(n-gram·PLE)·KV 공유 층·압축 어텐션, 층 지도가 없는 MLA·Mamba·conv 는 unsupported.
 */
export function classifyArch(config: unknown): ArchResult {
  if (typeof config !== 'object' || config === null) return { kind: 'unsupported', reason: 'config 없음' };
  const top = config as Record<string, unknown>;
  const cfg = textConfig(config);
  const has = (key: string): boolean => key in cfg || key in top;
  // 화이트리스트와 무관하게 먼저 막는다(D63): 반복 층은 토큰마다 같은 층을 N번 지나 가중치 읽기·KV 가 N배(Nanbeige num_loops·Ouro total_ut_steps),
  // n-gram·PLE 임베딩 표는 llama.cpp 가 디스크에서 행만 읽어(TENSOR_READ_LAZY) 파일 크기로 메모리를 셀 수 없다(Qwen3.8-Flash-Next)
  const loops = Math.max(posInt(cfg['num_loops']) ?? 1, posInt(cfg['total_ut_steps']) ?? 1);
  if (loops > 1) return { kind: 'unsupported', reason: `반복 층 — 토큰마다 같은 층을 ${loops}번 지남(가중치 읽기·KV 가 ${loops}배)` };
  if (has('ngram_vocab_size_base') || has('ple_layer_ids')) return { kind: 'unsupported', reason: '디스크에서 읽는 n-gram 임베딩 표 — 파일 크기로 메모리를 셀 수 없음' };
  // Gemma 4 E 계열(10-16 D98): 층별 임베딩 표(PLE, hidden_size_per_layer_input > 0)는 입력층이라 그래픽카드에 올라가지 않는데
  // Q4_K_M 파일의 43~56% 라 헤더 실측 offGpuGB 가 검증 상한(MAX_OFF_GPU_FRACTION 25%)에 걸려 파일 전체가 그래픽카드 몫이 된다
  // (4GiB 를 넘는 표는 디스크에서 행만 읽는다 — TENSOR_READ_LAZY). 뒤쪽 num_kv_shared_layers 층은 앞 층의 KV 를 다시 써
  // (n_layer_kv_from_start = 층 수 − 공유 층) 전체 어텐션 층으로 센 KV 가 1.75~2.3배. 큰 Gemma 4 는 두 값이 0 이라 그대로 통과한다
  // 출처: https://github.com/ggml-org/llama.cpp/blob/b6334e37e6ef286fc5091a41b6561b2113d915fb/src/models/gemma4.cpp#L9-L11 · #L59
  if (posInt(cfg['hidden_size_per_layer_input']) !== undefined) return { kind: 'unsupported', reason: '층별 임베딩 표(PLE) — 그래픽카드 밖 몫이 파일의 25% 를 넘어 지금 산식으로는 메모리를 셀 수 없음' };
  const sharedKv = posInt(cfg['num_kv_shared_layers']);
  if (sharedKv !== undefined) return { kind: 'unsupported', reason: `KV 공유 층 ${sharedKv}개(num_kv_shared_layers) — 층마다 KV 를 두는 산식으로는 과대` };
  const modelType = String(cfg['model_type'] ?? top['model_type'] ?? '');
  if (!KNOWN_MODEL_TYPES.has(modelType)) return { kind: 'unsupported', reason: `처음 보는 구조 model_type=${modelType || '(없음)'} — 선례 없음, 수동 검토` };
  for (const key of ALWAYS_UNSUPPORTED_KEYS) {
    if (has(key)) return { kind: 'unsupported', reason: `엔진이 모델링하지 않는 구조 (${key})` };
  }
  const archs = [cfg['architectures'], top['architectures']].flatMap((a) => (Array.isArray(a) ? a.map(String) : []));
  let branch: StateBranch | undefined;
  if (modelType === 'nemotron_h') branch = 'mamba';
  else if (modelType === 'lfm2') {
    // 같은 model_type 의 임베딩·인코더 변형(Lfm2Model·Lfm2Bidirectional…)은 채팅 모델이 아니다 — llama.cpp 변환기가 CausalLM 으로 받는 것만
    if (!archs.some((a) => a === 'Lfm2ForCausalLM' || a === 'LFM2ForCausalLM')) return { kind: 'unsupported', reason: `lfm2 변형(${archs.join(',') || 'architectures 없음'}) — 채팅(CausalLM) 모델만` };
    branch = 'conv';
  } else if (modelType === 'bailing_hybrid') {
    // llama.cpp bailingmoe3 변환기는 BailingMoeV3 만 받고 KDA LoRA·비안전 게이트·헤드 단위가 아닌 게이트는 거부한다(Ling/Ring-2.5 = V2_5 미지원)
    const v3 =
      archs.includes('BailingMoeV3ForCausalLM') &&
      cfg['no_kda_lora'] === true &&
      cfg['kda_safe_gate'] === true &&
      cfg['gated_attention_proj_granularity_type'] === 'head_wise';
    if (!v3) return { kind: 'unsupported', reason: `llama.cpp 가 변환하지 않는 bailing_hybrid 변형(${archs.join(',') || 'architectures 없음'})` };
    branch = 'mla';
  } else if (modelType === 'mellum') {
    // llama.cpp mellum 은 모든 블록을 MoE 로 읽고(load_block — dense FFN 경로 없음) 변환기는 MellumForCausalLM 만 받는다 —
    // dense 층이 섞인 변형·다른 클래스는 변환·로드되지 않는다 (10-20)
    // 출처: https://github.com/ggml-org/llama.cpp/blob/master/src/models/mellum.cpp · https://github.com/ggml-org/llama.cpp/blob/master/conversion/mellum.py
    const mlp = cfg['mlp_layer_types'];
    if (!archs.includes('MellumForCausalLM')) return { kind: 'unsupported', reason: `llama.cpp 가 읽지 않는 mellum 변형(${archs.join(',') || 'architectures 없음'})` };
    if (Array.isArray(mlp) && mlp.some((t) => t !== 'sparse')) return { kind: 'unsupported', reason: 'llama.cpp 가 읽지 않는 mellum 변형(dense 층 포함 — mlp_layer_types)' };
  }
  for (const [key, need] of Object.entries(BRANCH_KEYS)) {
    if (has(key) && need !== branch) return { kind: 'unsupported', reason: `엔진이 모델링하지 않는 구조 (${key})` };
  }
  const layers = posInt(cfg['num_hidden_layers']);
  const heads = posInt(cfg['num_attention_heads']);
  const kvHeads = posInt(cfg['num_key_value_heads']) ?? heads;
  const hidden = posInt(cfg['hidden_size']);
  const headDim = posInt(cfg['head_dim']) ?? (hidden && heads && Number.isInteger(hidden / heads) ? hidden / heads : undefined);
  const maxContext = posInt(cfg['max_position_embeddings'] ?? top['max_position_embeddings']);
  if (!layers || !kvHeads || !headDim || !maxContext) return { kind: 'unsupported', reason: 'config 필드 누락(layers·kv heads·head_dim·max_position_embeddings)' };

  const moe = extractMoe(config);
  const vision = 'vision_config' in top;
  const full = layers * kvHeads * headDim * 4;
  const base = { kind: 'ok' as const, modelType, vision, maxContext, ...(moe ? { moe } : {}) };

  if (branch === 'mamba') {
    // Nemotron-H: KV 는 어텐션 블록만, Mamba2 상태는 컨텍스트와 무관한 고정 크기(Qwen3.5 선형 상태처럼 미계상 — docs/02 §2.2)
    const blocks = mambaBlocks(cfg);
    if (!blocks || blocks.length !== layers) return { kind: 'unsupported', reason: `Mamba 하이브리드 층 지도(layers_block_type) 없음·길이 불일치 — KV 를 셀 수 없음` };
    const nAttn = blocks.filter((b) => b === 'attention').length;
    if (nAttn === 0) return { kind: 'unsupported', reason: '어텐션 블록 없음(순수 Mamba) — 선례 없음' };
    const expertIdx = blocks.flatMap((b, i) => (b === 'moe' ? [i] : []));
    if ((moe !== undefined) !== (expertIdx.length > 0)) return { kind: 'unsupported', reason: 'MoE 설정과 층 지도의 MoE 블록이 서로 맞지 않음' };
    const kv = nAttn * kvHeads * headDim * 4;
    return {
      ...base, attnType: 'hybrid',
      arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: kv },
      override: { kvBytesPerTokenF16: kv, reason: `hybrid mamba — attention ${nAttn}/${layers} blocks, KV 는 어텐션 블록만(Mamba2 상태는 고정 크기라 미계상) (add-model)`, refs: KV_REFS.mamba },
      ...(expertIdx.length > 0 && expertIdx.length < layers ? { expertLayers: expertIdx } : {}),
    };
  }
  if (branch === 'mla') {
    // Ling-3.0(BailingMoeV3): KDA 층 + MLA 층. MLA 층 = 변환기 is_full_attention — (bid+1) % g == 0, 마지막 묶음의 나머지 층,
    // nextn(MTP) 층(bid ≥ L). llama.cpp 는 MLA 잠재 K(kv_lora_rank + rope)만 캐시하고 V 는 두지 않는다 → 층당 (rank + rope) × 2B(f16)
    const g = posInt(cfg['layer_group_size']);
    const rank = posInt(cfg['kv_lora_rank']);
    const rope = posInt(cfg['qk_rope_head_dim']);
    const nextnRaw = cfg['num_nextn_predict_layers'];
    const nextn = nextnRaw === undefined || nextnRaw === null ? 0 : typeof nextnRaw === 'number' && Number.isInteger(nextnRaw) && nextnRaw >= 0 ? nextnRaw : undefined;
    if (!g || !rank || !rope || nextn === undefined) return { kind: 'unsupported', reason: 'MLA 층 지도 필드 누락(layer_group_size·kv_lora_rank·qk_rope_head_dim)' };
    const blockCount = layers + nextn;
    const mla = bailingMlaLayers(layers, g, nextn);
    const kv = mla.length * (rank + rope) * 2;
    const dense = posInt(cfg['first_k_dense_replace']);
    const mtp = nextn > 0 ? `, MTP 층 포함(llama.cpp bailingmoe3 는 nextn 층에도 KV)` : '';
    return {
      ...base, attnType: 'hybrid',
      arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: kv },
      override: {
        kvBytesPerTokenF16: kv,
        reason: `hybrid KDA+MLA — MLA ${mla.length}/${blockCount} layers${mtp} × (kv_lora_rank ${rank} + rope ${rope}) × 2B, V 캐시 없음(KDA 상태는 고정 크기라 미계상) (add-model)`,
        refs: KV_REFS.mla,
      },
      ...(moe && dense !== undefined && dense < layers ? { expertLayers: Array.from({ length: layers - dense }, (_, i) => dense + i) } : {}),
    };
  }

  const known = (t: string): boolean => KNOWN_LAYER_TYPES.has(t) || (branch === 'conv' && t === 'conv');
  const layerTypes = Array.isArray(cfg['layer_types']) ? (cfg['layer_types'] as unknown[]).map(String) : undefined;
  if (layerTypes && layerTypes.some((t) => !known(t))) {
    return { kind: 'unsupported', reason: `처음 보는 층 종류 ${[...new Set(layerTypes)].filter((t) => !known(t)).join(',')}` };
  }
  if (branch === 'conv' && !layerTypes) return { kind: 'unsupported', reason: 'conv 하이브리드 층 지도(layer_types) 없음 — KV 를 셀 수 없음' };
  const nFull = layerTypes?.filter((t) => t === 'full_attention').length;
  const hasSliding = layerTypes?.includes('sliding_attention') ?? false;
  const hasLinear = layerTypes?.some((t) => STATE_LAYER_TYPES.has(t)) ?? false;

  if (hasSliding && hasLinear) return { kind: 'unsupported', reason: '슬라이딩 + 선형 혼합 — 선례 없음' };
  if (hasSliding && nFull !== undefined) {
    const gKv = posInt(cfg['num_global_key_value_heads']) ?? kvHeads;
    const gDim = posInt(cfg['global_head_dim']) ?? headDim;
    const kv = nFull * gKv * gDim * 4;
    const global = gKv !== kvHeads || gDim !== headDim ? ` × global kv ${gKv} × head_dim ${gDim}` : '';
    return {
      kind: 'ok', modelType, attnType: 'swa', vision, maxContext, ...(moe ? { moe } : {}),
      arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: kv },
      override: { kvBytesPerTokenF16: kv, reason: `swa — full attn ${nFull}/${layers} layers${global}, sliding win${String(cfg['sliding_window'] ?? '?')} 는 평탄 근사로 제외 (add-model)` },
    };
  }
  if (hasLinear && nFull !== undefined) {
    if (nFull === 0) return { kind: 'unsupported', reason: '전체 어텐션 층 없음 — 선례 없음' };
    const kv = nFull * kvHeads * headDim * 4;
    // short-conv(LFM2) 상태 = n_embd × (L_cache − 1) 고정 크기 — 선형 어텐션 상태처럼 미계상 (D63)
    const reason =
      branch === 'conv'
        ? `hybrid conv — full attn ${nFull}/${layers} layers, KV 는 full 레이어만(short-conv 상태는 고정 크기라 미계상) (add-model)`
        : `hybrid linear — full attn ${nFull}/${layers} layers, KV 는 full 레이어만 계상 (add-model)`;
    return {
      kind: 'ok', modelType, attnType: 'hybrid', vision, maxContext, ...(moe ? { moe } : {}),
      arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: kv },
      override: { kvBytesPerTokenF16: kv, reason, ...(branch === 'conv' ? { refs: KV_REFS.conv } : {}) },
    };
  }
  // conv 분기인데 conv 층이 없다(전부 full 등) — lfm2 로는 선례 없음
  if (branch === 'conv') return { kind: 'unsupported', reason: 'conv 층 없는 lfm2 — 선례 없음' };
  // layer_types 가 없고 sliding_window_pattern(N 층마다 1층 전역 — Gemma 3 구형 config)만 있으면 전역 층 = floor(layers / N).
  // 카탈로그 gemma-3-12b(48층 → 8 × 8 × 256 × 4 = 65,536)·27b(62층 → 10 × 16 × 128 × 4 = 81,920) 기록과 같은 산식 (10-01)
  const sw = posInt(cfg['sliding_window']);
  const pattern = posInt(cfg['sliding_window_pattern']);
  if (!layerTypes && sw !== undefined && pattern !== undefined && pattern >= 2 && sw < maxContext) {
    const nGlobal = Math.floor(layers / pattern);
    const kv = nGlobal * kvHeads * headDim * 4;
    return {
      kind: 'ok', modelType, attnType: 'swa', vision, maxContext, ...(moe ? { moe } : {}),
      arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: kv },
      override: { kvBytesPerTokenF16: kv, reason: `swa ${pattern - 1}:1 (sliding_window_pattern) — full attn ${nGlobal}/${layers} layers, sliding win${sw} 는 평탄 근사로 제외` },
    };
  }
  // 그 밖에 layer_types 가 없거나 전부 full. 모든 층 슬라이딩(use_sliding_window 켜짐)은 선례 없음
  if (!layerTypes && sw !== undefined && cfg['use_sliding_window'] !== false && sw < maxContext) {
    return { kind: 'unsupported', reason: `전 층 슬라이딩 윈도(${sw}) — 선례 없음` };
  }
  return { kind: 'ok', modelType, attnType: 'full', vision, maxContext, ...(moe ? { moe } : {}), arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: full } };
}

const DROP_SUFFIX = /[-_](?:instruct|it|chat|hf)$/i;

/** `google/gemma-4-31B-it` → `gemma-4-31b` */
export function slugFromHfId(hfId: string): string {
  let base = hfId.split('/').pop() ?? hfId;
  while (DROP_SUFFIX.test(base)) base = base.replace(DROP_SUFFIX, '');
  return base.toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9.-]/g, '');
}

/** `meta-llama/Llama-3.2-3B-Instruct` → `Llama 3.2 3B`, `ibm-granite/granite-4.2-30b` → `Granite 4.2 30B` */
export function displayName(hfId: string): string {
  let base = hfId.split('/').pop() ?? hfId;
  while (DROP_SUFFIX.test(base)) base = base.replace(DROP_SUFFIX, '');
  return base
    .split(/[-_]/)
    .map((w) => (/^\d+(?:\.\d+)?b$/i.test(w) ? w.toUpperCase() : /^[a-z]/.test(w) ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/ (A\d+(?:\.\d+)?B)\b/, '-$1'); // 35B A3B → 35B-A3B
}

export const familyOf = (name: string): string => (name.split(' ')[0] ?? name).toLowerCase().replace(/[^a-z]/g, '') || 'other';

/**
 * HF 라이선스 id(카드 `license`, 또는 `license: other` 일 때의 `license_name`) → 카탈로그 문자열(license.ts 배지 맵과 같은 표기).
 * openmdw-1.1 은 두 자리 모두에 나온다(Laguna = license, Nemotron = other + license_name), lfm1.0 은 license_name 으로만(LFM2.5)
 */
const LICENSE_MAP: Readonly<Record<string, string>> = {
  'apache-2.0': 'Apache-2.0',
  mit: 'MIT',
  llama3: 'Llama 3',
  'llama3.1': 'Llama 3.1',
  'llama3.2': 'Llama 3.2',
  'llama3.3': 'Llama 3.3',
  gemma: 'Gemma',
  'openmdw-1.1': 'OpenMDW-1.1',
  'lfm1.0': 'LFM Open License 1.0',
};

/**
 * HF 카드 라이선스 → 카탈로그 문자열. `license: other` 면 `license_name`(10-03)을 본다.
 * 모르면 원문 그대로(`other` 는 license_name 원문) — 배지 테스트가 잡아 사람이 맵에 추가
 */
export function mapLicense(hf: string | undefined, licenseName?: string): string {
  if (!hf) return 'unknown';
  const id = hf.toLowerCase() === 'other' && licenseName ? licenseName : hf;
  return LICENSE_MAP[id.toLowerCase()] ?? id;
}

/** 30일 다운로드 → 인기도 1~5 (09-30 카탈로그 분포에 맞춘 기준) */
export function popularityFrom(downloads: number | undefined): number {
  const d = downloads ?? 0;
  return d >= 5_000_000 ? 5 : d >= 1_000_000 ? 4 : d >= 200_000 ? 3 : d >= 30_000 ? 2 : 1;
}

/** 이름의 활성 파라미터 표기(`35B-A3B`) → 3 */
export const activeFromName = (hfId: string): number | undefined => {
  const m = /(?:^|[-_])A(\d+(?:\.\d+)?)B(?:[-_]|$)/i.exec(hfId.split('/').pop() ?? '');
  return m ? Number(m[1]) : undefined;
};

const OWNER_ORDER = ['ggml-org', 'bartowski', 'unsloth', 'lmstudio-community'];

/**
 * GGUF 후보 repo 정렬 — 같은 모델의 변환본만(파인튠·abliterated 제외): basename 이 `<base>-GGUF`·`<owner>_<base>-GGUF`·`<base>-MTP-GGUF`.
 * 순서: 원 저장소 소유자(공식) → ggml-org → bartowski → unsloth → lmstudio-community.
 */
export function rankGgufRepos(candidates: readonly string[], hfId: string): string[] {
  const [owner = '', base = ''] = hfId.split('/');
  const b = base.toLowerCase();
  const same = (repo: string): boolean => {
    let name = (repo.split('/').pop() ?? '').toLowerCase().replace(/-gguf$/, '').replace(/-mtp$/, '');
    if (name.startsWith(`${owner.toLowerCase()}_`)) name = name.slice(owner.length + 1);
    return name === b;
  };
  const rank = (repo: string): number => {
    const o = repo.split('/')[0] ?? '';
    if (o === owner) return 0;
    const i = OWNER_ORDER.indexOf(o);
    return i < 0 ? 99 : i + 1;
  };
  return candidates.filter(same).filter((r) => rank(r) < 99).sort((a, c) => rank(a) - rank(c));
}

/** repo 트리 → 표준 양자화 행 (Q4_K_M 필수 — 없으면 빈 배열, 있으면 첫 행). Q2_K 가 없고 UD-Q2_K_XL 만 있으면 그걸 쓴다 */
export function quantRowsFrom(tree: readonly TreeEntry[], repo: string, modelId: string): ModelQuantRecord[] {
  const rows: ModelQuantRecord[] = [];
  const add = (quant: QuantId): boolean => {
    const files = matchQuantFiles(tree, quant);
    if (files.length === 0) return false;
    const primary = primaryFile(files);
    const gb = sumFileGB(files);
    if ('error' in primary || !Number.isFinite(gb)) return false;
    rows.push({ modelId, quant, fileGB: gb, ggufRepo: repo, fileName: primary.path, sources: [hfUrl(repo)] });
    return true;
  };
  if (!add('Q4_K_M')) return [];
  add('IQ4_XS');
  add('Q8_0');
  if (!add('Q2_K')) add('UD-Q2_K_XL');
  return rows;
}

// ---------------------------------------------------------------------------
// 조립 — HF 데이터 → 엔진 입력 레코드
// ---------------------------------------------------------------------------

/** 카탈로그 밖 모델 id 접두 — 카탈로그 id(slug)는 이 접두를 쓰지 않으므로 충돌하지 않는다 */
export const HF_MODEL_ID_PREFIX = 'hf-';

export type HfModelInput = {
  /** 원본 모델 id (`org/repo`) — 이름·id·활성 파라미터(이름 표기) 유도에 쓴다 */
  hfId: string;
  /** GGUF 저장소 (`tree` 의 출처) */
  ggufRepo: string;
  /** 원본 config.json (파싱된 JSON) */
  config: unknown;
  /** GGUF 저장소 트리 */
  tree: readonly TreeEntry[];
  info?: {
    /** HF cardData.license */
    license?: string;
    /** HF cardData.license_name — license 가 `other` 일 때 (10-03) */
    licenseName?: string;
    /** safetensors.total / 1e9 */
    paramsB?: number;
  };
  /**
   * 기준(Q4_K_M) 파일 헤더 실측 (`measureSplit` 결과에서). 크기는 MoE 에서만 쓴다.
   * totalParamsB·expertParamsB = `totalParams / 1e9`·`expertParams / 1e9` — paramsB·activeParamsB 대용.
   */
  baseSplit?: { expertGB: number; nonExpertGB: number; totalParamsB?: number; expertParamsB?: number };
};

/**
 * 근사 표식 (UI 가 "추정" 안내를 붙인다):
 * - params-from-header: 파라미터 수를 safetensors 대신 GGUF 헤더 텐서 원소 수로
 * - active-from-name: MoE 활성 파라미터를 이름 표기(A3B)에서 — 반올림된 값
 * - active-from-header: MoE 활성 파라미터를 헤더(전문가 원소 수 × topK/experts)로 계산
 * - nonexpert-derived: 비전문가 크기를 실측 없이 bpw 균등 유도 (derive.ts — 과소 추정 경향)
 * - split-ignored: 헤더 실측 합이 기준 파일 크기를 넘어 쓰지 않음(다른 파일을 쟀을 수 있음)
 * - kv-full-layers-only: swa·hybrid — KV 를 전체 어텐션 층만 계상(슬라이딩 창·선형 상태는 제외)
 */
export type HfModelNote =
  | 'params-from-header'
  | 'active-from-name'
  | 'active-from-header'
  | 'nonexpert-derived'
  | 'split-ignored'
  | 'kv-full-layers-only';

export type HfModelResult =
  | { kind: 'ok'; model: ModelCore; rows: ModelQuantCore[]; notes: HfModelNote[] }
  | { kind: 'unsupported' | 'no-gguf' | 'no-params'; reason: string };

/** validateAll 의 반올림 허용치와 같다 — 실측 합이 파일보다 이만큼 넘으면 다른 파일을 잰 것 */
const SPLIT_TOLERANCE_GB = 0.02;

/**
 * HF 데이터 → 엔진 입력 레코드 (ModelCore + ModelQuantCore[]). 순수 — 네트워크는 호출자가 끝낸 뒤 부른다.
 * 결과 모델은 `{ ...catalog, modelQuants: [...catalog.modelQuants, ...rows] }` 와 함께 assessCombo 에 그대로 넣는다.
 *
 * - classifyArch 가 unsupported 면 그 사유 그대로. Q4_K_M GGUF 가 없으면 no-gguf.
 * - paramsB = info.paramsB → baseSplit.totalParamsB, 둘 다 없으면 no-params.
 * - MoE: activeParamsB = 이름 표기(A3B) → 헤더(total − expert + expert × topK/experts), 없으면 no-params.
 *   모델 nonExpertGB = 헤더 실측 → derive 유도. 기준 행(Q4_K_M)에 실측 expertGB·nonExpertGB.
 * - 그래픽카드에 안 올리는 몫(입력 임베딩·MTP)은 빼지 않는다 — 파일 전체로 판정(카탈로그 행만 헤더 실측 offGpuGB, D62).
 *   dense 는 헤더를 새로 읽지 않고, MoE 기준 행은 offGpuGB 0 으로 분할 유도를 막는다(다른 행과 같은 기준).
 * - 표시 값은 카탈로그 관례대로 2자리 반올림(paramsB·activeParamsB·nonExpertGB).
 */
export function buildHfModel(input: HfModelInput): HfModelResult {
  const arch = classifyArch(input.config);
  if (arch.kind === 'unsupported') return { kind: 'unsupported', reason: arch.reason };

  const modelId = `${HF_MODEL_ID_PREFIX}${slugFromHfId(input.hfId)}`;
  const records = quantRowsFrom(input.tree, input.ggufRepo, modelId);
  const baseRecord = records[0]; // quantRowsFrom: Q4_K_M 이 첫 행
  if (!baseRecord) return { kind: 'no-gguf', reason: `no Q4_K_M GGUF in ${input.ggufRepo}` };

  const notes: HfModelNote[] = [];
  const split = input.baseSplit;
  const paramsB = input.info?.paramsB ?? split?.totalParamsB;
  // 레코드에 실제로 들어가는 반올림 값으로 검증 (0.004B 는 0 이 되어 엔진이 NaN 을 낸다 — 10-01 리뷰)
  if (paramsB === undefined || !(round2(paramsB) > 0)) {
    return { kind: 'no-params', reason: 'parameter count unknown (no safetensors metadata, no GGUF header count)' };
  }
  if (input.info?.paramsB === undefined) notes.push('params-from-header');
  if (arch.override) notes.push('kv-full-layers-only');

  const modelArch: ModelCore['arch'] = {
    layers: arch.arch.layers,
    kvHeads: arch.arch.kvHeads,
    headDim: arch.arch.headDim,
    attnType: arch.attnType,
    kvBytesPerTokenF16: arch.override?.kvBytesPerTokenF16 ?? arch.arch.kvBytesPerTokenF16,
    ...(arch.moe ? { experts: arch.moe.experts, topK: arch.moe.topK } : {}),
    ...(arch.expertLayers ? { expertLayers: arch.expertLayers } : {}),
  };
  // 기준 행만 헤더 실측 분할을 갖는다. 엔진은 분할이 있으면 그래픽카드 상주량(전문가 + 비전문가)으로 full-gpu 를 판정하는데
  // (10-03 D62), 다른 행은 파일 전체라 큰 양자화만 전량 탑재되는 사다리 역전이 생길 수 있다 — offGpuGB 0(파일 전체를 셈)으로 막는다
  const toCore = (r: ModelQuantRecord, measured?: { expertGB: number; nonExpertGB: number }): ModelQuantCore => ({
    modelId: r.modelId,
    quant: r.quant,
    fileGB: r.fileGB,
    ...(measured ? { expertGB: measured.expertGB, nonExpertGB: measured.nonExpertGB, offGpuGB: 0 } : {}),
    ggufRepo: r.ggufRepo,
    ...(r.fileName !== undefined ? { fileName: r.fileName } : {}),
  });
  /** 키 순서 = MODEL_CORE_KEYS (toCatalogLite 결과와 같은 모양) */
  const model = (moe?: { activeParamsB: number; nonExpertGB: number }): ModelCore => ({
    id: modelId,
    name: displayName(input.hfId),
    hfId: input.hfId,
    paramsB: round2(paramsB),
    ...(moe ? { activeParamsB: round2(moe.activeParamsB) } : {}),
    arch: modelArch,
    maxContext: arch.maxContext,
    license: mapLicense(input.info?.license, input.info?.licenseName),
    moe: moe !== undefined,
    ...(moe ? { nonExpertGB: moe.nonExpertGB } : {}),
    category: arch.vision ? ['chat', 'vision'] : ['chat'],
    korean: false,
    popularity: 1,
  });

  if (!arch.moe) return { kind: 'ok', model: model(), rows: records.map((r) => toCore(r)), notes };

  const { experts, topK } = arch.moe;
  // 헤더 원소 수가 있으면 그 값(이름 표기 A3B 는 반올림 — Qwen3-30B-A3B 실제 3.3B), 없으면 이름 표기
  let activeParamsB: number | undefined;
  if (split?.totalParamsB !== undefined && split.expertParamsB !== undefined) {
    activeParamsB = split.totalParamsB - split.expertParamsB + split.expertParamsB * (topK / experts);
    notes.push('active-from-header');
  } else {
    activeParamsB = activeFromName(input.hfId);
    if (activeParamsB !== undefined) notes.push('active-from-name');
  }
  if (activeParamsB === undefined) {
    return { kind: 'no-params', reason: 'MoE active parameter count unknown (no AxB in the name, no GGUF header count)' };
  }
  const inconsistent = {
    kind: 'no-params' as const,
    reason: `MoE parameter counts inconsistent (total ${round2(paramsB)}B, active ${round2(activeParamsB)}B, top-${topK} of ${experts} experts)`,
  };
  if (!(round2(activeParamsB) > 0) || round2(activeParamsB) >= round2(paramsB)) return inconsistent;

  // 헤더 실측은 기준 파일 크기 안일 때만 (validateAll 불변식과 같은 기준)
  let measured: { expertGB: number; nonExpertGB: number } | undefined;
  if (split) {
    if (split.nonExpertGB > 0 && split.expertGB + split.nonExpertGB <= baseRecord.fileGB + SPLIT_TOLERANCE_GB) {
      measured = { expertGB: split.expertGB, nonExpertGB: split.nonExpertGB };
    } else notes.push('split-ignored');
  }
  let nonExpertGB = measured?.nonExpertGB;
  if (nonExpertGB === undefined) {
    nonExpertGB = round2(deriveNonExpertGB({ totalParamsB: paramsB, activeParamsB, experts, topK }, baseRecord.fileGB));
    notes.push('nonexpert-derived');
    if (!(nonExpertGB > 0)) return inconsistent; // 활성 비율이 topK/experts 보다 작다 — 이름·헤더 값이 서로 안 맞음
  }

  return {
    kind: 'ok',
    model: model({ activeParamsB, nonExpertGB }),
    rows: records.map((r, i) => toCore(r, i === 0 ? measured : undefined)),
    notes,
  };
}
