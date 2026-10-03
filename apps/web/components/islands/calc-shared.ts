/**
 * 계산기 아일랜드 공용 — 번역 바인딩·경로·리듀서 (클라이언트, P1-3).
 */
import type { CatalogLite } from '@canrun/data/client';
import type { EffClass } from '@canrun/engine';
import { makeT, type Dict, type TranslateWithHas } from '@/lib/i18n-lite';
import { normalize, type CalcState, type CustomHardware, type HardwareChoice } from '@/lib/calc/state';

export type CalcTranslators = {
  calc: TranslateWithHas;
  detect: TranslateWithHas;
  share: TranslateWithHas;
  license: TranslateWithHas;
  verdict: TranslateWithHas;
  confidence: TranslateWithHas;
  common: TranslateWithHas;
  mode: TranslateWithHas;
  memory: TranslateWithHas;
  reason: TranslateWithHas;
  hint: TranslateWithHas;
  tier: TranslateWithHas;
  category: TranslateWithHas;
  names: TranslateWithHas;
  gpuHub: TranslateWithHas;
  table: TranslateWithHas;
  modelHub: TranslateWithHas;
  sort: TranslateWithHas;
};

export function bindTranslators(dict: Dict, locale: string): CalcTranslators {
  return {
    calc: makeT(dict, locale, 'Calculator'),
    detect: makeT(dict, locale, 'Detect'),
    share: makeT(dict, locale, 'Share'),
    license: makeT(dict, locale, 'LicenseShort'),
    verdict: makeT(dict, locale, 'Verdict'),
    confidence: makeT(dict, locale, 'Confidence'),
    common: makeT(dict, locale, 'Common'),
    mode: makeT(dict, locale, 'Mode'),
    memory: makeT(dict, locale, 'Memory'),
    reason: makeT(dict, locale, 'VerdictReason'),
    hint: makeT(dict, locale, 'Hint'),
    tier: makeT(dict, locale, 'QuantTier'),
    category: makeT(dict, locale, 'Category'),
    names: makeT(dict, locale, 'GpuName'),
    gpuHub: makeT(dict, locale, 'GpuHub'),
    table: makeT(dict, locale, 'Table'),
    modelHub: makeT(dict, locale, 'ModelHub'),
    sort: makeT(dict, locale, 'Sort'),
  };
}

/** 커스텀 하드웨어 제조사 계열 → 메시지 키 */
export function classKey(effClass: EffClass): string {
  switch (effClass) {
    case 'amd':
      return 'classAmd';
    case 'intel-arc':
      return 'classIntelArc';
    case 'apple':
      return 'classApple';
    case 'apple-ultra':
      return 'classAppleUltra';
    case 'strix':
      return 'classStrix';
    case 'dgx-spark':
      return 'classDgxSpark';
    default:
      return 'classNvidia';
  }
}

/** `lib/links.ts localeHref` 와 같은 규칙 (클라이언트 사본 — routing 모듈을 끌어오지 않는다) */
export function localePrefix(locale: string): string {
  return locale === 'en' ? '' : `/${locale}`;
}

export type CalcAction =
  | { type: 'restore'; state: CalcState }
  | { type: 'hardware'; hardware: HardwareChoice }
  | { type: 'custom'; patch: Partial<CustomHardware> }
  | { type: 'ram'; ramGB: number | undefined }
  | { type: 'ddr'; ddr: CalcState['ddr'] }
  | { type: 'os'; os: CalcState['os'] }
  | { type: 'display'; display: boolean }
  | { type: 'ctx'; ctx: number }
  | { type: 'kv'; kv: CalcState['kv'] }
  | { type: 'cat'; cat: CalcState['cat'] }
  | { type: 'min'; min: CalcState['min'] }
  | { type: 'size'; size: CalcState['size'] }
  | { type: 'sort'; sort: CalcState['sort'] }
  | { type: 'focus'; focus: string | undefined }
  | { type: 'hf'; hf: string | undefined }
  | { type: 'gpus'; gpus: number | undefined }
  | { type: 'clearFilters' }
  // 모델 모드 (10-03 D65)
  | { type: 'mode'; mode: CalcState['mode'] }
  /** 카탈로그 모델로 대상 바꾸기 — 불러온 모델은 뺀다(아일랜드가 HF 불러오기 차례 번호도 올린다) */
  | { type: 'pickModel'; focus: string }
  /** 하드웨어 모드 카드 → 그 모델의 GPU 목록 (`focus` 가 없으면 불러온 모델 카드 — 대상 유지) */
  | { type: 'toModel'; focus?: string }
  /** GPU 행 → 그 GPU 로 하드웨어 모드. 통합·CPU 행은 그 행이 쓴 메모리 용량을 넣는다 */
  | { type: 'useGpu'; gpuId: string; ramGB?: number }
  | { type: 'type'; hwType: CalcState['type'] }
  | { type: 'budget'; budget: number | undefined }
  | { type: 'gsort'; gsort: CalcState['gsort'] }
  | { type: 'clearGpuFilters' };

