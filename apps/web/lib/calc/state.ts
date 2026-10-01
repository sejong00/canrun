/**
 * 계산기 상태 (P1-3 D31) — 순수 타입·기본값·정규화. URL 코덱(url.ts)과 아일랜드 리듀서가 공유한다.
 */
import { HUB_POLICY, type CatalogLite, type GpuCore } from '@canrun/data/client';
import type { EffClass, KvQuant, Os, Verdict } from '@canrun/engine';

export type DdrKind = 'ddr4-3200' | 'ddr5-5600' | 'ddr5-6000';
export const DDR_KINDS: readonly DdrKind[] = ['ddr4-3200', 'ddr5-5600', 'ddr5-6000'];
/** DDR 종류 → 시스템 RAM 대역폭을 조회할 CPU 프로필 (gpus.json) */
export const DDR_PROFILE: Readonly<Record<DdrKind, string>> = {
  'ddr4-3200': 'cpu-ddr4-3200-2ch',
  'ddr5-5600': 'cpu-ddr5-5600-2ch',
  'ddr5-6000': 'cpu-ddr5-6000-2ch',
};
export const DEFAULT_DDR: DdrKind = 'ddr5-5600';

export type Category = 'chat' | 'coding' | 'reasoning' | 'vision';
export const CATEGORIES: readonly Category[] = ['chat', 'coding', 'reasoning', 'vision'];

export type SizeBucket = 's' | 'm' | 'l' | 'xl';
export const SIZE_BUCKETS: readonly SizeBucket[] = ['s', 'm', 'l', 'xl'];
/** 파라미터 수(B) → 크기 버킷: ≤9 / 10–24 / 25–49 / 50+ */
export function sizeBucket(paramsB: number): SizeBucket {
  if (paramsB < 10) return 's';
  if (paramsB < 25) return 'm';
  if (paramsB < 50) return 'l';
  return 'xl';
}

export type SortKey = 'verdict' | 'speed' | 'size';
export const SORT_KEYS: readonly SortKey[] = ['verdict', 'speed', 'size'];

export type MinVerdict = Exclude<Verdict, 'F'>;

export const CUSTOM_CLASSES: readonly EffClass[] = ['nvidia', 'amd', 'intel-arc', 'apple', 'apple-ultra', 'strix', 'dgx-spark'];
/** 통합 메모리 종류에만 성립하는 제조사 계열 — 나머지는 dGPU 전용 */
export const UNIFIED_CLASSES: readonly EffClass[] = ['apple', 'apple-ultra', 'strix', 'dgx-spark'];

export type CustomHardware = {
  kind: 'dgpu' | 'unified';
  effClass: EffClass;
  /** dGPU 전용 VRAM (GB) */
  vramGB?: number;
  /** 통합 메모리 총량 (GB) — 통합은 이 값이 곧 RAM */
  memGB?: number;
  bandwidthGBs?: number;
  fp16Tflops?: number;
};

export type HardwareChoice =
  | { kind: 'none' }
  | { kind: 'catalog'; gpuId: string }
  | { kind: 'unresolved'; text: string }
  | { kind: 'custom'; custom: CustomHardware };

export type CalcState = {
  hardware: HardwareChoice;
  /** 시스템 RAM(dGPU) / 통합·CPU 메모리 (GB) — undefined 면 기본값 */
  ramGB?: number;
  ddr: DdrKind;
  os?: Os;
  /** dGPU 가 화면 출력 담당 (OS 예약 VRAM) */
  display: boolean;
  /** 같은 dGPU 장수 2~4 (1 이면 생략) — 멀티 GPU 베타(docs/02 §6, D58): VRAM 합산·층 나눠 올리기, 이론 추정 */
  gpus?: number;
  ctx: number;
  kv: KvQuant;
  cat: Category[];
  min?: MinVerdict;
  size: SizeBucket[];
  sort: SortKey;
  /** 카드 포커스 모델 id */
  focus?: string;
  /** 카탈로그 밖 모델 — Hugging Face 저장소 id(`org/repo`). 브라우저가 HF 에서 불러와 이론 추정으로 계산 (계산기 P2, PROGRESS §4 D57) */
  hf?: string;
};

