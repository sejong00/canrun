/** 파일 간 정합성 + 시드 규모 — docs/06 P0-3 (GPU 42 코어·모델 20·실측 ~30점). */
import { describe, expect, it } from 'vitest';
import { deriveNonExpertGB, ModelQuantSchema, MOE_ARCH, MTP_LOADABLE_MODELS, validateAll } from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();

describe('cross-file consistency (validateAll)', () => {
  it('reports zero problems on the seed', () => {
    expect(validateAll(seed)).toEqual([]);
  });

  it('catches an unknown model FK', () => {
    const broken = {
      ...seed,
      modelQuants: [...seed.modelQuants, { ...seed.modelQuants[0]!, modelId: 'ghost-model' }],
    };
    expect(validateAll(broken).some((p) => p.includes('ghost-model'))).toBe(true);
  });

  it('catches a bpw drift from engine constants', () => {
    const broken = {
      ...seed,
      quantDefs: seed.quantDefs.map((q) => (q.id === 'Q4_K_M' ? { ...q, bpw: 4.9 } : q)),
    };
    expect(validateAll(broken).some((p) => p.includes('Q4_K_M'))).toBe(true);
  });
});

describe('MoE measured split (model-quants expertGB/nonExpertGB, 10-01)', () => {
  const moeRow = seed.modelQuants.find((mq) => mq.modelId === 'gpt-oss-20b')!;
  const denseRow = seed.modelQuants.find((mq) => mq.modelId === 'llama-3.1-8b')!;
  const withRow = (row: (typeof seed.modelQuants)[number]) => ({
    ...seed,
    modelQuants: seed.modelQuants.map((mq) =>
      mq.modelId === row.modelId && mq.quant === row.quant ? row : mq,
    ),
  });

  it('seed: gpt-oss-20b MXFP4 carries the header-measured split (GPU non-expert 1.30GB, not the derived 0.65)', () => {
    expect(moeRow).toMatchObject({ quant: 'MXFP4', expertGB: 10.18, nonExpertGB: 1.3 });
  });

  it('rejects a split on a dense model row', () => {
    const problems = validateAll(withRow({ ...denseRow, expertGB: 1, nonExpertGB: 1 }));
    expect(problems.some((p) => p.includes('llama-3.1-8b') && p.includes('only for MoE'))).toBe(true);
  });

  it('rejects a half-set split and a split larger than the file', () => {
    const { nonExpertGB: _dropped, ...half } = moeRow;
    expect(validateAll(withRow(half)).some((p) => p.includes('set together'))).toBe(true);
    const tooBig = validateAll(withRow({ ...moeRow, expertGB: moeRow.fileGB, nonExpertGB: 0.5 }));
    expect(tooBig.some((p) => p.includes('> fileGB'))).toBe(true);
    // 10-03 D62: GPU 상주량(전문가+비전문가)이 파일의 75% 미만이면 다른 파일을 잰 것
    const tooSmall = validateAll(withRow({ ...moeRow, expertGB: 5, nonExpertGB: 1 }));
    expect(tooSmall.some((p) => p.includes('a different file?'))).toBe(true);
  });
});

