/**
 * 실측 대조 회귀 — verify_engine.py (2026-08-09) 의 vitest 이식 (docs/02 §7).
 * print 스크립트가 아닌 assertion: §7 수치가 곧 기대값. `pnpm run verify-engine` 로 단독 실행.
 *
 * AC (docs/06 P0-2):
 *  1) 가중치 11종: MAE < 1% (검증값 0.7%), 케이스별 |err| ≤ 1.6%
 *  2) KV 7종: 공식값 전수 일치 (±0.5 KiB)
 *  3) 속도 12점: 각 점이 클래스 밴드(±12%/±20%) 이내 + MAE < 7% (검증값 6.3% → 10-15 D83 Apple 2점을 지금 빌드 값으로 바꿔 5.6%
 *     → 10-16 D88 MoE 고정 시간으로 4.7% → 10-16 D90 strix 재보정으로 4.2%)
 *  4) 판정 새너티: 4060 8GB 통념 일치
 *  5) cpu-moe(전문가 RAM) 3점: 각 ±20% 이내 + MAE < 12% (09-30 보정 — 이전 식은 ~2.5× 과소)
 *  6) 같은 GPU 여러 장 10점(D58) · 7) 서로 다른 GPU 섞기 3점(D67)
 *  8) 클래스 계수 재보정 29점(10-15 D79·D83, 10-16 D90): AMD Vulkan 4점 각 ±12% · DGX Spark 10점·Apple dense 9점·Strix Halo dense 6점 각 ±20%
 *     (Apple MoE 8점(#15396 2025-08 빌드)은 10-16 D88 에 회귀 밖 참고점 — 10 의 MOE_OLD_BUILD_CASES)
 *  9) pp(§3.5) Apple 12점(10-16 D86): 각 ±40%(PP_BAND) · M5 계열 5점 각 ±12% · 그 밖의 칩 새 빌드 2점 각 ±5%
 * 10) MoE 토큰당 고정 시간(§3.1, 10-16 D88): 2026 빌드 49점(10-16 D90 에 Strix Halo 4점 추가) 각 ±20% · MAE < 10%(검증값 8.9% → 8.3%) · 클래스별 MAE < 12%
 * 11) pp 모델 크기(§3.5, 10-16 D91): 2026 빌드 다모델 91점(dense 61·MoE 30) 각 ±40%(PP_BAND) · MAE < 13%(검증값 11.6%) · 클래스별 MAE < 15%
 *     · ±30% 밖 2점 이하 — 옛 식(GPU 마다 값 하나)은 같은 점에서 MAE 92%·최대 +733%
 * 12) Gemma 4 E4B·E2B(층별 임베딩 표·KV 공유 층, 10-21 D112): 저장 KV 정확값 · 그래픽카드 상주/시스템 RAM 몫 · 공개 실측 10점 오차표 고정
 *     · 층별 임베딩 표 고정 시간(PLE_TOKEN_OVERHEAD_MS — D112 리뷰 반영)은 백엔드별 minimax: CUDA 6점 ±11.1% · Vulkan 2점 ±2.5% 안,
 *     참고점 B580 SYCL ±5% · A770 Vulkan +78%(intel-arc 계수 문제) — 라벨은 이론 추정(docs/02 §4 ⑦·§7·§9)
 * 13) 반복 층(Nanbeige4.2-3B — 10-22 D114, 엔진 0.12.0): KV 180,224 B/tok(논리 44층) · 같은 기기 비율(Steam Deck Vulkan fa 1·0, 빌드 b10360 추정 — 카탈로그 밖
 *     기기라 비율로 대역폭·계수를 지운다) 추정 비/실측 비 ±5%(−2.6%·−0.6%), 반복을 빼면 +60% 넘게·파일 전체 × 2 면 −10% 넘게 벗어남을 함께 고정,
 *     pp 는 rough ±40% 안(반복을 빼면 밖) — 라벨은 이론 추정(근거 1점·카탈로그 밖 기기, docs/02 §4 ⑨·§7·§9)
 * 14) DeepSeek V4 Flash(압축 어텐션·mHC — 10-22 D115, 엔진 산식 변화 없음): 압축 KV 6,880 B/tok 이 llama.cpp 로그(#27680)의 CSA·인덱서·HCA 캐시와
 *     ±1% 안(256 셀 패딩), raw SWA 창·압축기 상태는 컨텍스트와 무관한 상수(엔진은 연산 버퍼 근사에 맡긴다), 공개 실측 참고점 M2 Ultra(#28948 tg32)는
 *     추정이 +25% 높고(±30% 안 — 실측 ≥ 추정 × 0.7) 08-03 옛 빌드는 +33%, 문맥 감쇠는 실측 −19%·엔진 −1.6% — 라벨은 이론 추정(docs/02 §4 ⑩·§7·§9).
 *     로그는 슬롯 하나(-np 1 — 1/1 seqs)라 토큰당 KV 는 슬롯 하나 기준(스니펫이 -np 1 을 붙인다, 기본 4슬롯이면 4배), pp 는 30k 깊이에서 0.26배로
 *     떨어지는데 엔진 pp 는 깊이와 무관 — 엔진 밖 한계로 고정(10-22 D115 리뷰)
 * 15) GLM-5.3-Flash(KDA + DSA 희소 MLA·인덱서 + mHC — 10-22 엔진 후속 ⑧-b, 엔진 산식 변화 없음): KV 19,712 B/tok 이 llama.cpp 메모리 로그(#30499 댓글)의
 *     MLA·인덱서 캐시와 정확히 같고, KDA 순환 상태(시퀀스마다 ≈ 153MB — 로그와 일치)는 다른 상수 상태 층 하이브리드처럼 미계상(슬롯마다 한 벌 — 스니펫의
 *     -np 1 은 이 상태가 아니라 슬롯 수에 비례하는 인덱서 k-pool 연산 예약 #29950 때문이다, 10-22 ⑧-b 리뷰).
 *     공개 실측 참고점 3곳(M2 Ultra #29958 · DGX Spark #30640 · 6 × 3090 #29928 — 모두 파일 가정이나 카탈로그 밖 구성이라 조인 안 됨)은 추정이 8~26% 높고
 *     ±30% 표시 범위 안, 문맥 감쇠는 엔진과 같다(DeepSeek V4 와 다르다) — 라벨은 이론 추정(docs/02 §4 ⑩·§7·§9). 가장 작은 과대(+8.2%)는 데이터 계층 판정
 *     할인(packages/data/src/assess.ts `VERDICT_OVERESTIMATE`)의 값이다 — 등급만 이만큼 낮춘 속도로 정한다(엔진 값은 그대로)
 * 16) DGX Spark 가 GPU 에 올릴 수 있는 메모리(10-23 D117, 엔진 0.13.0 `Hardware.unifiedUsableGB`): 1대 공개 실측 4점의 들어감·안 들어감이 기기 근거 값
 *     116.9GB(DGX OS 7.5.0 부팅 가용 − 데스크톱 기본 사용량)와 모두 맞고, 옛 규칙(× 0.70 = 89.6GB)으로는 1대에서 돈 셋이 GPU 에 안 들어간다. CPU 경로 한도도
 *     그 값을 넘지 않는다(같은 메모리). 값이 없는 통합 메모리 기기(맥·Strix Halo)는 산식 그대로(docs/02 §2.3·§7)
 * 17) DGX Spark 여러 대 llama.cpp RPC 층 분할(10-23 D118, 엔진 0.14.0·0.14.1·0.14.2 `Hardware.nodes`·`RPC_HOP_TG_MS`): 같은 사람 1대/2대 공개 쌍 14점 — 조건이 같은 9점의
 *     토큰당 추가 시간 역산(TCP 기본 3.6~7.95ms · RDMA 1.0~1.4ms — Classmethod 쌍은 루프백 RPC 장치 몫 포함)과, 2대만 CPU 유휴 상태를 끈 5점(1대는 기본 설정 —
 *     조건이 다른 쌍이라 이동 시간 근거에서 뺀다, D118 리뷰)까지 14점 모두의 5ms 2대 예측 오차(전부 ±17% 안, 과대는 TCP 32k +10.3% 뿐, 깊이 8k 이하 TCP 기본
 *     점은 모두 실측 이하)를 고정하고, 2대에서만 돈 공개 실측 2점이 1대에는 안 들어가고 2대에는 들어감을 본다. 가장 많이 맡는 대는 GGUF 헤더로 따라 한 llama.cpp
 *     분할과 견준다(남은 메모리가 같을 때와 첫 기기가 0.1% 작을 때 — 원격 한 대가 한 칸 더 받는다, D118 리뷰 2차) — 앞쪽 dense MoE(GLM-5.3-Flash)·크기가 고른
 *     층(DeepSeek V4 Flash 0731)은 두 경우 모두 그 이상, 층마다 양자화가 다른 Kolibri-1 Q4_K_M 은 알려진 과소(최대 −2.04GB)를 값으로 고정(D118 리뷰).
 *     3·4대는 이동 횟수(대수 − 1)로 늘린 이론값(4대 RPC 공개 실측 없음) — 라벨은 이론 추정(docs/02 §6.2·§7)
 */
