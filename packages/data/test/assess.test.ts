/**
 * 허브 판정 조립 (packages/data/src/assess.ts) — docs/01 §3 허브 판정 규칙의 회귀 고정.
 * 기대값은 P1-1 계획 검토의 전 카탈로그 시뮬레이션(2,378 구성) 수치와 일치한다.
 */
import { MOE_EXPERT_OVERHEAD_US } from '@canrun/engine';
import { describe, expect, it } from 'vitest';
import {
  assessCombo,
  baselineRow,
  canMixWith,
  cheapestOptions,
  classifyLicense,
  commandPlan,
  ctxMatrix,
  ggufPublisher,
  hardwareConfigs,
  HUB_POLICY,
  isFp16Crippled,
  isTheoretical,
  isMixableGpu,
  memoryMatrix,
  modelGpuRows,
  rankableStreet,
  sameSizeQuant,
  summarizeGpu,
  summarizeModel,
  toModelQuant,
  unifiedCpuBandwidth,
  memBandwidthAt,
  VERDICT_OVERESTIMATE,
  verdictRank,
  vramBreakdown,
  type ComboAssessment,
} from '../src/index';
import { scenarioSeed } from './scenario-models';
import { loadSeed } from './seed';

const seed = loadSeed();
const gpu = (id: string) => seed.gpus.find((g) => g.id === id)!;
const model = (id: string) => seed.models.find((m) => m.id === id)!;

/** GPU 의 index 번째 구성(dGPU 는 0 = 32GB 가정)에서 모델 평가 */
function combo(gpuId: string, modelId: string, configIndex = 0): ComboAssessment {
  const g = gpu(gpuId);
  const config = hardwareConfigs(g, seed.gpus)[configIndex]!;
  return assessCombo(seed, g, config, model(modelId));
}

describe('hardwareConfigs (결정 D2)', () => {
  it('dGPU = 32GB DDR5-5600 가정 1개, 대역폭은 CPU 프로필에서 조회', () => {
    const configs = hardwareConfigs(gpu('rtx-4060'), seed.gpus);
    expect(configs).toHaveLength(1);
    expect(configs[0]!.assumedRam).toBe(true);
    expect(configs[0]!.hw).toMatchObject({
      kind: 'dgpu',
      os: 'windows',
      vramGB: 8,
      ramGB: HUB_POLICY.dgpuRamGB,
      ramBandwidthGBs: gpu(HUB_POLICY.dgpuRamProfileId).memBandwidthGBs,
      isDisplayGpu: true,
    });
  });

  it('통합 메모리·CPU 는 RAM 옵션마다 1개 (apple = macos)', () => {
    const m4 = hardwareConfigs(gpu('apple-m4'), seed.gpus);
    expect(m4.map((c) => c.ramGB)).toEqual(gpu('apple-m4').ramOptionsGB);
    expect(m4.every((c) => c.hw.os === 'macos' && !c.assumedRam)).toBe(true);
    const strix = hardwareConfigs(gpu('amd-strix-halo'), seed.gpus);
    expect(strix[0]!.hw.os).toBe('linux');
    expect(hardwareConfigs(gpu('cpu-ddr5-5600-2ch'), seed.gpus)[0]!.hw.kind).toBe('cpu');
  });
});

describe('baseline quant (docs/01 §3 "Q4_K_M 기준")', () => {
  const bpw = Object.fromEntries(seed.quantDefs.map((q) => [q.id, q.bpw]));
  const rows = (id: string) => seed.modelQuants.filter((mq) => mq.modelId === id);

  it('Q4_K_M → MXFP4 → bpw 최근접', () => {
    expect(baselineRow(rows('qwen3-14b'), bpw)!.quant).toBe('Q4_K_M');
    expect(baselineRow(rows('gpt-oss-120b'), bpw)!.quant).toBe('MXFP4');
    expect(baselineRow(rows('solar-open2-250b'), bpw)!.quant).toBe('IQ4_XS');
  });
});

describe('measured join (결정 D4)', () => {
  it('정확 일치 + full-gpu → measured, 추정 밴드는 보조로 유지', () => {
    const c = combo('rtx-4060', 'llama-3.1-8b');
    expect(c.baseline.result.confidence).toBe('measured');
    expect(c.baseline.result.tgTokS.est).toBeCloseTo(38.1, 5);
    expect(c.baseline.measured?.values).toEqual([38.1]);
    expect(c.baseline.estimate.confidence).toBe('calibrated');
    expect(c.baseline.estimate.tgTokS.est).toBeCloseTo(31.766, 2);
    expect(c.baseline.estimate.tgTokS.low).toBeCloseTo(27.95, 1);
    expect(c.baseline.estimate.tgTokS.high).toBeCloseTo(35.58, 1);
  });

  it('페이지 가정에서 안 들어가면 주입하지 않는다 (5090 × gpt-oss-120b @32GB)', () => {
    const c = combo('rtx-5090', 'gpt-oss-120b');
    expect(c.baseline.result.verdict).toBe('F');
    expect(c.baseline.fReason).toBe('no-fit');
    expect(c.baseline.measured).toBeUndefined();
    expect(c.recommended).toBeUndefined();
  });

  it('dGPU 오프로드 모드면 호스트가 달라 주입하지 않는다 (RAM 힌트 64GB cpu-moe)', () => {
    const hint = combo('rtx-5090', 'gpt-oss-120b').ramHint!;
    // 10-01 D56: RAM 에는 CPU 쪽 전문가(앞쪽 21층)만 — 96GB 가 아니라 64GB 에서 들어간다
    expect(hint.ramGB).toBe(64);
    expect(hint.verdict).toBe('A');
    expect(hint.mode).toBe('cpu-moe');
    expect(hint.result.confidence).toBe('theoretical');
    expect(hint.result.cpuMoeLayers).toBe(21);
    // 09-30 22.18(전문가 전부 RAM) → 10-01 전문가 15층 GPU 배치 35.33 → 10-16 D88 GPU 몫 dense 계수 + MoE 고정 시간 35.49.
    // 공개 실측 5090 + DDR5-6400 --n-cpu-moe 24 = 37.59
    expect(hint.result.tgTokS.est).toBeCloseTo(35.49, 1);
  });

  it('Q4_K_XL 실측은 Q4_K_M 에 조인되지 않는다', () => {
    const c = combo('rtx-4090', 'qwen3-8b');
    expect(c.baseline.measured).toBeUndefined();
    expect(c.baseline.result.confidence).toBe('calibrated');
  });

  it('통합 메모리 조인 (M4 Max 32c × gpt-oss-20b @36GB, full-gpu)', () => {
    // 10-15 D81: 출처의 "M4 Max (36GB)" 는 32코어 GPU 구성뿐 — 40코어에 붙어 있던 레코드를 옮겼다
    const c = combo('apple-m4-max-32c', 'gpt-oss-20b', 0);
    expect(c.baseline.result.mode).toBe('full-gpu');
    expect(c.baseline.result.confidence).toBe('measured');
    expect(c.baseline.result.tgTokS.est).toBeCloseTo(92.4, 5);
    expect(combo('apple-m4-max-40c', 'gpt-oss-20b', 2).baseline.result.confidence).toBe('calibrated');
  });

  it('CPU 프로필은 cpu-only 에서도 조인 (dGPU 와 달리 모드 무관)', () => {
    // 시드에는 조건이 밝혀진 CPU × 카탈로그 모델 실측이 없다(10-15 D79 에 s21 을 뺐다) — 조인 규칙만 가상의 점으로 확인
    const g = gpu('cpu-ddr5-5600-2ch');
    const config = hardwareConfigs(g, seed.gpus)[1]!;
    const point = { ...seed.benchmarks[0]!, id: 'test-cpu', gpuId: g.id, modelId: 'qwen3-30b-a3b-2507', quant: 'Q4_K_M', ctx: 512, tgTokS: 19 };
    const c = assessCombo({ ...seed, benchmarks: [point] }, g, config, model('qwen3-30b-a3b-2507'));
    expect(c.baseline.result.mode).toBe('cpu-only');
    expect(c.baseline.result.confidence).toBe('measured');
    expect(c.baseline.measured?.values).toEqual([19]);
    expect(combo('cpu-ddr5-5600-2ch', 'qwen3-30b-a3b-2507', 1).baseline.result.confidence).toBe('calibrated');
  });
});

describe('구성별 대역폭 (10-20 — Apple M6, 애플 사양 128108)', () => {
  it('16GB 는 153.6, 24·32GB 는 칩 값 170.6 — 엔진 입력(GPU·CPU 경로)이 구성 값을 쓴다', () => {
    const m6 = gpu('apple-m6');
    const configs = hardwareConfigs(m6, seed.gpus);
    expect(configs.map((c) => [c.ramGB, c.hw.memBandwidthGBs, c.hw.ramBandwidthGBs])).toEqual([
      [16, 153.6, 153.6],
      [24, 170.6, 170.6],
      [32, 170.6, 170.6],
    ]);
    // 계산기 경로(RAM 하나를 고른 경우)도 같다
    expect(hardwareConfigs(m6, seed.gpus, { ramGB: 16 })[0]!.hw.memBandwidthGBs).toBe(153.6);
    expect(memBandwidthAt(m6, 32)).toBe(170.6);
    // 구성별 값이 없는 칩은 그대로
    for (const config of hardwareConfigs(gpu('apple-m5'), seed.gpus)) expect(config.hw.memBandwidthGBs).toBe(153.6);
  });
});