describe('dense offGpuGB · mtpGB (GGUF header, 10-03 D62)', () => {
  const dense = seed.modelQuants.find((mq) => mq.modelId === 'qwen3.5-9b' && mq.quant === 'Q4_K_M')!;
  const moeRow = seed.modelQuants.find((mq) => mq.modelId === 'gpt-oss-20b')!;
  const withRow = (row: (typeof seed.modelQuants)[number]) => ({
    ...seed,
    modelQuants: seed.modelQuants.map((mq) => (mq.modelId === row.modelId && mq.quant === row.quant ? row : mq)),
  });

  // 측정은 필수가 아니다(D62): sync·add-model 은 측정 실패·보류 행을 offGpuGB 없이(파일 전체로) 두고 manual 로 알린다.
  // 그래서 "모든 dense 행" 대신 백필 때 잰 대표 행만 고정한다 — 주간 동기화의 `pnpm test` 가 새 행 하나로 깨지지 않게
  it('seed: known dense rows carry the backfilled measurement; MTP rows carry mtpGB inside the off-GPU share', () => {
    const pick = (modelId: string, quant: string) =>
      seed.modelQuants.find((mq) => mq.modelId === modelId && mq.quant === quant);
    expect(pick('llama-3.1-8b', 'Q4_K_M')).toMatchObject({ fileGB: 4.92, offGpuGB: 0.3 });
    expect(pick('exaone-4.5-33b', 'Q4_K_M')).toMatchObject({ offGpuGB: 0.79, mtpGB: 0.34 });
    expect(dense).toMatchObject({ fileGB: 5.87, offGpuGB: 0.75, mtpGB: 0.17 });
    const moeIds = new Set(seed.models.filter((m) => m.activeParamsB !== undefined).map((m) => m.id));
    expect(seed.modelQuants.filter((mq) => moeIds.has(mq.modelId) && mq.offGpuGB !== undefined)).toEqual([]);
  });

  it('MTP_LOADABLE_MODELS names catalog models whose rows carry an MTP block (EXAONE 4.5 is not one)', () => {
    for (const id of MTP_LOADABLE_MODELS) {
      expect(seed.modelQuants.some((mq) => mq.modelId === id && mq.mtpGB !== undefined), id).toBe(true);
    }
    expect(MTP_LOADABLE_MODELS).not.toContain('exaone-4.5-33b');
  });

  it('rejects offGpuGB on a MoE row and above 25% of the file', () => {
    expect(validateAll(withRow({ ...moeRow, offGpuGB: 0.5 })).some((p) => p.includes('only for dense'))).toBe(true);
    expect(validateAll(withRow({ ...dense, offGpuGB: 2 })).some((p) => p.includes('a different file?'))).toBe(true);
  });

  it('rejects mtpGB without the measurement it came from or larger than the off-GPU share', () => {
    const { offGpuGB: _dropped, ...unmeasured } = dense;
    expect(validateAll(withRow(unmeasured)).some((p) => p.includes('mtpGB needs'))).toBe(true);
    expect(validateAll(withRow({ ...dense, mtpGB: 1 })).some((p) => p.includes('off-GPU share'))).toBe(true);
    expect(validateAll(withRow({ ...moeRow, mtpGB: 0.9 })).some((p) => p.includes('off-GPU share'))).toBe(true);
  });
});

describe('per-layer embedding table pleGB (Gemma 4 E 계열, 10-21 D112)', () => {
  const dense = seed.modelQuants.find((mq) => mq.modelId === 'qwen3.5-9b' && mq.quant === 'Q4_K_M')!;
  // 표가 있는 모델로 꾸민 시드 — 행 값은 E4B 꼴(파일의 40% 가 표, 나머지 GPU 밖 몫은 작다)
  const withPle = (row: Record<string, unknown>, archPle = true) => ({
    ...seed,
    models: seed.models.map((m) => (m.id === dense.modelId && archPle ? { ...m, arch: { ...m.arch, ple: true as const } } : m)),
    modelQuants: seed.modelQuants.map((mq) => (mq.modelId === dense.modelId && mq.quant === dense.quant ? { ...mq, ...row } : mq)),
  });
  const others = (problems: string[]) => problems.filter((p) => p.includes('qwen3.5-9b/Q4_K_M'));

  it('accepts a table far above 25% of the file — the cap applies to offGpuGB − pleGB', () => {
    expect(others(validateAll(withPle({ offGpuGB: 2.5, pleGB: 2.4, mtpGB: undefined })))).toEqual([]);
    expect(others(validateAll(withPle({ offGpuGB: 4.0, pleGB: 2.4, mtpGB: undefined })))).toEqual([
      expect.stringContaining('a different file?'),
    ]);
  });

  it('pleGB only on arch.ple models; their measured rows need it; arch.ple only on dense models', () => {
    expect(validateAll(withPle({ offGpuGB: 2.5, pleGB: 2.4, mtpGB: undefined }, false)).some((p) => p.includes('only for models with arch.ple'))).toBe(true);
    expect(validateAll(withPle({})).some((p) => p.includes('needs pleGB'))).toBe(true);
    const moe = { ...seed, models: seed.models.map((m) => (m.id === 'gpt-oss-20b' ? { ...m, arch: { ...m.arch, ple: true as const } } : m)) };
    expect(validateAll(moe).some((p) => p.includes('dense models only'))).toBe(true);
  });

  it('the row schema needs offGpuGB with pleGB and pleGB ≤ offGpuGB', () => {
    const { offGpuGB: _o, mtpGB: _m, ...bare } = dense;
    expect(ModelQuantSchema.safeParse({ ...bare, pleGB: 1 }).success).toBe(false);
    expect(ModelQuantSchema.safeParse({ ...bare, offGpuGB: 1, pleGB: 1.2 }).success).toBe(false);
    expect(ModelQuantSchema.safeParse({ ...bare, offGpuGB: 1.95, pleGB: 1.94 }).success).toBe(true);
  });
});

