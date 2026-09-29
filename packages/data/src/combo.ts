/**
 * 콤보 페이지 조립 (docs/04 §4 8요소 중 데이터가 필요한 것) — 엔진 무변경, 순수 함수.
 *
 *  - ctxMatrix: ctx × KV quant 별 메모리·판정·속도 (정적 표 — 인터랙션은 P1-3, 결정 D11)
 *  - vramBreakdown: 가중치·KV·버퍼·OS 예약 + RAM 몫 (분해 바)
 *  - ppRange: 프롬프트 처리 추정 — docs/02 §3.5 "대략 ±40%", full-gpu 이고 fit 일 때만 (D13)
 *  - alternatives: 대안 0~3 (더 큰/작은 모델 · 다른 quant · 실행 방식/RAM/칩/GPU)
 *  - adjacentCombos: 인접 콤보 4 (같은 GPU 모델 2, 같은 모델 GPU 2) — 공개 페이지는 공개 풀만 (D9)
 *  - twinGpus: 메모리 구성이 같은 쌍둥이 GPU (D22)
 */

import {
  computeBufferGB,
  kvGB,
  VERDICT_THRESHOLDS,
  type KvQuant,
  type QuantId,
  type Result,
  type Verdict,
} from '@canrun/engine';
import {
  estimateAt,
  HUB_POLICY,
  verdictRank,
  type ComboAssessment,
  type GpuHubData,
  type HwConfig,
  type ModelHubData,
  type PricedOption,
  type QuantAssessment,
  type SeedCatalog,
} from './assess';
import { comboKey, comboPublishState, indexableCombos } from './publish';
import type { Gpu, Model, PublishPlan } from './schema';

// ---------------------------------------------------------------------------
// pp — docs/02 §3.5
// ---------------------------------------------------------------------------

/** pp 표기 밴드 — "대략" 수준(±40%), 콤보의 pp 는 4번째 신뢰 라벨 `rough` 로 표시 (D13). */
// source: docs/02 §3.5 (policy)
export const PP_BAND = 0.4;

export type PpRange = { est: number; low: number; high: number; band: number };

/** full-gpu(통합 포함)이고 fit 일 때만 — ppEstimate 는 fp16 연산식이라 다른 모드엔 성립하지 않는다. */
export function ppRange(q: Pick<QuantAssessment, 'fits' | 'result'>): PpRange | undefined {
  const est = q.result.ppTokS?.est;
  if (!q.fits || q.result.mode !== 'full-gpu' || est === undefined) return undefined;
  return { est, low: est * (1 - PP_BAND), high: est * (1 + PP_BAND), band: PP_BAND };
}

// ---------------------------------------------------------------------------
// ctx × KV 행렬
// ---------------------------------------------------------------------------

export type CtxCell = {
  ctx: number;
  kvQuant: KvQuant;
  kvGB: number;
  totalNeedGB: number;
  /** 엔진이 비교하는 필요량 — CPU 경로는 가중치 + KV (MemoryNeed.needGB 와 같은 규칙) */
  needGB: number;
  fits: boolean;
  mode: Result['mode'];
  gpuFrac?: number;
  verdict: Verdict;
  result: Result;
};

export type CtxMatrix = {
  ctxs: number[];
  kvQuants: KvQuant[];
  /** rows[ctxIndex][kvIndex] */
  rows: CtxCell[][];
};

const DEFAULT_KV: readonly KvQuant[] = ['f16', 'q8_0', 'q4_0'];

export function ctxMatrix(
  gpu: Gpu,
  config: HwConfig,
  model: Model,
  q: Pick<QuantAssessment, 'quant' | 'fileGB'> & Partial<Pick<QuantAssessment, 'result'>>,
  opts: { ctxs?: readonly number[]; kvQuants?: readonly KvQuant[] } = {},
): CtxMatrix {
  const ctxs = (opts.ctxs ?? HUB_POLICY.matrixCtx).filter((ctx) => ctx <= model.maxContext);
  const kvQuants = [...(opts.kvQuants ?? DEFAULT_KV)];
  const rows = ctxs.map((ctx) =>
    kvQuants.map((kvQuant): CtxCell => {
      const { fit, result: estimated } = estimateAt(gpu, config, model, q, { ctx, kvQuant });
      // 페이지 헤드라인(8k·f16)이 실측 조인이면 같은 조건의 셀도 그 값을 쓴다 — 한 페이지에 두 tok/s 가 없도록
      const result =
        q.result?.confidence === 'measured' && ctx === HUB_POLICY.referenceCtx && kvQuant === 'f16' && fit.fits
          ? q.result
          : estimated;
      const kv = kvGB(model.arch.kvBytesPerTokenF16, ctx, kvQuant);
      const cpuPath = gpu.kind === 'cpu' || (fit.fits && fit.mode === 'cpu-only');
      return {
        ctx,
        kvQuant,
        kvGB: kv,
        // fit 이 실패한 셀도 필요량은 보여야 한다 — 엔진 breakdown 은 미탑재 시 0 을 돌려준다
        totalNeedGB: q.fileGB + kv + computeBufferGB(ctx),
        needGB: cpuPath ? q.fileGB + kv : q.fileGB + kv + computeBufferGB(ctx),
        fits: fit.fits,
        mode: fit.mode,
        ...(fit.gpuFrac !== undefined ? { gpuFrac: fit.gpuFrac } : {}),
        verdict: result.verdict,
        result,
      };
    }),
  );
  return { ctxs, kvQuants, rows };
}