describe('통합 메모리 CPU 경로 (P1-1 리뷰 — 역전 방지)', () => {
  it('CPU측 대역폭은 dense 계수 비율로만 깎는다 — 지금은 깎이는 클래스가 없다 (새 상수 없음)', () => {
    // 10-16 D88: GPU 클래스 MoE 계수가 없어져 apple-ultra 를 0.29/0.43 로 깎던 MoE 몫은 엔진으로 옮겼다
    // (cpu-only 가 통합 메모리에서 full-gpu 추정을 넘지 않음 — 아래 역전 방지 테스트가 지킨다)
    for (const id of ['apple-m3-ultra', 'apple-m4', 'amd-strix-halo', 'nvidia-dgx-spark']) {
      const g = gpu(id);
      expect(unifiedCpuBandwidth(g), id).toBe(g.memBandwidthGBs);
    }
  });

  it('같은 칩에서 RAM 이 적은 구성이 더 빠르게 추정되지 않는다', () => {
    for (const g of seed.gpus.filter((x) => x.kind === 'unified')) {
      const configs = hardwareConfigs(g, seed.gpus);
      for (const m of seed.models) {
        const est = configs.map((config) => assessCombo(seed, g, config, m).baseline.result);
        for (let i = 0; i + 1 < est.length; i += 1) {
          if (est[i]!.verdict === 'F' || est[i + 1]!.verdict === 'F') continue;
          expect(
            est[i]!.tgTokS.est,
            `${g.id} ${m.id} @${configs[i]!.ramGB} vs @${configs[i + 1]!.ramGB}`,
          ).toBeLessThanOrEqual(est[i + 1]!.tgTokS.est + 1e-9);
        }
      }
    }
  });

  it('통합 메모리 cpu-only 는 theoretical (apple-m4 16GB × qwen3-30b-a3b-2507)', () => {
    const c = combo('apple-m4', 'qwen3-30b-a3b-2507', 0);
    if (c.baseline.result.mode === 'cpu-only') {
      expect(c.baseline.result.confidence).toBe('theoretical');
    }
    for (const g of seed.gpus.filter((x) => x.kind === 'unified')) {
      for (const config of hardwareConfigs(g, seed.gpus)) {
        for (const m of seed.models) {
          const q = assessCombo(seed, g, config, m).baseline;
          if (q.fits && q.result.mode === 'cpu-only' && !q.measured) {
            expect(q.result.confidence, `${g.id} ${m.id}`).toBe('theoretical');
          }
        }
      }
    }
  });
});

describe('판정 사유 = 실제로 걸린 규칙 (P1-1 리뷰)', () => {
  it('부분 오프로드 gpuFrac ≥ 0.9 는 A — S 는 full-gpu 전용 (rtx-5080 × mistral-small-3.2-24b)', () => {
    const c = combo('rtx-5080', 'mistral-small-3.2-24b');
    expect(c.baseline.result.mode).toBe('partial-offload');
    expect(c.baseline.gpuFrac).toBeGreaterThanOrEqual(0.9);
    expect(c.baseline.result.verdict).toBe('A');
    expect(c.baseline.verdictReason).toBe('cap-full-gpu-only');
  });

  // 기본 구성(RAM 32GB)의 비-리즈닝 cpu-moe 는 전부 20 이상 — 리즈닝(기준 ×1.5 = 30)으로 규칙을 고정.
  // 10-01 D56 부분 배치로 rtx-4060 × gpt-oss-20b 는 30.8 → A. 10-16 D88(GPU 몫 dense 계수 + MoE 고정 시간)에 3050 × gpt-oss-20b 도
  // 27.7 → 34 로 A — 남은 B 는 8GB 급 노트북·3050 의 gemma-4-26b-a4b
  it('cpu-moe 는 원활 기준 미만이면 B — 리즈닝은 30 (rtx-3050-8gb × gemma-4-26b-a4b)', () => {
    const c = combo('rtx-3050-8gb', 'gemma-4-26b-a4b');
    expect(c.baseline.result.mode).toBe('cpu-moe');
    expect(c.baseline.result.verdict).toBe('B');
    expect(c.baseline.verdictReason).toBe('cap-cpu-moe');
    expect(c.baseline.capMinTokS).toBe(30);
  });

  it('사유가 뜻하는 등급 = 표시 판정 (전 카탈로그)', () => {
    const implied: Record<string, string> = {
      'cap-full-gpu-only': 'A',
      'cap-partial': 'B',
      'cap-cpu-moe': 'B',
      'cap-cpu-only': 'B',
      'no-fit': 'F',
    };
    for (const g of seed.gpus) {
      for (const config of hardwareConfigs(g, seed.gpus)) {
        for (const m of seed.models) {
          for (const q of assessCombo(seed, g, config, m).perQuant) {
            const expected = implied[q.verdictReason];
            if (expected) expect(q.result.verdict, `${g.id} ${m.id} ${q.quant}`).toBe(expected);
          }
        }
      }
    }
  });
});

describe('theoretical 규칙 (docs/02 §4, 결정 D4)', () => {
  it('MoE 계수 없는 클래스 (arc-b580 × MoE)', () => {
    expect(combo('arc-b580', 'gpt-oss-20b').baseline.result.confidence).toBe('theoretical');
  });

  it('cpu-moe 는 최대 오차가 밴드를 넘어 theoretical (rtx-3060-12gb × qwen3.5-35b-a3b)', () => {
    const c = combo('rtx-3060-12gb', 'qwen3.5-35b-a3b');
    expect(c.baseline.result.mode).toBe('cpu-moe');
    expect(c.baseline.result.verdict).toBe('A');
    expect(c.baseline.result.confidence).toBe('theoretical');
    // 43.2 tok/s ≥ 20 → A 에서 멈춤: S 는 full-gpu 전용
    expect(c.baseline.verdictReason).toBe('cap-full-gpu-only');
    // 10-01 D56: RAM 은 앞쪽 24층 전문가(11.72) + token_embd·MTP 블록(1.09) — 이전(전문가 전부) 21.41
    expect(c.baseline.result.cpuMoeLayers).toBe(24);
    expect(c.baseline.memory.ramGB).toBeCloseTo(12.81, 2);
  });

  it('GGUF 실측 분할이 있는 MoE 는 모델 수준 nonExpertGB 가 없어도 cpu-moe (rtx-5080 × gemma-4-26b-a4b)', () => {
    // 10-01 D56 이전엔 dense 부분 오프로드 + B 상한(백로그 「엔진 후속」②)
    const c = combo('rtx-5080', 'gemma-4-26b-a4b');
    expect(c.baseline.result.mode).toBe('cpu-moe');
    expect(c.baseline.result.confidence).toBe('theoretical');
    expect(c.baseline.result.verdict).toBe('A');
  });

  it('검증 안 된 아키텍처·FP16 크리플 GPU', () => {
    expect(combo('rtx-4060', 'hyperclovax-seed-think-14b').baseline.result.confidence).toBe(
      'theoretical',
    );
    expect(isFp16Crippled(gpu('gtx-1080-ti'))).toBe(true);
    expect(isFp16Crippled(gpu('rtx-4060'))).toBe(false);
    expect(combo('gtx-1080-ti', 'llama-3.1-8b').baseline.result.confidence).toBe('theoretical');
  });

  it('상수 상태 층 하이브리드(Mamba2·short-conv·KDA+MLA)는 전량 탑재여도 이론 추정 — 속도 모델 미검증 (10-03 D63)', () => {
    for (const id of ['lfm2.5-2.6b', 'ling-3.0-tiny']) {
      const r = combo('rtx-4090', id).baseline.result;
      expect(r.mode, id).toBe('full-gpu');
      expect(r.confidence, id).toBe('theoretical');
    }
    expect(combo('rtx-5090', 'nemotron-3.5-lightning-30b-a3b').baseline.result).toMatchObject({ mode: 'full-gpu', confidence: 'theoretical' });
    // 선례 구조(SWA)인 Spark-X2.5 는 기존 경로 — NVIDIA dense 전량 탑재 보정 추정
    expect(combo('rtx-4090', 'spark-x2.5-4b').baseline.result).toMatchObject({ mode: 'full-gpu', confidence: 'calibrated' });
  });

  it('NVIDIA dGPU dense full-gpu 는 calibrated ±12%', () => {
    const r = combo('rtx-4090', 'qwen3-8b').baseline.result;
    expect(r.confidence).toBe('calibrated');
    expect(r.tgTokS.high / r.tgTokS.est).toBeCloseTo(1.12, 5);
  });
});

describe('추천 quant·최후 수단 (결정 D4 — 품질 상향 금지, desperate 제한)', () => {
  it('기준이 이미 최선이면 기준 그대로 — Q8_0 로 올리지 않는다', () => {
    const c = combo('rtx-4090', 'qwen3-8b');
    expect(c.recommended?.quant).toBe('Q4_K_M');
    expect(c.lastResort).toBeUndefined();
  });

  it('부분 오프로드 B 는 유지, desperate 는 최후 수단으로만 (rtx-4060 × qwen3-14b)', () => {
    const c = combo('rtx-4060', 'qwen3-14b');
    expect(c.baseline.result.verdict).toBe('B');
    expect(c.baseline.result.mode).toBe('partial-offload');
    expect(c.baseline.gpuFrac).toBeCloseTo(0.6092, 3);
    // 10-01 D59: qwen3-14b 는 생각 모드(기본 켜짐) — 리즈닝 임계(원활 12 tok/s)라 8.1 tok/s 는 속도로 B (전엔 부분 오프로드 상한)
    expect(c.baseline.verdictReason).toBe('speed');
    expect(c.recommended?.quant).toBe('Q4_K_M');
    expect(c.lastResort?.quant).toBe('Q2_K');
    expect(c.lastResort?.result.verdict).toBe('A');
    // docs/02 §7: 14B Q4_K_M 은 8GB 에 풀 오프로드 불가
    expect(c.baseline.result.mode).not.toBe('full-gpu');
  });

  it('A 기준에서 Q2_K S 로 끌어올리지 않는다 (rtx-3090 × deepseek-r1-distill-32b)', () => {
    const c = combo('rtx-3090', 'deepseek-r1-distill-32b');
    expect(c.recommended?.quant).toBe('Q4_K_M');
    expect(c.recommended?.result.verdict).toBe('A');
    expect(c.lastResort?.quant).toBe('Q2_K');
  });

  it('더 나은 비-desperate quant 로 하향 (rtx-4060 × gemma-3-12b → IQ4_XS A)', () => {
    const c = combo('rtx-4060', 'gemma-3-12b');
    expect(c.baseline.result.verdict).toBe('B');
    expect(c.recommended?.quant).toBe('IQ4_XS');
    expect(c.recommended?.result.verdict).toBe('A');
  });

  it('전부 F 면 추천 없음 (rtx-4060 × llama-3.3-70b)', () => {
    const c = combo('rtx-4060', 'llama-3.3-70b');
    expect(c.recommended).toBeUndefined();
    expect(c.lastResort).toBeUndefined();
    expect(c.maxCtx).toBeUndefined();
    // 10-03 D62: dGPU 필요량은 그래픽카드에 올라가는 가중치 기준 — 42.52 − 입력 임베딩 0.60 = 41.92 (+ KV 2.684 + 버퍼 0.575)
    expect(c.baseline.memory.totalNeedGB).toBeCloseTo(45.179, 2);
  });

  it('F too-slow 와 표시 quant (rtx-3090 × llama-3.3-70b)', () => {
    const c = combo('rtx-3090', 'llama-3.3-70b');
    expect(c.baseline.result.verdict).toBe('F');
    expect(c.baseline.fReason).toBe('too-slow');
    expect(c.baseline.result.tgTokS.est).toBeCloseTo(1.774, 2);
    expect(c.recommended?.quant).toBe('IQ4_XS');
    expect(c.display.quant).toBe('IQ4_XS');
  });
});