/** dGPU 부류(시스템 RAM 목록·OS 선택지를 공유) — none/unresolved 는 dGPU 기본값을 쓴다 */
function isDgpuChoice(hardware: HardwareChoice, catalog: CatalogLite): boolean {
  if (hardware.kind === 'catalog') return catalog.gpus.find((g) => g.id === hardware.gpuId)?.kind === 'dgpu';
  if (hardware.kind === 'custom') return hardware.custom.kind === 'dgpu';
  return true;
}

export function makeReducer(catalog: CatalogLite) {
  return (state: CalcState, action: CalcAction): CalcState => {
    switch (action.type) {
      case 'restore':
        return normalize(action.state, catalog);
      case 'hardware':
        return withHardware(state, action.hardware, catalog);
      case 'custom': {
        const base: CustomHardware =
          state.hardware.kind === 'custom' ? state.hardware.custom : { kind: 'dgpu', effClass: 'nvidia' };
        // 종류 ↔ 계열 결합은 normalize(coerceCustomClass) 가 맡는다 — URL 파서와 같은 규칙
        const hardware: HardwareChoice = { kind: 'custom', custom: { ...base, ...action.patch } };
        // 'hardware' 와 같은 규칙: 부류가 바뀌면(맥·CPU → 커스텀 dGPU, 커스텀 dGPU ↔ 통합) RAM·OS 를 기본값으로 (재검증)
        const keep = isDgpuChoice(state.hardware, catalog) === isDgpuChoice(hardware, catalog);
        return normalize({ ...state, hardware, ...(keep ? {} : { ramGB: undefined, os: undefined }) }, catalog);
      }
      case 'ram':
        return normalize({ ...state, ramGB: action.ramGB }, catalog);
      case 'ddr': {
        // CPU 프로필은 DDR 선택이 곧 프로필 — gpuId 도 함께 바꾼다
        const isCpu = state.hardware.kind === 'catalog' && catalog.gpus.find((g) => g.id === (state.hardware as { gpuId: string }).gpuId)?.kind === 'cpu';
        const hardware: HardwareChoice = isCpu ? { kind: 'catalog', gpuId: `cpu-${action.ddr}-2ch` } : state.hardware;
        return normalize({ ...state, ddr: action.ddr, hardware }, catalog);
      }
      case 'os':
        return normalize({ ...state, os: action.os }, catalog);
      case 'display':
        return { ...state, display: action.display };
      case 'ctx':
        return normalize({ ...state, ctx: action.ctx }, catalog);
      case 'kv':
        return normalize({ ...state, kv: action.kv }, catalog);
      case 'cat':
        return normalize({ ...state, cat: action.cat }, catalog);
      case 'min':
        return { ...state, min: action.min };
      case 'size':
        return normalize({ ...state, size: action.size }, catalog);
      case 'sort':
        return { ...state, sort: action.sort };
      case 'focus':
        return normalize({ ...state, focus: action.focus }, catalog);
      case 'hf':
        return normalize({ ...state, hf: action.hf }, catalog);
      case 'gpus':
        return normalize({ ...state, gpus: action.gpus }, catalog);
      case 'clearFilters':
        return { ...state, cat: [], size: [], min: undefined };
      case 'mode':
        return normalize({ ...state, mode: action.mode }, catalog);
      case 'pickModel':
        return normalize({ ...state, focus: action.focus, hf: undefined }, catalog);
      case 'toModel':
        return normalize({ ...state, mode: 'model', ...(action.focus !== undefined ? { focus: action.focus, hf: undefined } : {}) }, catalog);
      case 'useGpu': {
        // 'hardware' 와 같은 RAM·OS 유지 규칙으로 바꾼 뒤, 통합·CPU 행이면 그 행의 메모리 용량으로 (`m` = 대상 모델은 그대로 강조)
        const next = withHardware({ ...state, mode: 'hardware' }, { kind: 'catalog', gpuId: action.gpuId }, catalog);
        const kind = catalog.gpus.find((g) => g.id === action.gpuId)?.kind;
        return kind !== 'dgpu' && action.ramGB !== undefined ? normalize({ ...next, ramGB: action.ramGB }, catalog) : next;
      }
      case 'type':
        return normalize({ ...state, type: action.hwType }, catalog);
      case 'budget':
        return normalize({ ...state, budget: action.budget }, catalog);
      case 'gsort':
        return normalize({ ...state, gsort: action.gsort }, catalog);
      case 'clearGpuFilters':
        return { ...state, type: [], budget: undefined, min: undefined };
    }
  };
}

/** 하드웨어 교체 — dGPU ↔ dGPU 처럼 같은 부류 안의 교체는 사용자의 RAM·OS 를 유지하고, 부류가 바뀌면(옵션 목록이 다르다) 기본값으로 */
function withHardware(state: CalcState, hardware: HardwareChoice, catalog: CatalogLite): CalcState {
  const keep = isDgpuChoice(state.hardware, catalog) === isDgpuChoice(hardware, catalog);
  return normalize({ ...state, hardware, ...(keep ? {} : { ramGB: undefined, os: undefined }) }, catalog);
}
