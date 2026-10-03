/**
 * 계산기 모델 모드 결과 조립 (10-03 D65 — 모델 → GPU 방향). 순수 함수(DOM 없음).
 * 행은 모델 허브 GPU 표와 같은 함수(`modelGpuRows` — dGPU 는 허브 가정 D2, 통합·CPU 는 `pickConfigCombo`)로 만들고,
 * 사용자의 ctx·KV 만 바꾼다. 8k·f16 이면 허브 표와 같은 값이다(실측 조인도 D33 대로 8k·f16 에서만).
 * 무거운 평가(GPU 54종 × 구성 82개)와 가벼운 필터·정렬을 나눠 아일랜드가 따로 메모한다.
 */
import {
  assessCombo,
  cheapestOptions,
  hardwareConfigs,
  HUB_POLICY,
  modelGpuRows,
  pickConfigCombo,
  rankableStreet,
  verdictRank,
  type CatalogLite,
  type ComboAssessment,
  type GpuCore,
  type ModelCore,
  type PricedOption,
} from '@canrun/data/client';
import type { Os } from '@canrun/engine';
import { resolveHardware, type ResolvedHardware } from './hardware';
import type { ExtraModel, VerdictCounts } from './run';
import { hwTypeOf, normalize, type CalcState, type GpuSortKey, type HwType } from './state';

export type GpuRow = {
  gpu: GpuCore;
  combo: ComboAssessment;
  type: HwType;
  /** 순위·예산에 쓰는 가격 — dGPU 실거래가 + 기준일만 (`rankableStreet`, docs/01 §3) */
  street?: { usd: number; asOf: string };
  /**
   * 통합·CPU: 콤보 페이지(8k·f16 기준으로 구성을 고른다)의 RAM 이 이 행(지금 ctx·KV 로 고른 구성)과 다를 때 —
   * "상세" 링크 라벨에 부기한다
   */
  hubConfig?: { ramGB: number; os: Os };
};

export type ModelTarget = { model: ModelCore; external: boolean };

export type ModelRunResult = ModelTarget & {
  /** 평가 ctx — 모델 최대보다 큰 선택은 최대로 클램프 */
  ctx: number;
  clamped: boolean;
  /** 필터 전 전체 — 판정 → tok/s → GPU id (허브 표 순서) */
  all: GpuRow[];
  /** 필터 전 판정 수 */
  counts: VerdictCounts;
  /** 필터 전 최저가 (허브 최저가와 같은 규칙) */
  cheapest: { great?: PricedOption<GpuCore>; well?: PricedOption<GpuCore> };
};

/** 대상 모델 — 불러온 모델(완료)이 있으면 그것, 아니면 카탈로그 모델(`m`) */
export function modelTarget(catalog: CatalogLite, state: Pick<CalcState, 'focus'>, extra?: ExtraModel): ModelTarget | undefined {
  if (extra) return { model: extra.model, external: true };
  const model = state.focus === undefined ? undefined : catalog.models.find((m) => m.id === state.focus);
  return model ? { model, external: false } : undefined;
}

function catalogWith(catalog: CatalogLite, extra?: ExtraModel): CatalogLite {
  // 불러온 모델은 행만 덧붙인 카탈로그로 평가한다 (run.ts 고정 카드와 같은 방식 — 실측 조인 없음)
  return extra ? { ...catalog, modelQuants: [...catalog.modelQuants, ...extra.rows] } : catalog;
}

function countVerdicts(rows: readonly GpuRow[]): VerdictCounts {
  const counts: VerdictCounts = { S: 0, A: 0, B: 0, F: 0, otherQuant: 0 };
  for (const { combo } of rows) {
    counts[combo.baseline.result.verdict] += 1;
    if (combo.baseline.result.verdict === 'F' && combo.recommended) counts.otherQuant += 1;
  }
  return counts;
}