describe('maxCtx — 같은 모드·같은 판정 유지', () => {
  it('8GB 카드 8B Q4_K_M 은 16k 에서 VRAM 초과 → 8k', () => {
    // 10-03 D62 뒤에도 16k f16 은 4.62 + 2.1475 + 0.65 = 7.4175 > 사용 가능 7.40 — 저장값 0.01 단위 경계라 고정해 둔다
    expect(combo('rtx-4060', 'llama-3.1-8b').maxCtx).toBe(8192);
  });

  it('모델 최대 ctx 를 넘지 않는다', () => {
    const c = combo('rtx-5090', 'phi-4');
    expect(c.maxCtx).toBeLessThanOrEqual(model('phi-4').maxContext);
  });
});

describe('memoryMatrix (docs/01 F2)', () => {
  it('llama-3.1-8b Q4_K_M @16k = (4.92 − 0.30) + 2.1475 + 0.65', () => {
    const m = model('llama-3.1-8b');
    const matrix = memoryMatrix(
      m,
      seed.modelQuants.filter((mq) => mq.modelId === m.id),
    );
    const col = matrix.ctxs.indexOf(16384);
    const row = matrix.rows.find((r) => r.quant === 'Q4_K_M')!;
    // 10-03 D62: 셀은 dGPU 규칙(그래픽카드에 올라가는 가중치) — 입력 임베딩 0.30GB 는 시스템 RAM (전엔 파일 4.92 로 7.7175)
    expect(row.gpuWeightsGB).toBeCloseTo(4.62, 6);
    expect(row.cellsGB[col]).toBeCloseTo(7.4175, 4);
    expect(matrix.ctxs.at(-1)).toBeLessThanOrEqual(m.maxContext);
  });

  it('MoE rows derive the GPU weights from the measured split; tied-embedding rows stay at the file size', () => {
    const q36 = model('qwen3.6-35b-a3b');
    const row36 = memoryMatrix(q36, seed.modelQuants.filter((mq) => mq.modelId === q36.id)).rows.find((r) => r.quant === 'Q4_K_M')!;
    expect(row36.gpuWeightsGB).toBeCloseTo(19.5 + 1.59, 6);
    const g3 = model('gemma-3-12b');
    const rowG = memoryMatrix(g3, seed.modelQuants.filter((mq) => mq.modelId === g3.id)).rows.find((r) => r.quant === 'Q4_K_M')!;
    expect(rowG.fileGB - rowG.gpuWeightsGB).toBeLessThanOrEqual(0.02);
  });
});

describe('summaries', () => {
  it('GPU 허브: 전 모델 행·등급 카운트 합 = 모델 수, 판정 내림차순', () => {
    expect(summarizeGpu(seed, gpu('rtx-4060')).rows).toHaveLength(seed.models.length);
    // 분포 고정은 시나리오 모델 집합 위에서 — 새 모델 추가가 이 숫자를 바꾸지 않게 (scenario-models.ts)
    const scen = scenarioSeed(seed);
    const hub = summarizeGpu(scen, gpu('rtx-4060'));
    const c = hub.counts[0]!;
    expect(c.S + c.A + c.B + c.F).toBe(scen.models.length);
    // 09-30 카탈로그 확장 1차: 소형 4종(Llama 3.2·MiniCPM5) S, qwen3.6-35b-a3b A(형제 qwen3.5 와 동일), 30B급 dense 3종 B(부분 오프로드)
    // 09-30 Gemma 4 12B KV 수정(4배 과대 → 설정 기준)으로 12B 가 4060 에서 B → A(부분 오프로드지만 GPU 90% 이상)
    // 09-30 cpu-moe 보정: qwen3-30b-a3b-2507·kanana-1.5-15.7b-a3b 가 4060 에서 B → A (20 tok/s 이상)
    // 10-01 전문가 부분 배치(D56): gpt-oss-20b(리즈닝 30 → 30.8)·gemma-4-26b-a4b(부분 오프로드 B → cpu-moe) B → A
    // 10-01 D59 생각 모드 모델 ×1.5(qwen3·qwen3.5·gemma-4·exaone-4·minicpm5 등): A 7→6, B 11→10, F 8→10
    // 10-16 D88 MoE 고정 시간(cpu-moe GPU 몫 dense 계수): gemma-4-26b-a4b 25.3 → 30.6 으로 리즈닝 기준 30 을 넘어 B → A
    expect(c).toMatchObject({ S: 11, A: 7, B: 9, F: 10, otherQuant: 5 });
    expect(hub.faq.referenceLarge?.baseline.fReason).toBe('no-fit');
    expect(hub.benchmarks.every((bp) => bp.gpuId === 'rtx-4060')).toBe(true);
    // 정렬: 기준 판정 비증가, 같은 판정 안에서는 표시 tok/s 비증가
    const primary = hub.rows.map((row) => row.combos[hub.primaryIndex]!);
    for (let i = 0; i + 1 < primary.length; i += 1) {
      const [a, b] = [primary[i]!, primary[i + 1]!];
      const ra = verdictRank(a.baseline.result.verdict);
      const rb = verdictRank(b.baseline.result.verdict);
      expect(ra).toBeGreaterThanOrEqual(rb);
      if (ra === rb) {
        expect(a.display.result.tgTokS.est).toBeGreaterThanOrEqual(b.display.result.tgTokS.est);
      }
    }
  });

  // 모델 이름을 박지 않고 규칙을 검산한다 — 카탈로그가 늘어도(09-30 자동화) 손대지 않게.
  // 규칙: 비-desperate·비-F 인 등록 quant 중 full-GPU 가 하나라도 있는 모델 가운데 파라미터가 가장 큰 것(동률은 id 순)
  const largestFullGpuOracle = (gpuId: string) => {
    const hub = summarizeGpu(seed, gpu(gpuId));
    const paramsOf = (id: string) => seed.models.find((m) => m.id === id)!.paramsB;
    const candidates = hub.rows
      .map((row) => row.combos[hub.primaryIndex]!)
      .filter((c) => [c.baseline, ...c.perQuant].some((q) => q.tier !== 'desperate' && q.result.verdict !== 'F' && q.result.mode === 'full-gpu'))
      .sort((a, b) => paramsOf(b.modelId) - paramsOf(a.modelId) || a.modelId.localeCompare(b.modelId));
    return { pick: hub.faq.largestFullGpu!, expected: candidates[0]!.modelId };
  };

  it('"가장 큰 full-GPU 모델" 은 비-desperate 추천 quant 도 본다 — 규칙 검산 (16GB 카드·M4 Pro)', () => {
    for (const gpuId of ['rtx-5060-ti-16gb', 'rtx-4060-ti-16gb', 'apple-m4-pro', 'rtx-4060', 'rtx-3090']) {
      const { pick, expected } = largestFullGpuOracle(gpuId);
      expect(pick.combo.modelId, gpuId).toBe(expected);
      expect(pick.q.result.mode, gpuId).toBe('full-gpu');
      expect(pick.q.tier, gpuId).not.toBe('desperate');
    }
  });

  it('기준이 full-GPU 가 아니어도 더 작은 full-GPU quant 를 찾는다 (P1-1 재검증)', () => {
    // 16GB 카드·M4 Pro 의 답은 지금 모두 기준(Q4_K_M)이 넘치고 IQ4_XS 로 전부 올라가는 경우다 — 이 경로가 실제로 쓰이는지 고정
    for (const gpuId of ['rtx-5060-ti-16gb', 'rtx-4060-ti-16gb', 'apple-m4-pro']) {
      const { pick } = largestFullGpuOracle(gpuId);
      expect(pick.combo.baseline.result.mode, gpuId).not.toBe('full-gpu');
      expect(pick.q.quant, gpuId).not.toBe(pick.combo.baseline.quant);
    }
  });

  it('CPU 프로필 허브는 full-gpu 모델이 없고 돌아가는 최대 모델로 대신한다', () => {
    const hub = summarizeGpu(seed, gpu('cpu-ddr5-5600-2ch'));
    expect(hub.faq.largestFullGpu).toBeUndefined();
    expect(hub.faq.largestRunnable).toBeDefined();
    expect(hub.counts.every((c) => c.S === 0 && c.A === 0)).toBe(true);
  });

  it('모델 허브: 전 GPU 행(CPU 포함)·최저가는 dGPU 실거래가만', () => {
    const hub = summarizeModel(seed, model('qwen3-32b'));
    expect(hub.gpuRows).toHaveLength(seed.gpus.length);
    expect(hub.gpuRows.some((r) => r.gpu.kind === 'cpu')).toBe(true);
    // 10-01 D59: qwen3-32b 는 생각 모드 — 쾌적 임계 30 tok/s 라 3090 은 원활, 쾌적 최저가는 4090
    expect(hub.cheapest.great?.gpu.id).toBe('rtx-4090');
    expect(hub.cheapest.great?.priceUSD).toBe(2755);
    expect(hub.cheapest.great?.priceAsOf).toBe('2026-08-09');
    expect(hub.cheapest.well?.gpu.id).toBe('rtx-3090');
    expect(hub.cheapest.well?.priceUSD).toBe(1050);
    expect(hub.referenceRows.map((r) => r.gpu.id)).toEqual(HUB_POLICY.referenceGpuIds);
  });

  it('최저가: 쾌적 최저가 + 그보다 싼 원활 최저가 병기 (deepseek-r1-distill-32b)', () => {
    const { great, well } = summarizeModel(seed, model('deepseek-r1-distill-32b')).cheapest;
    expect(great?.gpu.id).toBe('rtx-4090');
    expect(great?.combo.baseline.result.verdict).toBe('S');
    expect(well?.gpu.id).toBe('rtx-3090');
    expect(well?.combo.baseline.result.verdict).toBe('A');
    expect(well!.priceUSD).toBeLessThan(great!.priceUSD);
  });

  it('통합 메모리 행은 최고 판정의 최소 RAM 구성', () => {
    const hub = summarizeModel(seed, model('gpt-oss-120b'));
    expect(hub.cheapest).toEqual({});
    const m4max = hub.gpuRows.find((r) => r.gpu.id === 'apple-m4-max-40c')!;
    const all = hardwareConfigs(gpu('apple-m4-max-40c'), seed.gpus).map((config) =>
      assessCombo(seed, gpu('apple-m4-max-40c'), config, model('gpt-oss-120b')),
    );
    const bestRank = Math.max(
      ...all.map((c) => ['F', 'B', 'A', 'S'].indexOf(c.baseline.result.verdict)),
    );
    const firstBest = all.find(
      (c) => ['F', 'B', 'A', 'S'].indexOf(c.baseline.result.verdict) === bestRank,
    )!;
    expect(m4max.combo.ramGB).toBe(firstBest.ramGB);
  });

  it('손실이 더 큰 파일이 더 나은 파일과 크기가 거의 같으면 더 나은 쪽을 안내 (10-03 D63 후속)', () => {
    // Nemotron 3.5 Lightning: K-quant 폴백으로 Q2_K 18.91GB ≈ IQ4_XS 18.92GB
    expect(summarizeModel(seed, model('nemotron-3.5-lightning-30b-a3b')).sameSizeQuant).toEqual({
      low: 'Q2_K',
      high: 'IQ4_XS',
    });
    // 지금 카탈로그에서 해당하는 모델은 하나뿐 — 보통 모델엔 안내가 없다
    const tierOf = new Map(seed.quantDefs.map((d) => [d.id, d.tier]));
    const flagged = seed.models
      .filter((m) =>
        sameSizeQuant(
          seed.modelQuants
            .filter((r) => r.modelId === m.id)
            .map((row) => ({ row, tier: tierOf.get(row.quant) ?? 'ok' })),
        ),
      )
      .map((m) => m.id);
    expect(flagged).toEqual(['nemotron-3.5-lightning-30b-a3b']);
    // 비율 경계: 95% 미만이면 안내하지 않고, 범위 안 더 나은 파일이 여럿이면 가장 큰 파일
    const q = (quant: string, fileGB: number, tier: 'desperate' | 'degraded' | 'ok' | 'safe') => ({
      row: { quant: quant as never, fileGB },
      tier,
    });
    expect(sameSizeQuant([q('Q2_K', 9.4, 'desperate'), q('IQ4_XS', 10, 'ok')])).toBeUndefined();
    expect(
      sameSizeQuant([q('Q2_K', 9.6, 'desperate'), q('IQ3_XS', 9.7, 'degraded'), q('IQ4_XS', 10, 'ok')]),
    ).toEqual({ low: 'Q2_K', high: 'IQ4_XS' });
  });
});