import { describe, expect, it } from 'vitest';
import { fit } from '../src/fit';
import { evaluate } from '../src/index';
import { clusterNodeLoadGB, clusterShareOf, computeBufferGB, gpuResidentGBFor, kvBytesPerToken, kvGB, usableGB, usableRamGB, weightsGBFromBpw } from '../src/memory';
import { PLE_CUDA_CLASSES, PLE_TOKEN_OVERHEAD_MS, RPC_HOP_TG_MS } from '../src/constants';
import { bytesPerTokenGB, gpuThroughputGBs, pleOverheadSeconds, ppEstimate, tgEstimate } from '../src/speed';
import type { Hardware, ModelQuant } from '../src/types';
import {
  APPLE_PP_CASES,
  LLAMA2_7B_Q4_0,
  PP_SIZE_CASES,
  CPU_MOE_CASES,
  DSV4_FLASH_MXFP4,
  DSV4_FLASH_Q2K,
  DSV4_FLASH_MXFP4_CLUSTER,
  DSV4_KV_LOG,
  DSV4_M2_ULTRA,
  DSV4_REFERENCE,
  GLM53_3090X6,
  GLM53_AVAR6_Q2Q3,
  GLM53_KV_LOG,
  GLM53_M2_ULTRA,
  GLM53_Q2K,
  GLM53_Q4K,
  GLM53_REFERENCE,
  GLM53_SPARK,
  GLM53_UD_IQ2XXS,
  GEMMA4_E2B_Q4,
  GEMMA4_E4B_Q4,
  GEMMA4_E4B_Q8,
  LOOP_RATIO_CASES,
  LOOP_RATIO_CTX,
  LOOP_RATIO_REFERENCE,
  LOOP_RATIO_SOURCE,
  NANBEIGE42_Q4,
  NANBEIGE42_Q4_OWAO,
  PLE_SPEED_CASES,
  MOE_OLD_BUILD_CASES,
  MOE_OVERHEAD_CASES,
  MOE_OVERHEAD_SPARK_B7941,
  RECAL_1015_CASES,
  STRIX_SLOWER_DENSE_CASES,
  HETERO_GPU_CASES,
  MULTI_GPU_CASES,
  GPT_OSS_20B,
  KV_CASES,
  LLAMA31_8B_Q4,
  LLAMA31_8B_Q4_RESIDENT,
  QWEN3_14B_Q4,
  QWEN3_30B_A3B_Q4,
  QWEN3_8B_Q4,
  RTX_4060_8GB,
  RTX_4090,
  CLUSTER_FIT_CASES,
  CLUSTER_RPC_PAIRS,
  CLUSTER_SPLIT_SIM,
  GLM53_Q2K_CLUSTER,
  GPT_OSS_120B,
  SPARK_128_USABLE,
  SPARK_128_X2,
  SPARK_64_USABLE,
  SPARK_FIT_CASES,
  SPARK_USABLE_128_GB,
  SPEED_CASES,
  WEIGHTS_CASES,
} from './fixtures';

describe('1) weights: paramsB × bpw / 8 vs actual GGUF size (11 cases)', () => {
  const errors = WEIGHTS_CASES.map(({ paramsB, quant, actualGB }) => {
    const pred = weightsGBFromBpw(paramsB, quant);
    return Math.abs(pred - actualGB) / actualGB;
  });

  it.each(WEIGHTS_CASES.map((c) => [c.name, c.quant, c] as const))(
    '%s %s within ±1.6%%',
    (_name, _quant, c) => {
      const pred = weightsGBFromBpw(c.paramsB, c.quant);
      expect(Math.abs(pred - c.actualGB) / c.actualGB).toBeLessThanOrEqual(0.016);
    },
  );

  it('MAE < 1% (verified 0.7%)', () => {
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mae).toBeLessThan(0.01);
  });
});

describe('2) KV cache: 2·layers·kvHeads·headDim·2B vs known KiB/tok (9 cases — 10-21 D112 Gemma 4 E4B·E2B 저장 KV)', () => {
  // 정확값 일치 (외부 리뷰 반영 — 근사 허용 오차 제거, 공식이므로 toBe)
  it.each(KV_CASES.map((c) => [c.name, c] as const))('%s exact match', (_name, c) => {
    expect(kvBytesPerToken({ layers: c.layers, kvHeads: c.kvHeads, headDim: c.headDim })).toBe(
      c.expectKiB * 1024,
    );
  });

  it('Llama-3.1-8B @16k ctx: f16 exactly 2^31 bytes = 2.147483648 GB, q8_0 = ×0.535', () => {
    const f16 = kvGB(128 * 1024, 16384, 'f16');
    expect(f16).toBe((128 * 1024 * 16384) / 1e9); // 2.147483648
    expect(kvGB(128 * 1024, 16384, 'q8_0')).toBeCloseTo(f16 * 0.535, 9);
  });
});

describe('3) speed: tg = eff × BW / (weightsRead + kvRead) vs measured (12 points)', () => {
  const errors = SPEED_CASES.map(({ hw, mq, ctx, measuredTg }) => {
    const pred = tgEstimate(hw, mq, { mode: 'full-gpu' }, { ctx });
    return (pred - measuredTg) / measuredTg;
  });

  it.each(SPEED_CASES.map((c, i) => [c.label, c, i] as const))(
    '%s within class band',
    (_label, c, i) => {
      expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(c.band);
    },
  );

  it('MAE < 7% (verified 6.3% → 5.6% after the 10-15 D83 Apple swap → 4.7% with the 10-16 D88 MoE fixed time → 4.2% with the 10-16 D90 strix recalibration)', () => {
    const mae = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
    expect(mae).toBeLessThan(0.07);
  });

  it('§8 seed: tg(4090, qwen3-8b Q4, 16k) ∈ [88, 115] (measured 104.3)', () => {
    const { tgTokS, mode } = evaluate(RTX_4090, QWEN3_8B_Q4, { ctx: 16384 });
    expect(mode).toBe('full-gpu');
    expect(tgTokS.est).toBeGreaterThanOrEqual(88);
    expect(tgTokS.est).toBeLessThanOrEqual(115);
  });
});

describe('4) verdict sanity: RTX 4060 8GB (windows display, usable ≈ 7.4GB)', () => {
  it('Llama-3.1-8B Q4_K_M runs full-gpu (measured 38~42 tok/s → S)', () => {
    const r = evaluate(RTX_4060_8GB, LLAMA31_8B_Q4);
    expect(r.mode).toBe('full-gpu');
    expect(r.verdict).toBe('S');
  });

  it.each([
    ['Qwen3-14B Q4_K_M', QWEN3_14B_Q4],
    ['Qwen3-30B-A3B Q4_K_M', QWEN3_30B_A3B_Q4],
    ['gpt-oss-20b MXFP4', GPT_OSS_20B],
  ] as const)('%s: no full offload', (_name, mq) => {
    expect(evaluate(RTX_4060_8GB, mq).mode).not.toBe('full-gpu');
  });

  it('Qwen3-14B Q4_K_M stays off full offload with the header-measured GPU share (10-03 D62: 9.00 − 0.44 = 8.56GB)', () => {
    // 입력 임베딩 0.44GB 를 빼도 8.56 + KV 1.31 + 버퍼 0.575 = 10.45 > 7.4 — 판정 새너티는 그대로
    expect(evaluate(RTX_4060_8GB, { ...QWEN3_14B_Q4, offGpuGB: 0.44 }).mode).not.toBe('full-gpu');
    expect(evaluate(RTX_4060_8GB, LLAMA31_8B_Q4_RESIDENT)).toMatchObject({ mode: 'full-gpu', verdict: 'S' });
  });
});

describe('5) cpu-moe: 전문가 일부 GPU 배치까지 공개 실측 대조 (09-30 → 10-01 D56, docs/02 §3.3·§7)', () => {
  const errors = CPU_MOE_CASES.map(
    ({ hw, mq, ctx, nCpuMoe, measuredTg }) =>
      (tgEstimate(hw, mq, { mode: 'cpu-moe', cpuMoeLayers: nCpuMoe }, { ctx }) - measuredTg) / measuredTg,
  );
  const abs = errors.map(Math.abs);

  it.each(CPU_MOE_CASES.flatMap((c, i) => (c.strict ? [[c.label, i] as const] : [])))('%s within ±20%% (09-30 strict)', (_label, i) => {
    expect(abs[i]!).toBeLessThanOrEqual(0.2);
  });

  it('MAE < 12% over every public point', () => {
    expect(abs.reduce((a, b) => a + b, 0) / abs.length).toBeLessThan(0.12);
  });

  it('≥ 80% of points within ±20%, every point within ±40%', () => {
    expect(abs.filter((e) => e <= 0.2).length / abs.length).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...abs)).toBeLessThan(0.4);
  });

  it('표시 범위(이론 추정 est×0.7~1.3) 밖은 과소 추정뿐 — 실제가 범위보다 느린 점은 없다 (docs/02 §4 ②)', () => {
    CPU_MOE_CASES.forEach((c, i) => {
      const est = c.measuredTg * (1 + errors[i]!);
      expect(c.measuredTg, c.label).toBeGreaterThanOrEqual(est * 0.7);
    });
  });

  it('has enough points to mean something', () => {
    expect(CPU_MOE_CASES.length).toBeGreaterThanOrEqual(35);
  });
});

describe('6) multi-GPU layer split (§6 beta, D58): 공개 실측 10점', () => {
  const errors = MULTI_GPU_CASES.map(({ hw, mq, ctx, measuredTg }) => {
    const r = fit(hw, mq, { ctx });
    expect(r.mode).toBe('full-gpu');
    return (tgEstimate(hw, mq, r, { ctx }) - measuredTg) / measuredTg;
  });

  it('every point within ±30% (theoretical band) and never more than 5% optimistic', () => {
    for (const e of errors) {
      expect(Math.abs(e)).toBeLessThanOrEqual(0.3);
      expect(e).toBeLessThanOrEqual(0.05);
    }
  });

  it('MAE < 15%', () => {
    expect(errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length).toBeLessThan(0.15);
  });
});