describe('looped layers arch.loops · loopGB (Nanbeige4.2, 10-22 D114)', () => {
  const nb = seed.modelQuants.find((mq) => mq.modelId === 'nanbeige4.2-3b' && mq.quant === 'Q4_K_M')!;
  const dense = seed.modelQuants.find((mq) => mq.modelId === 'qwen3.5-9b' && mq.quant === 'Q4_K_M')!;
  const withRow = (row: Record<string, unknown>) => ({
    ...seed,
    modelQuants: seed.modelQuants.map((mq) => (mq.modelId === row['modelId'] && mq.quant === row['quant'] ? { ...mq, ...row } : mq)),
  });
  const withModel = (id: string, arch: Record<string, unknown>) => ({
    ...seed,
    models: seed.models.map((m) => (m.id === id ? { ...m, arch: { ...m.arch, ...arch } } : m)),
  });

  it('seed: every Nanbeige row is header-measured with the loop block (trunk blk.N.*) inside the GPU-resident share', () => {
    const rows = seed.modelQuants.filter((mq) => mq.modelId === 'nanbeige4.2-3b');
    expect(rows.map((r) => r.quant)).toEqual(['Q4_K_M', 'IQ4_XS', 'Q8_0', 'Q2_K']);
    for (const r of rows) {
      expect(r.loopGB, r.quant).toBeDefined();
      expect(r.loopGB!, r.quant).toBeLessThanOrEqual(r.fileGB - r.offGpuGB!);
    }
    expect(nb).toMatchObject({ fileGB: 2.68, offGpuGB: 0.29, loopGB: 1.97 });
    expect(seed.models.find((m) => m.id === 'nanbeige4.2-3b')!.arch).toMatchObject({ layers: 22, loops: 2, kvBytesPerTokenF16: 180_224 });
  });

  it('the full-attention KV formula counts logical layers (layers × loops) — the plain count is rejected', () => {
    expect(validateAll(withModel('nanbeige4.2-3b', { kvBytesPerTokenF16: 90_112 })).some((p) => p.includes('kvBytesPerTokenF16 90112 != formula 180224'))).toBe(true);
    expect(validateAll(withModel('nanbeige4.2-3b', { loops: undefined })).some((p) => p.includes('kvBytesPerTokenF16 180224 != formula 90112'))).toBe(true);
  });

  it('loopGB only on arch.loops models; their measured rows need it; arch.loops only on dense models', () => {
    expect(validateAll(withRow({ ...dense, loopGB: 4 })).some((p) => p.includes('only for models with arch.loops'))).toBe(true);
    const { loopGB: _dropped, ...unlooped } = nb;
    const missing = { ...seed, modelQuants: seed.modelQuants.map((mq) => (mq === nb ? unlooped : mq)) };
    expect(validateAll(missing).some((p) => p.includes('needs loopGB'))).toBe(true);
    // 측정 없는 행(offGpuGB 없음)은 받는다 — 엔진이 읽기 바이트 전체를 반복 블록으로 본다(보수)
    const { loopGB: _l, offGpuGB: _o, ...bare } = nb;
    expect(validateAll({ ...seed, modelQuants: seed.modelQuants.map((mq) => (mq === nb ? bare : mq)) })).toEqual([]);
    expect(validateAll(withModel('gpt-oss-20b', { loops: 2 })).some((p) => p.includes('arch.loops is for dense models only'))).toBe(true);
  });

  it('the row schema needs offGpuGB with loopGB and loopGB ≤ fileGB − offGpuGB', () => {
    const { offGpuGB: _o, loopGB: _l, ...bare } = nb;
    expect(ModelQuantSchema.safeParse({ ...bare, loopGB: 1.97 }).success).toBe(false);
    expect(ModelQuantSchema.safeParse({ ...bare, offGpuGB: 0.29, loopGB: 2.5 }).success).toBe(false);
    expect(ModelQuantSchema.safeParse({ ...bare, offGpuGB: 0.29, loopGB: 1.97 }).success).toBe(true);
  });
});