describe('GGUF 출처 3단 (결정 D3)·라이선스 분류', () => {
  it('공식 / llama.cpp 팀 / 커뮤니티', () => {
    const q = (modelId: string) => seed.modelQuants.find((mq) => mq.modelId === modelId)!;
    expect(ggufPublisher(model('exaone-4.5-33b'), q('exaone-4.5-33b')).kind).toBe('official');
    expect(ggufPublisher(model('gpt-oss-20b'), q('gpt-oss-20b')).kind).toBe('llamacpp');
    expect(ggufPublisher(model('llama-3.1-8b'), q('llama-3.1-8b'))).toEqual({
      kind: 'community',
      owner: 'bartowski',
      repo: q('llama-3.1-8b').ggufRepo,
    });
    // naver-ellm 은 HF 미인증 org — 공식으로 단정하지 않는다 (PROGRESS §5 재확인)
    expect(
      ggufPublisher(model('hyperclovax-seed-think-14b'), q('hyperclovax-seed-think-14b')).kind,
    ).toBe('community');
  });

  it('시드의 모든 라이선스 문자열이 분류돼 있다 (신모델 추가 시 분류 강제)', () => {
    for (const m of seed.models) {
      expect(classifyLicense(m.license), `${m.id}: '${m.license}'`).not.toBe('unknown');
    }
    expect(classifyLicense('EXAONE AI Model License 1.2 NC')).toBe('nonCommercial');
    expect(classifyLicense('Apache-2.0')).toBe('permissive');
    expect(classifyLicense('Some New License')).toBe('unknown');
  });
});

describe('전 카탈로그 불변식', () => {
  it('모든 (구성, 모델) 조합이 예외 없이 평가되고 규칙 3 을 지킨다', () => {
    let combos = 0;
    for (const g of seed.gpus) {
      for (const config of hardwareConfigs(g, seed.gpus)) {
        for (const m of seed.models) {
          const c = assessCombo(seed, g, config, m);
          combos += 1;
          // F 가 아니면 표시 수치는 유한 양수 + 밴드 존재 (measured 는 추정 밴드를 병기)
          for (const q of [c.baseline, c.display]) {
            if (q.result.verdict === 'F') continue;
            expect(Number.isFinite(q.result.tgTokS.est) && q.result.tgTokS.est > 0).toBe(true);
            expect(q.estimate.tgTokS.high).toBeGreaterThan(q.estimate.tgTokS.low);
          }
          // 추천은 기준보다 낮은 판정이 될 수 없다
          if (c.recommended) {
            expect(
              ['F', 'B', 'A', 'S'].indexOf(c.recommended.result.verdict),
            ).toBeGreaterThanOrEqual(['F', 'B', 'A', 'S'].indexOf(c.baseline.result.verdict));
          }
          // desperate 추천은 비-desperate 가 전부 F 일 때만
          if (c.recommended?.tier === 'desperate') {
            expect(
              c.perQuant
                .filter((q) => q.tier !== 'desperate')
                .every((q) => q.result.verdict === 'F'),
            ).toBe(true);
          }
        }
      }
    }
    expect(combos).toBeGreaterThan(2000);
  });
});

describe('모델 → GPU 행 (10-03 D65 — 모델 허브 표와 계산기 모델 모드 공용)', () => {
  it('summarizeModel 은 modelGpuRows·cheapestOptions 를 그대로 쓴다 (옵션 없음 = 8k·f16 = 허브)', () => {
    const m = model('qwen3-14b');
    const hub = summarizeModel(seed, m);
    const rows = modelGpuRows(seed, m);
    expect(rows).toEqual(hub.gpuRows);
    expect(cheapestOptions(rows)).toEqual(hub.cheapest);
    // 8k·f16 을 명시해도 같다 (계산기가 기본 조건에서 허브 표와 같은 값을 내는 근거)
    expect(modelGpuRows(seed, m, { ctx: HUB_POLICY.referenceCtx, kvQuant: 'f16' })).toEqual(rows);
  });

  it('옵션(ctx·KV·theoretical)은 모든 구성 평가에 전달된다 — 실측 조인은 8k·f16 에서만 (D33)', () => {
    const m = model('llama-3.1-8b');
    const ref = modelGpuRows(seed, m);
    expect(ref.some((r) => r.combo.baseline.result.confidence === 'measured')).toBe(true);
    const at32k = modelGpuRows(seed, m, { ctx: 32768, kvQuant: 'q8_0' });
    expect(at32k).toHaveLength(seed.gpus.length);
    expect(at32k.some((r) => r.combo.baseline.result.confidence === 'measured')).toBe(false);
    const theoretical = modelGpuRows(seed, m, { theoretical: true });
    expect(theoretical.every((r) => r.combo.display.estimate.confidence === 'theoretical')).toBe(true);
  });

  it('rankableStreet: dGPU 실거래가 + 기준일만 (MSRP·통합 메모리·기준일 없는 값은 순위 밖, docs/01 §3)', () => {
    expect(rankableStreet(gpu('rtx-4060-ti-16gb'))).toBeUndefined(); // 출시가만 있는 카드
    expect(rankableStreet(gpu('rtx-3090'))).toEqual({ usd: 1050, asOf: '2026-08-09' });
    expect(rankableStreet({ kind: 'dgpu', streetUSD: 300 })).toBeUndefined();
    expect(rankableStreet({ kind: 'unified', streetUSD: 1999, priceAsOf: '2026-08-09' })).toBeUndefined();
    expect(rankableStreet({ kind: 'dgpu', streetUSD: 300, priceAsOf: '2026-08-09' })).toEqual({ usd: 300, asOf: '2026-08-09' });
  });

  it('cheapestOptions: 원활 최저가는 쾌적 최저가보다 쌀 때만', () => {
    const rows = modelGpuRows(seed, model('deepseek-r1-distill-32b'));
    const { great, well } = cheapestOptions(rows);
    expect(great?.gpu.id).toBe('rtx-4090');
    expect(well?.gpu.id).toBe('rtx-3090');
    // 원활 행만 남기면 well 만, 쾌적 행만 남기면 great 만
    expect(cheapestOptions(rows.filter((r) => r.combo.baseline.result.verdict === 'A'))).toEqual({ well });
    expect(cheapestOptions(rows.filter((r) => r.combo.baseline.result.verdict === 'S'))).toEqual({ great });
    expect(cheapestOptions([])).toEqual({});
  });
});