describe('7) mixed GPUs layer split (§6 beta, 10-03 D67): 공개 실측 3점', () => {
  const rows = HETERO_GPU_CASES.map((c) => {
    const r = fit(c.hw, c.mq, { ctx: c.ctx });
    return { c, r, error: (tgEstimate(c.hw, c.mq, r, { ctx: c.ctx }) - c.measuredTg) / c.measuredTg };
  });

  it.each(rows.map((row) => [row.c.label, row] as const))('%s: 두 카드 모두에 전량 탑재(기본 층 분할)', (_, { r }) => {
    expect(r.mode).toBe('full-gpu');
  });

  it('class coefficients (5070 Ti + 3060): within ±30% and never more than 5% optimistic (≈ −7%)', () => {
    for (const { error } of rows.filter((row) => row.c.kind === 'class')) {
      expect(Math.abs(error)).toBeLessThanOrEqual(0.3);
      expect(error).toBeLessThanOrEqual(0.05);
      expect(error).toBeCloseTo(-0.068, 2);
    }
  });

  it('formula with per-card coefficients fitted to single-card runs (3060 + P100): each within ±10% (+2.6% · −1.5%)', () => {
    const formula = rows.filter((row) => row.c.kind === 'formula');
    expect(formula).toHaveLength(2);
    for (const { error } of formula) expect(Math.abs(error)).toBeLessThanOrEqual(0.1);
    expect(formula[0]!.error).toBeCloseTo(0.026, 2);
    expect(formula[1]!.error).toBeCloseTo(-0.015, 2);
  });
});

describe('8) class recalibration (10-15 D79·D83, 10-16 D90): AMD Vulkan 4점 · DGX Spark 10점 · Apple dense 9점 · Strix Halo dense 6점', () => {
  const errors = RECAL_1015_CASES.map(
    ({ hw, mq, ctx, measuredTg }) => (tgEstimate(hw, mq, { mode: 'full-gpu' }, { ctx }) - measuredTg) / measuredTg,
  );
  const group = (prefix: string) => errors.filter((_, i) => RECAL_1015_CASES[i]!.label.startsWith(prefix));

  it.each(RECAL_1015_CASES.map((c, i) => [c.label, c, i] as const))('%s within class band', (_label, c, i) => {
    expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(c.band);
  });

  it('AMD dense (Vulkan no-FA 표): MAE < 7%', () => {
    const amd = group('RX ');
    expect(amd).toHaveLength(4);
    expect(amd.reduce((a, b) => a + Math.abs(b), 0) / amd.length).toBeLessThan(0.07);
  });

  it('DGX Spark (b7941 결과 파일): MAE < 12%', () => {
    const spark = group('DGX Spark');
    expect(spark).toHaveLength(10);
    expect(spark.reduce((a, b) => a + Math.abs(b), 0) / spark.length).toBeLessThan(0.12);
  });

  it('Apple dense (#4167 새 빌드 — 10-15 D83): base/Pro/Max 6점 MAE < 7% · Ultra 3점 MAE < 5%', () => {
    const base = group('Apple dense');
    const ultra = group('Apple Ultra dense');
    expect(base).toHaveLength(6);
    expect(ultra).toHaveLength(3);
    expect(base.reduce((a, b) => a + Math.abs(b), 0) / base.length).toBeLessThan(0.07);
    expect(ultra.reduce((a, b) => a + Math.abs(b), 0) / ultra.length).toBeLessThan(0.05);
    // 가이드 mac-local-llm '얼마나 확실한가'의 "각 11% 안쪽" 문장을 고정한다
    expect(Math.max(...base.map(Math.abs))).toBeLessThan(0.11);
  });

  it('Strix Halo dense (Vulkan 지금 빌드 — 10-16 D90): 6점 MAE < 3% · 각 ±5%', () => {
    const strix = group('Strix Halo dense');
    expect(strix).toHaveLength(6);
    expect(strix.reduce((a, b) => a + Math.abs(b), 0) / strix.length).toBeLessThan(0.03);
    expect(Math.max(...strix.map(Math.abs))).toBeLessThan(0.05);
  });

  it('회귀 밖 참고: Strix Halo 의 ROCm·FA 끔 dense 5점은 추정이 높게(0~+14%) — 모두 ±20% 안', () => {
    for (const c of STRIX_SLOWER_DENSE_CASES) {
      const e = (tgEstimate(c.hw, c.mq, { mode: 'full-gpu' }, { ctx: c.ctx }) - c.measuredTg) / c.measuredTg;
      expect(e, c.label).toBeGreaterThanOrEqual(0);
      expect(e, c.label).toBeLessThanOrEqual(c.band);
    }
  });
});

describe('9) pp: Apple #4167 Llama 2 7B Q4_0 pp512 (10-16 D86·D87, docs/02 §3.5)', () => {
  // 표시 밴드 = 데이터 레이어 PP_BAND 0.4 (docs/02 §3.5 policy) — 엔진 테스트라 값으로 둔다
  const PP_BAND = 0.4;
  const errors = APPLE_PP_CASES.map(({ hw, measuredPp }) => (ppEstimate(hw, LLAMA2_7B_Q4_0)! - measuredPp) / measuredPp);
  const group = (g: (typeof APPLE_PP_CASES)[number]['group']) => errors.filter((_, i) => APPLE_PP_CASES[i]!.group === g);

  it.each(APPLE_PP_CASES.map((c, i) => [c.label, i] as const))('%s within ±40% rough band', (_label, i) => {
    expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(PP_BAND);
  });

  it('M5 계열(Neural Accelerator) 지금 빌드 5점: 각 ±12% · MAE < 10%', () => {
    const m5 = group('m5');
    expect(m5).toHaveLength(5);
    expect(Math.max(...m5.map(Math.abs))).toBeLessThan(0.12);
    expect(m5.reduce((a, b) => a + Math.abs(b), 0) / m5.length).toBeLessThan(0.1);
  });

  it('그 밖의 칩 새 빌드 2점(M2 Ultra·M4 Max 32코어): 각 ±5%', () => {
    const current = group('current');
    expect(current).toHaveLength(2);
    expect(Math.max(...current.map(Math.abs))).toBeLessThan(0.05);
  });
});

