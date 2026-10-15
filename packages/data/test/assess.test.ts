/**
 * 허브 판정 조립 (packages/data/src/assess.ts) — docs/01 §3 허브 판정 규칙의 회귀 고정.
 * 기대값은 P1-1 계획 검토의 전 카탈로그 시뮬레이션(2,378 구성) 수치와 일치한다.
 */
import { describe, expect, it } from 'vitest';
import {
  assessCombo,
  baselineRow,
  canMixWith,
  cheapestOptions,
  classifyLicense,
  ctxMatrix,
  ggufPublisher,
  hardwareConfigs,
  HUB_POLICY,
  isFp16Crippled,
  isMixableGpu,
  memoryMatrix,
  modelGpuRows,
  rankableStreet,
  sameSizeQuant,
  summarizeGpu,
  summarizeModel,
  unifiedCpuBandwidth,
  verdictRank,
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
    // 09-30 22.18(전문가 전부 RAM) → 10-01 전문가 15층 GPU 배치. 공개 실측 5090 + DDR5-6400 --n-cpu-moe 24 = 37.59
    expect(hint.result.tgTokS.est).toBeCloseTo(35.33, 1);
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

describe('통합 메모리 CPU 경로 (P1-1 리뷰 — 역전 방지)', () => {
  it('CPU측 대역폭은 기존 계수 비율로 깎인다 (새 상수 없음)', () => {
    const m3u = gpu('apple-m3-ultra');
    // apple-ultra: min(1, 0.44/0.5, 0.29/0.43) = 0.29/0.43
    expect(unifiedCpuBandwidth(m3u)).toBeCloseTo((m3u.memBandwidthGBs * 0.29) / 0.43, 6);
    // apple: min(1, 0.6/0.5, 0.44/0.43) = 1 (10-15 D81 — MoE 0.30 → 0.44) · strix: 계수가 cpu 보다 커서 깎지 않는다
    const m4 = gpu('apple-m4');
    expect(unifiedCpuBandwidth(m4)).toBe(m4.memBandwidthGBs);
    const strix = gpu('amd-strix-halo');
    expect(unifiedCpuBandwidth(strix)).toBe(strix.memBandwidthGBs);
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
  // 10-01 D56 부분 배치로 rtx-4060 × gpt-oss-20b 는 30.8 → A, 남은 B 는 8GB 급 노트북·3050
  it('cpu-moe 는 원활 기준 미만이면 B — 리즈닝은 30 (rtx-3050-8gb × gpt-oss-20b)', () => {
    const c = combo('rtx-3050-8gb', 'gpt-oss-20b');
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
    expect(c).toMatchObject({ S: 11, A: 6, B: 10, F: 10, otherQuant: 5 });
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
