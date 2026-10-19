/**
 * GPU 대 GPU 비교 (10-19 D106) — 두 GPU 허브 요약(`summarizeGpu`)을 모델 id 로 맞대어 비교 페이지(`/compare/{a}-vs-{b}`)의
 * 수치를 만든다. 엔진 무변경, 순수 함수(Date·random·fs 없음). 포맷팅(반올림·단위·문장)은 UI 레이어 몫(규칙 6).
 *
 * - 행: 같은 모델의 두 조합(각 허브의 요약 구성 — dGPU 는 허브 가정 RAM, 통합·CPU 는 가장 큰 메모리 `primaryIndex`).
 *   기준 양자화는 두 허브가 같은 규칙(`baselineRow`)으로 고르므로 같다. 정렬 = 둘 중 나은 판정 → paramsB 큰 순 → id
 * - 속도 비율: 두 기준 양자화가 **모두** GPU(통합 메모리 풀)에 전부 올라가고 불가가 아닌 행만, `b.est / a.est` 의 중앙값.
 *   **순수 추정끼리만** 비교한다(`estimate` — 실측 조인 값을 섞으면 한쪽만 실측인 행이 비율을 흔든다)
 * - 기준 모델: 그 행들 가운데 가장 큰 모델 — 두 추정 밴드가 겹치는지(겹치면 실제 차이는 더 작을 수 있다)와 pp 범위(대략 ±40%)
 */

import type { TgEstimate } from '@canrun/engine';
import {
  rankableStreet,
  verdictRank,
  type ComboAssessment,
  type ComboPick,
  type GpuHubData,
  type HwConfig,
  type VerdictCounts,
} from './assess';
import { ppRange, type PpRange } from './combo';
import type { Gpu, Model } from './schema';

export type CompareSide = {
  gpu: Gpu;
  /** 비교에 쓰는 구성 — 허브 요약 구성(dGPU = 유일 구성, 통합·CPU = 최대 RAM) */
  config: HwConfig;
  /** 통합 메모리·CPU 프로필의 그 구성 메모리(GB) — 제목·표가 "Apple M4 Pro 64 GB"처럼 밝힌다. dGPU 는 없음 */
  memoryGB?: number;
  counts: VerdictCounts;
  /** 허브 FAQ 와 같은 값 — 그 구성에서 GPU(통합 풀)에 전부 올라가는 가장 큰 모델 */
  largestFullGpu?: ComboPick;
  /** 허브 FAQ 와 같은 값 — 어떤 방식으로든 도는 가장 큰 모델 (CPU 프로필용) */
  largestRunnable?: ComboPick;
  /** 실거래가 — `rankableStreet`(dGPU·priceAsOf 동반)만. 표시 규칙(없으면 출시가)은 페이지 몫 */
  street?: { usd: number; asOf: string };
  /** 공개 실측 행 수 (data/benchmarks.json, 이 GPU) */
  benchmarks: number;
};

export type CompareRow = {
  model: Model;
  a: ComboAssessment;
  b: ComboAssessment;
  /** 기준 판정(배지)이 다른가 */
  verdictDiffers: boolean;
};

export type CompareSpeed = {
  /** b 추정 ÷ a 추정의 중앙값 — 1 보다 크면 b 가 빠르다 */
  ratio: number;
  /** 비율을 낸 모델 수 */
  models: number;
  /** 비율을 낸 모델 가운데 가장 큰 모델의 행 */
  reference: CompareRow;
  /** 기준 모델에서 두 추정 밴드가 겹치는가 */
  overlap: boolean;
  /** 기준 모델의 pp 범위 (docs/02 §3.5 대략 ±40%) — FP16 이 없거나 GPU 에 다 안 올라가면 없음 */
  pp: { a?: PpRange; b?: PpRange };
};

