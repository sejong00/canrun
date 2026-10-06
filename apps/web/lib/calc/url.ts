/**
 * 계산기 공유 URL 코덱 (P1-3 D31) — 기본값 생략·키 순서 고정·미지 키 삭제. 순수 함수.
 *   gpu=<id|이름|별칭|custom> [kind class vram mem bw fp16] gpus plus ram ddr os display ctx kv cat min size sort mode m hf mm type budget gsort
 * 서로 다른 GPU(10-03 D67): `plus=rtx-3060-12gb[,…]` — 함께 꽂은 카드의 카탈로그 id, 넣은 순서 그대로(정리 규칙은 state.ts normalizePlus).
 * 모델 모드(10-03 D65): `mode=model` + 대상 `m`(카탈로그) 또는 `hf`(불러온 모델), GPU 필터 `type`·`budget`·`gsort`. `ctx`·`kv`·`min` 은
 * 두 모드가 같은 뜻으로 쓴다. 기본 모드(hardware)는 생략하므로 기존 하드웨어 모드 URL 은 그대로다.
 * 직접 입력 모델(D66): `mm=p8.03-l32-k8-d128` — 글자+숫자 조각을 '-' 로 잇고 순서는 p a e t l k d f c h 로 고정
 * (전체·활성 파라미터, 전문가 수, top-k, 층, KV 헤드, 헤드 차원, 전체 어텐션 층, 최대 컨텍스트, 생각 모드 h1). 숫자만 받는다 —
 * 공유 링크로 임의 문구를 심을 수 없게. 조각마다 범위를 검사해 틀린 조각만 버린다(커스텀 하드웨어와 같다). `hf` 가 있으면 버린다.
 * 정렬(10-06 D68): 기본 추천순(`rec`)은 생략, `sort=popular|downloads|verdict|speed|size`. 그 전의 기본(판정·속도 순)은 이제 `sort=verdict` 로
 * 적고, sort 가 없는 옛 공유 링크는 추천순으로 열린다(의도된 변화).
 * 홈 GET 폼은 `gpu=<자유 텍스트>` 만 보내고 여기서 별칭·fuzzy 로 해석한다 (해석 실패 = unresolved, 폼에 텍스트 유지).
 */
import { manualRangeIssue, type CatalogLite, type ManualNumberField, type ManualSpec } from '@canrun/data/client';
import type { EffClass, KvQuant, Os } from '@canrun/engine';
import { matchGpu, type GpuNames } from './gpu-match';
import {
  BUDGET_OPTIONS_USD,
  CALC_MODES,
  CATEGORIES,
  CTX_OPTIONS,
  CUSTOM_CLASSES,
  DDR_KINDS,
  DEFAULT_DDR,
  DEFAULT_SORT,
  GPU_SORT_KEYS,
  HW_TYPES,
  KV_OPTIONS,
  SIZE_BUCKETS,
  SORT_KEYS,
  defaultState,
  normalize,
  type CalcState,
  type Category,
  type DdrKind,
  type HwType,
  type MinVerdict,
  type SizeBucket,
  type SortKey,
} from './state';

const OS_VALUES: readonly Os[] = ['windows', 'linux', 'macos'];

function num(raw: string | null, min: number, max: number): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | undefined {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const picked = raw.split(',').filter((v): v is T => (allowed as readonly string[]).includes(v));
  return allowed.filter((v) => picked.includes(v));
}

/** 직접 입력 모델 조각 글자 — 배열 순서가 곧 URL 순서 */
const MANUAL_SEGMENTS: readonly (readonly [string, ManualNumberField | 'maxContext' | 'thinking'])[] = [
  ['p', 'paramsB'],
  ['a', 'activeParamsB'],
  ['e', 'experts'],
  ['t', 'topK'],
  ['l', 'layers'],
  ['k', 'kvHeads'],
  ['d', 'headDim'],
  ['f', 'fullAttnLayers'],
  ['c', 'maxContext'],
  ['h', 'thinking'],
];
const MANUAL_SEGMENT_RE = /^([a-z])(\d+(?:\.\d+)?)$/;

/** 한 칸이 URL 에 실릴 수 있는 값인가 — 숫자 칸은 고정 범위·정수, 컨텍스트는 선택지, 생각 모드는 1 */
function manualValueOk(field: ManualNumberField | 'maxContext' | 'thinking', value: number): boolean {
  if (field === 'maxContext') return CTX_OPTIONS.includes(value);
  if (field === 'thinking') return value === 1;
  return manualRangeIssue(field, value) === undefined;
}

function parseManual(raw: string | null): ManualSpec | undefined {
  if (!raw) return undefined;
  const spec: ManualSpec = {};
  for (const segment of raw.split('-')) {
    const m = MANUAL_SEGMENT_RE.exec(segment);
    const field = m ? MANUAL_SEGMENTS.find(([letter]) => letter === m[1])?.[1] : undefined;
    if (!m || !field || spec[field] !== undefined) continue;
    const value = Number(m[2]);
    if (!manualValueOk(field, value)) continue;
    if (field === 'thinking') spec.thinking = true;
    else spec[field] = value;
  }
  return spec;
}

function serializeManual(spec: ManualSpec): string {
  const parts: string[] = [];
  for (const [letter, field] of MANUAL_SEGMENTS) {
    const value = field === 'thinking' ? (spec.thinking ? 1 : undefined) : spec[field];
    if (value !== undefined && manualValueOk(field, value)) parts.push(`${letter}${String(value)}`);
  }
  return parts.join('-');
}