describe('계산기 평가 옵션 (P1-3 결정 D33) — 기본 인자는 허브와 동일', () => {
  it('32k·q8_0 의 assessCombo 기준 quant = ctxMatrix 같은 셀, 실측 조인은 8k·f16 에서만', () => {
    const g = gpu('rtx-4060');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const m = model('llama-3.1-8b');
    const c = assessCombo(seed, g, config, m, { ctx: 32768, kvQuant: 'q8_0' });
    const matrix = ctxMatrix(g, config, m, c.baseline);
    const cell = matrix.rows[matrix.ctxs.indexOf(32768)]![matrix.kvQuants.indexOf('q8_0')]!;
    expect(c.baseline.result.tgTokS).toEqual(cell.result.tgTokS);
    expect(c.baseline.result.verdict).toBe(cell.verdict);
    expect(c.baseline.memory.needGB).toBeCloseTo(cell.needGB, 9);
    expect(c.baseline.measured).toBeUndefined();
    // 같은 구성의 8k·f16 은 실측 조인 (D4 앵커)
    expect(combo('rtx-4060', 'llama-3.1-8b').baseline.result.confidence).toBe('measured');
  });

  it('theoretical 강제 (커스텀 하드웨어, D32) — 전 quant 이론 추정 ±30%', () => {
    const g = gpu('rtx-4090');
    const c = assessCombo(seed, g, hardwareConfigs(g, seed.gpus)[0]!, model('llama-3.1-8b'), { theoretical: true });
    for (const q of c.perQuant) {
      // 실측이 조인된 quant 는 result 가 measured 지만, 추정은 전부 이론 밴드 (커스텀 하드웨어엔 실측이 없다)
      expect(q.estimate.confidence).toBe('theoretical');
      expect(q.estimate.tgTokS.low).toBeCloseTo(q.estimate.tgTokS.est * 0.7, 6);
      if (!q.measured) expect(q.result.confidence).toBe('theoretical');
    }
  });

  it('사용자 RAM 구성(16GB·linux·화면 출력 아님)은 assumedRam=false, RAM 힌트는 옵션일 때만·사용자 RAM 초과 후보·같은 os', () => {
    const g = gpu('rtx-4060');
    const [config] = hardwareConfigs(g, seed.gpus, { ramGB: 16, os: 'linux', isDisplayGpu: false });
    expect(config!.assumedRam).toBe(false);
    expect(config!.hw).toMatchObject({ os: 'linux', isDisplayGpu: false, ramGB: 16 });
    const big = model('gpt-oss-120b');
    expect(assessCombo(seed, g, config!, big).ramHint).toBeUndefined();
    const hinted = assessCombo(seed, g, config!, big, { ramHint: true });
    expect(hinted.ramHint).toBeDefined();
    expect(hinted.ramHint!.ramGB).toBeGreaterThan(16);
    // 후보는 32/64/96/128 중 사용자 RAM 초과분을 작은 순으로 — 16GB 사용자에게 32 가 후보에 든다 (허브 32GB 는 64 부터)
    expect([32, 64, 96, 128]).toContain(hinted.ramHint!.ramGB);
    const [at32] = hardwareConfigs(g, seed.gpus, { ramGB: 32, os: 'linux', isDisplayGpu: false });
    const improvedAt32 = verdictRank(assessCombo(seed, g, at32!, big).baseline.result.verdict) > verdictRank(hinted.baseline.result.verdict);
    expect(hinted.ramHint!.ramGB === 32).toBe(improvedAt32);
    expect(hinted.ramHint!.config.hw).toMatchObject({ os: 'linux', isDisplayGpu: false });
    expect(hinted.ramHint!.config.hw.ramBandwidthGBs).toBe(config!.hw.ramBandwidthGBs);
  });

  it('RAM 대역폭 옵션(DDR 종류)은 dGPU 시스템 RAM 대역폭이 된다', () => {
    const g = gpu('rtx-4060');
    const ddr4 = gpu('cpu-ddr4-3200-2ch').memBandwidthGBs;
    const [config] = hardwareConfigs(g, seed.gpus, { ramBandwidthGBs: ddr4 });
    expect(config!.hw.ramBandwidthGBs).toBe(ddr4);
    expect(config!.assumedRam).toBe(true);
  });

  it('통합·CPU 에 ramGB 를 지정하면 그 구성 1개, apple 은 os 지정을 무시하고 macos', () => {
    const m4 = hardwareConfigs(gpu('apple-m4'), seed.gpus, { ramGB: 24, os: 'windows' });
    expect(m4).toHaveLength(1);
    expect(m4[0]!.hw).toMatchObject({ ramGB: 24, os: 'macos' });
    const strix = hardwareConfigs(gpu('amd-strix-halo'), seed.gpus, { ramGB: 64, os: 'windows' });
    expect(strix[0]!.hw.os).toBe('windows');
    const cpu = hardwareConfigs(gpu('cpu-ddr5-5600-2ch'), seed.gpus, { ramGB: 32 });
    expect(cpu[0]!.hw).toMatchObject({ kind: 'cpu', ramGB: 32, os: 'linux' });
  });
});

describe('그래픽카드에 올라가는 가중치로 full-gpu 판정 (10-03 D62)', () => {
  it('rtx-2080-ti × hyperclovax-seed-think-14b: 입력 임베딩을 빼면 전량 탑재 → S (이론 추정 GPU)', () => {
    const c = combo('rtx-2080-ti', 'hyperclovax-seed-think-14b');
    expect(c.baseline.result.mode).toBe('full-gpu');
    expect(c.baseline.result.verdict).toBe('S');
    expect(c.baseline.result.confidence).toBe('theoretical');
    expect(c.baseline.result.vram.weights).toBeCloseTo(8.92 - 0.39, 6);
    // 필요량 문장은 같은 규칙 — 그래픽카드 몫 + KV + 버퍼
    expect(c.baseline.memory.needGB).toBeCloseTo(c.baseline.result.vram.weights + c.baseline.result.vram.kv + c.baseline.result.vram.buffer, 9);
    expect(c.baseline.memory.offGpuGB).toBeCloseTo(0.39, 6);
    expect(c.baseline.memory.ramGB).toBe(0);
  });

  it('rtx-3090 × qwen3.5-35b-a3b: 컨텍스트를 32k 까지 늘려도 그래픽카드에 다 올라간다 (전엔 8k 까지)', () => {
    const g = gpu('rtx-3090');
    const c = combo('rtx-3090', 'qwen3.5-35b-a3b');
    const m = ctxMatrix(g, hardwareConfigs(g, seed.gpus)[0]!, model('qwen3.5-35b-a3b'), c.baseline);
    const f16 = (ctx: number) => m.rows[m.ctxs.indexOf(ctx)]![0]!;
    expect([8192, 16384, 32768].map((ctx) => f16(ctx).mode)).toEqual(['full-gpu', 'full-gpu', 'full-gpu']);
    expect(f16(65536).mode).not.toBe('full-gpu');
    // MTP 블록은 기본 미적재라 GPU 몫에서 빠지고, 분해 바가 "켜면 더 든다"고 알린다
    expect(c.baseline.mtpGB).toBeCloseTo(0.53, 6);
    expect(c.baseline.memory.offGpuGB).toBeCloseTo(22.63 - 19.53 - 2.01, 6);
  });

  it('통합 메모리(맥)는 파일 전체로 계산한다 — offGpuGB 를 쓰지 않는다', () => {
    const c = combo('apple-m4', 'llama-3.1-8b', 0);
    expect(c.baseline.result.mode).toBe('full-gpu');
    expect(c.baseline.result.vram.weights).toBeCloseTo(4.92, 6);
    expect(c.baseline.memory.offGpuGB).toBe(0);
    expect(c.baseline.memory.totalNeedGB).toBeCloseTo(4.92 + c.baseline.result.vram.kv + c.baseline.result.vram.buffer, 9);
  });
});

describe('Gemma 4 E4B·E2B — 층별 임베딩 표 (10-21 D112)', () => {
  it('rtx-4060 × gemma-4-e4b: 상주 3.03GB 로 전량 탑재, 표 1.95GB 는 시스템 RAM 몫으로 보이고 이론 추정(±30%)', () => {
    const c = combo('rtx-4060', 'gemma-4-e4b');
    expect(c.baseline.quant).toBe('Q4_K_M');
    expect(c.baseline.result).toMatchObject({ mode: 'full-gpu', verdict: 'S', confidence: 'theoretical' });
    expect(c.baseline.result.vram.weights).toBeCloseTo(4.98 - 1.95, 6);
    expect(c.baseline.pleGB).toBe(1.94);
    expect(c.baseline.memory.offGpuGB).toBeCloseTo(1.95, 6);
    expect(c.baseline.memory.ramGB).toBeCloseTo(1.95, 6);
    expect(c.baseline.memory.needGB).toBeCloseTo(3.03 + 0.134 + 0.575, 2);
    // 읽기 바이트 = 파일 − 표: (3.04 + 8k KV 0.134) ÷ (0.70 × 272) + 층별 임베딩 표 고정 시간(CUDA 1.35ms)
    expect(c.baseline.result.tgTokS.est).toBeCloseTo(1 / ((4.98 - 1.94 + (16_384 * 8192) / 1e9) / (0.7 * 272) + 1.35e-3), 6);
    // 표가 없는 dense 모델은 그대로 RAM 몫 0 (D62 각주만)
    expect(combo('rtx-4060', 'llama-3.1-8b').baseline.memory.ramGB).toBe(0);
    // 분해 바 각주는 입력 임베딩이 아니라 층별 임베딩 표를 말한다(D112 리뷰) — dGPU 전량 탑재만, 맥(통합 메모리)은 각주 없음
    expect(vramBreakdown(c.baseline, 'gemma-4-e4b').note).toEqual({ fileGB: 4.98, offGpuGB: expect.closeTo(1.95, 6) as number, pleGB: 1.94 });
    const mac = combo('apple-m4', 'gemma-4-e4b', 1);
    expect(mac.baseline.result.mode).toBe('full-gpu');
    expect(vramBreakdown(mac.baseline, 'gemma-4-e4b').note).toEqual({ fileGB: 4.98, offGpuGB: 0 });
  });

  it('rtx-5090 × E4B·E2B Q4_K_M: 공개 실측(Vulkan, 같은 unsloth 파일)이 조인된다', () => {
    expect(combo('rtx-5090', 'gemma-4-e4b').baseline.result).toMatchObject({ confidence: 'measured', tgTokS: { est: 234 } });
    expect(combo('rtx-5090', 'gemma-4-e2b').baseline.result).toMatchObject({ confidence: 'measured', tgTokS: { est: 341.8 } });
  });

  it('isTheoretical: arch.ple 모델은 GPU·모드와 무관하게 이론 추정, 다른 dense 모델은 그대로', () => {
    for (const gpuId of ['rtx-4060', 'rtx-3060-12gb', 'apple-m4', 'cpu-ddr5-5600-2ch']) {
      expect(combo(gpuId, 'gemma-4-e2b').baseline.result.confidence, gpuId).toBe('theoretical');
    }
    expect(combo('rtx-4060', 'gemma-4-12b').baseline.estimate.confidence).toBe('calibrated');
  });
});

