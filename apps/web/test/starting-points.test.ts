/**
 * 계산기 첫 화면 결과 예시 (10-14 PROGRESS §4 D73) — 서버 HTML 에 싣는 "많이 쓰는 하드웨어" 예시가 실제 계산기 결과와 어긋나지 않는다:
 * 크기 구간마다 고른 모델 = 계산기에서 그 하드웨어를 고르고 크기 필터를 그 구간 하나만 켰을 때 맨 위 카드(판정·양자화·속도 밴드·라벨·실행 방식),
 * 요약 수·평가 구성 = 계산기 기본 상태의 결과. 콤보 링크는 공개(index) 콤보만. 하드웨어마다 달라지는 줄(GPU 에 전부 올라가는 가장 큰 모델,
 * 불가 구간의 RAM 힌트)은 허브 FAQ·계산기 카드와 같은 값이다(D73 리뷰 반영).
 */
import { HUB_POLICY, verdictRank } from '@canrun/data';
import { describe, expect, it } from 'vitest';
import { getCatalogLite } from '../lib/calc-catalog';
import { assembleResults } from '../lib/calc/run';
import { DDR_PROFILE, defaultState, SIZE_BUCKETS, sizeBucket, type CalcState } from '../lib/calc/state';
import { catalog } from '../lib/catalog';
import { getGpuHub } from '../lib/hubs';
import { isComboIndexable } from '../lib/publish';
import { STARTING_POINT_GPU_IDS, startingPoint, startingPoints } from '../lib/starting-points';

const lite = getCatalogLite();
const withGpu = (gpuId: string, extra: Partial<CalcState> = {}): CalcState => ({
  ...defaultState(),
  hardware: { kind: 'catalog', gpuId },
  ...extra,
});

