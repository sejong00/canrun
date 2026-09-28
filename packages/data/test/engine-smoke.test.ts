/**
 * AC (docs/06 P0-3): 전 (GPU × 모델 × quant) 조합 엔진 스모크 — NaN/음수 0건.
 *
 * 조합 구성:
 *  - 하드웨어: 허브와 같은 구성 (assess.ts hardwareConfigs — dgpu 32GB DDR5-5600 가정, 통합·CPU 는 RAM 옵션 전부)
 *  - quant: 모델별 등록 quant (model-quants) + 미등록 대비 Q4_K_M bpw 폴백 1점
 */
import { evaluate, type Hardware, type ModelQuant, type Verdict } from '@canrun/engine';
import { describe, expect, it } from 'vitest';
import { hardwareConfigs, toModelQuant, type Gpu, type Model } from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();

function hardwareVariants(gpu: Gpu): Hardware[] {
  return hardwareConfigs(gpu, seed.gpus).map((config) => config.hw);
}

function modelQuantVariants(model: Model): ModelQuant[] {
  const registered = seed.modelQuants.filter((mq) => mq.modelId === model.id);
  const variants: ModelQuant[] = registered.map((mq) => toModelQuant(model, mq));
  // bpw 폴백 경로도 조합에 포함 (fileGB 미등록 quant 재현)
  variants.push(toModelQuant(model));
  return variants;
}

describe('engine smoke over the full seed matrix', () => {
  const verdictCounts: Record<Verdict, number> = { S: 0, A: 0, B: 0, F: 0 };
  let combos = 0;

  it('produces finite, non-negative numbers for every combination', () => {
    for (const gpu of seed.gpus) {
      for (const hw of hardwareVariants(gpu)) {
        for (const model of seed.models) {
          for (const mq of modelQuantVariants(model)) {
            const r = evaluate(hw, mq, {
              reasoning: model.category.includes('reasoning'),
            });
            combos += 1;
            verdictCounts[r.verdict] += 1;

            const numbers: Array<[string, number]> = [
              ['vram.weights', r.vram.weights],
              ['vram.kv', r.vram.kv],
              ['vram.buffer', r.vram.buffer],
              ['vram.osReserve', r.vram.osReserve],
              ['vram.total', r.vram.total],
              ['vram.limit', r.vram.limit],
              ['tgTokS.est', r.tgTokS.est],
              ['tgTokS.low', r.tgTokS.low],
              ['tgTokS.high', r.tgTokS.high],
            ];
            if (r.ppTokS) numbers.push(['ppTokS.est', r.ppTokS.est]);

            for (const [label, value] of numbers) {
              expect(
                Number.isFinite(value) && value >= 0,
                `${gpu.id} × ${mq.quant} ${model.id} → ${label} = ${value}`,
              ).toBe(true);
            }
          }
        }
      }
    }
    // AC 리포트용 통계
    console.log(`[engine-smoke] combos=${combos}`, verdictCounts);
    expect(combos).toBeGreaterThan(4000);
  });

  it('spans the verdict spectrum (S와 F 가 모두 존재 — 매핑 오류 감지)', () => {
    expect(verdictCounts.S).toBeGreaterThan(0);
    expect(verdictCounts.F).toBeGreaterThan(0);
  });
});