describe('Nanbeige4.2 3B — 반복 층 (10-22 D114)', () => {
  it('toModelQuant passes loops and the row loop block; models without loops get neither key (engine input unchanged)', () => {
    const m = model('nanbeige4.2-3b');
    const row = seed.modelQuants.find((q) => q.modelId === m.id && q.quant === 'Q4_K_M')!;
    expect(toModelQuant(m, row)).toMatchObject({ loops: 2, loopGB: 1.97, kvBytesPerToken: 180_224, offGpuGB: 0.29 });
    // 블록 실측이 없는 행·bpw 폴백은 loops 만(엔진이 읽기 바이트 전체를 반복 블록으로 — 보수)
    expect(toModelQuant(m)).toMatchObject({ loops: 2 });
    expect(toModelQuant(m)).not.toHaveProperty('loopGB');
    for (const other of seed.models.filter((x) => x.arch.loops === undefined)) {
      const mq = toModelQuant(other, seed.modelQuants.find((q) => q.modelId === other.id));
      expect(mq, other.id).not.toHaveProperty('loops');
      expect(mq, other.id).not.toHaveProperty('loopGB');
    }
  });

  it('RTX 4060 8k: full-gpu with one copy of the weights (2.68 − 0.29), reads the loop block twice — theoretical', () => {
    const c = combo('rtx-4060', 'nanbeige4.2-3b');
    expect(c.baseline.quant).toBe('Q4_K_M');
    expect(c.baseline.result).toMatchObject({ mode: 'full-gpu', confidence: 'theoretical', verdict: 'S' });
    expect(c.baseline.result.vram.weights).toBeCloseTo(2.39, 9);
    expect(c.baseline.result.vram.kv).toBeCloseTo((180_224 * 8192) / 1e9, 9);
    expect(c.baseline.loopGB).toBe(1.97);
  });

  it('RTX 4060 32k: the 5.9GB KV pushes it to partial offload; -ngl counts logical layers (22 × (2 − 1) + 1 + GPU layers)', () => {
    const g = gpu('rtx-4060');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const m = model('nanbeige4.2-3b');
    const c = assessCombo(seed, g, config, m, { ctx: 32768 });
    const q = c.perQuant.find((x) => x.quant === 'Q4_K_M')!;
    expect(q.result.mode).toBe('partial-offload');
    const row = seed.modelQuants.find((r) => r.modelId === m.id && r.quant === 'Q4_K_M')!;
    const plan = commandPlan(g, config, m, row, q, { ctx: 32768 });
    const onGpu = Math.floor(q.gpuFrac! * 22);
    expect(onGpu).toBeGreaterThan(0);
    expect(plan.llamaCpp!.ngl).toBe(22 + 1 + onGpu);
    expect(plan.loops).toBe(2);
    expect(plan.layers).toBe(22);
  });

  it('isTheoretical: every GPU and mode for a looped model, other dense models unchanged', () => {
    const m = model('nanbeige4.2-3b');
    for (const id of ['rtx-5090', 'rtx-4060', 'apple-m4-pro', 'cpu-ddr5-5600-2ch']) {
      for (const mode of ['full-gpu', 'partial-offload', 'cpu-only'] as const) expect(isTheoretical(gpu(id), m, mode), `${id} ${mode}`).toBe(true);
    }
    expect(isTheoretical(gpu('rtx-4060'), model('llama-3.1-8b'), 'full-gpu')).toBe(false);
  });
});

describe('K2-Horizon 7B·MoVA 36B-A4B (10-21 D113)', () => {
  it('7B: 표준 dense — RTX 4060 Q4_K_M 8k 전량 탑재, 보정 추정(생각 모드 always 라 임계 ×1.5)', () => {
    const c = combo('rtx-4060', 'k2-horizon-7b');
    expect(c.baseline.quant).toBe('Q4_K_M');
    expect(c.baseline.result).toMatchObject({ mode: 'full-gpu', confidence: 'calibrated' });
    // 그래픽카드 상주 = 파일 − 입력 임베딩(헤더 실측 offGpuGB)
    expect(c.baseline.result.vram.weights).toBeCloseTo(5.59 - 0.59, 6);
  });

  it('MoVA: 값 전문가는 비전문가(그래픽카드 상주)라 cpu-moe 도 VRAM 에 남고, --n-cpu-moe 는 앞 dense 3층을 건너뛴 블록 수', () => {
    const g = gpu('rtx-3060-12gb');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const m = model('k2-horizon-mova-36b-a4b');
    const c = assessCombo(seed, g, config, m);
    expect(c.baseline.result.mode).toBe('cpu-moe');
    // VRAM 가중치 = 비전문가(값 전문가 4.25GB 포함 6.0) + GPU 에 남긴 FFN 전문가 층
    const perLayer = 15.99 / 45;
    const onCpu = c.baseline.result.cpuMoeLayers!;
    expect(c.baseline.result.vram.weights).toBeCloseTo(6.0 + perLayer * (45 - onCpu), 6);
    const row = seed.modelQuants.find((q) => q.modelId === m.id && q.quant === 'Q4_K_M')!;
    const n = commandPlan(g, config, m, row, c.baseline).llamaCpp!.nCpuMoe!;
    expect(n).toBe(onCpu + 3);
  });

  it('MoVA: 값 전문가 라우팅 고정 시간을 따로 세지 않고 공개 실측도 없어 GPU·모드와 무관하게 이론 추정', () => {
    for (const [gpuId, index] of [['rtx-5090', 0], ['rtx-3060-12gb', 0], ['rtx-4060', 0], ['apple-m4-pro', 2], ['cpu-ddr5-5600-2ch', 2]] as const) {
      const c = combo(gpuId, 'k2-horizon-mova-36b-a4b', index);
      expect(c.baseline.result.confidence, gpuId).toBe('theoretical');
    }
    expect(combo('rtx-5090', 'k2-horizon-mova-36b-a4b').baseline.result.mode).toBe('full-gpu');
  });

  it('MoVA: 엔진 입력에 행 실측 valueExpertGB 와 비율 valueTopK/valueExperts 가 실린다 — 분할 없는 행·다른 모델에는 없다', () => {
    const m = model('k2-horizon-mova-36b-a4b');
    const row = seed.modelQuants.find((q) => q.modelId === m.id && q.quant === 'Q8_0')!;
    expect(toModelQuant(m, row)).toMatchObject({ nonExpertGB: 10.94, expertGB: 28.2, valueExpertGB: 8.02, valueExpertFrac: 4 / 64 });
    const { expertGB: _e, nonExpertGB: _n, ...unsplit } = row;
    expect(toModelQuant(m, unsplit).valueExpertGB).toBeUndefined();
    const oss = model('gpt-oss-20b');
    const ossRow = seed.modelQuants.find((q) => q.modelId === oss.id)!;
    expect(toModelQuant(oss, ossRow)).not.toHaveProperty('valueExpertGB');
    expect(toModelQuant(oss, ossRow)).not.toHaveProperty('valueExpertFrac');
  });

  it('MoVA: 읽기 바이트는 값 전문가 중 고른 4/64 몫만 — RTX 5090 Q4_K_M 8k 전량 탑재 추정 = 엔진 식, ctx 표(같은 행 재평가)도 같은 값', () => {
    const g = gpu('rtx-5090');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const m = model('k2-horizon-mova-36b-a4b');
    const c = assessCombo(seed, g, config, m);
    expect(c.baseline.valueExpertGB).toBe(4.25);
    const read = 6.0 - 4.25 * (1 - 4 / 64) + 15.99 * (8 / 100) + (196_608 * 8192) / 1e9;
    const overhead = 45 * 8 * MOE_EXPERT_OVERHEAD_US.nvidia! * 1e-6;
    expect(c.baseline.result.tgTokS.est).toBeCloseTo(1 / (read / (0.7 * g.memBandwidthGBs) + overhead), 6);
    expect(c.baseline.result).toMatchObject({ verdict: 'S', confidence: 'theoretical' });
    // ctx 표는 QuantAssessment 를 행으로 다시 평가한다 — valueExpertGB 를 실어 나르지 않으면 8k·f16 칸이 헤드라인과 달라진다
    const cell = ctxMatrix(g, config, m, c.baseline, { ctxs: [8192], kvQuants: ['f16'] }).rows[0]![0]!;
    expect(cell.result.tgTokS.est).toBeCloseTo(c.baseline.result.tgTokS.est, 6);
    const { valueExpertGB: _v, ...withoutValue } = c.baseline;
    const stale = ctxMatrix(g, config, m, withoutValue, { ctxs: [8192], kvQuants: ['f16'] }).rows[0]![0]!;
    expect(stale.result.tgTokS.est).toBeLessThan(c.baseline.result.tgTokS.est * 0.8);
  });
});