describe('MoE arch.experts/topK (10-01)', () => {
  const withModel = (id: string, arch: Record<string, unknown>) => ({
    ...seed,
    models: seed.models.map((m) => (m.id === id ? { ...m, arch: { ...m.arch, ...arch } } : m)),
  });

  it('every MoE model has experts/topK (topK < experts) and agrees with MOE_ARCH', () => {
    for (const model of seed.models.filter((m) => m.activeParamsB !== undefined)) {
      expect(model.arch.experts, model.id).toBeDefined();
      expect(model.arch.topK!, model.id).toBeLessThan(model.arch.experts!);
      const arch = MOE_ARCH[model.id];
      if (arch) expect([model.arch.experts, model.arch.topK], model.id).toEqual([arch.experts, arch.topK]);
    }
  });

  it('catches a missing pair, topK ≥ experts, MOE_ARCH drift and experts on a dense model', () => {
    const missing = validateAll(withModel('gemma-4-26b-a4b', { experts: undefined, topK: undefined }));
    expect(missing.some((p) => p.includes('gemma-4-26b-a4b') && p.includes('requires arch.experts'))).toBe(true);
    const inverted = validateAll(withModel('gemma-4-26b-a4b', { experts: 8, topK: 8 }));
    expect(inverted.some((p) => p.includes('must be <'))).toBe(true);
    const drift = validateAll(withModel('gpt-oss-20b', { experts: 64 }));
    expect(drift.some((p) => p.includes('!= MOE_ARCH 32'))).toBe(true);
    const dense = validateAll(withModel('llama-3.1-8b', { experts: 8, topK: 2 }));
    expect(dense.some((p) => p.includes('llama-3.1-8b') && p.includes('only for MoE'))).toBe(true);
  });

  it('value experts (MoVA, 10-21 D113): MoE only, set together, valueTopK < valueExperts', () => {
    // 모델 필드 자체는 통과 — 그 모델 행에 값 전문가 실측(valueExpertGB)이 없다는 행 규칙만 남는다
    expect(validateAll(withModel('gpt-oss-20b', { valueExperts: 64, valueTopK: 4 }))).toEqual([
      expect.stringContaining('model-quants/gpt-oss-20b/MXFP4: every row of a value-expert (MoVA) model needs'),
    ]);
    const dense = validateAll(withModel('llama-3.1-8b', { valueExperts: 64, valueTopK: 4 }));
    expect(dense.some((p) => p.includes('llama-3.1-8b') && p.includes('valueExperts/valueTopK only for MoE'))).toBe(true);
    const half = validateAll(withModel('gpt-oss-20b', { valueExperts: 64 }));
    expect(half.some((p) => p.includes('must be set together'))).toBe(true);
    const inverted = validateAll(withModel('gpt-oss-20b', { valueExperts: 4, valueTopK: 4 }));
    expect(inverted.some((p) => p.includes('arch.valueTopK 4 must be < arch.valueExperts 4'))).toBe(true);
  });
});