export function parseCalcQuery(search: string, catalog: CatalogLite, names: GpuNames = {}): CalcState {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const state = defaultState();
  const gpuRaw = (q.get('gpu') ?? '').trim();
  if (gpuRaw === 'custom') {
    const kind = oneOf(q.get('kind'), ['dgpu', 'unified'] as const) ?? 'dgpu';
    state.hardware = {
      kind: 'custom',
      custom: {
        kind,
        effClass: oneOf(q.get('class'), CUSTOM_CLASSES) ?? (kind === 'unified' ? 'apple' : 'nvidia'),
        ...(kind === 'dgpu' ? { vramGB: num(q.get('vram'), 1, 512) } : { memGB: num(q.get('mem'), 1, 1024) }),
        bandwidthGBs: num(q.get('bw'), 10, 8000),
        fp16Tflops: num(q.get('fp16'), 0.1, 2000),
      },
    };
  } else if (gpuRaw) {
    const match = matchGpu(gpuRaw, catalog.gpus, { names });
    state.hardware = match.kind === 'exact' ? { kind: 'catalog', gpuId: match.id } : { kind: 'unresolved', text: gpuRaw };
  }
  state.gpus = num(q.get('gpus'), 1, 8);
  const plus = (q.get('plus') ?? '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 8);
  state.plus = plus.length > 0 ? plus : undefined;
  state.ramGB = num(q.get('ram'), 1, 2048);
  state.ddr = oneOf(q.get('ddr'), DDR_KINDS) ?? DEFAULT_DDR;
  state.os = oneOf(q.get('os'), OS_VALUES);
  state.display = q.get('display') !== '0';
  const ctx = num(q.get('ctx'), 1, 1 << 22);
  state.ctx = ctx !== undefined && CTX_OPTIONS.includes(ctx) ? ctx : state.ctx;
  state.kv = oneOf(q.get('kv'), KV_OPTIONS) ?? 'f16';
  state.cat = list<Category>(q.get('cat'), CATEGORIES);
  state.min = oneOf(q.get('min'), ['S', 'A', 'B'] as const);
  state.size = list<SizeBucket>(q.get('size'), SIZE_BUCKETS);
  state.sort = oneOf(q.get('sort'), SORT_KEYS) ?? DEFAULT_SORT;
  state.mode = oneOf(q.get('mode'), CALC_MODES) ?? 'hardware';
  state.focus = q.get('m') ?? undefined;
  state.hf = q.get('hf')?.trim() || undefined;
  state.manual = parseManual(q.get('mm'));
  state.type = list<HwType>(q.get('type'), HW_TYPES);
  const budget = num(q.get('budget'), 1, 100_000);
  state.budget = budget !== undefined && BUDGET_OPTIONS_USD.includes(budget) ? budget : undefined;
  state.gsort = oneOf(q.get('gsort'), GPU_SORT_KEYS) ?? 'verdict';
  return normalize(state, catalog);
}

/** 정규형 — 기본값은 쓰지 않고 키 순서는 고정. 빈 상태는 '' */
export function serializeCalcQuery(state: CalcState, catalog: CatalogLite): string {
  const s = normalize(state, catalog);
  const q = new URLSearchParams();
  const hw = s.hardware;
  if (hw.kind === 'catalog') q.set('gpu', hw.gpuId);
  else if (hw.kind === 'unresolved') q.set('gpu', hw.text);
  else if (hw.kind === 'custom') {
    q.set('gpu', 'custom');
    q.set('kind', hw.custom.kind);
    q.set('class', hw.custom.effClass);
    if (hw.custom.vramGB !== undefined) q.set('vram', String(hw.custom.vramGB));
    if (hw.custom.memGB !== undefined) q.set('mem', String(hw.custom.memGB));
    if (hw.custom.bandwidthGBs !== undefined) q.set('bw', String(hw.custom.bandwidthGBs));
    if (hw.custom.fp16Tflops !== undefined) q.set('fp16', String(hw.custom.fp16Tflops));
  }
  if (s.gpus !== undefined) q.set('gpus', String(s.gpus));
  if (s.plus !== undefined && s.plus.length > 0) q.set('plus', s.plus.join(','));
  if (s.ramGB !== undefined) q.set('ram', String(s.ramGB));
  if (s.ddr !== DEFAULT_DDR) q.set('ddr', s.ddr);
  if (s.os !== undefined) q.set('os', s.os);
  if (!s.display) q.set('display', '0');
  if (s.ctx !== defaultState().ctx) q.set('ctx', String(s.ctx));
  if (s.kv !== 'f16') q.set('kv', s.kv);
  if (s.cat.length > 0) q.set('cat', s.cat.join(','));
  if (s.min !== undefined) q.set('min', s.min);
  if (s.size.length > 0) q.set('size', s.size.join(','));
  if (s.sort !== DEFAULT_SORT) q.set('sort', s.sort);
  if (s.mode !== 'hardware') q.set('mode', s.mode);
  if (s.focus !== undefined) q.set('m', s.focus);
  if (s.hf !== undefined) q.set('hf', s.hf);
  const mm = s.manual ? serializeManual(s.manual) : '';
  if (mm) q.set('mm', mm);
  if (s.type.length > 0) q.set('type', s.type.join(','));
  if (s.budget !== undefined) q.set('budget', String(s.budget));
  if (s.gsort !== 'verdict') q.set('gsort', s.gsort);
  const out = q.toString();
  return out ? `?${out}` : '';
}

export type { CalcState, DdrKind, EffClass, KvQuant, MinVerdict, SortKey };