/** 대상 모델을 카탈로그 GPU 전부로 평가 (무거움 — 대상·ctx·KV 가 바뀔 때만) */
export function assembleModelRows(
  catalog: CatalogLite,
  state: Pick<CalcState, 'focus' | 'ctx' | 'kv'>,
  extra?: ExtraModel,
): ModelRunResult | undefined {
  const target = modelTarget(catalog, state, extra);
  if (!target) return undefined;
  const { model, external } = target;
  const ctx = Math.min(state.ctx, model.maxContext);
  const atReference = ctx === HUB_POLICY.referenceCtx && state.kv === 'f16';
  const rows = modelGpuRows(catalogWith(catalog, extra), model, {
    ctx,
    kvQuant: state.kv,
    ...(external ? { theoretical: true } : {}),
  });

  const all: GpuRow[] = rows.map(({ gpu, combo }) => {
    let hubConfig: GpuRow['hubConfig'];
    // 콤보 페이지는 8k·f16 으로 구성을 고른다 — 다른 조건에서 고른 RAM 과 다르면 라벨에 밝힌다 (불러온 모델은 콤보 페이지 없음)
    if (!atReference && !external && gpu.kind !== 'dgpu') {
      const configs = hardwareConfigs(gpu, catalog.gpus);
      const combos = configs.map((config) => assessCombo(catalog, gpu, config, model));
      const picked = configs[combos.indexOf(pickConfigCombo(combos))]!;
      if (picked.ramGB !== combo.ramGB) hubConfig = { ramGB: picked.ramGB, os: picked.hw.os };
    }
    const street = rankableStreet(gpu);
    return { gpu, combo, type: hwTypeOf(gpu), ...(street ? { street } : {}), ...(hubConfig ? { hubConfig } : {}) };
  });

  return { model, external, ctx, clamped: ctx < state.ctx, all, counts: countVerdicts(all), cheapest: cheapestOptions(rows) };
}

export type GpuView = {
  rows: GpuRow[];
  /** 예산을 걸어 빠진 "순위 가격 없는" 행 수(종류·판정 필터를 통과한 것 중) — 안내 문장용 */
  hiddenUnpriced: number;
};

/** 정렬 — 판정은 기본 순서, 빠른 순은 미탑재를 맨 뒤, 가격순은 실거래가 오름차순 뒤에 나머지를 기본 순서로 */
export function sortGpuRows(rows: readonly GpuRow[], key: GpuSortKey): GpuRow[] {
  const index = new Map(rows.map((r, i) => [r.gpu.id, i]));
  const byIndex = (a: GpuRow, b: GpuRow) => index.get(a.gpu.id)! - index.get(b.gpu.id)!;
  if (key === 'speed') {
    const tg = (r: GpuRow) => (r.combo.display.fReason === 'no-fit' ? -1 : r.combo.display.result.tgTokS.est);
    return [...rows].sort((a, b) => tg(b) - tg(a) || byIndex(a, b));
  }
  if (key === 'price') {
    const priced = rows.filter((r) => r.street !== undefined).sort((a, b) => a.street!.usd - b.street!.usd || byIndex(a, b));
    return [...priced, ...rows.filter((r) => r.street === undefined)];
  }
  return [...rows];
}

/** 필터·정렬 (가벼움) — 종류, 최소 판정(하드웨어 모드와 같은 `min`), 예산(순위 가격 ≤ 상한) */
export function filterGpuRows(
  result: Pick<ModelRunResult, 'all'>,
  state: Pick<CalcState, 'budget' | 'min' | 'gsort'> & { type: readonly HwType[] },
): GpuView {
  const minRank = state.min ? verdictRank(state.min) : 0;
  const base = result.all.filter(
    (r) => (state.type.length === 0 || state.type.includes(r.type)) && verdictRank(r.combo.baseline.result.verdict) >= minRank,
  );
  const budget = state.budget;
  if (budget === undefined) return { rows: sortGpuRows(base, state.gsort), hiddenUnpriced: 0 };
  return {
    rows: sortGpuRows(
      base.filter((r) => r.street !== undefined && r.street.usd <= budget),
      state.gsort,
    ),
    hiddenUnpriced: base.filter((r) => r.street === undefined).length,
  };
}

export type MineRow = { hardware: ResolvedHardware; combo: ComboAssessment; ctx: number };

/**
 * "내 구성" 행 — 하드웨어 모드에서 넣은 구성(RAM·DDR·OS·화면 출력·GPU 수·직접 입력 사양)으로 대상 모델을 한 번 평가한다.
 * 하드웨어 모드의 그 모델 카드와 같은 호출이다(run.ts). 목록 행은 허브 가정이라 이 행과 다를 수 있다
 */
export function myConfigRow(catalog: CatalogLite, rawState: CalcState, extra?: ExtraModel): MineRow | undefined {
  const state = normalize(rawState, catalog);
  const target = modelTarget(catalog, state, extra);
  if (!target) return undefined;
  const hardware = resolveHardware(state, catalog);
  if (!hardware) return undefined;
  const ctx = Math.min(state.ctx, target.model.maxContext);
  const combo = assessCombo(catalogWith(catalog, extra), hardware.gpu, hardware.config, target.model, {
    ctx,
    kvQuant: state.kv,
    ...(hardware.theoretical || target.external ? { theoretical: true } : {}),
    ramHint: hardware.gpu.kind === 'dgpu',
  });
  return { hardware, combo, ctx };
}