/** HF 저장소 id 형식 (`org/repo`) — URL 에서 온 값 검증용. 입력 해석(주소·Ollama 표기)은 `@canrun/data/hf` parseHfInput */
export const HF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export const CTX_OPTIONS: readonly number[] = HUB_POLICY.matrixCtx;
/** 같은 dGPU 장수 선택지 */
export const GPU_COUNT_OPTIONS: readonly number[] = [1, 2, 3, 4];
export const KV_OPTIONS: readonly KvQuant[] = ['f16', 'q8_0', 'q4_0'];
/** dGPU 시스템 RAM 선택지 (GB) */
export const DGPU_RAM_OPTIONS: readonly number[] = [8, 16, 24, 32, 48, 64, 96, 128, 192, 256];

export function defaultState(): CalcState {
  return {
    hardware: { kind: 'none' },
    ddr: DEFAULT_DDR,
    display: true,
    ctx: HUB_POLICY.referenceCtx,
    kv: 'f16',
    cat: [],
    size: [],
    sort: 'verdict',
  };
}

export function findGpu(catalog: CatalogLite, id: string): GpuCore | undefined {
  return catalog.gpus.find((g) => g.id === id);
}

/** 이 하드웨어의 기본 OS — 허브 가정과 동일: dGPU windows(D2), Apple macOS(고정), CPU 프로필·그 외 통합 linux */
export function defaultOs(hardware: HardwareChoice, catalog: CatalogLite): Os {
  if (hardware.kind === 'catalog') {
    const gpu = findGpu(catalog, hardware.gpuId);
    if (!gpu) return 'windows';
    if (gpu.vendor === 'apple') return 'macos';
    if (gpu.kind !== 'dgpu') return 'linux';
    return 'windows';
  }
  if (hardware.kind === 'custom') {
    if (hardware.custom.effClass === 'apple' || hardware.custom.effClass === 'apple-ultra') return 'macos';
    return hardware.custom.kind === 'unified' ? 'linux' : 'windows';
  }
  return 'windows';
}

/** OS 가 고정인 하드웨어 (Apple 실리콘·DGX) */
export function osLocked(hardware: HardwareChoice, catalog: CatalogLite): Os | undefined {
  if (hardware.kind === 'catalog') {
    const gpu = findGpu(catalog, hardware.gpuId);
    if (gpu?.vendor === 'apple') return 'macos';
    if (gpu?.vendor === 'nvidia-dgx') return 'linux';
  }
  if (hardware.kind === 'custom' && (hardware.custom.effClass === 'apple' || hardware.custom.effClass === 'apple-ultra')) {
    return 'macos';
  }
  return undefined;
}

/** 선택 가능한 OS — Apple·DGX 는 고정, 그 외는 windows|linux (macOS 는 Apple 실리콘에만 성립: dGPU·Strix 에 macOS 를 주면 OS 예약이 0 이 된다) */
export function osOptions(hardware: HardwareChoice, catalog: CatalogLite): readonly Os[] {
  const locked = osLocked(hardware, catalog);
  return locked ? [locked] : ['windows', 'linux'];
}

/** 커스텀 종류 ↔ 제조사 계열 결합 — 통합엔 apple/apple-ultra/strix/dgx-spark 만, dGPU 엔 나머지만 (리듀서·URL 파서 공용) */
export function coerceCustomClass(custom: CustomHardware): CustomHardware {
  const unifiedClass = UNIFIED_CLASSES.includes(custom.effClass);
  if (custom.kind === 'unified' && !unifiedClass) return { ...custom, effClass: 'apple' };
  if (custom.kind === 'dgpu' && unifiedClass) return { ...custom, effClass: 'nvidia' };
  return custom;
}

/** 선택 가능한 RAM 옵션 — dGPU 고정 목록, 통합·CPU 는 카탈로그 ramOptionsGB, 커스텀 통합은 memGB 하나 */
export function ramOptions(hardware: HardwareChoice, catalog: CatalogLite): readonly number[] {
  if (hardware.kind === 'catalog') {
    const gpu = findGpu(catalog, hardware.gpuId);
    if (gpu && gpu.kind !== 'dgpu') return gpu.ramOptionsGB ?? [];
  }
  if (hardware.kind === 'custom' && hardware.custom.kind === 'unified') {
    return hardware.custom.memGB !== undefined ? [hardware.custom.memGB] : [];
  }
  return DGPU_RAM_OPTIONS;
}

/** 기본 RAM — dGPU 32GB(D2), 통합·CPU 는 최대 옵션(허브 primary 와 동일), 커스텀 통합은 memGB */
export function defaultRam(hardware: HardwareChoice, catalog: CatalogLite): number {
  if (hardware.kind === 'catalog') {
    const gpu = findGpu(catalog, hardware.gpuId);
    if (gpu && gpu.kind !== 'dgpu') return Math.max(...(gpu.ramOptionsGB ?? [HUB_POLICY.dgpuRamGB]));
  }
  if (hardware.kind === 'custom' && hardware.custom.kind === 'unified') return hardware.custom.memGB ?? HUB_POLICY.dgpuRamGB;
  return HUB_POLICY.dgpuRamGB;
}