describe('value-expert rows (MoVA valueExpertGB, 10-21 D113)', () => {
  const MOVA = 'k2-horizon-mova-36b-a4b';
  const movaQ4 = seed.modelQuants.find((mq) => mq.modelId === MOVA && mq.quant === 'Q4_K_M')!;
  const withRow = (row: (typeof seed.modelQuants)[number]) => ({
    ...seed,
    modelQuants: seed.modelQuants.map((mq) => (mq.modelId === row.modelId && mq.quant === row.quant ? row : mq)),
  });
  const needs = (problems: string[]) => problems.some((p) => p.includes(MOVA) && p.includes('needs the header-measured expertGB/nonExpertGB and valueExpertGB'));

  it('seed: both MoVA rows carry the header-measured value experts inside nonExpertGB (Q4_K_M 4.25 of 6.0, Q8_0 8.02 of 10.94)', () => {
    const rows = seed.modelQuants.filter((mq) => mq.modelId === MOVA);
    expect(rows.map((r) => [r.quant, r.nonExpertGB, r.valueExpertGB])).toEqual([
      ['Q4_K_M', 6.0, 4.25],
      ['Q8_0', 10.94, 8.02],
    ]);
  });

  it('every row of a value-expert model needs the split and valueExpertGB — the model-level derived 0.65 would drop the GPU-resident value experts', () => {
    const { expertGB: _e, nonExpertGB: _n, valueExpertGB: _v, ...noSplit } = movaQ4;
    expect(needs(validateAll(withRow(noSplit)))).toBe(true);
    const { valueExpertGB: _only, ...noValue } = movaQ4;
    expect(needs(validateAll(withRow(noValue)))).toBe(true);
  });

  it('valueExpertGB only on arch.valueExperts models', () => {
    const oss = seed.modelQuants.find((mq) => mq.modelId === 'gpt-oss-20b')!;
    expect(validateAll(withRow({ ...oss, valueExpertGB: 0.5 })).some((p) => p.includes('gpt-oss-20b') && p.includes('valueExpertGB only for models with arch.valueExperts'))).toBe(true);
  });

  it('the row schema needs the split with valueExpertGB and valueExpertGB ≤ nonExpertGB', () => {
    const { expertGB: _e, nonExpertGB: _n, ...bare } = movaQ4;
    expect(ModelQuantSchema.safeParse(bare).success).toBe(false);
    expect(ModelQuantSchema.safeParse({ ...movaQ4, valueExpertGB: 6.5 }).success).toBe(false);
    expect(ModelQuantSchema.safeParse(movaQ4).success).toBe(true);
  });
});

describe('compressed attention (DeepSeek V4 — 10-22 D115)', () => {
  it('a compressed-attention model needs attnOverrides (the KV formula and its llama.cpp sources)', () => {
    const v4 = seed.models.find((m) => m.id === 'deepseek-v4-flash-0731')!;
    expect(v4.attnOverrides?.sources.some((s) => s.includes('llama-kv-cache-dsv4.cpp'))).toBe(true);
    const { attnOverrides: _drop, ...bare } = v4;
    const broken = { ...seed, models: seed.models.map((m) => (m.id === v4.id ? bare : m)) };
    expect(validateAll(broken).some((p) => p.includes(v4.id) && p.includes('compressed attention needs attnOverrides'))).toBe(true);
  });
});