/**
 * 판정이 `verdict` 이상으로 유지되는 최대 ctx (KV quant 별) — FAQ "컨텍스트는 얼마까지" 용.
 * 작은 ctx 부터 훑다가 미탑재이거나 판정이 낮아지는 첫 셀에서 멈춘다 (4k 가 S 이고 8k 가 A 여도 A 기준이면 계속).
 */
export function maxCtxAtVerdict(matrix: CtxMatrix, kvQuant: KvQuant, verdict: Verdict): number | undefined {
  const kvIndex = matrix.kvQuants.indexOf(kvQuant);
  if (kvIndex < 0) return undefined;
  const floor = verdictRank(verdict);
  let best: number | undefined;
  for (const row of matrix.rows) {
    const cell = row[kvIndex]!;
    if (!cell.fits || verdictRank(cell.verdict) < floor) break;
    best = cell.ctx;
  }
  return best;
}

// ---------------------------------------------------------------------------
// VRAM 분해
// ---------------------------------------------------------------------------

export type VramBreakdown = {
  gpu: {
    weights: number;
    kv: number;
    buffer: number;
    osReserve: number;
    total: number;
    limit: number;
    usable: number;
  };
  ram: { weights: number; usable: number };
};

export function vramBreakdown(q: QuantAssessment): VramBreakdown {
  const v = q.result.vram;
  return {
    gpu: {
      weights: v.weights,
      kv: v.kv,
      buffer: v.buffer,
      osReserve: v.osReserve,
      total: v.total,
      limit: v.limit,
      usable: q.memory.gpuUsableGB,
    },
    ram: { weights: q.memory.ramGB, usable: q.memory.ramUsableGB },
  };
}

// ---------------------------------------------------------------------------
// 쌍둥이 GPU (D22)
// ---------------------------------------------------------------------------

