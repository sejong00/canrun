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
  | { type: 'clearFilters' };

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
      case 'hardware': {
        // dGPU ↔ dGPU 처럼 같은 부류 안의 교체는 사용자의 RAM·OS 를 유지하고, 부류가 바뀌면(옵션 목록이 다르다) 기본값으로
        const keep = isDgpuChoice(state.hardware, catalog) === isDgpuChoice(action.hardware, catalog);
        return normalize({ ...state, hardware: action.hardware, ...(keep ? {} : { ramGB: undefined, os: undefined }) }, catalog);
      }
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
      case 'clearFilters':
        return { ...state, cat: [], size: [], min: undefined };
    }
  };
}
