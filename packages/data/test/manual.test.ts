/**
 * 계산기 "모델 값 직접 입력" (D66) — 입력 → 엔진 입력 레코드. 쌍둥이(카탈로그 모델의 config 값을 그대로 넣은 입력)는
 * KV·비전문가 크기가 카탈로그 기록과 같아야 하고, 양자화 행은 bpw 어림(실제 파일과 몇 % 차이)이다.
 */
import { describe, expect, it } from 'vitest';
import {
  buildManualModel,
  deriveNonExpertGB,
  MANUAL_LIMITS,
  MANUAL_MODEL_ID,
  MANUAL_UNKNOWN_MAX_CONTEXT,
  manualIssues,
  manualRangeIssue,
  type ManualBuild,
  type ManualSpec,
} from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();
const catalogModel = (id: string) => seed.models.find((m) => m.id === id)!;

const LLAMA_8B: ManualSpec = { paramsB: 8.03, layers: 32, kvHeads: 8, headDim: 128, maxContext: 131072 };
const QWEN3_30B_A3B: ManualSpec = { paramsB: 30.5, activeParamsB: 3.3, experts: 128, topK: 8, layers: 48, kvHeads: 4, headDim: 128 };

function ok(build: ManualBuild): Extract<ManualBuild, { kind: 'ok' }> {
  if (build.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(build)}`);
  return build;
}

describe('buildManualModel — catalog twins', () => {
  it('Llama 3.1 8B numbers: KV equals the catalog record, four bpw rows, dense, unknown license', () => {
    const { model, rows } = ok(buildManualModel(LLAMA_8B));
    expect(model.id).toBe(MANUAL_MODEL_ID);
    expect(model.arch.kvBytesPerTokenF16).toBe(catalogModel('llama-3.1-8b').arch.kvBytesPerTokenF16);
    expect(model.arch.kvBytesPerTokenF16).toBe(131072);
    expect(model.arch.attnType).toBe('full');
    expect(rows.map((r) => [r.quant, r.fileGB])).toEqual([
      ['Q2_K', 3.17],
      ['IQ4_XS', 4.48],
      ['Q4_K_M', 4.91],
      ['Q8_0', 8.53],
    ]);
    expect(rows.every((r) => r.modelId === MANUAL_MODEL_ID && r.fileName === undefined)).toBe(true);
    expect(model).toMatchObject({ moe: false, license: 'unknown', maxContext: 131072, korean: false, category: ['chat'] });
    expect(model.thinking).toBeUndefined();
    expect(model.nonExpertGB).toBeUndefined();
    expect(model.activeParamsB).toBeUndefined();
  });

  it('Qwen3-30B-A3B numbers: nonExpertGB equals the catalog record, experts/topK carried', () => {
    const { model } = ok(buildManualModel(QWEN3_30B_A3B));
    const twin = catalogModel('qwen3-30b-a3b-2507');
    expect(model.moe).toBe(true);
    expect(model.nonExpertGB).toBe(twin.nonExpertGB);
    expect(model.nonExpertGB).toBe(0.91);
    expect(model.activeParamsB).toBe(3.3);
    expect(model.arch).toMatchObject({ experts: 128, topK: 8, kvBytesPerTokenF16: twin.arch.kvBytesPerTokenF16 });
  });

  it('Gemma 3 12B with 8 full-attention layers out of 48: KV equals the catalog record (sliding layers left out)', () => {
    const { model } = ok(buildManualModel({ paramsB: 12.2, layers: 48, kvHeads: 8, headDim: 256, fullAttnLayers: 8 }));
    expect(model.arch.kvBytesPerTokenF16).toBe(catalogModel('gemma-3-12b').arch.kvBytesPerTokenF16);
    expect(model.arch.kvBytesPerTokenF16).toBe(65536);
    expect(model.arch.attnType).toBe('hybrid');
  });

  it('Gemma 4 26B-A4B with the global KV heads and head dimension on 5 full-attention layers out of 30: KV equals the catalog record', () => {
    // 화면 안내(리뷰 반영): config.json 에 num_global_key_value_heads·global_head_dim 이 있으면 그 값을 넣는다 — 슬라이딩 층 값(8·256)이면 2배 과대
    const { model } = ok(
      buildManualModel({ paramsB: 26.54, activeParamsB: 4, experts: 128, topK: 8, layers: 30, kvHeads: 2, headDim: 512, fullAttnLayers: 5 }),
    );
    expect(model.arch.kvBytesPerTokenF16).toBe(catalogModel('gemma-4-26b-a4b').arch.kvBytesPerTokenF16);
    expect(model.arch.kvBytesPerTokenF16).toBe(20480);
  });

  it('no max context → a value above the whole context ladder (no clamping); thinking → default-on', () => {
    const { model } = ok(buildManualModel({ ...LLAMA_8B, maxContext: undefined, thinking: true }));
    expect(model.maxContext).toBe(MANUAL_UNKNOWN_MAX_CONTEXT);
    expect(model.maxContext).toBeGreaterThan(262144);
    expect(model.thinking).toBe('default-on');
  });

  it('the bpw estimate stays close to the real catalog files: dense within ±10%, MoE within ±13% (documented in D66)', () => {
    const worst = { dense: 0, moe: 0, largeOutput: 0 };
    // 출력층(output.weight)을 모든 양자화에서 Q6_K 로 둔 큰 어휘 모델 — Nanbeige4.2 3B 는 166,144 × 3072 = 0.51B(파라미터의 12%)라
    // Q2_K 파일이 어림보다 11% 크다(10-22 D114 — 헤더 실측: 출력층 0.42GB 가 Q4_K_M·IQ4_XS·Q2_K 모두 같다). 따로 ±12% 로 고정한다
    const largeOutput = new Set(['nanbeige4.2-3b']);
    for (const m of seed.models) {
      // 전문가 FFN 폭이 256 배수가 아니라 K-quant 가 더 큰 형식으로 대체된 모델 — 실제 파일이 어림보다 최대 34% 크다 (D63 §5, D66 §5)
      if (m.id === 'nemotron-3.5-lightning-30b-a3b') continue;
      const built = ok(buildManualModel({ paramsB: m.paramsB, layers: 32, kvHeads: 8, headDim: 128 }));
      for (const row of built.rows) {
        const real = seed.modelQuants.find((r) => r.modelId === m.id && r.quant === row.quant);
        if (!real) continue;
        const err = Math.abs(row.fileGB - real.fileGB) / real.fileGB;
        if (largeOutput.has(m.id)) worst.largeOutput = Math.max(worst.largeOutput, err);
        else if (m.moe) worst.moe = Math.max(worst.moe, err);
        else worst.dense = Math.max(worst.dense, err);
      }
    }
    expect(worst.dense).toBeGreaterThan(0);
    expect(worst.dense).toBeLessThan(0.1);
    expect(worst.moe).toBeLessThan(0.13);
    expect(worst.largeOutput).toBeGreaterThan(0);
    expect(worst.largeOutput).toBeLessThan(0.12);
  });

  it('per-layer embedding models (arch.ple, 10-21 D112): the part outside the table tracks the bpw estimate of the parameters outside it', () => {
    // 층별 임베딩 표 파라미터 = vocab_size_per_layer_input × num_hidden_layers × hidden_size_per_layer_input (google/gemma-4-E4B-it·E2B-it config.json).
    // 직접 입력(D66)은 표를 모델링하지 않는다 — 파일 전체 비교(위 ±10%)를 통과하는 건 safetensors paramsB 에 비전·오디오 인코더(약 0.47B,
    // GGUF 텍스트 파일 밖)가 들어 있어 표의 높은 정밀도(Q5_K·Q8_0)를 우연히 상쇄하기 때문이다. 그래서 표 밖 몫을 따로 본다:
    // 표 밖 파일(fileGB − pleGB) ≤ (paramsB − 표 파라미터) × bpw / 8 — 인코더만큼 어림이 크다(E4B +4~+6%, E2B +13~+16%)
    const plePB: Readonly<Record<string, number>> = { 'gemma-4-e4b': (262144 * 42 * 256) / 1e9, 'gemma-4-e2b': (262144 * 35 * 256) / 1e9 };
    const pleModels = seed.models.filter((m) => m.arch.ple === true);
    expect(pleModels.map((m) => m.id).sort()).toEqual(Object.keys(plePB).sort());
    for (const m of pleModels) {
      const built = ok(buildManualModel({ paramsB: m.paramsB - plePB[m.id]!, layers: 32, kvHeads: 8, headDim: 128 }));
      for (const row of built.rows) {
        const real = seed.modelQuants.find((r) => r.modelId === m.id && r.quant === row.quant);
        if (!real) continue;
        expect(real.pleGB, `${m.id}/${real.quant}`).toBeDefined();
        const err = row.fileGB / (real.fileGB - real.pleGB!) - 1;
        expect(err, `${m.id}/${real.quant}`).toBeGreaterThan(0);
        expect(err, `${m.id}/${real.quant}`).toBeLessThan(0.17);
      }
    }
  });
});

describe('buildManualModel — incomplete and invalid input', () => {
  it('missing required values → incomplete with the missing fields', () => {
    expect(buildManualModel({})).toEqual({ kind: 'incomplete', missing: ['paramsB', 'layers', 'kvHeads', 'headDim'] });
    expect(buildManualModel({ ...LLAMA_8B, headDim: undefined })).toEqual({ kind: 'incomplete', missing: ['headDim'] });
    // MoE 값을 하나라도 넣으면 셋 다 필요하다
    expect(buildManualModel({ ...LLAMA_8B, experts: 64 })).toEqual({ kind: 'incomplete', missing: ['activeParamsB', 'topK'] });
  });

  it('out of range or a fraction in an integer field → invalid range with the limits', () => {
    expect(buildManualModel({ ...LLAMA_8B, paramsB: 0.05 })).toEqual({ kind: 'invalid', field: 'paramsB', issue: { code: 'range', min: 0.1, max: 2000, integer: false } });
    expect(buildManualModel({ ...LLAMA_8B, layers: 0 })).toMatchObject({ kind: 'invalid', field: 'layers', issue: { code: 'range', integer: true } });
    expect(buildManualModel({ ...LLAMA_8B, headDim: 2000 })).toMatchObject({ kind: 'invalid', field: 'headDim' });
    expect(buildManualModel({ ...LLAMA_8B, layers: 32.5 })).toMatchObject({ kind: 'invalid', field: 'layers' });
    expect(manualRangeIssue('kvHeads', Number.NaN)).toMatchObject({ code: 'range' });
    expect(manualRangeIssue('paramsB', 2000)).toBeUndefined();
    // 입력 도중의 값(헤드 차원 '1')도 상태에 남아 안내 문장이 보인다 — 여기선 범위 오류
    expect(manualIssues({ headDim: 1 })).toEqual({ headDim: { code: 'range', ...MANUAL_LIMITS.headDim } });
  });

  it('full-attention layers above the layer count → range up to the layer count', () => {
    expect(buildManualModel({ ...LLAMA_8B, fullAttnLayers: 33 })).toEqual({
      kind: 'invalid',
      field: 'fullAttnLayers',
      issue: { code: 'range', min: 1, max: 32, integer: true },
    });
    expect(ok(buildManualModel({ ...LLAMA_8B, fullAttnLayers: 32 })).model.arch.kvBytesPerTokenF16).toBe(131072);
  });

  it('MoE consistency: top-k must be below the expert count, active below total', () => {
    expect(buildManualModel({ ...QWEN3_30B_A3B, topK: 128 })).toEqual({ kind: 'invalid', field: 'topK', issue: { code: 'topk-too-large' } });
    expect(buildManualModel({ ...QWEN3_30B_A3B, activeParamsB: 30.5 })).toEqual({ kind: 'invalid', field: 'activeParamsB', issue: { code: 'active-too-large' } });
    // 반올림 값으로 비교 (HF 경로와 같다)
    expect(buildManualModel({ ...QWEN3_30B_A3B, activeParamsB: 30.499 })).toMatchObject({ issue: { code: 'active-too-large' } });
  });

  it('active too small for the expert ratio → the minimum that works, and that minimum is accepted', () => {
    const tooSmall = buildManualModel({ ...QWEN3_30B_A3B, activeParamsB: 1.5 });
    expect(tooSmall).toEqual({ kind: 'invalid', field: 'activeParamsB', issue: { code: 'active-too-small', min: 1.92 } });
    // 1.91 은 유도값이 0.0025GB 라 반올림하면 0 — 안내한 최소값(1.92)은 통과해야 한다 (적대적 검토 반영)
    expect(buildManualModel({ ...QWEN3_30B_A3B, activeParamsB: 1.91 })).toMatchObject({ issue: { code: 'active-too-small', min: 1.92 } });
    const atMin = ok(buildManualModel({ ...QWEN3_30B_A3B, activeParamsB: 1.92 }));
    expect(atMin.model.nonExpertGB).toBeGreaterThan(0);
    // 여러 비율에서 안내한 최소값은 늘 통과하고 0.01 아래는 통과하지 않는다
    for (const [p, e, t] of [[30.5, 128, 8], [8, 64, 2], [235, 128, 8], [120, 32, 4], [1.2, 16, 15], [0.5, 4, 1]] as const) {
      const issue = manualIssues({ paramsB: p, activeParamsB: 0.1, experts: e, topK: t }).activeParamsB;
      if (issue?.code !== 'active-too-small') continue; // 0.1 이 이미 충분한 비율
      expect(buildManualModel({ paramsB: p, activeParamsB: issue.min, experts: e, topK: t, layers: 32, kvHeads: 8, headDim: 128 }).kind, `${p}/${e}/${t}`).toBe('ok');
      const below = Math.round((issue.min - 0.01) * 100) / 100;
      if (below >= 0.1) {
        const arch = { totalParamsB: p, activeParamsB: below, experts: e, topK: t };
        const fileGB = Math.round(((p * 4.8944) / 8) * 100) / 100;
        expect(Math.round(deriveNonExpertGB(arch, fileGB) * 100) / 100, `${p}/${e}/${t} below`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('top-k so close to the expert count that no active value is below the total → a top-k problem, not an impossible minimum', () => {
    // 1B·128 전문가·top-k 127: 최소 활성값이 1(= 전체)이 되어 "활성 < 전체" 와 모순이던 경우 (리뷰 반영)
    for (const [p, e, t] of [[1, 128, 127], [0.5, 64, 63], [1.5, 256, 255]] as const) {
      const spec: ManualSpec = { paramsB: p, activeParamsB: 0.1, experts: e, topK: t, layers: 32, kvHeads: 8, headDim: 128 };
      expect(manualIssues(spec), `${p}/${e}/${t}`).toEqual({ topK: { code: 'topk-no-room' } });
      expect(buildManualModel(spec)).toEqual({ kind: 'invalid', field: 'topK', issue: { code: 'topk-no-room' } });
      // 활성 값을 넣기 전에도 top-k 칸에 알린다
      expect(manualIssues({ paramsB: p, experts: e, topK: t }).topK).toEqual({ code: 'topk-no-room' });
    }
    // 안내한 최소값은 늘 전체보다 작다 — 작은 모델·높은 top-k 비율을 훑는다
    for (const p of [0.1, 0.5, 1, 1.5, 3, 8]) {
      for (const e of [2, 4, 16, 64, 128, 256, 512]) {
        for (const t of [1, Math.floor(e / 2), e - 2, e - 1].filter((k) => k >= 1 && k < e)) {
          const issues = manualIssues({ paramsB: p, activeParamsB: 0.1, experts: e, topK: t });
          const min = issues.activeParamsB?.code === 'active-too-small' ? issues.activeParamsB.min : undefined;
          if (min === undefined) continue;
          expect(buildManualModel({ paramsB: p, activeParamsB: min, experts: e, topK: t, layers: 32, kvHeads: 8, headDim: 128 }).kind, `${p}/${e}/${t}`).toBe('ok');
        }
      }
    }
  });

  it('range problems come first in field order', () => {
    const build = buildManualModel({ paramsB: 0, layers: 0 });
    expect(build).toMatchObject({ kind: 'invalid', field: 'paramsB' });
  });
});
