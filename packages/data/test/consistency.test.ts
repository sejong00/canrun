/** 파일 간 정합성 + 시드 규모 — docs/06 P0-3 (GPU 42 코어·모델 20·실측 ~30점). */
import { describe, expect, it } from 'vitest';
import { deriveNonExpertGB, MOE_ARCH, validateAll } from '../src/index';
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

  it('seed: every dense row is measured; MTP rows carry mtpGB inside the off-GPU share', () => {
    const moeIds = new Set(seed.models.filter((m) => m.activeParamsB !== undefined).map((m) => m.id));
    expect(seed.modelQuants.filter((mq) => !moeIds.has(mq.modelId) && mq.offGpuGB === undefined)).toEqual([]);
    expect(seed.modelQuants.filter((mq) => moeIds.has(mq.modelId) && mq.offGpuGB !== undefined)).toEqual([]);
    expect(dense).toMatchObject({ fileGB: 5.87, offGpuGB: 0.75, mtpGB: 0.17 });
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
});

describe('seed scale (docs/06 P0-3)', () => {
  it('has the 42-strong core catalog (32 desktop dgpu + 10-class unified) plus extras', () => {
    const desktopDgpu = seed.gpus.filter((g) => g.kind === 'dgpu' && g.form === 'desktop');
    const unified = seed.gpus.filter((g) => g.kind === 'unified');
    expect(desktopDgpu.length).toBe(32);
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