/** 메모리 구성(kind·VRAM/RAM 옵션·대역폭·클래스)이 같아 생성 속도가 동일한 GPU — FP16 만 다르다. */
export function twinGpus(gpu: Gpu, gpus: readonly Gpu[]): Gpu[] {
  const key = (g: Gpu) =>
    [g.kind, g.vramGB ?? '', (g.ramOptionsGB ?? []).join('/'), g.memBandwidthGBs, g.effClass].join('|');
  const mine = key(gpu);
  return gpus.filter((g) => g.id !== gpu.id && key(g) === mine).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 대안 (docs/04 §4 ⑥)
// ---------------------------------------------------------------------------

export type Alternative =
  | { kind: 'larger-model' | 'smaller-model' | 'faster-model'; model: Model; combo: ComboAssessment }
  | { kind: 'lower-quant' | 'higher-quant'; q: QuantAssessment; desperate: boolean }
  | { kind: 'cpu-moe'; nCpuMoe: number; nCpuMoeMin?: number }
  | { kind: 'ram-upgrade'; ramGB: number; quant: QuantId; verdict: Verdict; result: Result }
  | { kind: 'ram-config'; ramGB: number; combo: ComboAssessment }
  | { kind: 'chip'; gpu: Gpu; combo: ComboAssessment }
  | { kind: 'gpu'; option: PricedOption };

export type AlternativesInput = {
  catalog: SeedCatalog;
  gpu: Gpu;
  /** 이 GPU 의 허브 데이터 (같은 GPU 다른 모델) */
  gpuHub: GpuHubData;
  configIndex: number;
  /** 이 모델의 허브 데이터 (다른 GPU·칩) */
  modelHub: ModelHubData;
  model: Model;
  combo: ComboAssessment;
  nCpuMoeMin?: number;
};

const A_RANK = verdictRank('A');

/** (a) 더 큰/작은 모델 · (b) 다른 quant · (c) 실행 방식/RAM/칩/GPU — 각 0~1개. */
export function alternatives(input: AlternativesInput): Alternative[] {
  const { gpu, gpuHub, configIndex, modelHub, model, combo } = input;
  const out: Alternative[] = [];
  const rank = verdictRank(combo.baseline.result.verdict);
  const rows = gpuHub.rows.map((row) => ({ model: row.model, combo: row.combos[configIndex]! }));

  // (a) 모델
  const sameOrBetterA = rows.filter((r) => verdictRank(r.combo.baseline.result.verdict) >= A_RANK);
  if (rank >= A_RANK) {
    const larger = sameOrBetterA
      .filter((r) => r.model.paramsB > model.paramsB)
      .sort((a, b) => b.model.paramsB - a.model.paramsB || a.model.id.localeCompare(b.model.id))[0];
    if (larger) out.push({ kind: 'larger-model', model: larger.model, combo: larger.combo });
  } else {
    const smaller = sameOrBetterA
      .filter((r) => r.model.paramsB < model.paramsB)
      .sort((a, b) => b.model.paramsB - a.model.paramsB || a.model.id.localeCompare(b.model.id))[0];
    if (smaller) {
      out.push({ kind: 'smaller-model', model: smaller.model, combo: smaller.combo });
    } else {
      // CPU 프로필처럼 어떤 모델도 A 에 못 미치는 구성: 같은 판정에서 더 빠른 모델
      const faster = rows
        .filter(
          (r) =>
            r.model.id !== model.id &&
            verdictRank(r.combo.baseline.result.verdict) === rank &&
            r.combo.baseline.result.verdict !== 'F' &&
            r.combo.baseline.result.tgTokS.est > combo.baseline.result.tgTokS.est,
        )
        .sort((a, b) => b.model.paramsB - a.model.paramsB || a.model.id.localeCompare(b.model.id))[0];
      if (faster) out.push({ kind: 'faster-model', model: faster.model, combo: faster.combo });
    }
  }

  // (b) quant
  if (combo.recommended && combo.recommended.quant !== combo.baseline.quant) {
    out.push({
      kind: 'lower-quant',
      q: combo.recommended,
      desperate: combo.recommended.tier === 'desperate',
    });
  } else if (combo.lastResort) {
    out.push({ kind: 'lower-quant', q: combo.lastResort, desperate: true });
  } else if (combo.baseline.result.verdict === 'S') {
    const higher = combo.perQuant
      .filter(
        (q) => q.tier !== 'desperate' && q.fileGB > combo.baseline.fileGB && q.result.verdict === 'S',
      )
      .sort((a, b) => b.fileGB - a.fileGB)[0];
    if (higher) out.push({ kind: 'higher-quant', q: higher, desperate: false });
  }

  // (c) 실행 방식 · RAM · 칩 · GPU
  const display = combo.display;
  if (display.fits && display.result.mode === 'cpu-moe') {
    out.push({
      kind: 'cpu-moe',
      nCpuMoe: model.arch.layers,
      ...(input.nCpuMoeMin !== undefined ? { nCpuMoeMin: input.nCpuMoeMin } : {}),
    });
  } else if (
    combo.ramHint &&
    (!display.fits || verdictRank(combo.ramHint.verdict) > verdictRank(display.result.verdict))
  ) {
    // RAM 증설이 표시 quant 의 판정보다 나아질 때만 (desperate quant 로 이미 B 인데 "64GB 면 B" 는 무의미)
    out.push({
      kind: 'ram-upgrade',
      ramGB: combo.ramHint.ramGB,
      quant: combo.ramHint.q.quant,
      verdict: combo.ramHint.verdict,
      result: combo.ramHint.result,
    });
  } else if (gpu.kind !== 'dgpu') {
    const better = gpuHub.rows
      .find((row) => row.model.id === model.id)
      ?.combos.find(
        (c, i) => i > configIndex && verdictRank(c.baseline.result.verdict) > rank,
      );
    if (better) {
      out.push({ kind: 'ram-config', ramGB: better.ramGB, combo: better });
    } else if (gpu.kind === 'unified') {
      // 같은 vendor 의 다음 티어 칩 (대역폭 오름차순) 중 기준 판정이 오르는 첫 칩
      const chip = modelHub.gpuRows
        .filter(
          (r) =>
            r.gpu.kind === 'unified' &&
            r.gpu.vendor === gpu.vendor &&
            r.gpu.memBandwidthGBs > gpu.memBandwidthGBs &&
            verdictRank(r.combo.baseline.result.verdict) > rank,
        )
        .sort((a, b) => a.gpu.memBandwidthGBs - b.gpu.memBandwidthGBs || a.gpu.id.localeCompare(b.gpu.id))[0];
      if (chip) out.push({ kind: 'chip', gpu: chip.gpu, combo: chip.combo });
      else if (rank < verdictRank('S') && modelHub.cheapest.great) {
        out.push({ kind: 'gpu', option: modelHub.cheapest.great });
      }
    }
  } else if (rank < verdictRank('S') && modelHub.cheapest.great) {
    out.push({ kind: 'gpu', option: modelHub.cheapest.great });
  }

  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// 인접 콤보 (docs/04 §2 ④)
// ---------------------------------------------------------------------------

export type AdjacentCombos = {
  /** 같은 GPU, 파라미터 수가 바로 아래·위인 모델 (최대 2) */
  models: Model[];
  /** 같은 모델, 메모리가 가장 가까운 GPU (같은 kind 우선, 최대 2) */
  gpus: Gpu[];
  /** 이 페이지가 공개(index) 상태라 공개 풀만 썼는가 */
  restricted: boolean;
};

function memoryKey(gpu: Gpu): number {
  return gpu.kind === 'dgpu' ? (gpu.vramGB ?? 0) : Math.max(...(gpu.ramOptionsGB ?? [0]));
}

export function adjacentCombos(
  catalog: SeedCatalog,
  publish: PublishPlan,
  gpu: Gpu,
  model: Model,
): AdjacentCombos {
  const restricted = comboPublishState(publish, gpu.id, model.id).indexable;
  const pool = restricted ? indexableCombos(publish) : undefined;
  const allowed = (g: Gpu, m: Model) => pool === undefined || pool.has(comboKey(g.id, m.id));

  // 같은 GPU — 모델 바로 아래·위
  const modelPool = catalog.models.filter((m) => m.id !== model.id && allowed(gpu, m));
  const below = modelPool
    .filter((m) => m.paramsB <= model.paramsB)
    .sort((a, b) => b.paramsB - a.paramsB || a.id.localeCompare(b.id));
  const above = modelPool
    .filter((m) => m.paramsB > model.paramsB)
    .sort((a, b) => a.paramsB - b.paramsB || a.id.localeCompare(b.id));
  const models = [below[0], above[0]].filter((m): m is Model => m !== undefined);
  for (const extra of [below[1], above[1]]) {
    if (models.length >= 2) break;
    if (extra) models.push(extra);
  }

  // 같은 모델 — 메모리 근접, 같은 kind 우선
  const mine = memoryKey(gpu);
  const gpuPool = catalog.gpus.filter((g) => g.id !== gpu.id && allowed(g, model));
  const byDistance = (a: Gpu, b: Gpu) =>
    Math.abs(memoryKey(a) - mine) - Math.abs(memoryKey(b) - mine) ||
    Number(b.form === gpu.form) - Number(a.form === gpu.form) ||
    Math.abs(a.memBandwidthGBs - gpu.memBandwidthGBs) - Math.abs(b.memBandwidthGBs - gpu.memBandwidthGBs) ||
    a.id.localeCompare(b.id);
  const sameKind = gpuPool.filter((g) => g.kind === gpu.kind).sort(byDistance);
  const otherKind = gpuPool.filter((g) => g.kind !== gpu.kind).sort(byDistance);
  const gpus = [...sameKind, ...otherKind].slice(0, 2);

  return { models, gpus, restricted };
}

// ---------------------------------------------------------------------------
// 판정 요약 헬퍼 (제목·문장용)
// ---------------------------------------------------------------------------

/** 제목에 쓰는 판정 (D14): 기준 비-F → 기준 / F + 비-desperate 추천 → 그 quant / RAM 힌트 / 그 외 F */
export type TitleVerdict =
  | { kind: 'baseline'; verdict: Verdict }
  | { kind: 'quant'; verdict: Verdict; quant: string }
  | { kind: 'ram'; verdict: Verdict; ramGB: number }
  | { kind: 'none'; verdict: 'F' };

export function titleVerdict(combo: ComboAssessment): TitleVerdict {
  const base = combo.baseline.result.verdict;
  if (base !== 'F') return { kind: 'baseline', verdict: base };
  // 추천이 desperate(품질 손실 큼)여도 그 quant 가 본문의 표시 quant·판정 문장이므로 제목도 같은 답을 낸다
  // ("RAM 64GB면 …" 으로 새면 본문과 모순). 품질 손실 경고는 본문 몫
  if (combo.recommended) {
    return { kind: 'quant', verdict: combo.recommended.result.verdict, quant: combo.recommended.quant };
  }
  if (combo.ramHint) return { kind: 'ram', verdict: combo.ramHint.verdict, ramGB: combo.ramHint.ramGB };
  return { kind: 'none', verdict: 'F' };
}

/** 리즈닝 모델의 S 임계 (cpu-moe 사유 문구 등) */
export function sMinTokS(reasoning: boolean): number {
  return VERDICT_THRESHOLDS.sMinTg * (reasoning ? VERDICT_THRESHOLDS.reasoningMultiplier : 1);
}
