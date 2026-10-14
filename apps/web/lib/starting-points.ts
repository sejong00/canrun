/**
 * 계산기 첫 화면 "많이 쓰는 하드웨어에서 돌아가는 모델" (10-14 PROGRESS §4 D73) — 서버 전용, 빌드 때 계산한다.
 * 결과는 하이드레이션 뒤에만 그려지므로(D36) JS 가 없는 방문자·크롤러에게도 보이는 결과 예시를 서버 HTML 에 싣는다.
 *
 * 값은 GPU 허브와 같은 요약(`getGpuHub` — 허브 가정 D2, 통합·CPU 는 가장 큰 메모리 구성 = 계산기 기본값)이고, 크기 구간마다
 * 계산기 추천순(`sortCards(…, 'rec')`, D68)의 첫 모델을 고른다. 계산기에서 그 하드웨어를 고르고 크기 필터를 하나만 켰을 때
 * 맨 위 카드와 같다 — `apps/web/test/starting-points.test.ts` 가 `assembleResults` 와 대조한다.
 *
 * 추천순은 같은 구간 안에서 인기도를 먼저 보므로 인기 모델이 여러 하드웨어에서 되풀이된다(같은 모델의 판정·속도·실행 방식을
 * 하드웨어끼리 견줄 수 있다). 하드웨어마다 달라지는 내용은 두 가지를 더한다(D73 리뷰 반영): GPU 에 전부 올라가는 가장 큰 모델
 * (허브 FAQ 와 같은 `faq.largestFullGpu`), 구간 전체가 불가인 그래픽카드 구간의 RAM 힌트(계산기 카드의 "RAM N GB라면"과 같은 값).
 */
import { verdictRank, type ComboAssessment, type Gpu, type Model, type QuantAssessment } from '@canrun/data';
import type { Os, Verdict } from '@canrun/engine';
import { sortCards } from './calc/result-sort';
import { SIZE_BUCKETS, sizeBucket, type SizeBucket } from './calc/state';
import { getGpuHub } from './hubs';
import { isComboIndexable } from './publish';

/**
 * 보여 줄 하드웨어 — 메모리 등급마다 많이 쓰는 것 하나: 8·12·16·24GB 그래픽카드, 맥, 통합 메모리 PC (전부 카탈로그 `popular`).
 * UI 정책 (엔진 상수 아님)
 */
// source: docs/04 §2 (policy)
export const STARTING_POINT_GPU_IDS = ['rtx-4060', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'apple-m4-pro', 'amd-strix-halo'] as const;

/** 시스템 RAM 을 늘리면 나아지는 모델 하나 — 계산기 카드의 RAM 힌트(`combo.ramHint`)와 같은 값 */
export type StartingRamHint = { model: Model; ramGB: number; verdict: Verdict };

/**
 * 크기 구간 하나의 결과. `pick` = 추천순 첫 모델(판정이 불가가 아님). `none` = 그 구간 첫 모델이 불가 — 추천순은 불가를 맨 뒤에 두므로
 * 구간의 모든 모델이 불가다. `lowerQuant` = 그중 더 낮은 양자화로는 돌아가는 모델 수(계산기 요약의 "양자화를 낮추면 N개" 와 같은 규칙).
 * `ramHint` = 그중 시스템 RAM 을 가장 적게 늘려도 나아지는 모델(같으면 판정이 좋은 것 → 인기 → 큰 것 → id)
 */
export type StartingPick =
  | { kind: 'pick'; bucket: SizeBucket; model: Model; combo: ComboAssessment; comboIndexable: boolean }
  | { kind: 'none'; bucket: SizeBucket; models: number; lowerQuant: number; ramHint?: StartingRamHint };

/** GPU 에 전부 올라가는 가장 큰 모델과 그 양자화(기준 우선, 없으면 2비트가 아닌 가장 큰 파일 — 허브 FAQ 와 같은 규칙) */
export type StartingLargest = { model: Model; q: QuantAssessment; reasoning: boolean; comboIndexable: boolean };

export type StartingPoint = {
  gpu: Gpu;
  /** 평가 구성 — dGPU 는 시스템 RAM(허브 가정), 통합·CPU 는 메모리 용량 */
  ramGB: number;
  os: Os;
  /** 카탈로그 모델 수 · 쾌적 또는 원활 수 */
  total: number;
  good: number;
  picks: StartingPick[];
  largest?: StartingLargest;
};

type Card = { model: Model; combo: ComboAssessment };

function ramHintOf(cards: readonly Card[]): StartingRamHint | undefined {
  const best = cards
    .filter((c): c is Card & { combo: Required<Pick<ComboAssessment, 'ramHint'>> } => c.combo.ramHint !== undefined)
    .sort(
      (a, b) =>
        a.combo.ramHint.ramGB - b.combo.ramHint.ramGB ||
        verdictRank(b.combo.ramHint.verdict) - verdictRank(a.combo.ramHint.verdict) ||
        b.model.popularity - a.model.popularity ||
        b.model.paramsB - a.model.paramsB ||
        a.model.id.localeCompare(b.model.id),
    )[0];
  return best ? { model: best.model, ramGB: best.combo.ramHint.ramGB, verdict: best.combo.ramHint.verdict } : undefined;
}

export function startingPoint(gpuId: string): StartingPoint {
  const hub = getGpuHub(gpuId);
  if (!hub) throw new Error(`starting point: unknown GPU '${gpuId}'`);
  const config = hub.configs[hub.primaryIndex]!;
  const sorted = sortCards(
    hub.rows.map((row) => ({ model: row.model, combo: row.combos[hub.primaryIndex]! })),
    'rec',
  );
  const picks = SIZE_BUCKETS.flatMap((bucket): StartingPick[] => {
    const inBucket = sorted.filter((c) => sizeBucket(c.model.paramsB) === bucket);
    const first = inBucket[0];
    if (!first) return [];
    if (first.combo.baseline.result.verdict === 'F') {
      const ramHint = ramHintOf(inBucket);
      return [
        {
          kind: 'none',
          bucket,
          models: inBucket.length,
          lowerQuant: inBucket.filter((c) => c.combo.recommended).length,
          ...(ramHint ? { ramHint } : {}),
        },
      ];
    }
    return [{ kind: 'pick', bucket, model: first.model, combo: first.combo, comboIndexable: isComboIndexable(gpuId, first.model.id) }];
  });
  const counts = hub.counts[hub.primaryIndex]!;
  const full = hub.faq.largestFullGpu;
  const fullModel = full && hub.rows.find((row) => row.model.id === full.combo.modelId)?.model;
  const largest: StartingLargest | undefined =
    full && fullModel
      ? { model: fullModel, q: full.q, reasoning: full.combo.reasoning, comboIndexable: isComboIndexable(gpuId, fullModel.id) }
      : undefined;
  return {
    gpu: hub.gpu,
    ramGB: config.ramGB,
    os: config.hw.os,
    total: hub.rows.length,
    good: counts.S + counts.A,
    picks,
    ...(largest ? { largest } : {}),
  };
}

export function startingPoints(): StartingPoint[] {
  return STARTING_POINT_GPU_IDS.map((id) => startingPoint(id));
}