describe('서로 다른 GPU 섞기 (docs/02 §6 베타, 10-03 D67)', () => {
  it('자격: 같은 계열(NVIDIA·AMD)의 데스크톱 dGPU 끼리만, FP16 크리플·노트북·Arc·통합·CPU 제외', () => {
    expect(canMixWith(gpu('rtx-3090'), gpu('rtx-3060-12gb'))).toBe(true);
    expect(canMixWith(gpu('rx-7900-xtx'), gpu('rx-7800-xt'))).toBe(true);
    expect(canMixWith(gpu('rtx-3090'), gpu('rx-7900-xtx'))).toBe(false);
    expect(canMixWith(gpu('rtx-3090'), gpu('gtx-1080-ti'))).toBe(false);
    expect(canMixWith(gpu('rtx-4090'), gpu('rtx-4090-laptop'))).toBe(false);
    expect(canMixWith(gpu('arc-b580'), gpu('arc-b580'))).toBe(false);
    expect(canMixWith(gpu('apple-m4'), gpu('rtx-3060-12gb'))).toBe(false);
    expect(canMixWith(gpu('cpu-ddr5-5600-2ch'), gpu('rtx-3060-12gb'))).toBe(false);
    // 섞을 수 있는 카드 = NVIDIA 데스크톱 24 + AMD 6 (GTX 1080 Ti 제외)
    expect(seed.gpus.filter(isMixableGpu).map((g) => g.effClass).sort()).toEqual([...Array(6).fill('amd'), ...Array(24).fill('nvidia')]);
  });

  const mixed = (ramGB: number) => hardwareConfigs(gpu('rtx-3090'), seed.gpus, { ramGB, extraGpus: [gpu('rtx-3060-12gb')] })[0]!;

  it('카드 목록 = 1번 × 장수 + 추가 카드, 화면 출력은 1번만 — 추가 카드가 없으면 예전 하드웨어 그대로', () => {
    expect(mixed(64).hw.gpus).toEqual([
      { vramGB: 24, memBandwidthGBs: 936, effClass: 'nvidia', isDisplayGpu: true },
      { vramGB: 12, memBandwidthGBs: 360, effClass: 'nvidia' },
    ]);
    const three = hardwareConfigs(gpu('rtx-3090'), seed.gpus, { gpuCount: 2, isDisplayGpu: false, extraGpus: [gpu('rtx-3060-12gb')] })[0]!;
    expect(three.hw.gpus?.map((u) => [u.vramGB, u.isDisplayGpu ?? false])).toEqual([[24, false], [24, false], [12, false]]);
    expect(hardwareConfigs(gpu('rtx-3090'), seed.gpus, { gpuCount: 2, extraGpus: [] })[0]!.hw).toEqual(
      hardwareConfigs(gpu('rtx-3090'), seed.gpus, { gpuCount: 2 })[0]!.hw,
    );
    expect(hardwareConfigs(gpu('rtx-3090'), seed.gpus, { gpuCount: 2 })[0]!.hw.gpuCount).toBe(2);
  });

  it('실측은 붙이지 않는다(1장 기준) — 통합 메모리·CPU 는 그대로 조인된다', () => {
    const g = gpu('rtx-3090');
    const measuredModels = seed.models.filter((m) =>
      seed.benchmarks.some((bp) => bp.gpuId === 'rtx-3090' && bp.modelId === m.id),
    );
    expect(measuredModels.length).toBeGreaterThan(0);
    let joinedAlone = 0;
    for (const m of measuredModels) {
      const alone = assessCombo(seed, g, hardwareConfigs(g, seed.gpus)[0]!, m);
      if (alone.perQuant.some((q) => q.measured)) joinedAlone += 1;
      const pair = assessCombo(seed, g, mixed(32), m, { theoretical: true });
      expect(pair.perQuant.every((q) => q.measured === undefined && q.result.confidence === 'theoretical'), m.id).toBe(true);
    }
    expect(joinedAlone).toBeGreaterThan(0);
  });

  it('RAM 힌트 구성은 함께 꽂은 카드를 유지한다 (1번 GPU 로 다시 만들지 않는다)', () => {
    const g = gpu('rtx-3090');
    const config = mixed(16);
    const c = assessCombo(seed, g, config, model('gpt-oss-120b'), { ramHint: true, theoretical: true });
    expect(c.ramHint).toBeDefined();
    expect(c.ramHint!.config.hw.gpus).toHaveLength(2);
    expect(c.ramHint!.config.hw).toEqual({ ...config.hw, ramGB: c.ramHint!.ramGB });
  });

  it('필요량 문장의 연산 버퍼는 카드마다 (엔진 fit 과 같은 값)', () => {
    const g = gpu('rtx-3090');
    const one = assessCombo(seed, g, hardwareConfigs(g, seed.gpus)[0]!, model('llama-3.3-70b'));
    const pair = assessCombo(seed, g, mixed(32), model('llama-3.3-70b'), { theoretical: true });
    expect(pair.baseline.memory.totalNeedGB - one.baseline.memory.totalNeedGB).toBeCloseTo(0.5 + 0.3 * (8192 / 32768), 9);
    // 3090 + 3060 = 36GB(사용 가능 35.4) — 70B Q4_K_M 은 부분 오프로드, 분모는 VRAM 합
    expect(pair.baseline.result.mode).toBe('partial-offload');
    expect(pair.baseline.result.vram.limit).toBe(36);
    expect(pair.baseline.memory.gpuUsableGB).toBeCloseTo(35.4, 9);
  });
});

describe('DeepSeek V4 Flash 0731 — compressed attention, mHC, MXFP4 baseline (10-22 D115)', () => {
  const V4 = 'deepseek-v4-flash-0731';
  const at = (gpuId: string, ramGB: number, opts: { gpuCount?: number } = {}) => {
    const g = gpu(gpuId);
    const config = hardwareConfigs(g, seed.gpus, { ramGB, ...opts })[0]!;
    return assessCombo(seed, g, config, model(V4));
  };

  it('record: compressed KV 6,880 B/tok, MoE 256 top-6, mHC, MXFP4 baseline (no Q4_K_M row), every row header-measured', () => {
    const m = model(V4);
    expect(m.arch).toMatchObject({ attnType: 'compressed', kvBytesPerTokenF16: 6880, experts: 256, topK: 6, mhc: true });
    expect(m.attnOverrides?.kvBytesPerTokenF16).toBe(6880);
    const rows = seed.modelQuants.filter((r) => r.modelId === V4);
    expect(rows.map((r) => [r.quant, r.fileGB, r.expertGB, r.nonExpertGB])).toEqual([
      ['MXFP4', 154.99, 147.17, 7.25],
      ['Q2_K', 117.35, 109.66, 7.13],
    ]);
    expect(at('apple-m3-ultra', 256).baseline.quant).toBe('MXFP4');
  });

  it('isTheoretical: every GPU and mode (mHC / compressed attention), other MoE models unchanged', () => {
    const m = model(V4);
    for (const id of ['rtx-5090', 'rtx-4060', 'apple-m3-ultra', 'nvidia-dgx-spark', 'cpu-ddr5-5600-2ch']) {
      for (const mode of ['full-gpu', 'cpu-moe', 'partial-offload', 'cpu-only'] as const) expect(isTheoretical(gpu(id), m, mode), `${id} ${mode}`).toBe(true);
    }
    expect(isTheoretical(gpu('apple-m3-ultra'), model('gpt-oss-120b'), 'full-gpu')).toBe(false);
    // 플래그 하나만 있어도 이론 추정
    expect(isTheoretical(gpu('apple-m3-ultra'), { ...model('gpt-oss-120b'), arch: { ...model('gpt-oss-120b').arch, mhc: true } }, 'full-gpu')).toBe(true);
    expect(isTheoretical(gpu('apple-m3-ultra'), { ...model('gpt-oss-120b'), arch: { ...model('gpt-oss-120b').arch, attnType: 'compressed' } }, 'full-gpu')).toBe(true);
  });

  it('large-memory Macs hold MXFP4 on the GPU; M2 Ultra 192GB only past the 70% default (CPU path), its Q2_K on the GPU', () => {
    for (const [id, ram] of [['apple-m3-ultra', 256], ['apple-m3-ultra', 512], ['apple-m5-ultra', 256]] as const) {
      const c = at(id, ram);
      expect(c.baseline.result, `${id} ${ram}`).toMatchObject({ verdict: 'S', mode: 'full-gpu', confidence: 'theoretical' });
    }
    const m2 = at('apple-m2-ultra', 192);
    expect(m2.baseline.result).toMatchObject({ verdict: 'B', mode: 'cpu-only' });
    expect(m2.perQuant.find((q) => q.quant === 'Q2_K')!.result).toMatchObject({ verdict: 'S', mode: 'full-gpu' });
  });

  it('128GB unified memory (DGX Spark, Strix Halo): MXFP4 does not fit, Q2_K only on the CPU path', () => {
    for (const id of ['nvidia-dgx-spark', 'amd-strix-halo']) {
      const c = at(id, 128);
      expect(c.baseline.fits, id).toBe(false);
      const q2 = c.perQuant.find((q) => q.quant === 'Q2_K')!;
      expect(q2.result, id).toMatchObject({ verdict: 'B', mode: 'cpu-only' });
      expect(c.display.quant, id).toBe('Q2_K');
    }
  });

  it('dGPU + system RAM: experts in RAM from 192GB with an RTX 5090 or RTX 4090 (MXFP4), Q2_K from 128GB; RTX 4060 + 32GB does not fit', () => {
    for (const id of ['rtx-5090', 'rtx-4090']) {
      expect(at(id, 192).baseline.result, id).toMatchObject({ verdict: 'B', mode: 'cpu-moe', confidence: 'theoretical' });
      expect(at(id, 128).baseline.fits, id).toBe(false);
      expect(at(id, 128).perQuant.find((q) => q.quant === 'Q2_K')!.result, id).toMatchObject({ verdict: 'B', mode: 'cpu-moe' });
    }
    const small = at('rtx-4060', 32);
    expect(small.perQuant.every((q) => !q.fits)).toBe(true);
  });

  it('the command keeps the MXFP4 shard tag (llama.cpp -hf skips dspark-* sidecars) and puts the first N blocks of experts in RAM', () => {
    const g = gpu('rtx-5090');
    const config = hardwareConfigs(g, seed.gpus, { ramGB: 192 })[0]!;
    const c = assessCombo(seed, g, config, model(V4));
    const row = seed.modelQuants.find((r) => r.modelId === V4 && r.quant === 'MXFP4')!;
    const plan = commandPlan(g, config, model(V4), row, c.baseline);
    expect(plan.llamaCpp?.command).toContain('-hf ggml-org/DeepSeek-V4-Flash-0731-GGUF:MXFP4');
    expect(plan.llamaCpp?.nCpuMoe).toBe(c.baseline.result.cpuMoeLayers);
    expect(plan.ollamaOmitted).toBe('sharded');
  });
});