/** 통합·CPU 옵션 목록에 스냅 (올림 우선, 최대 초과면 최대) */
export function snapRam(value: number, options: readonly number[]): number {
  if (options.length === 0) return value;
  const up = options.filter((o) => o >= value);
  return up.length > 0 ? Math.min(...up) : Math.max(...options);
}

/** dGPU 는 CPU 프로필 자체를 DDR 로 고른다 — CPU 프로필 하드웨어면 ddr 에 맞는 프로필 id 로 바꾼다 */
export function cpuProfileFor(ddr: DdrKind): string {
  return DDR_PROFILE[ddr];
}

export function isCpuProfile(catalog: CatalogLite, gpuId: string): boolean {
  return findGpu(catalog, gpuId)?.kind === 'cpu';
}

/** 상태 정규화 — 하드웨어 종류에 맞지 않는 필드를 기본값으로 되돌린다 (URL 파싱·리듀서 공용) */
export function normalize(state: CalcState, catalog: CatalogLite): CalcState {
  const next: CalcState = { ...state };
  // 커스텀: 종류에 맞지 않는 제조사 계열은 기본값으로 (URL 이 임의 조합을 실어 올 수 있다)
  if (next.hardware.kind === 'custom') next.hardware = { kind: 'custom', custom: coerceCustomClass(next.hardware.custom) };
  // CPU 프로필은 DDR 선택이 곧 프로필
  if (next.hardware.kind === 'catalog' && isCpuProfile(catalog, next.hardware.gpuId)) {
    const ddrFromProfile = (Object.keys(DDR_PROFILE) as DdrKind[]).find((d) => DDR_PROFILE[d] === (next.hardware as { gpuId: string }).gpuId);
    if (ddrFromProfile) next.ddr = ddrFromProfile;
  }
  // OS: 고정 하드웨어는 생략, 그 외는 허용 목록(windows|linux) 밖이면 기본값으로, 기본값이면 생략
  if (next.os !== undefined && !osOptions(next.hardware, catalog).includes(next.os)) next.os = undefined;
  if (osLocked(next.hardware, catalog) !== undefined) next.os = undefined;
  else if (next.os !== undefined && next.os === defaultOs(next.hardware, catalog)) next.os = undefined;
  const options = ramOptions(next.hardware, catalog);
  if (next.ramGB !== undefined) {
    const kindIsDgpu =
      next.hardware.kind === 'none' ||
      next.hardware.kind === 'unresolved' ||
      (next.hardware.kind === 'catalog' && findGpu(catalog, next.hardware.gpuId)?.kind === 'dgpu') ||
      (next.hardware.kind === 'custom' && next.hardware.custom.kind === 'dgpu');
    if (!kindIsDgpu) next.ramGB = snapRam(next.ramGB, options);
    if (next.ramGB === defaultRam(next.hardware, catalog)) next.ramGB = undefined;
  }
  if (!CTX_OPTIONS.includes(next.ctx)) next.ctx = HUB_POLICY.referenceCtx;
  if (!KV_OPTIONS.includes(next.kv)) next.kv = 'f16';
  next.cat = CATEGORIES.filter((c) => state.cat.includes(c));
  next.size = SIZE_BUCKETS.filter((s) => state.size.includes(s));
  if (next.focus !== undefined && !catalog.models.some((m) => m.id === next.focus)) next.focus = undefined;
  if (next.hf !== undefined && !HF_ID_RE.test(next.hf)) next.hf = undefined;
  // 멀티 GPU 는 dGPU(카탈로그·커스텀) 에만 — 통합·CPU 로 바뀌면 지운다. 1장은 기본값이라 생략
  const dgpuChoice =
    next.hardware.kind === 'none' ||
    next.hardware.kind === 'unresolved' ||
    (next.hardware.kind === 'catalog' && findGpu(catalog, next.hardware.gpuId)?.kind === 'dgpu') ||
    (next.hardware.kind === 'custom' && next.hardware.custom.kind === 'dgpu');
  if (next.gpus !== undefined && (!dgpuChoice || next.gpus === 1 || !GPU_COUNT_OPTIONS.includes(next.gpus))) next.gpus = undefined;
  return next;
}