describe('calculator starting points (D73)', () => {
  it('lists six distinct popular catalog GPUs, graphics cards and unified memory both', () => {
    expect(STARTING_POINT_GPU_IDS).toHaveLength(6);
    expect(new Set(STARTING_POINT_GPU_IDS).size).toBe(STARTING_POINT_GPU_IDS.length);
    const gpus = STARTING_POINT_GPU_IDS.map((id) => catalog.gpus.find((g) => g.id === id));
    for (const [i, gpu] of gpus.entries()) {
      expect(gpu, STARTING_POINT_GPU_IDS[i]).toBeDefined();
      expect(gpu!.popular, gpu!.id).toBe(true);
    }
    expect(gpus.some((g) => g!.kind === 'dgpu')).toBe(true);
    expect(gpus.some((g) => g!.kind === 'unified')).toBe(true);
    expect(startingPoints().map((p) => p.gpu.id)).toEqual([...STARTING_POINT_GPU_IDS]);
  });

  it('each size class shows the top card the calculator shows with only that size filter on', () => {
    for (const gpuId of STARTING_POINT_GPU_IDS) {
      const point = startingPoint(gpuId);
      const present = SIZE_BUCKETS.filter((b) => catalog.models.some((m) => sizeBucket(m.paramsB) === b));
      expect(point.picks.map((p) => p.bucket), gpuId).toEqual(present);
      for (const pick of point.picks) {
        const run = assembleResults(lite, withGpu(gpuId, { size: [pick.bucket] }))!;
        const top = run.cards[0]!;
        const where = `${gpuId}/${pick.bucket}`;
        if (pick.kind === 'pick') {
          expect(top.model.id, where).toBe(pick.model.id);
          expect(top.combo.baseline.result.verdict, where).toBe(pick.combo.baseline.result.verdict);
          expect(pick.combo.baseline.result.verdict, where).not.toBe('F');
          expect(top.combo.display.quant, where).toBe(pick.combo.display.quant);
          expect(top.combo.display.result.tgTokS, where).toEqual(pick.combo.display.result.tgTokS);
          expect(top.combo.display.result.confidence, where).toBe(pick.combo.display.result.confidence);
          expect(top.combo.display.result.mode, where).toBe(pick.combo.display.result.mode);
          expect(pick.comboIndexable, where).toBe(isComboIndexable(gpuId, pick.model.id));
        } else {
          // 추천순은 불가를 맨 뒤에 둔다 — 맨 위가 불가면 그 구간 전부 불가
          expect(run.cards.every((c) => c.combo.baseline.result.verdict === 'F'), where).toBe(true);
          expect(run.cards.length, where).toBe(pick.models);
          expect(run.cards.filter((c) => c.combo.recommended).length, where).toBe(pick.lowerQuant);
        }
      }
    }
  });

  it('the summary line and the evaluated memory match the calculator defaults for that hardware', () => {
    for (const gpuId of STARTING_POINT_GPU_IDS) {
      const point = startingPoint(gpuId);
      const run = assembleResults(lite, withGpu(gpuId))!;
      expect(point.total, gpuId).toBe(run.all.length);
      expect(point.good, gpuId).toBe(run.counts.S + run.counts.A);
      expect(point.ramGB, gpuId).toBe(run.hardware.ramGB);
      expect(point.os, gpuId).toBe(run.hardware.os);
    }
  });

  it('the largest model that fits entirely on the GPU is the GPU hub answer, and no bigger model fits there (D73 review)', () => {
    for (const gpuId of STARTING_POINT_GPU_IDS) {
      const point = startingPoint(gpuId);
      const hub = getGpuHub(gpuId)!;
      const largest = point.largest!;
      expect(largest, gpuId).toBeDefined();
      expect(largest.model.id, gpuId).toBe(hub.faq.largestFullGpu!.combo.modelId);
      expect(largest.q.result.mode, gpuId).toBe('full-gpu');
      expect(largest.q.result.verdict, gpuId).not.toBe('F');
      expect(largest.q.tier, gpuId).not.toBe('desperate');
      expect(largest.comboIndexable, gpuId).toBe(isComboIndexable(gpuId, largest.model.id));
      for (const row of hub.rows.filter((r) => r.model.paramsB > largest.model.paramsB)) {
        const fits = row.combos[hub.primaryIndex]!.perQuant.some(
          (q) => q.result.mode === 'full-gpu' && q.result.verdict !== 'F' && q.tier !== 'desperate',
        );
        expect(fits, `${gpuId}: ${row.model.id} is bigger and also fits on the GPU`).toBe(false);
      }
    }
  });

  it('a size class that cannot run names the RAM hint the calculator card shows, at the smallest RAM in that class (D73 review)', () => {
    let hints = 0;
    for (const gpuId of STARTING_POINT_GPU_IDS) {
      for (const pick of startingPoint(gpuId).picks) {
        if (pick.kind !== 'none') continue;
        const cards = assembleResults(lite, withGpu(gpuId, { size: [pick.bucket] }))!.cards;
        const hinted = cards.filter((c) => c.combo.ramHint);
        const where = `${gpuId}/${pick.bucket}`;
        if (!pick.ramHint) {
          expect(hinted, where).toEqual([]);
          continue;
        }
        hints += 1;
        const card = cards.find((c) => c.model.id === pick.ramHint!.model.id)!;
        expect(card.combo.ramHint?.ramGB, where).toBe(pick.ramHint.ramGB);
        expect(card.combo.ramHint?.verdict, where).toBe(pick.ramHint.verdict);
        expect(verdictRank(pick.ramHint.verdict), where).toBeGreaterThan(verdictRank('F'));
        expect(Math.min(...hinted.map((c) => c.combo.ramHint!.ramGB)), where).toBe(pick.ramHint.ramGB);
      }
    }
    // 그래픽카드 넷의 50B 이상 구간이 지금 모두 불가 — 힌트가 하나도 없으면 이 검사가 빈 검사가 된다
    expect(hints).toBeGreaterThan(0);
  });

  it('the fixed wording matches the hub policy: DDR5-5600 system RAM and the baseline quant fallback named for gpt-oss', () => {
    // CalculatorStatic.startAssume 은 "DDR5-5600" 을, readVerdict 는 "(gpt-oss → 두 번째 기준 양자화)" 를 문장으로 적는다
    expect(HUB_POLICY.dgpuRamProfileId).toBe(DDR_PROFILE['ddr5-5600']);
    expect(HUB_POLICY.baselineOrder.length).toBeGreaterThanOrEqual(2);
    const gptOss = catalog.models.filter((m) => m.id.startsWith('gpt-oss'));
    expect(gptOss.length).toBeGreaterThan(0);
    const hub = getGpuHub('rtx-3090')!;
    for (const model of gptOss) {
      const row = hub.rows.find((r) => r.model.id === model.id)!;
      expect(row.combos[hub.primaryIndex]!.baseline.quant, model.id).toBe(HUB_POLICY.baselineOrder[1]);
    }
  });
});
