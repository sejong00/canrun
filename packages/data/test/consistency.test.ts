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

  it('models without documented expert structure omit nonExpertGB (근거 없는 값 금지)', () => {
    for (const id of ['gemma-4-26b-a4b', 'qwen3.5-122b-a10b']) {
      const model = seed.models.find((m) => m.id === id);
      expect(model?.moe).toBe(true);
      expect(model?.nonExpertGB).toBeUndefined();
    }
  });
});