export type GpuComparison = {
  a: CompareSide;
  b: CompareSide;
  /** 두 허브 공통 모델 — 정렬은 파일 머리 주석 */
  rows: CompareRow[];
  /** 기준 판정이 다른 모델 수 */
  differing: number;
  /** 두 기기 모두 GPU 에 전부 올라가는 모델이 없으면 없음 */
  speed?: CompareSpeed;
  /** b ÷ a — FP16 은 둘 다 값이 있을 때만 */
  specRatio: { bandwidth: number; fp16?: number };
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 두 밴드 [low, high] 가 겹치는가 (끝점이 닿아도 겹침) */
export function bandsOverlap(x: TgEstimate, y: TgEstimate): boolean {
  return x.low <= y.high && y.low <= x.high;
}

function side(hub: GpuHubData): CompareSide {
  const config = hub.configs[hub.primaryIndex]!;
  const street = rankableStreet(hub.gpu);
  return {
    gpu: hub.gpu,
    config,
    ...(hub.gpu.kind === 'dgpu' ? {} : { memoryGB: config.ramGB }),
    counts: hub.counts[hub.primaryIndex]!,
    ...(hub.faq.largestFullGpu ? { largestFullGpu: hub.faq.largestFullGpu } : {}),
    ...(hub.faq.largestRunnable ? { largestRunnable: hub.faq.largestRunnable } : {}),
    ...(street ? { street } : {}),
    benchmarks: hub.benchmarks.length,
  };
}

/** 속도 비율에 넣는 조합 — 순수 추정이 GPU(통합 풀)에 전부 올라가고 불가가 아님 */
function fullGpuEstimate(combo: ComboAssessment): boolean {
  const q = combo.baseline;
  return q.fits && q.estimate.mode === 'full-gpu' && q.estimate.verdict !== 'F';
}

const bestRank = (row: CompareRow) =>
  Math.max(verdictRank(row.a.baseline.result.verdict), verdictRank(row.b.baseline.result.verdict));

const byParamsDesc = (x: CompareRow, y: CompareRow) =>
  y.model.paramsB - x.model.paramsB || x.model.id.localeCompare(y.model.id);

export function compareGpus(a: GpuHubData, b: GpuHubData): GpuComparison {
  if (a.gpu.id === b.gpu.id) throw new Error(`compareGpus: ${a.gpu.id} compared with itself`);
  const bRows = new Map(b.rows.map((row) => [row.model.id, row.combos[b.primaryIndex]!]));
  const rows: CompareRow[] = [];
  for (const row of a.rows) {
    const comboB = bRows.get(row.model.id);
    if (!comboB) continue;
    const comboA = row.combos[a.primaryIndex]!;
    if (comboA.baseline.quant !== comboB.baseline.quant) {
      throw new Error(`compareGpus: ${row.model.id} baseline ${comboA.baseline.quant} vs ${comboB.baseline.quant}`);
    }
    rows.push({
      model: row.model,
      a: comboA,
      b: comboB,
      verdictDiffers: comboA.baseline.result.verdict !== comboB.baseline.result.verdict,
    });
  }
  rows.sort((x, y) => bestRank(y) - bestRank(x) || byParamsDesc(x, y));

  const both = rows.filter((row) => fullGpuEstimate(row.a) && fullGpuEstimate(row.b));
  let speed: CompareSpeed | undefined;
  if (both.length > 0) {
    const reference = [...both].sort(byParamsDesc)[0]!;
    const ppA = ppRange({ fits: reference.a.baseline.fits, result: reference.a.baseline.estimate });
    const ppB = ppRange({ fits: reference.b.baseline.fits, result: reference.b.baseline.estimate });
    speed = {
      ratio: median(both.map((row) => row.b.baseline.estimate.tgTokS.est / row.a.baseline.estimate.tgTokS.est)),
      models: both.length,
      reference,
      overlap: bandsOverlap(reference.a.baseline.estimate.tgTokS, reference.b.baseline.estimate.tgTokS),
      pp: { ...(ppA ? { a: ppA } : {}), ...(ppB ? { b: ppB } : {}) },
    };
  }

  const fp16 =
    a.gpu.fp16Tflops !== undefined && b.gpu.fp16Tflops !== undefined && a.gpu.fp16Tflops > 0
      ? b.gpu.fp16Tflops / a.gpu.fp16Tflops
      : undefined;

  return {
    a: side(a),
    b: side(b),
    rows,
    differing: rows.filter((row) => row.verdictDiffers).length,
    ...(speed ? { speed } : {}),
    specRatio: {
      bandwidth: b.gpu.memBandwidthGBs / a.gpu.memBandwidthGBs,
      ...(fp16 !== undefined ? { fp16 } : {}),
    },
  };
}
