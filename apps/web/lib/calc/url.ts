/**
 * 계산기 공유 URL 코덱 (P1-3 D31) — 기본값 생략·키 순서 고정·미지 키 삭제. 순수 함수.
 *   gpu=<id|이름|별칭|custom> [kind class vram mem bw fp16] ram ddr os display ctx kv cat min size sort m hf
 * 홈 GET 폼은 `gpu=<자유 텍스트>` 만 보내고 여기서 별칭·fuzzy 로 해석한다 (해석 실패 = unresolved, 폼에 텍스트 유지).
 */
import type { CatalogLite } from '@canrun/data/client';
import type { EffClass, KvQuant, Os } from '@canrun/engine';
import { matchGpu, type GpuNames } from './gpu-match';
import {
  CATEGORIES,
  CTX_OPTIONS,
  CUSTOM_CLASSES,
  DDR_KINDS,
  DEFAULT_DDR,
  KV_OPTIONS,
  SIZE_BUCKETS,
  SORT_KEYS,
  defaultState,
  normalize,
  type CalcState,
  type Category,
  type DdrKind,
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
  state.sort = oneOf(q.get('sort'), SORT_KEYS) ?? 'verdict';
  state.focus = q.get('m') ?? undefined;
  state.hf = q.get('hf')?.trim() || undefined;
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
  if (s.ramGB !== undefined) q.set('ram', String(s.ramGB));
  if (s.ddr !== DEFAULT_DDR) q.set('ddr', s.ddr);
  if (s.os !== undefined) q.set('os', s.os);
  if (!s.display) q.set('display', '0');
  if (s.ctx !== defaultState().ctx) q.set('ctx', String(s.ctx));
  if (s.kv !== 'f16') q.set('kv', s.kv);
  if (s.cat.length > 0) q.set('cat', s.cat.join(','));
  if (s.min !== undefined) q.set('min', s.min);
  if (s.size.length > 0) q.set('size', s.size.join(','));
  if (s.sort !== 'verdict') q.set('sort', s.sort);
  if (s.focus !== undefined) q.set('m', s.focus);
  if (s.hf !== undefined) q.set('hf', s.hf);
  const out = q.toString();
  return out ? `?${out}` : '';
}

export type { CalcState, DdrKind, EffClass, KvQuant, MinVerdict, SortKey };