describe('GLM-5.3-Flash — KDA + DSA hybrid, mHC, Q4_K file as the Q4_K_M baseline (10-22 엔진 후속 ⑧-b)', () => {
  const GLM = 'glm-5.3-flash';
  const at = (gpuId: string, ramGB: number, opts: { gpuCount?: number } = {}) => {
    const g = gpu(gpuId);
    const config = hardwareConfigs(g, seed.gpus, { ramGB, ...opts })[0]!;
    return assessCombo(seed, g, config, model(GLM));
  };
  const q = (c: ReturnType<typeof at>, quant: string) => c.perQuant.find((x) => x.quant === quant)!;

  it('record: hybrid KV 19,712 B/tok (DSA 11 layers), MoE 288 top-8 on 42 layers, mHC, always thinking, both rows header-measured', () => {
    const m = model(GLM);
    expect(m.arch).toMatchObject({ attnType: 'hybrid', kvBytesPerTokenF16: 19712, experts: 288, topK: 8, mhc: true, indexerKPool: 4, layers: 45 });
    expect(m.arch.expertLayers).toHaveLength(42);
    expect(m.attnOverrides?.kvBytesPerTokenF16).toBe(19712);
    expect(m.thinking).toBe('always');
    const rows = seed.modelQuants.filter((r) => r.modelId === GLM);
    expect(rows.map((r) => [r.quant, r.fileGB, r.expertGB, r.nonExpertGB, r.fileName])).toEqual([
      ['Q4_K_M', 181.37, 171.23, 9.46, 'GLM-5.3-Flash-Q4_K-00001-of-00002.gguf'],
      ['Q2_K', 133.81, 123.66, 9.46, 'GLM-5.3-Flash-Q2_K-00001-of-00002.gguf'],
    ]);
    expect(at('apple-m3-ultra', 512).baseline.quant).toBe('Q4_K_M');
  });

  it('isTheoretical: every GPU and mode (mHC)', () => {
    const m = model(GLM);
    for (const id of ['rtx-5090', 'rtx-4060', 'apple-m3-ultra', 'nvidia-dgx-spark', 'cpu-ddr5-5600-2ch']) {
      for (const mode of ['full-gpu', 'cpu-moe', 'partial-offload', 'cpu-only'] as const) expect(isTheoretical(gpu(id), m, mode), `${id} ${mode}`).toBe(true);
    }
  });

  it('Macs: Q4_K_M on the GPU only with 512GB (181.37GB > 179.2 on 256GB); Q2_K on the GPU from 256GB; M2 Ultra 192GB is 0.15GB short for Q2_K (CPU path)', () => {
    // M5 Ultra 는 카탈로그 메모리 옵션이 96·256GB 뿐(512GB 구성은 계산기에서 고를 수 없다 — 10-22 ⑧-b 리뷰)
    expect(gpu('apple-m5-ultra').ramOptionsGB).toEqual([96, 256]);
    expect(at('apple-m3-ultra', 512).baseline.result).toMatchObject({ verdict: 'A', mode: 'full-gpu', confidence: 'theoretical' });
    for (const id of ['apple-m3-ultra', 'apple-m5-ultra']) {
      const c = at(id, 256);
      expect(c.baseline.result, id).toMatchObject({ verdict: 'B', mode: 'cpu-only' });
      expect(q(c, 'Q2_K').result, id).toMatchObject({ mode: 'full-gpu' });
    }
    // Q2_K 쾌적은 M5 Ultra 만 — M3 Ultra 는 판정 할인(아래 테스트)으로 원활
    expect(q(at('apple-m5-ultra', 256), 'Q2_K').result.verdict).toBe('S');
    expect(q(at('apple-m3-ultra', 256), 'Q2_K').result.verdict).toBe('A');
    const m2 = at('apple-m2-ultra', 192);
    expect(m2.baseline.result).toMatchObject({ verdict: 'B', mode: 'cpu-only' });
    expect(q(m2, 'Q2_K').result).toMatchObject({ verdict: 'B', mode: 'cpu-only' });
    // GPU 경로 8k 필요량(256GB 맥에서 잰 값 134.55)이 192GB 의 GPU 몫 134.4(× 0.70)를 넘는다 — sysctl 로 한도를 올리면 GPU(기존 툴팁)
    const gpuNeed = q(at('apple-m3-ultra', 256), 'Q2_K').memory.needGB;
    expect(gpuNeed).toBeGreaterThan(134.4);
    expect(gpuNeed - 134.4).toBeLessThan(0.2);
  });

  it('128GB unified memory (DGX Spark, Strix Halo) and RTX 4060 + 32GB: neither file fits', () => {
    for (const [id, ram] of [['nvidia-dgx-spark', 128], ['amd-strix-halo', 128], ['rtx-4060', 32]] as const) {
      expect(at(id, ram).perQuant.every((x) => !x.fits), id).toBe(true);
    }
  });

  it('dGPU + system RAM: experts in RAM with an RTX 5090 + 192GB / RTX 4090 + 256GB (Q4_K_M), Q2_K only from 128GB; 4 × RTX 3090 + 128GB', () => {
    expect(at('rtx-5090', 192).baseline.result).toMatchObject({ verdict: 'B', mode: 'cpu-moe', confidence: 'theoretical' });
    expect(at('rtx-4090', 256).baseline.result).toMatchObject({ verdict: 'B', mode: 'cpu-moe' });
    const small = at('rtx-5090', 128);
    expect(small.baseline.fits).toBe(false);
    expect(q(small, 'Q2_K').result).toMatchObject({ verdict: 'B', mode: 'cpu-moe' });
    expect(at('rtx-3090', 128, { gpuCount: 4 }).baseline.result).toMatchObject({ verdict: 'B', mode: 'cpu-moe' });
  });

  it('verdict discount (10-22 ⑧-b 리뷰): every public reference ran ≥ 8.2% under the estimate, so the grade uses est ÷ 1.082 — speed, band and label stay the engine values', () => {
    // GLM 만(DeepSeek V4 Flash 는 배포된 페이지라 사용자 결정 전까지 — PROGRESS §2 큐 3). 값 = 엔진 회귀 15 GLM53_REFERENCE.recordedErr 의 최솟값
    expect(VERDICT_OVERESTIMATE).toEqual({ [GLM]: 0.082 });
    expect(Math.min(0.235, 0.238, 0.108, 0.116, 0.082, 0.238, 0.261, 0.242)).toBe(VERDICT_OVERESTIMATE[GLM]);
    for (const ram of [256, 512]) {
      const c = at('apple-m3-ultra', ram);
      const q2 = q(c, 'Q2_K');
      // 표시 추정은 쾌적 임계(생각 모드 20 × 1.5 = 30)를 넘지만, 같은 칩 계열·같은 파일 참고점(M2 Ultra +23.5%)으로 보면 원활 쪽
      expect(q2.result.tgTokS.est).toBeGreaterThan(30);
      expect(q2.result.tgTokS.est / 1.082).toBeLessThan(30);
      expect(q2.result).toMatchObject({ verdict: 'A', mode: 'full-gpu', confidence: 'theoretical' });
      expect(q2.estimate.verdict).toBe('A');
      expect(q2.verdictReason).toBe('cap-overestimate');
      expect(q2.overestimate).toBe(0.082);
      // 범위는 엔진 ±30% 그대로
      expect(q2.result.tgTokS.low).toBeCloseTo(q2.result.tgTokS.est * 0.7, 9);
      // ctx 계단·행렬(estimateAt)도 같은 등급
      expect(ctxMatrix(gpu('apple-m3-ultra'), hardwareConfigs(gpu('apple-m3-ultra'), seed.gpus, { ramGB: ram })[0]!, model(GLM), q2).rows[1]![0]!.verdict).toBe('A');
    }
    // 512GB: Q2_K 가 기준(Q4_K_M 원활)과 같은 등급이 되어 최후 수단 힌트가 없어진다 · 256GB: 최후 수단 Q2_K 원활
    expect(at('apple-m3-ultra', 512).lastResort).toBeUndefined();
    expect(at('apple-m3-ultra', 256).lastResort?.result.verdict).toBe('A');
    // 할인해도 등급이 같으면 사유는 그대로 — M5 Ultra Q2_K 42.6 ÷ 1.082 ≈ 39.4 쾌적(속도), RTX 5090 네 장 + 64GB Q2_K 49.9(MoE 전문가 RAM 배치 —
    // 쾌적은 GPU 전량 탑재 전용)
    const m5 = q(at('apple-m5-ultra', 256), 'Q2_K');
    expect(m5.verdictReason).toBe('speed');
    expect(m5).not.toHaveProperty('overestimate');
    const four = q(at('rtx-5090', 64, { gpuCount: 4 }), 'Q2_K');
    expect(four.result).toMatchObject({ verdict: 'A', mode: 'cpu-moe' });
    expect(four.verdictReason).toBe('cap-full-gpu-only');
  });

  it('verdict discount touches no other catalog model (hub configurations)', () => {
    for (const m of seed.models) {
      if (m.id === GLM) continue;
      for (const g of seed.gpus) {
        for (const c of hardwareConfigs(g, seed.gpus)) {
          for (const x of assessCombo(seed, g, c, m).perQuant) {
            expect(x.verdictReason, `${m.id} ${g.id}`).not.toBe('cap-overestimate');
          }
        }
      }
    }
  });
});