describe('10) MoE 토큰당 고정 시간 (§3.1, 10-16 D88·D90): 2026 llama.cpp 빌드 49점', () => {
  const cases = [...MOE_OVERHEAD_CASES, ...MOE_OVERHEAD_SPARK_B7941];
  const err = (c: (typeof cases)[number]) => (tgEstimate(c.hw, c.mq, { mode: 'full-gpu' }, { ctx: c.ctx }) - c.measuredTg) / c.measuredTg;
  const errors = cases.map(err);
  const mae = (xs: readonly number[]) => xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;

  it('has the 49 points the constants were fitted to', () => {
    expect(cases).toHaveLength(49);
    for (const c of cases) expect(c.source, c.label).toMatch(/^https:\/\//);
  });

  it.each(cases.map((c, i) => [c.label, i] as const))('%s within ±20% (MoE band)', (_label, i) => {
    expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(0.2);
  });

  it('MAE < 10% over all 49 (verified 8.9% on 45 → 8.3% with the 10-16 D90 Strix Halo points) and < 12% in every class', () => {
    expect(mae(errors)).toBeLessThan(0.1);
    for (const cls of ['apple', 'apple-ultra', 'dgx-spark', 'nvidia', 'amd', 'strix'] as const) {
      const xs = errors.filter((_, i) => cases[i]!.hw.effClass === cls);
      expect(xs.length, cls).toBeGreaterThanOrEqual(3);
      expect(mae(xs), cls).toBeLessThan(0.12);
    }
  });

  it('같은 모델의 Q4·Q8 비(바이트만 다른 쌍)를 옛 식보다 가깝게 낸다 — M5 Max·M2 Ultra Qwen3.5-35B-A3B, M2 Ultra Gemma 4 (D86 ①)', () => {
    const tg = (label: string) => {
      const c = cases.find((x) => x.label.startsWith(label))!;
      return { est: tgEstimate(c.hw, c.mq, { mode: 'full-gpu' }, { ctx: c.ctx }), meas: c.measuredTg };
    };
    for (const [q4, q8] of [
      ['Apple M5 Max 40c Qwen3.5-35B-A3B Q4_K_M', 'Apple M5 Max 40c Qwen3.5-35B-A3B Q8_0'],
      ['Apple M2 Ultra Qwen3.5-35B-A3B Q4_K_M', 'Apple M2 Ultra Qwen3.5-35B-A3B Q8_0'],
      ['Apple M2 Ultra Gemma 4 26B-A4B Q4_0', 'Apple M2 Ultra Gemma 4 26B-A4B Q8_0'],
    ] as const) {
      const a = tg(q4);
      const b = tg(q8);
      const measured = a.meas / b.meas; // 1.09 ~ 1.26
      const estimated = a.est / b.est;
      expect(Math.abs(estimated / measured - 1), q4).toBeLessThan(0.17);
    }
  });

  it('회귀 밖 참고: 2025-08 빌드(#15396) Apple 8점은 지금 식이 모두 높게 본다(+10~+40%, 빌드가 빨라졌다)', () => {
    for (const c of MOE_OLD_BUILD_CASES) {
      const e = err(c);
      expect(e, c.label).toBeGreaterThan(0.1);
      expect(e, c.label).toBeLessThan(0.4);
    }
  });
});

describe('11) pp 모델 크기 (§3.5, 10-16 D91): 2026 llama.cpp 빌드 다모델 91점', () => {
  // 표시 밴드 = 데이터 레이어 PP_BAND 0.4 (docs/02 §3.5 policy) — 엔진 테스트라 값으로 둔다
  const PP_BAND = 0.4;
  const err = (c: (typeof PP_SIZE_CASES)[number]) =>
    (ppEstimate(c.hw, c.mq, { ubatch: c.ubatch })! - c.measuredPp) / c.measuredPp;
  const errors = PP_SIZE_CASES.map(err);
  const mae = (xs: readonly number[]) => xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;
  const cls = (c: (typeof PP_SIZE_CASES)[number]) => (c.hw.neuralAccel ? 'neural-accel' : c.hw.effClass);

  it('has the 91 points the constants were fitted to (dense 61 · MoE 30), all with an https source', () => {
    expect(PP_SIZE_CASES).toHaveLength(91);
    expect(PP_SIZE_CASES.filter((c) => c.mq.activeParamsB !== undefined)).toHaveLength(30);
    for (const c of PP_SIZE_CASES) expect(c.source, c.label).toMatch(/^https:\/\//);
  });

  it.each(PP_SIZE_CASES.map((c, i) => [c.label, i] as const))('%s within ±40% rough band', (_label, i) => {
    expect(Math.abs(errors[i]!)).toBeLessThanOrEqual(PP_BAND);
  });

  it('MAE < 13% (verified 11.6%), ±30% 밖 2점 이하, 클래스마다 MAE < 15%', () => {
    expect(mae(errors)).toBeLessThan(0.13);
    expect(errors.filter((e) => Math.abs(e) > 0.3).length).toBeLessThanOrEqual(2);
    for (const k of ['nvidia', 'dgx-spark', 'apple-ultra', 'neural-accel', 'amd', 'strix'] as const) {
      const xs = errors.filter((_, i) => cls(PP_SIZE_CASES[i]!) === k);
      expect(xs.length, k).toBeGreaterThanOrEqual(4);
      expect(mae(xs), k).toBeLessThan(0.15);
    }
  });

  it('같은 기기·같은 빌드에서 큰 모델이 느린 비율을 따라간다 — 4090 8B → 70B · DGX Spark 3B → 70B (±25%)', () => {
    const pair = (a: string, b: string) => {
      const ca = PP_SIZE_CASES.find((c) => c.label.startsWith(a))!;
      const cb = PP_SIZE_CASES.find((c) => c.label.startsWith(b))!;
      const est = ppEstimate(ca.hw, ca.mq, { ubatch: ca.ubatch })! / ppEstimate(cb.hw, cb.mq, { ubatch: cb.ubatch })!;
      return est / (ca.measuredPp / cb.measuredPp) - 1;
    };
    expect(Math.abs(pair('RTX 4090 llama 8B Q4_0 pp512 (2026-05-25', 'RTX 4090 llama 70B Q4_K_M'))).toBeLessThan(0.25);
    expect(Math.abs(pair('DGX Spark llama 3B Q4_K_M', 'DGX Spark llama 70B Q4_K_M'))).toBeLessThan(0.25);
    expect(Math.abs(pair('RTX 3090 llama 1B Q4_0', 'RTX 3090 llama 8B Q4_0 pp512'))).toBeLessThan(0.25);
  });
});

describe('12) Gemma 4 E4B·E2B — 층별 임베딩 표·KV 공유 층 (10-21 D112, docs/02 §2.2·§2.4·§3.1·§7)', () => {
  it('stored KV: E4B 16 KiB/tok · E2B 6 KiB/tok (all-full-layer counting would be 28 · 14 KiB) — 8k f16 0.134 · 0.050 GB', () => {
    expect(GEMMA4_E4B_Q4.kvBytesPerToken).toBe(kvBytesPerToken({ layers: 4, kvHeads: 2, headDim: 512 }));
    expect(GEMMA4_E2B_Q4.kvBytesPerToken).toBe(kvBytesPerToken({ layers: 3, kvHeads: 1, headDim: 512 }));
    expect(kvGB(GEMMA4_E4B_Q4.kvBytesPerToken, 8192)).toBeCloseTo(0.134, 3);
    expect(kvGB(GEMMA4_E2B_Q4.kvBytesPerToken, 8192)).toBeCloseTo(0.05, 3);
  });

  it('weights: the per-layer embedding table stays in system RAM — GPU-resident 3.03 (E4B Q4_K_M) · 1.48 (E2B) GB, read per token = file − table', () => {
    expect(gpuResidentGBFor(GEMMA4_E4B_Q4)).toBeCloseTo(4.98 - 1.95, 6);
    expect(gpuResidentGBFor(GEMMA4_E2B_Q4)).toBeCloseTo(3.11 - 1.63, 6);
    expect(bytesPerTokenGB(GEMMA4_E4B_Q4, 512)).toBeCloseTo(4.98 - 1.94 + kvGB(16_384, 512), 6);
    // RTX 4060 8GB(Windows 화면 출력, 사용 가능 7.4GB): 3.03 + KV 0.134 + 버퍼 0.575 = 3.74GB → GPU 에 전량, 시스템 RAM 에 1.95GB
    const r = evaluate(RTX_4060_8GB, GEMMA4_E4B_Q4);
    expect(r.mode).toBe('full-gpu');
    expect(r.vram.weights).toBeCloseTo(3.03, 6);
    expect(r.vram.total - r.vram.osReserve).toBeCloseTo(3.03 + 0.134 + 0.575, 2);
    // Q8_0 도 4060 에 들어간다(5.18 + 0.134 + 0.575 = 5.89GB)
    expect(fit(RTX_4060_8GB, GEMMA4_E4B_Q8).mode).toBe('full-gpu');
  });

  it('system RAM must hold the off-GPU table in full-gpu: 6GB RAM (usable 2) holds 1.95GB, 5GB (usable 1) does not and nothing else fits', () => {
    expect(fit({ ...RTX_4060_8GB, ramGB: 6 }, GEMMA4_E4B_Q4)).toMatchObject({ fits: true, mode: 'full-gpu' });
    const small = fit({ ...RTX_4060_8GB, ramGB: 5 }, GEMMA4_E4B_Q4);
    expect(small.fits).toBe(false);
  });

  // 읽기 바이트(ubatch 1 pp 점은 마지막 토큰만 읽는 출력층을 뺀다) ÷ GPU 처리량 + 층별 임베딩 표 고정 시간(점의 백엔드)
  const readSeconds = (c: (typeof PLE_SPEED_CASES)[number]) => (bytesPerTokenGB(c.mq, c.ctx) - (c.skippedOutputGB ?? 0)) / gpuThroughputGBs(c.hw);
  const estimate = (c: (typeof PLE_SPEED_CASES)[number], overheadMs?: number) =>
    1 / (readSeconds(c) + (overheadMs === undefined ? pleOverheadSeconds(c.hw, c.mq, c.backend) : overheadMs * 1e-3));
  const errors = PLE_SPEED_CASES.map((c) => estimate(c) / c.measuredTg - 1);
  const fitted = (backend: 'cuda' | 'vulkan') =>
    PLE_SPEED_CASES.filter((c) => !c.reference && (c.backend ?? (PLE_CUDA_CLASSES.includes(c.hw.effClass) ? 'cuda' : 'vulkan')) === backend);

  it.each(PLE_SPEED_CASES.map((c, i) => [c.label, c, i] as const))('%s: error matches the recorded table (±0.5%p)', (_label, c, i) => {
    expect(errors[i]!).toBeCloseTo(c.recordedErr, 2);
  });

  it('tg points on the class default backend are exactly what the site shows (engine tgEstimate)', () => {
    const plain = PLE_SPEED_CASES.filter((c) => c.backend === undefined && c.skippedOutputGB === undefined);
    expect(plain).toHaveLength(4);
    for (const c of plain) expect(estimate(c), c.label).toBeCloseTo(tgEstimate(c.hw, c.mq, { mode: 'full-gpu' }, { ctx: c.ctx }), 9);
  });

  it('constants are the minimax of their points (0.05ms steps): CUDA 6 points within ±11.1%, Vulkan 2 points within ±2.5%', () => {
    for (const c of PLE_SPEED_CASES) expect(c.source, c.label).toMatch(/^https:\/\//);
    const cuda = fitted('cuda');
    const vulkan = fitted('vulkan');
    expect(cuda).toHaveLength(6);
    expect(vulkan).toHaveLength(2);
    const maxErr = (cs: typeof cuda, ms: number) => Math.max(...cs.map((c) => Math.abs(estimate(c, ms) / c.measuredTg - 1)));
    for (const [cs, ms, bound] of [[cuda, PLE_TOKEN_OVERHEAD_MS.cuda, 0.111], [vulkan, PLE_TOKEN_OVERHEAD_MS.vulkan, 0.025]] as const) {
      expect(maxErr(cs, ms)).toBeLessThanOrEqual(bound);
      expect(maxErr(cs, ms)).toBeLessThanOrEqual(maxErr(cs, ms - 0.05));
      expect(maxErr(cs, ms)).toBeLessThanOrEqual(maxErr(cs, ms + 0.05));
    }
  });

  it('without the fixed time every 3090/4090/5090 point is above +30% — why the constant exists (dense models on the same card leave 0.14~0.72ms)', () => {
    const fast = PLE_SPEED_CASES.filter((c) => /RTX (3090|4090|5090)/.test(c.label));
    expect(fast).toHaveLength(5);
    for (const c of fast) expect(estimate(c, 0) / c.measuredTg - 1, c.label).toBeGreaterThan(0.3);
  });

  it('reference points (not fitted): B580 SYCL on the class default within ±5%; A770 Vulkan stays far above (+78% — intel-arc class coefficient set on B580)', () => {
    const ref = (label: string) => errors[PLE_SPEED_CASES.findIndex((c) => c.label.startsWith(label))]!;
    expect(Math.abs(ref('Arc B580'))).toBeLessThanOrEqual(0.05);
    expect(ref('Arc A770')).toBeGreaterThan(0.3);
    // A770 을 빼면 모든 점이 ±12% 안
    for (const [i, c] of PLE_SPEED_CASES.entries()) if (!c.label.startsWith('Arc A770')) expect(Math.abs(errors[i]!), c.label).toBeLessThanOrEqual(0.12);
  });

  it('the fixed time applies only to rows with a table, on the GPU path — other dense models and the CPU path are unchanged', () => {
    expect(pleOverheadSeconds(RTX_4060_8GB, { pleGB: undefined })).toBe(0);
    expect(pleOverheadSeconds(RTX_4060_8GB, GEMMA4_E4B_Q4)).toBeCloseTo(PLE_TOKEN_OVERHEAD_MS.cuda * 1e-3, 12);
    const arc = PLE_SPEED_CASES.find((c) => c.label.startsWith('Arc A770'))!;
    expect(pleOverheadSeconds(arc.hw, GEMMA4_E4B_Q4)).toBeCloseTo(PLE_TOKEN_OVERHEAD_MS.vulkan * 1e-3, 12);
    const cpu = { ...RTX_4060_8GB, kind: 'cpu' as const, effClass: 'cpu' as const };
    const kv = kvGB(GEMMA4_E4B_Q4.kvBytesPerToken, 8192);
    expect(tgEstimate(cpu, GEMMA4_E4B_Q4, { mode: 'cpu-only' })).toBeCloseTo((0.5 * cpu.ramBandwidthGBs) / (4.98 - 1.94 + kv), 9);
  });
});

describe('13) 반복 층 — Nanbeige4.2-3B (10-22 D114, docs/02 §2.2·§3.1·§3.5·§7)', () => {
  // 대역폭·클래스 계수는 비에서 지워진다 — 아무 GPU(전량 탑재)로 두 모델의 추정을 나눈다
  const DECK: Hardware = { kind: 'unified', os: 'linux', memBandwidthGBs: 88, ramGB: 16, ramBandwidthGBs: 88, effClass: 'amd' };
  const tg = (mq: ModelQuant) => tgEstimate(DECK, mq, { mode: 'full-gpu' }, { ctx: LOOP_RATIO_CTX });
  const ratioErr = (mq: ModelQuant, c: (typeof LOOP_RATIO_CASES)[number]) =>
    tg(mq) / tg(LOOP_RATIO_REFERENCE) / (c.measured.loop / c.measured.reference) - 1;
  const noLoops: ModelQuant = { ...NANBEIGE42_Q4_OWAO, loops: undefined, loopGB: undefined };
  const wholeFile: ModelQuant = { ...NANBEIGE42_Q4_OWAO, loopGB: undefined };

  it('KV: 논리 층(물리 22 × loops 2) 마다 — 180,224 B/tok, 8k 1.48 · 32k 5.91GB (반복 없이 세면 90,112)', () => {
    expect(NANBEIGE42_Q4.kvBytesPerToken).toBe(kvBytesPerToken({ layers: 22 * 2, kvHeads: 8, headDim: 128 }));
    expect(kvGB(NANBEIGE42_Q4.kvBytesPerToken, 8192)).toBeCloseTo(1.476, 3);
    expect(kvGB(NANBEIGE42_Q4.kvBytesPerToken, 32768)).toBeCloseTo(5.906, 3);
  });

  it('읽기 바이트 = 파일 + (loops − 1) × 반복 블록 — 상주량(fit)은 가중치 한 벌 그대로', () => {
    expect(bytesPerTokenGB(NANBEIGE42_Q4, 8192)).toBeCloseTo(2.68 + 1.97 + kvGB(180_224, 8192), 9);
    expect(gpuResidentGBFor(NANBEIGE42_Q4)).toBeCloseTo(2.68 - 0.29, 9);
    const r = evaluate(RTX_4060_8GB, NANBEIGE42_Q4);
    expect(r.mode).toBe('full-gpu');
    expect(r.vram.weights).toBeCloseTo(2.39, 9);
  });

  it.each(LOOP_RATIO_CASES.map((c) => [c.label, c] as const))('%s: 추정 비/실측 비가 ±5% 안 — 기록한 오차표와 같다(±0.5%p)', (_label, c) => {
    expect(LOOP_RATIO_SOURCE).toMatch(/^https:\/\//);
    const err = ratioErr(NANBEIGE42_Q4_OWAO, c);
    expect(Math.abs(err)).toBeLessThanOrEqual(0.05);
    expect(err).toBeCloseTo(c.recordedErr.formula, 2);
    // 반복을 빼면(파일 한 번) +60% 넘게, 파일 전체를 loops 번 읽으면 −10% 넘게 벗어난다 — 반복 블록만 loops 번인 이유
    expect(ratioErr(noLoops, c)).toBeGreaterThan(0.6);
    expect(ratioErr(noLoops, c)).toBeCloseTo(c.recordedErr.noLoops, 2);
    expect(ratioErr(wholeFile, c)).toBeLessThan(-0.1);
    expect(ratioErr(wholeFile, c)).toBeCloseTo(c.recordedErr.wholeFile, 2);
  });

  it('pp: 실효 파라미터 × (1 + 반복 블록/파일) 이면 같은 기기 비가 rough ±40% 안 — 반복을 빼면 밖', () => {
    const hw = { effClass: 'amd' as const, fp16Tflops: 3.2 };
    const pp = (mq: ModelQuant) => ppEstimate(hw, mq)!;
    for (const c of LOOP_RATIO_CASES) {
      const measured = c.measuredPp.loop / c.measuredPp.reference;
      const err = pp(NANBEIGE42_Q4_OWAO) / pp(LOOP_RATIO_REFERENCE) / measured - 1;
      expect(Math.abs(err), c.label).toBeLessThanOrEqual(0.4);
      expect(pp(noLoops) / pp(LOOP_RATIO_REFERENCE) / measured - 1, c.label).toBeGreaterThan(0.4);
    }
  });
});

describe('14) DeepSeek V4 Flash — 압축 어텐션(CSA·HCA)·하이퍼 커넥션 (10-22 D115, docs/02 §2.2·§4 ⑩·§7·§9)', () => {
  const MIB = 2 ** 20;
  const log = DSV4_KV_LOG;
  const tg = (ctx: number) => tgEstimate(DSV4_M2_ULTRA, DSV4_FLASH_MXFP4, { mode: 'full-gpu' }, { ctx });

  it('KV per layer and cell matches the llama.cpp cache log: CSA 512 + indexer 128 K at 4 tokens a cell, HCA 512 at 128 — K only, 2B', () => {
    expect(log.source).toMatch(/^https:\/\//);
    expect((log.csa.mib * MIB) / (log.csa.cells * log.csa.layers)).toBeCloseTo(1024, 0);
    expect((log.indexer.mib * MIB) / (log.indexer.cells * log.indexer.layers)).toBeCloseTo(256, 0);
    expect((log.hca.mib * MIB) / (log.hca.cells * log.hca.layers)).toBeCloseTo(1024, 0);
    // 셀 수 = PAD(ceil(ctx / 비율), 256)
    expect(log.csa.cells).toBe(Math.ceil(Math.ceil(log.ctx / 4) / 256) * 256);
    expect(log.hca.cells).toBe(Math.ceil(Math.ceil(log.ctx / 128) / 256) * 256);
    // 토큰당 = 21 × (1024 + 256) / 4 + 20 × 1024 / 128
    expect(log.csa.layers * (1024 + 256) / 4 + log.hca.layers * 1024 / 128).toBe(DSV4_FLASH_MXFP4.kvBytesPerToken);
    expect(DSV4_FLASH_MXFP4.kvBytesPerToken).toBe(6880);
  });

  it('the engine KV at the log context is the three compressed caches within ±1% (padding), and the constant parts stay out', () => {
    const compressed = (log.csa.mib + log.indexer.mib + log.hca.mib) * MIB / 1e9;
    const engine = kvGB(DSV4_FLASH_MXFP4.kvBytesPerToken, log.ctx);
    expect(Math.abs(engine / compressed - 1)).toBeLessThan(0.01);
    // raw SWA = PAD(min(ctx, 창 + ubatch), 256) 셀 × 43층 × 1KB — 컨텍스트와 무관(로그 ub 4096 191.6MB, 기본 ub 512 면 768셀 33.8MB)
    expect(log.rawSwa.cells).toBe(Math.ceil((log.swaWindow + log.ubatch) / 256) * 256);
    expect((log.rawSwa.mib * MIB) / (log.rawSwa.cells * log.rawSwa.layers)).toBeCloseTo(1024, 0);
    const rawDefault = (Math.ceil((log.swaWindow + 512) / 256) * 256 * log.rawSwa.layers * 1024) / 1e9;
    const states = (log.states.reduce((a, b) => a + b, 0) * MIB) / 1e9;
    expect(rawDefault).toBeCloseTo(0.0338, 3);
    // 기본 ubatch 의 상수 몫(≈ 0.05GB)은 8k 연산 버퍼 근사(0.575GB)의 1/10 아래 — 따로 세지 않는다(docs/02 §9)
    expect(rawDefault + states).toBeLessThan(0.1 * computeBufferGB(8192));
    // 로그의 연산 버퍼(-ub 4096)는 엔진 근사의 두 배가 넘는다 — 한계로 적는다(docs/02 §9)
    expect((log.computeBufferMib[0] * MIB) / 1e9).toBeGreaterThan(2 * computeBufferGB(log.ctx));
  });

  it('the log ran one request slot (-np 1: "1/1 seqs", streams = 1, n_slots = 1) — the per-token KV holds per slot, so the commands add -np 1 (the server default is 4)', () => {
    // DSV4 캐시는 통합 KV 모드여도 시퀀스마다 따로 잡힌다 — 기본 4슬롯이면 압축 KV·raw SWA·상태가 모두 4배(엔진은 요청 하나로 센다, docs/02 §2.2)
    expect(log.seqs).toBe(1);
    expect(log.stateStreams).toBe(1);
    expect(log.slots).toBe(1);
    expect(log.serverDefaultSlots).toBe(4);
    const compressed = ((log.csa.mib + log.indexer.mib + log.hca.mib) * MIB) / 1e9 / log.seqs;
    expect(Math.abs(kvGB(DSV4_FLASH_MXFP4.kvBytesPerToken, log.ctx) / compressed - 1)).toBeLessThan(0.01);
  });

  it('weights: experts in RAM / GPU split is the header measurement; nothing else changes (no engine formula for mHC)', () => {
    expect(gpuResidentGBFor(DSV4_FLASH_MXFP4)).toBeCloseTo(154.42, 9);
    expect(gpuResidentGBFor(DSV4_FLASH_Q2K)).toBeCloseTo(116.79, 9);
    // 통합 메모리 192GB(사용 가능 134.4)에는 MXFP4 가 안 들어가 CPU 경로, Q2_K 는 들어간다
    expect(fit(DSV4_M2_ULTRA, DSV4_FLASH_MXFP4).mode).toBe('cpu-only');
    expect(fit(DSV4_M2_ULTRA, DSV4_FLASH_Q2K).mode).toBe('full-gpu');
  });

  it('reference (not fitted): M2 Ultra #28948 tg32 is +25% under the estimate — inside the theoretical band (measured ≥ est × 0.7), recorded error ±1%p', () => {
    const c = DSV4_REFERENCE.current;
    expect(c.source).toMatch(/^https:\/\//);
    const err = tg(c.ctx) / c.measuredTg - 1;
    expect(err).toBeCloseTo(c.recordedErr, 2);
    expect(c.measuredTg).toBeGreaterThanOrEqual(tg(c.ctx) * 0.7);
    expect(c.masterTg).toBeGreaterThanOrEqual(tg(c.ctx) * 0.7);
    // pp2048(-ub 2048 가정)은 rough ±40% 안
    const pp = ppEstimate({ effClass: 'apple-ultra', fp16Tflops: 27.2 }, DSV4_FLASH_MXFP4, { ubatch: c.ubatch })!;
    expect(Math.abs(pp / c.measuredPp - 1)).toBeLessThan(0.4);
  });

  it('reference: the 08-03 branch build is +33% at depth 0, and llama.cpp slows −19% by 30k where the engine slows −1.6% (indexer work grows with context)', () => {
    const o = DSV4_REFERENCE.oldBuild;
    const [d0, , , d30] = o.depths;
    expect(tg(d0!.ctx) / d0!.measuredTg - 1).toBeCloseTo(o.recordedErr, 2);
    const measuredDecay = d30!.measuredTg / d0!.measuredTg - 1;
    const engineDecay = tg(d30!.ctx) / tg(d0!.ctx) - 1;
    expect(measuredDecay).toBeCloseTo(-0.19, 2);
    expect(engineDecay).toBeCloseTo(-0.016, 3);
    // 30k 에서 옛 빌드 실측이 표시 범위(추정 × 0.7) 밑 — 긴 문맥 셀이 낙관적이라는 한계(docs/02 §9)
    expect(d30!.measuredTg).toBeLessThan(tg(d30!.ctx) * 0.7);
    const pp = ppEstimate({ effClass: 'apple-ultra', fp16Tflops: 27.2 }, DSV4_FLASH_MXFP4, { ubatch: o.ubatch })!;
    expect(Math.abs(pp / o.measuredPp - 1)).toBeLessThan(0.4);
  });

  it('limit outside the engine: pp drops to about a quarter by 30k (indexer and compressor work), while the engine pp does not depend on depth — the 30k point is far below the rough band', () => {
    const o = DSV4_REFERENCE.oldBuild;
    const pp0 = o.ppDepths[0]!;
    const pp30 = o.ppDepths[3]!;
    expect(pp0.measuredPp).toBe(o.measuredPp);
    expect(pp30.depth).toBe(30000);
    expect(pp30.measuredPp / pp0.measuredPp).toBeLessThan(0.3);
    expect(pp30.measuredPp / pp0.measuredPp).toBeCloseTo(0.26, 2);
    // 깊이마다 계속 떨어진다(10k 0.52 · 20k 0.35 · 30k 0.26)
    for (let i = 1; i < o.ppDepths.length; i++) expect(o.ppDepths[i]!.measuredPp).toBeLessThan(o.ppDepths[i - 1]!.measuredPp);
    const pp = ppEstimate({ effClass: 'apple-ultra', fp16Tflops: 27.2 }, DSV4_FLASH_MXFP4, { ubatch: o.ubatch })!;
    expect(pp30.measuredPp).toBeLessThan(pp * 0.6);
  });
});

describe('15) GLM-5.3-Flash — KDA + DSA(희소 MLA·인덱서)·하이퍼 커넥션 (10-22 엔진 후속 ⑧-b, docs/02 §2.2·§4 ⑩·§7·§9)', () => {
  const MIB = 2 ** 20;
  const log = GLM53_KV_LOG;
  const tgAt = (hw: Hardware, mq: ModelQuant, ctx: number) => tgEstimate(hw, mq, { mode: 'full-gpu' }, { ctx });

  it('KV per layer and cell matches the llama.cpp memory log: MLA latent 512 × 2B, indexer 128 × 3 (key | gate | pooled) × 2B, no V — 19,712 B/tok', () => {
    expect(log.source).toMatch(/^https:\/\//);
    expect((log.mla.mib * MIB) / (log.mla.cells * log.mla.layers)).toBe(1024);
    expect((log.indexer.mib * MIB) / (log.indexer.cells * log.indexer.layers)).toBe(768);
    expect(log.mla.layers * (1024 + 768)).toBe(GLM53_Q4K.kvBytesPerToken);
    // 엔진 KV(요청 하나) = 로그의 두 캐시 합 — 셀 패딩 1 이라 정확히 같다
    expect(kvGB(GLM53_Q4K.kvBytesPerToken, log.ctx)).toBeCloseTo(((log.mla.mib + log.indexer.mib) * MIB) / 1e9, 9);
    expect(log.seqs).toBe(1);
  });

  it('the KDA recurrent state is ≈ 153MB per sequence (outside the engine, one copy per slot like every constant-state hybrid — D63): within the compute-buffer approximation for one slot, over it for the server default 4', () => {
    const { heads, headDim, convKernel } = log.kda;
    const perLayer = (headDim * headDim * heads + 3 * (convKernel - 1) * heads * headDim) * 4;
    const perSeq = perLayer * log.recurrent.kdaLayers;
    // 로그: 1 시퀀스 × (1 + rs_seq 3) = 4 벌 — S·R 각각 맞는다
    expect((log.recurrent.sMib * MIB) / log.recurrent.copies).toBe(headDim * headDim * heads * 4 * log.recurrent.kdaLayers);
    expect((log.recurrent.rMib * MIB) / log.recurrent.copies).toBe(3 * (convKernel - 1) * heads * headDim * 4 * log.recurrent.kdaLayers);
    expect(((log.recurrent.mib * MIB) / log.recurrent.copies)).toBe(perSeq);
    expect(perSeq / 1e9).toBeCloseTo(0.1526, 4);
    expect(perSeq / 1e9).toBeLessThan(computeBufferGB(8192));
    expect((perSeq * log.serverDefaultSlots) / 1e9).toBeGreaterThan(computeBufferGB(8192));
  });

  it('weights: GPU split is the header measurement; 512GB Macs hold Q4_K_M on the GPU, 256GB do not (181.37 > 179.2), M2 Ultra 192GB is just short for Q2_K', () => {
    expect(gpuResidentGBFor(GLM53_Q4K)).toBeCloseTo(180.69, 9);
    expect(gpuResidentGBFor(GLM53_Q2K)).toBeCloseTo(133.12, 9);
    // M3 Ultra(819 GB/s) — M2 Ultra 픽스처의 메모리만 바꾼다
    const m3 = (ramGB: number): Hardware => ({ ...GLM53_M2_ULTRA, ramGB, memBandwidthGBs: 819, ramBandwidthGBs: 819 });
    expect(fit(m3(512), GLM53_Q4K).mode).toBe('full-gpu');
    expect(fit(m3(256), GLM53_Q4K).mode).toBe('cpu-only');
    expect(fit(m3(256), GLM53_Q2K).mode).toBe('full-gpu');
    expect(fit(GLM53_M2_ULTRA, GLM53_Q2K).mode).toBe('cpu-only');
  });

  it('reference (not fitted): every public current-build point is under the estimate and inside the theoretical band (measured ≥ est × 0.7) — M2 Ultra +24%, DGX Spark +8–12%, 6 × 3090 +24–26%', () => {
    const refs = [
      [GLM53_REFERENCE.m2Ultra, GLM53_M2_ULTRA, GLM53_Q2K],
      [GLM53_REFERENCE.spark, GLM53_SPARK, GLM53_UD_IQ2XXS],
      [GLM53_REFERENCE.rtx3090x6, GLM53_3090X6, GLM53_AVAR6_Q2Q3],
    ] as const;
    for (const [ref, hw, mq] of refs) {
      expect(ref.source).toMatch(/^https:\/\//);
      ref.points.forEach((p, i) => {
        const est = tgAt(hw, mq, p.ctx);
        expect(est / p.measuredTg - 1, `${ref.label} ctx ${p.ctx}`).toBeCloseTo(ref.recordedErr[i]!, 2);
        expect(p.measuredTg, `${ref.label} ctx ${p.ctx}`).toBeGreaterThanOrEqual(est * 0.7);
        expect(p.measuredTg, `${ref.label} ctx ${p.ctx}`).toBeLessThan(est);
      });
    }
    // 가장 작은 과대 = 데이터 계층 판정 할인 값(assess VERDICT_OVERESTIMATE 'glm-5.3-flash' 0.082 — 10-22 ⑧-b 리뷰). 엔진 패키지는 데이터 계층을 읽지 않으므로 값으로 고정
    expect(Math.min(...refs.flatMap(([ref]) => [...ref.recordedErr]))).toBe(0.082);
    // pp2048(-ub 2048) 는 rough ±40% 안
    const s = GLM53_REFERENCE.spark;
    const pp = ppEstimate({ effClass: 'dgx-spark', fp16Tflops: s.fp16Tflops }, GLM53_UD_IQ2XXS, { ubatch: s.ubatch })!;
    expect(Math.abs(pp / s.measuredPp - 1)).toBeLessThan(0.4);
  });

  it('context decay is not under-estimated (unlike DeepSeek V4): the k-pool indexer keeps llama.cpp within a few points of the engine at 16k–64k', () => {
    const s = GLM53_REFERENCE.spark;
    const measured = s.points[2]!.measuredTg / s.points[0]!.measuredTg - 1;
    const engine = tgAt(GLM53_SPARK, GLM53_UD_IQ2XXS, s.points[2]!.ctx) / tgAt(GLM53_SPARK, GLM53_UD_IQ2XXS, s.points[0]!.ctx) - 1;
    expect(measured).toBeCloseTo(-0.098, 2);
    expect(Math.abs(engine - measured)).toBeLessThan(0.05);
    const g = GLM53_REFERENCE.rtx3090x6;
    const m6 = g.points[2]!.measuredTg / g.points[0]!.measuredTg - 1;
    const e6 = tgAt(GLM53_3090X6, GLM53_AVAR6_Q2Q3, g.points[2]!.ctx) / tgAt(GLM53_3090X6, GLM53_AVAR6_Q2Q3, g.points[0]!.ctx) - 1;
    expect(Math.abs(e6 - m6)).toBeLessThan(0.02);
  });
});

describe('16) DGX Spark usable memory (10-23 D117, docs/02 §2.3·§7): 1대 공개 실측 4점', () => {
  it('every public single-unit run fits (and the one that did not, does not) under the device value — the old 70% rule misses three', () => {
    const old: Hardware = { ...SPARK_128_USABLE, unifiedUsableGB: undefined };
    let oldMisses = 0;
    for (const c of SPARK_FIT_CASES) {
      expect(c.source, c.label).toMatch(/^https:\/\//);
      const r = fit(SPARK_128_USABLE, c.mq, { ctx: c.ctx });
      expect(r.fits && r.mode === 'full-gpu', c.label).toBe(c.fits);
      if (c.fits && fit(old, c.mq, { ctx: c.ctx }).mode !== 'full-gpu') oldMisses += 1;
    }
    expect(oldMisses).toBe(3);
  });

  it('the device value bounds both paths; without it a unified machine keeps ram × 0.70 and ram − 4', () => {
    expect(usableGB(SPARK_128_USABLE)).toBe(SPARK_USABLE_128_GB);
    expect(usableRamGB(SPARK_128_USABLE)).toBe(SPARK_USABLE_128_GB);
    const old: Hardware = { ...SPARK_128_USABLE, unifiedUsableGB: undefined };
    expect(usableGB(old)).toBeCloseTo(89.6, 9);
    expect(usableRamGB(old)).toBe(124);
    // 1대 상한(UD-IQ3_S 116.1GB)이 들어가는 여유 — 컨텍스트 2k 에서 0.3GB 남짓
    const edge = SPARK_FIT_CASES[2]!;
    expect(SPARK_USABLE_128_GB - fit(SPARK_128_USABLE, edge.mq, { ctx: edge.ctx }).vram.total).toBeCloseTo(0.265, 2);
  });
});

describe('17) DGX Spark cluster — llama.cpp RPC layer split (10-23 D118, docs/02 §6.2·§7): 2대 공개 쌍 14점', () => {
  const extraMs = (single: number, cluster: number) => (1 / cluster - 1 / single) * 1000;
  const predict = (single: number, hops: number) => 1 / (1 / single + hops * RPC_HOP_TG_MS * 1e-3);

  it('back-calculates the per-token time each pair adds (1/two units − 1/one unit) and keeps the recorded values; the hop-time range uses same-condition pairs only', () => {
    for (const p of CLUSTER_RPC_PAIRS) {
      expect(p.source, p.label).toMatch(/^https:\/\//);
      expect(extraMs(p.single, p.cluster), p.label).toBeCloseTo(p.recordedMs, 2);
    }
    const range = (setup: string) => {
      const ms = CLUSTER_RPC_PAIRS.filter((p) => p.setup === setup && !p.mixed).map((p) => extraMs(p.single, p.cluster));
      return [Math.min(...ms), Math.max(...ms)];
    };
    expect(range('tcp')[0]).toBeCloseTo(0, 6); // Devstral 2.64 → 2.64 (표시 자릿수 ±1.4ms)
    expect(range('tcp')[1]).toBeCloseTo(7.947, 2); // TCP 기본 깊이 32k
    expect(range('rdma')).toEqual([expect.closeTo(1.035, 2), expect.closeTo(1.395, 2)]);
    // 2대만 유휴 상태를 끈 5점은 1대가 기본 설정 실행이라(유휴 상태를 끈 1대 실측 없음 — #15139580) 이동 시간 근거에서 뺀다(D118 리뷰)
    const mixed = CLUSTER_RPC_PAIRS.filter((p) => p.mixed);
    expect(mixed.map((p) => p.setup)).toEqual(Array(5).fill('tcp-idle-off'));
    expect(CLUSTER_RPC_PAIRS.filter((p) => p.setup === 'tcp-idle-off' && !p.mixed)).toEqual([]);
    for (const p of mixed) {
      const base = CLUSTER_RPC_PAIRS.find((x) => x.setup === 'tcp' && !x.mixed && x.depth === p.depth && x.source === CLUSTER_RPC_PAIRS[0]!.source)!;
      expect(p.single, `${p.label} — the one-unit value is the default-settings run`).toBe(base.single);
    }
  });

  it('the constant is the TCP-default value at the verdict depth (8,192) rounded up, so every TCP-default point to 8k is predicted at or below the measurement', () => {
    const at8k = CLUSTER_RPC_PAIRS.find((p) => p.setup === 'tcp' && p.depth === 8192)!;
    expect(RPC_HOP_TG_MS).toBe(Math.ceil(extraMs(at8k.single, at8k.cluster) * 10) / 10);
    for (const p of CLUSTER_RPC_PAIRS.filter((x) => x.setup === 'tcp' && x.depth <= 8192)) {
      expect(predict(p.single, 1) / p.cluster - 1, p.label).toBeLessThanOrEqual(0);
    }
  });

  it('predicts every two-unit result within ±17% from its one-unit result; the only over-estimates beyond +6% are TCP-default 32k (+10.3%)', () => {
    const errs = CLUSTER_RPC_PAIRS.map((p) => ({ p, e: predict(p.single, 1) / p.cluster - 1 }));
    for (const { p, e } of errs) expect(Math.abs(e), p.label).toBeLessThan(0.17);
    expect(Math.max(...errs.map((x) => Math.abs(x.e)))).toBeCloseTo(0.164, 3); // idle states off, depth 0
    const over = errs.filter((x) => x.e > 0.06);
    expect(over.map((x) => x.p.label)).toEqual(['gpt-oss-120b MXFP4 tg32 d32768 (b7157 TCP)']);
    expect(over[0]!.e).toBeCloseTo(0.103, 3);
    // RDMA·유휴 상태 끔 점(깊이 8k 이하)은 실측이 더 빠르다 — 이 설정이면 표시보다 빠를 수 있다(docs/02 §6.2)
    for (const { p, e } of errs.filter((x) => x.p.setup !== 'tcp' && x.p.depth <= 8192)) expect(e, p.label).toBeLessThan(0);
  });

  it('end to end: gpt-oss-120b on two 128GB units at 8k lands within ±10% of the 2-unit run at depth 8,192 (theoretical label, ±30%)', () => {
    const r = evaluate(SPARK_128_X2, { ...GPT_OSS_120B, layers: 36 }, { ctx: 8192, theoretical: true });
    expect(r.mode).toBe('full-gpu');
    expect(r.confidence).toBe('theoretical');
    const one = evaluate(SPARK_128_USABLE, GPT_OSS_120B, { ctx: 8192 }).tgTokS.est;
    expect(r.tgTokS.est).toBeCloseTo(predict(one, 1), 9);
    const measured = CLUSTER_RPC_PAIRS.find((p) => p.setup === 'tcp' && p.depth === 8192)!.cluster;
    expect(Math.abs(r.tgTokS.est / measured - 1)).toBeLessThan(0.1);
    expect(measured).toBeGreaterThanOrEqual(r.tgTokS.low);
  });

  it('models that ran only on two units do not fit one unit and fit two (busiest unit: ceil((layers + 1) / 2) / layers of the weights and KV + its own buffer)', () => {
    for (const c of CLUSTER_FIT_CASES) {
      expect(c.source, c.label).toMatch(/^https:\/\//);
      expect(fit(SPARK_128_USABLE, c.mq, { ctx: c.ctx }).fits, `${c.label} on one unit`).toBe(false);
      const two = fit(SPARK_128_X2, c.mq, { ctx: c.ctx });
      expect(two.fits && two.mode === 'full-gpu', `${c.label} on two units`).toBe(true);
      const share = clusterShareOf(c.mq, 2);
      expect(share).toBeCloseTo(Math.ceil((c.mq.layers! + 1) / 2) / c.mq.layers!, 12);
      expect(two.vram.total).toBeCloseTo(c.mq.fileGB! * share + kvGB(c.mq.kvBytesPerToken, c.ctx) * share + computeBufferGB(c.ctx), 9);
      expect(two.vram.total).toBeLessThan(SPARK_USABLE_128_GB);
    }
  });

  it('busiest unit vs the llama.cpp split simulated from GGUF headers (D118 review): at or above it with equal free memory and with the first unit 0.1% smaller, the per-layer quant mix gap pinned', () => {
    for (const c of CLUSTER_SPLIT_SIM) {
      expect(c.source, c.label).toMatch(/^https:\/\//);
      [2, 3, 4].forEach((nodes, i) => {
        const got = clusterNodeLoadGB({ ...SPARK_128_USABLE, nodes }, c.mq, c.mq.fileGB!, 0).weights;
        expect(got, `${c.label} × ${nodes}`).toBeCloseTo(c.engineGB[i]!, 2);
        // 전문가 층 위치를 쓰지 않고 층마다 같다고 본 값 — 앞쪽 dense 가 없는 모델은 그대로
        const uniform = clusterNodeLoadGB({ ...SPARK_128_USABLE, nodes }, { ...c.mq, moeLayerIdx: undefined }, c.mq.fileGB!, 0).weights;
        expect(uniform, `${c.label} × ${nodes} layer-uniform`).toBeCloseTo(c.layerUniformGB[i]!, 2);
        // 남은 메모리가 같을 때와 첫 기기가 0.1% 작을 때(원격 한 대가 한 칸 더 — D118 리뷰 2차) 가운데 큰 쪽
        const split = Math.max(c.busiestGB[i]!, c.busiestFirstSmallerGB[i]!);
        if (c.knownUnder === undefined) {
          expect(got - split, `${c.label} × ${nodes} at or above the split`).toBeGreaterThanOrEqual(0);
          expect(got - split).toBeLessThan(1.3);
        } else {
          // 알려진 한계 — 층마다 양자화가 다른 파일은 층마다 같다고 보는 근사가 작게 본다(docs/02 §6.2·§9)
          expect(split - got).toBeGreaterThan(0);
          expect(split - got).toBeLessThan(2.1);
        }
      });
    }
    // 0.14.0(층마다 같다고 본 첫 기기 몫 — 93.033·48.864GB)은 2·4대가 실제 분할보다 작았다(GLM-5.3-Flash Q4_K_M −2.12·−2.30GB)
    const glm = CLUSTER_SPLIT_SIM[0]!;
    expect(glm.busiestGB[0] - 93.033).toBeCloseTo(2.12, 2);
    expect(glm.busiestGB[2] - 48.864).toBeCloseTo(2.3, 2);
    // 그 차이로 '들어간다'가 되던 칸(64GB × 4대 · 1M · KV q4_0 — 헤더 분할로는 가장 많이 맡는 대 49.28GB)은 이제 '안 들어간다'
    const ctx = 1048576;
    const sim = 37.573 + (kvGB(GLM53_Q2K_CLUSTER.kvBytesPerToken, ctx, 'q4_0') * 3) / 11 + computeBufferGB(ctx);
    expect(sim).toBeCloseTo(49.28, 2);
    expect(sim).toBeGreaterThan(usableGB(SPARK_64_USABLE));
    const x4 = fit({ ...SPARK_64_USABLE, nodes: 4 }, GLM53_Q2K_CLUSTER, { ctx, kvQuant: 'q4_0' });
    expect(x4.fits).toBe(false);
    const need = clusterNodeLoadGB({ ...SPARK_64_USABLE, nodes: 4 }, GLM53_Q2K_CLUSTER, GLM53_Q2K_CLUSTER.fileGB!, kvGB(GLM53_Q2K_CLUSTER.kvBytesPerToken, ctx, 'q4_0'));
    expect(need.weights + need.kv + computeBufferGB(ctx)).toBeCloseTo(50.215, 2);
    expect(
      clusterNodeLoadGB({ ...SPARK_64_USABLE, nodes: 4 }, { ...GLM53_Q2K_CLUSTER, moeLayerIdx: undefined }, GLM53_Q2K_CLUSTER.fileGB!, kvGB(GLM53_Q2K_CLUSTER.kvBytesPerToken, ctx, 'q4_0'))
        .weights,
    ).toBeCloseTo(36.189, 2);
  });

  it('first unit with slightly less free memory (D118 review 2): a remote unit takes one cell more when (layers + 1) divides by N — DeepSeek V4 Flash 64GB × 4 · 524,288 no longer fits', () => {
    // 44칸 · 4대: 같으면 11·11·11·11, 첫 기기가 0.1% 작으면 12·11·11·10 — 첫 RPC 장치가 트렁크 12층(KV 도 12/43)
    const dsv4 = CLUSTER_SPLIT_SIM.find((c) => c.mq === DSV4_FLASH_MXFP4_CLUSTER)!;
    const ctx = 524288;
    const hw = { ...SPARK_64_USABLE, nodes: 4 };
    for (const [kvQuant, split, v0141] of [['f16', 49.231, 46.296], ['q8_0', 48.763, 45.866], ['q4_0', 48.511, 45.636]] as const) {
      const kv = kvGB(DSV4_FLASH_MXFP4_CLUSTER.kvBytesPerToken, ctx, kvQuant);
      const sim = dsv4.busiestFirstSmallerGB[2] + (kv * 12) / 43 + computeBufferGB(ctx);
      expect(sim, kvQuant).toBeCloseTo(split, 2);
      expect(sim).toBeGreaterThan(usableGB(SPARK_64_USABLE));
      // 0.14.1(첫 기기 몫만 — 11칸 + 장치 밖 몫)은 '들어간다'로 봤다
      const first = (gpuResidentGBFor(DSV4_FLASH_MXFP4_CLUSTER) * 11) / 43 + (DSV4_FLASH_MXFP4_CLUSTER.fileGB! - gpuResidentGBFor(DSV4_FLASH_MXFP4_CLUSTER)) + (kv * 11) / 43 + computeBufferGB(ctx);
      expect(first).toBeCloseTo(v0141, 2);
      expect(first).toBeLessThanOrEqual(usableGB(SPARK_64_USABLE));
      const r = fit(hw, DSV4_FLASH_MXFP4_CLUSTER, { ctx, kvQuant });
      expect(r.fits, kvQuant).toBe(false);
      const need = clusterNodeLoadGB(hw, DSV4_FLASH_MXFP4_CLUSTER, DSV4_FLASH_MXFP4_CLUSTER.fileGB!, kv);
      expect(need.weights + need.kv + computeBufferGB(ctx)).toBeGreaterThanOrEqual(sim);
    }
    // 칸 수가 나누어떨어지지 않는 3대(44 / 3)는 원격 한 대가 더 받지 않는다 — 첫 기기 몫(올림 15칸 + 장치 밖 몫) 그대로
    expect(dsv4.busiestFirstSmallerGB[1]).toBe(dsv4.busiestGB[1]);
    expect(clusterNodeLoadGB({ ...SPARK_128_USABLE, nodes: 3 }, DSV4_FLASH_MXFP4_CLUSTER, DSV4_FLASH_MXFP4_CLUSTER.fileGB!, 0).weights).toBeCloseTo(
      (gpuResidentGBFor(DSV4_FLASH_MXFP4_CLUSTER) * clusterShareOf(DSV4_FLASH_MXFP4_CLUSTER, 3)) + (DSV4_FLASH_MXFP4_CLUSTER.fileGB! - gpuResidentGBFor(DSV4_FLASH_MXFP4_CLUSTER)),
      9,
    );
  });
});