describe('seed scale (docs/06 P0-3)', () => {
  it('has the core catalog (34 desktop dgpu — 10-23 D120 RTX PRO 6000 Blackwell · 10-24 D123 Max-Q — + 10-class unified) plus extras', () => {
    const desktopDgpu = seed.gpus.filter((g) => g.kind === 'dgpu' && g.form === 'desktop');
    const unified = seed.gpus.filter((g) => g.kind === 'unified');
    expect(desktopDgpu.length).toBe(34);
    expect(unified.length).toBeGreaterThanOrEqual(10);
  });

  it('has at least the 37 models of 09-30 (first-wave 20 + 한국 9 + 확장 1차 8) — 늘어나는 건 자동화(add-model) 몫', () => {
    expect(seed.models.length).toBeGreaterThanOrEqual(37);
    expect(seed.models.filter((m) => m.korean).length).toBeGreaterThanOrEqual(9);
  });

  it('has ≥30 calibration benchmarks', () => {
    expect(seed.benchmarks.length).toBeGreaterThanOrEqual(30);
  });

  it('registers no rumor SKUs (RTX 50 Super, B770 — research 확인)', () => {
    for (const gpu of seed.gpus) {
      expect(gpu.id).not.toMatch(/super-?50|5080-super|5070-super|b770/);
      expect(gpu.name.toLowerCase()).not.toContain('b770');
    }
  });
});

describe('locale-neutral display fields (CLAUDE.md 규칙 4 — en 페이지에 한글 노출 금지)', () => {
  // 허브가 en/ko 양쪽에 그대로 렌더하는 필드. 한국어 설명은 messages 로, 내부 메모는 note(렌더 금지)로.
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

  it('gpu.name·aliases, model.name·family, bench.flags·hardwareDesc contain no Hangul', () => {
    const fields: Array<[string, string | undefined]> = [
      ...seed.gpus.flatMap((g): Array<[string, string]> => [
        [`gpus/${g.id}.name`, g.name],
        ...g.aliases.map((a): [string, string] => [`gpus/${g.id}.aliases`, a]),
      ]),
      ...seed.models.flatMap((m): Array<[string, string]> => [
        [`models/${m.id}.name`, m.name],
        [`models/${m.id}.family`, m.family],
      ]),
      ...seed.benchmarks.flatMap((bp): Array<[string, string | undefined]> => [
        [`benchmarks/${bp.id}.flags`, bp.flags],
        [`benchmarks/${bp.id}.hardwareDesc`, bp.hardwareDesc],
      ]),
    ];
    for (const [label, value] of fields) {
      if (value === undefined) continue;
      expect(HANGUL.test(value), `${label} = ${value}`).toBe(false);
    }
  });
});

describe('MoE nonExpertGB derivation (P0-2 잠정값 확정)', () => {
  it.each(Object.keys(MOE_ARCH))('%s seed value matches the derivation', (modelId) => {
    const model = seed.models.find((m) => m.id === modelId);
    const baseQuant = seed.modelQuants.find(
      (mq) => mq.modelId === modelId && (mq.quant === 'Q4_K_M' || mq.quant === 'MXFP4'),
    );
    expect(model?.nonExpertGB).toBeDefined();
    expect(baseQuant).toBeDefined();
    const derived = deriveNonExpertGB(MOE_ARCH[modelId]!, baseQuant!.fileGB);
    expect(Math.abs(derived - model!.nonExpertGB!)).toBeLessThanOrEqual(0.02);
  });

  it('models outside MOE_ARCH omit model-level nonExpertGB — 양자화 행별 헤더 실측이 대신 (10-01)', () => {
    for (const id of ['gemma-4-26b-a4b', 'qwen3.5-122b-a10b']) {
      const model = seed.models.find((m) => m.id === id);
      expect(model?.moe).toBe(true);
      expect(model?.nonExpertGB).toBeUndefined();
      const rows = seed.modelQuants.filter((mq) => mq.modelId === id);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.nonExpertGB, `${id}/${row.quant}`).toBeDefined();
    }
  });
});
