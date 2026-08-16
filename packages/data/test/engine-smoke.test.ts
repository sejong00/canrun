/**
 * AC (docs/06 P0-3): 전 (GPU × 모델 × quant) 조합 엔진 스모크 — NaN/음수 0건.
 *
 * 조합 구성:
 *  - dgpu: RAM 프로필 32GB / DDR5-5600 페어링 (계산기 기본값과 동일)
 *  - unified/cpu: ramOptionsGB 최소·최대 2점
 *  - quant: 모델별 등록 quant (model-quants) + 미등록 대비 Q4_K_M bpw 폴백 1점
 */
import { evaluate, type Hardware, type ModelQuant, type Verdict } from '@canrun/engine';
import { describe, expect, it } from 'vitest';
import type { Gpu, Model } from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();

function hardwareVariants(gpu: Gpu): Hardware[] {
  if (gpu.kind === 'dgpu') {
    return [
      {
        kind: 'dgpu',
        os: 'windows',
        vramGB: gpu.vramGB,
        memBandwidthGBs: gpu.memBandwidthGBs,
        fp16Tflops: gpu.fp16Tflops,
        ramGB: 32,
        ramBandwidthGBs: 89.6,
        effClass: gpu.effClass,
        isDisplayGpu: true,
      },
    ];
  }
  const rams = [...new Set([gpu.ramOptionsGB![0]!, gpu.ramOptionsGB!.at(-1)!])];
  return rams.map((ramGB) => ({
    kind: gpu.kind,
    os: gpu.vendor === 'apple' ? 'macos' : 'linux',
    memBandwidthGBs: gpu.memBandwidthGBs,
    fp16Tflops: gpu.fp16Tflops,
    ramGB,
    ramBandwidthGBs: gpu.memBandwidthGBs,
    effClass: gpu.effClass,
  }));
}

function modelQuantVariants(model: Model): ModelQuant[] {
  const registered = seed.modelQuants.filter((mq) => mq.modelId === model.id);
  const base = {
    paramsB: model.paramsB,
    activeParamsB: model.activeParamsB,
    kvBytesPerToken: model.arch.kvBytesPerTokenF16,
    attnType: model.arch.attnType,
    nonExpertGB: model.nonExpertGB,
    maxContext: model.maxContext,
  } as const;
  const variants: ModelQuant[] = registered.map((mq) => ({
    ...base,
    quant: mq.quant,
    fileGB: mq.fileGB,
  }));
  // bpw 폴백 경로도 조합에 포함 (fileGB 미등록 quant 재현)
  variants.push({ ...base, quant: 'Q4_K_M' });
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
