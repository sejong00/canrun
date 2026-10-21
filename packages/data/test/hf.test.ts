/**
 * 브라우저 진입점 `@canrun/data/hf` — HF 입력 해석 · HF 데이터 → 엔진 입력 레코드 조립 · GGUF 헤더 파라미터 수 · fetch 주입.
 * 네트워크 없음 (fetch 는 가짜). 조립 결과는 실제 시드 카탈로그와 함께 assessCombo·commandPlan 에 그대로 넣어 본다.
 */
import { describe, expect, it } from 'vitest';
import { gpuResidentGBFor } from '@canrun/engine';
import {
  assessCombo,
  classifyLicense,
  commandPlan,
  deriveNonExpertGB,
  hardwareConfigs,
  toModelQuant,
  verdictRank,
  type CatalogCore,
} from '../src/index';
import {
  bailingMlaLayers,
  buildHfModel,
  classifyArch,
  classifySplit,
  DEEPSEEK_V4_REFS,
  fetchRange,
  measureSplit,
  mapLicense,
  NANBEIGE_LOOP_REFS,
  parseHfInput,
  type FetchLike,
  type GgufHeader,
  type GgufTensorInfo,
  type HfModelInput,
  type HfModelResult,
  type TreeEntry,
} from '../src/hf';
import { loadSeed } from './seed';

// ---------------------------------------------------------------------------
// parseHfInput
// ---------------------------------------------------------------------------

describe('parseHfInput', () => {
  it.each([
    ['Qwen/Qwen3-8B', 'Qwen/Qwen3-8B'],
    ['  Qwen/Qwen3-8B \n', 'Qwen/Qwen3-8B'],
    ['meta-llama/Llama-3.2-3B-Instruct', 'meta-llama/Llama-3.2-3B-Instruct'],
    ['org_name.x/repo_name.v1-2', 'org_name.x/repo_name.v1-2'],
    ['https://huggingface.co/Qwen/Qwen3-8B', 'Qwen/Qwen3-8B'],
    ['http://www.huggingface.co/Qwen/Qwen3-8B', 'Qwen/Qwen3-8B'],
    ['https://huggingface.co/Qwen/Qwen3-8B/', 'Qwen/Qwen3-8B'],
    ['https://huggingface.co/Qwen/Qwen3-8B/tree/main', 'Qwen/Qwen3-8B'],
    ['https://huggingface.co/unsloth/Qwen3-8B-GGUF/blob/main/Qwen3-8B-Q4_K_M.gguf', 'unsloth/Qwen3-8B-GGUF'],
    ['https://huggingface.co/Qwen/Qwen3-8B?library=transformers', 'Qwen/Qwen3-8B'],
    ['https://huggingface.co/Qwen/Qwen3-8B#quickstart', 'Qwen/Qwen3-8B'],
    ['HuggingFace.co/Qwen/Qwen3-8B', 'Qwen/Qwen3-8B'],
    ['hf.co/unsloth/Qwen3-8B-GGUF', 'unsloth/Qwen3-8B-GGUF'],
    ['https://hf.co/unsloth/Qwen3-8B-GGUF', 'unsloth/Qwen3-8B-GGUF'],
    ['hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M', 'unsloth/Qwen3-8B-GGUF'],
    ['huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF:IQ4_XS', 'bartowski/Qwen_Qwen3-8B-GGUF'],
  ])('%j → %s', (input, expected) => {
    expect(parseHfInput(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'Qwen3-8B',
    'Qwen/',
    '/Qwen3-8B',
    'Qwen/Qwen3-8B/tree/main', // 호스트 없는 하위 경로
    'Qwen/Qwen3-8B:Q4_K_M', // Ollama 태그는 hf.co 형식에서만
    'org/repo name',
    '-org/repo',
    'org/.repo',
    'https://huggingface.co/datasets/HuggingFaceFW/fineweb',
    'huggingface.co/datasets/org/repo',
    'https://huggingface.co/spaces/org/app',
    'datasets/fineweb',
    'https://huggingface.co/Qwen',
    'huggingface.co/Qwen',
    'hf.co/Qwen',
    'https://example.com/Qwen/Qwen3-8B',
    'ftp://huggingface.co/Qwen/Qwen3-8B',
    'https://huggingface.co.evil.com/Qwen/Qwen3-8B',
    'ollama run hf.co/unsloth/Qwen3-8B-GGUF',
  ])('rejects %j', (input) => {
    expect(parseHfInput(input)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildHfModel
// ---------------------------------------------------------------------------

const file = (path: string, gb: number): TreeEntry => ({ type: 'file', path, size: Math.round(gb * 1e9) });

/** Qwen3-8B 형 dense 전체 어텐션 (HF config 축약) */
const DENSE_CONFIG = {
  architectures: ['Qwen3ForCausalLM'],
  model_type: 'qwen3',
  hidden_size: 4096,
  num_hidden_layers: 36,
  num_attention_heads: 32,
  num_key_value_heads: 8,
  head_dim: 128,
  max_position_embeddings: 40960,
  sliding_window: null,
  use_sliding_window: false,
};

const DENSE_REPO = 'unsloth/Qwen3-8B-GGUF';
const DENSE_TREE: TreeEntry[] = [
  { type: 'file', path: 'README.md', size: 1200 },
  { type: 'directory', path: 'BF16' },
  file('Qwen3-8B-Q2_K.gguf', 3.28),
  file('Qwen3-8B-IQ4_XS.gguf', 4.56),
  file('Qwen3-8B-Q4_K_M.gguf', 5.03),
  file('Qwen3-8B-Q8_0.gguf', 8.71),
  file('Qwen3-8B-UD-Q4_K_XL.gguf', 5.12),
  file('mmproj-F16.gguf', 0.4),
];

const denseInput: HfModelInput = {
  hfId: 'Qwen/Qwen3-8B',
  ggufRepo: DENSE_REPO,
  config: DENSE_CONFIG,
  tree: DENSE_TREE,
  info: { license: 'apache-2.0', paramsB: 8.190735 },
};

/** Qwen3-30B-A3B 형 MoE (128 전문가 top-8) */
const MOE_CONFIG = {
  model_type: 'qwen3_moe',
  hidden_size: 2048,
  num_hidden_layers: 48,
  num_attention_heads: 32,
  num_key_value_heads: 4,
  head_dim: 128,
  max_position_embeddings: 262144,
  num_experts: 128,
  num_experts_per_tok: 8,
  use_sliding_window: false,
};

const MOE_REPO = 'unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF';
const MOE_TREE: TreeEntry[] = [
  file('Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf', 18.56),
  file('Qwen3-30B-A3B-Instruct-2507-IQ4_XS.gguf', 16.38),
  file('Qwen3-30B-A3B-Instruct-2507-Q8_0.gguf', 32.48),
  file('Qwen3-30B-A3B-Instruct-2507-Q2_K.gguf', 11.26),
];
/** 기준(Q4_K_M) 파일 헤더 실측 — 카탈로그 qwen3-30b-a3b-2507 Q4_K_M 행과 같은 분할 */
const MOE_SPLIT = { expertGB: 17.55, nonExpertGB: 0.82, totalParamsB: 30.53, expertParamsB: 28.99 };

function ok(res: HfModelResult): Extract<HfModelResult, { kind: 'ok' }> {
  if (res.kind !== 'ok') throw new Error(`expected ok, got ${res.kind}: ${res.reason}`);
  return res;
}

describe('buildHfModel — dense full attention (Qwen3-8B)', () => {
  const built = ok(buildHfModel(denseInput));

  it('builds an engine-ready ModelCore with an hf- id that never collides with the catalog', () => {
    expect(built.model).toEqual({
      id: 'hf-qwen3-8b',
      name: 'Qwen3 8B',
      hfId: 'Qwen/Qwen3-8B',
      paramsB: 8.19,
      arch: { layers: 36, kvHeads: 8, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 36 * 8 * 128 * 4 },
      maxContext: 40960,
      license: 'Apache-2.0',
      moe: false,
      category: ['chat'],
      korean: false,
      popularity: 1,
    });
    expect(built.model.id.startsWith('hf-')).toBe(true);
    expect(loadSeed().models.some((m) => m.id === built.model.id)).toBe(false);
    expect(built.notes).toEqual([]);
  });

  it('maps the standard quant rows (Q4_K_M first) to ModelQuantCore — no doc-only fields', () => {
    expect(built.rows).toHaveLength(4);
    expect(built.rows.map((r) => r.quant)).toEqual(['Q4_K_M', 'IQ4_XS', 'Q8_0', 'Q2_K']);
    expect(built.rows[0]).toEqual({
      modelId: 'hf-qwen3-8b',
      quant: 'Q4_K_M',
      fileGB: 5.03,
      ggufRepo: DENSE_REPO,
      fileName: 'Qwen3-8B-Q4_K_M.gguf',
    });
    for (const row of built.rows) {
      expect(row.modelId).toBe(built.model.id);
      expect(row).not.toHaveProperty('sources');
      expect(row).not.toHaveProperty('expertGB');
    }
  });

  it('marks vision models and maps unknown licenses to "unknown"', () => {
    const vision = ok(buildHfModel({ ...denseInput, config: { model_type: 'qwen3_vl', vision_config: {}, text_config: DENSE_CONFIG }, info: { paramsB: 8.77 } }));
    expect(vision.model.category).toEqual(['chat', 'vision']);
    expect(vision.model.license).toBe('unknown');
  });

  it('takes paramsB from the GGUF header count when safetensors metadata is missing (dense ignores split sizes)', () => {
    const res = ok(buildHfModel({ ...denseInput, info: {}, baseSplit: { expertGB: 0, nonExpertGB: 4.4, totalParamsB: 8.190735, expertParamsB: 0 } }));
    expect(res.model.paramsB).toBe(8.19);
    expect(res.model.moe).toBe(false);
    expect(res.model).not.toHaveProperty('nonExpertGB');
    expect(res.rows[0]).not.toHaveProperty('expertGB');
    expect(res.notes).toEqual(['params-from-header']);
  });

  it('swa / hybrid: KV counts full-attention layers only and says so', () => {
    const layerTypes = [...Array.from({ length: 27 }, () => 'linear_attention'), ...Array.from({ length: 9 }, () => 'full_attention')];
    const res = ok(buildHfModel({ ...denseInput, config: { ...DENSE_CONFIG, model_type: 'qwen3_5_text', layer_types: layerTypes } }));
    expect(res.model.arch).toMatchObject({ attnType: 'hybrid', kvBytesPerTokenF16: 9 * 8 * 128 * 4 });
    expect(res.notes).toEqual(['kv-full-layers-only']);
  });
});

describe('buildHfModel — MoE (qwen3_moe 128 experts top-8)', () => {
  it('with the baseline header split: activeParamsB from header counts, measured nonExpertGB, split on the Q4_K_M row', () => {
    const res = ok(
      buildHfModel({
        hfId: 'acme/Qwen3-MoE-Instruct', // 이름에 A?B 표기 없음 → 헤더 원소 수로
        ggufRepo: MOE_REPO,
        config: MOE_CONFIG,
        tree: MOE_TREE,
        info: { license: 'apache-2.0', paramsB: 30.532122 },
        baseSplit: MOE_SPLIT,
      }),
    );
    expect(res.model).toMatchObject({
      id: 'hf-qwen3-moe',
      paramsB: 30.53,
      // 30.53 − 28.99 + 28.99 × 8/128
      activeParamsB: 3.35,
      moe: true,
      nonExpertGB: 0.82,
      arch: { layers: 48, kvHeads: 4, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 48 * 4 * 128 * 4, experts: 128, topK: 8 },
    });
    expect(res.rows[0]).toEqual({
      modelId: 'hf-qwen3-moe',
      quant: 'Q4_K_M',
      fileGB: 18.56,
      expertGB: 17.55,
      nonExpertGB: 0.82,
      // 10-03 D62: 기준 행만 분할이 있어 상주량 유도를 막는다(파일 전체로 판정 — 다른 행과 같은 기준)
      offGpuGB: 0,
      ggufRepo: MOE_REPO,
      fileName: 'Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf',
    });
    for (const row of res.rows.slice(1)) {
      expect(row).not.toHaveProperty('expertGB');
      expect(row).not.toHaveProperty('offGpuGB');
    }
    expect(res.notes).toEqual(['active-from-header']);
  });

  it('judges every quant row on the whole file, so no ladder inversion from a baseline-only split (10-03 D62)', () => {
    const res = ok(
      buildHfModel({
        hfId: 'acme/Qwen3-MoE-Instruct',
        ggufRepo: MOE_REPO,
        config: MOE_CONFIG,
        tree: MOE_TREE,
        info: { license: 'apache-2.0', paramsB: 30.532122 },
        baseSplit: MOE_SPLIT,
      }),
    );
    for (const row of res.rows) {
      const mq = toModelQuant(res.model, row);
      expect(gpuResidentGBFor(mq)).toBe(row.fileGB);
    }
  });

  it('name AxB wins for activeParamsB; without a header split nonExpertGB is derived (bpw-uniform)', () => {
    const res = ok(
      buildHfModel({ hfId: 'Qwen/Qwen3-30B-A3B-Instruct-2507', ggufRepo: MOE_REPO, config: MOE_CONFIG, tree: MOE_TREE, info: { paramsB: 30.5 } }),
    );
    expect(res.model.id).toBe('hf-qwen3-30b-a3b-instruct-2507');
    expect(res.model.name).toBe('Qwen3 30B-A3B Instruct 2507');
    expect(res.model.activeParamsB).toBe(3);
    const derived = Math.round(deriveNonExpertGB({ totalParamsB: 30.5, activeParamsB: 3, experts: 128, topK: 8 }, 18.56) * 100) / 100;
    expect(res.model.nonExpertGB).toBe(derived);
    expect(res.rows[0]).not.toHaveProperty('expertGB');
    expect(res.notes).toEqual(['active-from-name', 'nonexpert-derived']);
  });

  it('ignores a header split larger than the baseline file (another file was measured)', () => {
    const res = ok(
      buildHfModel({
        hfId: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
        ggufRepo: MOE_REPO,
        config: MOE_CONFIG,
        tree: MOE_TREE,
        info: { paramsB: 30.5 },
        baseSplit: { expertGB: 30.8, nonExpertGB: 1.34 },
      }),
    );
    expect(res.rows[0]).not.toHaveProperty('expertGB');
    expect(res.notes).toEqual(['active-from-name', 'split-ignored', 'nonexpert-derived']);
  });

  it('no-params when the active count is unknown or inconsistent', () => {
    const base = { ggufRepo: MOE_REPO, config: MOE_CONFIG, tree: MOE_TREE, info: { paramsB: 30.5 } };
    expect(buildHfModel({ ...base, hfId: 'acme/Qwen3-MoE' })).toMatchObject({ kind: 'no-params', reason: expect.stringContaining('active') });
    // 이름은 A3B 인데 총 300B — 활성 비율이 topK/experts 보다 작아 비전문가가 음수가 된다
    expect(buildHfModel({ ...base, hfId: 'acme/Big-300B-A3B', info: { paramsB: 300 } })).toMatchObject({ kind: 'no-params', reason: expect.stringContaining('inconsistent') });
  });
});

describe('buildHfModel — refusals', () => {
  it('unsupported structure passes the classifier reason through', () => {
    const res = buildHfModel({ ...denseInput, config: { ...DENSE_CONFIG, model_type: 'deepseek_v4' } });
    expect(res).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('deepseek_v4') });
    expect(buildHfModel({ ...denseInput, config: { ...DENSE_CONFIG, kv_lora_rank: 512 } })).toMatchObject({
      kind: 'unsupported',
      reason: expect.stringContaining('kv_lora_rank'),
    });
  });

  it('no-gguf when the repo has no Q4_K_M file', () => {
    const tree = DENSE_TREE.filter((e) => !e.path.includes('Q4_K_M'));
    expect(buildHfModel({ ...denseInput, tree })).toMatchObject({ kind: 'no-gguf' });
    expect(buildHfModel({ ...denseInput, tree: [] })).toMatchObject({ kind: 'no-gguf' });
  });

  it('no-params when neither safetensors metadata nor a header count is available', () => {
    expect(buildHfModel({ ...denseInput, info: { license: 'mit' } })).toMatchObject({ kind: 'no-params' });
    expect(buildHfModel({ ...denseInput, info: undefined, baseSplit: { expertGB: 0, nonExpertGB: 4.4 } })).toMatchObject({ kind: 'no-params' });
  });
});

// ---------------------------------------------------------------------------
// 실제 카탈로그와 함께 — 계산기가 하는 그대로 (행만 덧붙인 카탈로그로 assessCombo → commandPlan)
// ---------------------------------------------------------------------------

describe('buildHfModel results run through the assembly functions unchanged', () => {
  const seed = loadSeed();
  const gpu = (id: string) => {
    const g = seed.gpus.find((x) => x.id === id);
    if (!g) throw new Error(`gpu ${id} missing from seed`);
    return g;
  };
  const withRows = (built: Extract<HfModelResult, { kind: 'ok' }>): CatalogCore => ({
    ...seed,
    modelQuants: [...seed.modelQuants, ...built.rows],
  });

  it('dense Qwen3-8B on an RTX 4090: Q4_K_M fits fully on the GPU, a runnable verdict and a llama.cpp command', () => {
    const built = ok(buildHfModel(denseInput));
    const g = gpu('rtx-4090');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const combo = assessCombo(withRows(built), g, config, built.model, { theoretical: true, ramHint: true });
    expect(combo.modelId).toBe('hf-qwen3-8b');
    expect(combo.perQuant).toHaveLength(4);
    expect(combo.baseline.quant).toBe('Q4_K_M');
    expect(combo.baseline.fits).toBe(true);
    expect(combo.baseline.result.mode).toBe('full-gpu');
    expect(verdictRank(combo.baseline.result.verdict)).toBeGreaterThan(verdictRank('F'));
    expect(combo.baseline.result.tgTokS.est).toBeGreaterThan(0);
    expect(combo.baseline.result.confidence).toBe('theoretical');
    const row = built.rows.find((r) => r.quant === combo.display.quant)!;
    const plan = commandPlan(g, config, built.model, row, combo.display, { ctx: 8192 });
    expect(plan.llamaCpp?.command).toContain(DENSE_REPO);
  });

  it('MoE with a measured split on an 8GB RTX 4060: experts spill to RAM, the measured split reaches the engine', () => {
    const built = ok(
      buildHfModel({ hfId: 'acme/Qwen3-MoE-Instruct', ggufRepo: MOE_REPO, config: MOE_CONFIG, tree: MOE_TREE, info: { paramsB: 30.53 }, baseSplit: MOE_SPLIT }),
    );
    const g = gpu('rtx-4060');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const combo = assessCombo(withRows(built), g, config, built.model, { theoretical: true });
    expect(combo.baseline).toMatchObject({ quant: 'Q4_K_M', expertGB: 17.55, nonExpertGB: 0.82 });
    expect(combo.baseline.result.mode).not.toBe('full-gpu');
    expect(['S', 'A', 'B', 'F']).toContain(combo.baseline.result.verdict);
  });

  it('Nemotron-H loaded from HF (10-03 D63): license_name, MoE block map, and a --n-cpu-moe that ends right after an expert block', () => {
    const repo = 'bartowski/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF';
    const built = ok(
      buildHfModel({
        hfId: 'nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16',
        ggufRepo: repo,
        config: NEMOTRON_CONFIG,
        tree: [file('NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Q4_K_M.gguf', 25.48), file('NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Q8_0.gguf', 35)],
        info: { license: 'other', licenseName: 'openmdw-1.1', paramsB: 31.577937344 },
        baseSplit: { expertGB: 22.83, nonExpertGB: 1.65 },
      }),
    );
    expect(built.model.license).toBe('OpenMDW-1.1');
    expect(built.model.arch).toMatchObject({ attnType: 'hybrid', kvBytesPerTokenF16: 6144, experts: 128, topK: 6 });
    expect(built.model.arch.expertLayers).toHaveLength(23);
    expect(built.notes).toContain('kv-full-layers-only');
    // 엔진의 전문가 층 수 = MoE 블록 23 (52 블록 전체가 아니다)
    expect(toModelQuant(built.model, built.rows[0]).moeLayers).toBe(23);

    const g = gpu('rtx-5060-ti-16gb');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const combo = assessCombo(withRows(built), g, config, built.model, { theoretical: true });
    expect(combo.display.result.mode).toBe('cpu-moe');
    const onCpu = combo.display.result.cpuMoeLayers!;
    expect(onCpu).toBeGreaterThan(0);
    expect(onCpu).toBeLessThan(23);
    const row = built.rows.find((r) => r.quant === combo.display.quant)!;
    const n = commandPlan(g, config, built.model, row, combo.display).llamaCpp!.nCpuMoe!;
    // 앞 n 블록에 MoE 블록이 정확히 엔진 배치만큼 들어 있고, n-1 번 블록이 그 마지막 MoE 블록이다
    const experts = built.model.arch.expertLayers!;
    expect(experts.filter((l) => l < n)).toHaveLength(onCpu);
    expect(experts).toContain(n - 1);
  });
});

// ---------------------------------------------------------------------------
// GGUF 헤더 — 파라미터 수, fetch 주입
// ---------------------------------------------------------------------------

describe('classifySplit — parameter counts from tensor element counts', () => {
  const F32 = 0;
  const F16 = 1;
  const Q8_0 = 8;
  const Q4_K = 12;
  const MXFP4 = 39;
  const tensors: GgufTensorInfo[] = [
    { name: 'token_embd.weight', dims: [8, 10], type: F16 }, // 80
    { name: 'output.weight', dims: [8, 10], type: F32 }, // 80
    { name: 'output_norm.weight', dims: [8], type: F32 }, // 8
    { name: 'blk.0.attn_q.weight', dims: [32, 4], type: Q8_0 }, // 128
    { name: 'blk.0.ffn_up_shexp.weight', dims: [8, 4], type: F16 }, // 32 (공유 전문가 — 비전문가)
    { name: 'blk.0.ffn_gate_exps.weight', dims: [256, 2, 4], type: Q4_K }, // 2048 전문가
    { name: 'blk.1.ffn_down_exps.weight', dims: [32, 4, 4], type: MXFP4 }, // 512 전문가
    { name: 'blk.2.ffn_gate_exps.weight', dims: [32, 2], type: Q8_0 }, // MTP 블록 — 제외
    { name: 'blk.2.nextn.eh_proj.weight', dims: [8, 8], type: F16 }, // MTP — 제외
  ];
  const header = (ts: GgufTensorInfo[]): GgufHeader => ({
    version: 3,
    kv: {
      'general.architecture': 'qwen35moe',
      'qwen35moe.block_count': 3,
      'qwen35moe.nextn_predict_layers': 1,
      'qwen35moe.expert_count': 4,
      'qwen35moe.expert_used_count': 2,
    },
    tensors: ts,
    headerBytes: 0,
  });

  it('total = every non-MTP tensor (token_embd included once), expert = routed expert tensors', () => {
    const m = classifySplit([header(tensors)]);
    expect(m.totalParams).toBe(80 + 80 + 8 + 128 + 32 + 2048 + 512);
    expect(m.expertParams).toBe(2048 + 512);
    const tied = classifySplit([header(tensors.filter((t) => t.name !== 'output.weight'))]);
    expect(tied.totalParams).toBe(80 + 8 + 128 + 32 + 2048 + 512);
  });

  it('a SplitMeasure feeds buildHfModel.baseSplit directly (counts / 1e9)', () => {
    const m = classifySplit([header(tensors)]);
    const baseSplit: HfModelInput['baseSplit'] = { ...m, totalParamsB: m.totalParams / 1e9, expertParamsB: m.expertParams / 1e9 };
    expect(baseSplit).toMatchObject({ expertGB: m.expertGB, nonExpertGB: m.nonExpertGB });
  });
});

describe('fetchRange — injectable fetch and headers (browser: none, scripts: auth)', () => {
  const url = 'https://huggingface.co/org/m-GGUF/resolve/main/m.gguf';

  function fakeFetch() {
    const calls: Array<{ url: string; headers: Headers; thisArg: unknown }> = [];
    // 메서드 호출(this = 옵션 객체)이면 브라우저 window.fetch 가 Illegal invocation 으로 실패한다 — 평범한 함수 호출만 허용
    const f = function (this: unknown, input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) {
      calls.push({ url: String(input), headers: new Headers(init?.headers), thisArg: this });
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'content-range': 'bytes 0-3/100' } }),
      );
    } as FetchLike;
    return { f, calls };
  }

  it('sends only Range when no headers are given, and calls fetch as a plain function', async () => {
    const { f, calls } = fakeFetch();
    const res = await fetchRange(url, 0, 3, { fetch: f });
    expect([...res.bytes]).toEqual([1, 2, 3, 4]);
    expect(res.fileBytes).toBe(100);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(url);
    expect(calls[0]!.headers.get('range')).toBe('bytes=0-3');
    expect(calls[0]!.headers.get('authorization')).toBeNull();
    expect(calls[0]!.thisArg).toBeUndefined();
  });

  it('merges caller headers (script: HF_TOKEN Authorization) and keeps its own Range', async () => {
    const { f, calls } = fakeFetch();
    await fetchRange(url, 0, 3, { fetch: f, headers: { Authorization: 'Bearer test', Range: 'bytes=9-9' } });
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer test');
    expect(calls[0]!.headers.get('range')).toBe('bytes=0-3');
  });
});

// ---------------------------------------------------------------------------
// classifyArch — 상수 상태 층 하이브리드·새 model_type (10-03 D63). 픽스처는 10-03 실제 HF config 를 축약
// ---------------------------------------------------------------------------

const repeat = (n: number, ...pattern: string[]): string[] => Array.from({ length: n }, () => pattern).flat();
/** Gemma 4 layer_types — 전체 어텐션 층 = (i + 1) % every == 0 (E4B 6 · E2B 5, 마지막 층은 늘 전체 어텐션) */
const gemma4LayerTypes = (layers: number, every: number): string[] =>
  Array.from({ length: layers }, (_, i) => ((i + 1) % every === 0 ? 'full_attention' : 'sliding_attention'));
/** google/gemma-4-E4B-it config.json text_config 의 구조 값 (10-21 확인 — 층별 임베딩 256 차원 · 뒤 18층 KV 공유) */
const GEMMA4_E4B_TEXT = {
  model_type: 'gemma4_text', num_hidden_layers: 42, num_attention_heads: 8, num_key_value_heads: 2, num_global_key_value_heads: null,
  head_dim: 256, global_head_dim: 512, hidden_size: 2560, hidden_size_per_layer_input: 256, vocab_size_per_layer_input: 262144,
  num_kv_shared_layers: 18, sliding_window: 512, max_position_embeddings: 131072, num_experts: null, top_k_experts: null,
  tie_word_embeddings: true, layer_types: gemma4LayerTypes(42, 6),
};
/** google/gemma-4-E2B-it config.json text_config 의 구조 값 (10-21 확인 — 뒤 20층 KV 공유) */
const GEMMA4_E2B_TEXT = {
  ...GEMMA4_E4B_TEXT, num_hidden_layers: 35, num_key_value_heads: 1, hidden_size: 1536, num_kv_shared_layers: 20, layer_types: gemma4LayerTypes(35, 5),
};
/** nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16 layers_block_type (52 블록 = mamba 23 · moe 23 · attention 6) */
const NEMOTRON_BLOCKS = [
  'mamba', 'moe', 'mamba', 'moe', 'mamba', 'attention', 'moe', 'mamba', 'moe', 'mamba', 'moe', 'mamba', 'attention',
  'moe', 'mamba', 'moe', 'mamba', 'moe', 'mamba', 'attention', 'moe', 'mamba', 'moe', 'mamba', 'moe', 'mamba', 'attention',
  'moe', 'mamba', 'moe', 'mamba', 'moe', 'mamba', 'attention', 'moe', 'mamba', 'moe', 'mamba', 'moe', 'mamba', 'moe',
  'mamba', 'attention', 'moe', 'mamba', 'moe', 'mamba', 'moe', 'mamba', 'moe', 'mamba', 'moe',
];
const NEMOTRON_CONFIG = {
  architectures: ['NemotronHForCausalLM'],
  model_type: 'nemotron_h',
  num_hidden_layers: 52,
  num_attention_heads: 32,
  num_key_value_heads: 2,
  head_dim: 128,
  hidden_size: 2688,
  max_position_embeddings: 262144,
  n_routed_experts: 128,
  num_experts_per_tok: 6,
  ssm_state_size: 128,
  mamba_num_heads: 64,
  sliding_window: null,
  num_nextn_predict_layers: 1,
  layers_block_type: NEMOTRON_BLOCKS,
};
/** LiquidAI/LFM2.5-2.6B — short-conv 22 + full attention 8 */
const LFM2_CONFIG = {
  architectures: ['Lfm2ForCausalLM'],
  model_type: 'lfm2',
  num_hidden_layers: 30,
  num_attention_heads: 32,
  num_key_value_heads: 8,
  hidden_size: 2048,
  max_position_embeddings: 131072,
  conv_L_cache: 3,
  layer_types: [
    'conv', 'conv', 'full_attention', 'conv', 'conv', 'full_attention', 'conv', 'conv', 'conv', 'full_attention',
    'conv', 'conv', 'conv', 'full_attention', 'conv', 'conv', 'conv', 'full_attention', 'conv', 'conv',
    'conv', 'full_attention', 'conv', 'conv', 'full_attention', 'conv', 'conv', 'full_attention', 'conv', 'conv',
  ],
};
/** inclusionAI/Ling-3.0-tiny·flash (BailingMoeV3 — KDA + MLA) */
const ling = (over: Record<string, unknown>) => ({
  architectures: ['BailingMoeV3ForCausalLM'],
  model_type: 'bailing_hybrid',
  head_dim: 128,
  kv_lora_rank: 512,
  qk_rope_head_dim: 64,
  no_kda_lora: true,
  kda_safe_gate: true,
  gated_attention_proj_granularity_type: 'head_wise',
  num_experts_per_tok: 8,
  ...over,
});
const LING_TINY = ling({ num_hidden_layers: 24, num_attention_heads: 16, num_key_value_heads: 16, max_position_embeddings: 131072, num_experts: 128, layer_group_size: 4, num_nextn_predict_layers: 0, first_k_dense_replace: 1 });
/** JetBrains/Mellum2.1-12B-A2.5B-Thinking config 모양 (10-20) — 3 sliding : 1 full × 7, 전 층 sparse MoE 64 × top-8 */
/** Nanbeige/Nanbeige4.2-3B config.json (10-22 확인 — https://huggingface.co/Nanbeige/Nanbeige4.2-3B/blob/main/config.json, 반복 옵션 기본값) */
const NANBEIGE42_CONFIG = {
  architectures: ['NanbeigeForCausalLM'],
  model_type: 'nanbeige',
  attention_bias: false,
  head_dim: 128,
  hidden_size: 3072,
  intermediate_size: 10752,
  loop_loss_weights: [],
  max_position_embeddings: 262_144,
  num_attention_heads: 48,
  num_hidden_layers: 22,
  num_key_value_heads: 8,
  num_loops: 2,
  skip_loop_final_norm: false,
  tie_word_embeddings: false,
  vocab_size: 166_144,
};
const MELLUM_CONFIG = {
  architectures: ['MellumForCausalLM'], model_type: 'mellum', num_hidden_layers: 28, num_attention_heads: 32, num_key_value_heads: 4, head_dim: 128,
  max_position_embeddings: 131072, sliding_window: 1024, use_sliding_window: true, num_experts: 64, num_experts_per_tok: 8,
  mlp_layer_types: Array<string>(28).fill('sparse'),
  layer_types: repeat(7, 'sliding_attention', 'sliding_attention', 'sliding_attention', 'full_attention'),
};
const LING_FLASH = ling({ num_hidden_layers: 42, num_attention_heads: 32, num_key_value_heads: 32, max_position_embeddings: 262144, num_experts: 512, layer_group_size: 6, num_nextn_predict_layers: 1, first_k_dense_replace: 2 });

function okArch(config: unknown): Extract<ReturnType<typeof classifyArch>, { kind: 'ok' }> {
  const r = classifyArch(config);
  if (r.kind !== 'ok') throw new Error(`expected ok, got unsupported: ${r.reason}`);
  return r;
}

describe('classifyArch — new model types and constant-state hybrids (10-03 D63)', () => {
  it('Spark-X2.5 (spark2_5) and Laguna (laguna MoE) take the existing sliding-window path', () => {
    const spark = okArch({
      model_type: 'spark2_5', num_hidden_layers: 36, num_attention_heads: 16, num_key_value_heads: 4, head_dim: 256,
      max_position_embeddings: 1048576, sliding_window: 512, layer_types: repeat(9, 'sliding_attention', 'sliding_attention', 'sliding_attention', 'full_attention'),
    });
    expect(spark).toMatchObject({ attnType: 'swa', arch: { kvBytesPerTokenF16: 9 * 4 * 256 * 4 } });
    expect(spark.arch.kvBytesPerTokenF16).toBe(36_864);
    const laguna = okArch({
      model_type: 'laguna', num_hidden_layers: 48, num_attention_heads: 48, num_key_value_heads: 8, head_dim: 128,
      max_position_embeddings: 1048576, sliding_window: 512, num_experts: 256, num_experts_per_tok: 10, mlp_only_layers: [0],
      layer_types: repeat(12, 'full_attention', 'sliding_attention', 'sliding_attention', 'sliding_attention'),
    });
    expect(laguna).toMatchObject({ attnType: 'swa', moe: { experts: 256, topK: 10 }, arch: { kvBytesPerTokenF16: 49_152 } });
    // 앞쪽 dense 1층은 균등 근사의 여유(1층) 안 — 전문가 층 지도는 적지 않는다
    expect(laguna.expertLayers).toBeUndefined();
  });

  it('Nemotron-H (Mamba2 + MoE + attention blocks): KV on the 6 attention blocks only, MoE block indices for --n-cpu-moe', () => {
    const r = okArch(NEMOTRON_CONFIG);
    expect(r).toMatchObject({ attnType: 'hybrid', moe: { experts: 128, topK: 6 }, arch: { layers: 52, kvHeads: 2, headDim: 128, kvBytesPerTokenF16: 6 * 2 * 128 * 4 } });
    expect(r.override?.kvBytesPerTokenF16).toBe(6_144);
    expect(r.override?.reason).toContain('attention 6/52');
    expect(r.override?.refs).toEqual(['https://github.com/ggml-org/llama.cpp/blob/master/src/llama-model.cpp']);
    expect(r.expertLayers).toHaveLength(23);
    expect(r.expertLayers?.slice(0, 6)).toEqual([1, 3, 6, 8, 10, 13]);
    expect(r.expertLayers?.at(-1)).toBe(51);
  });

  it('older Nemotron-H configs: hybrid_override_pattern string (* = attention), dense MLP blocks carry no experts', () => {
    const r = okArch({ ...NEMOTRON_CONFIG, n_routed_experts: undefined, num_experts_per_tok: undefined, layers_block_type: undefined, num_hidden_layers: 10, hybrid_override_pattern: 'M-M*-M-M*-' });
    expect(r).toMatchObject({ attnType: 'hybrid', arch: { kvBytesPerTokenF16: 2 * 2 * 128 * 4 } });
    expect(r.moe).toBeUndefined();
    expect(r.expertLayers).toBeUndefined();
  });

  it('LFM2 (short-conv + full attention): KV on the 8 full-attention layers', () => {
    const r = okArch(LFM2_CONFIG);
    expect(r).toMatchObject({ attnType: 'hybrid', arch: { headDim: 64, kvBytesPerTokenF16: 8 * 8 * 64 * 4 } });
    expect(r.override?.kvBytesPerTokenF16).toBe(16_384);
    expect(r.override?.reason).toContain('hybrid conv');
  });

  it('Ling-3.0 (KDA + MLA): MLA latent K only, MLA layers match the GGUF head_count_kv arrays (MTP layer included)', () => {
    // inclusionAI 공식 Q4_K_M 헤더 head_count_kv 가 1 인 층 (10-03 실측)
    expect(bailingMlaLayers(24, 4, 0)).toEqual([3, 7, 11, 15, 19, 23]);
    expect(bailingMlaLayers(42, 6, 1)).toEqual([5, 11, 17, 23, 29, 35, 41, 42]);
    const tiny = okArch(LING_TINY);
    expect(tiny).toMatchObject({ attnType: 'hybrid', moe: { experts: 128, topK: 8 }, arch: { kvHeads: 16, headDim: 128, kvBytesPerTokenF16: 6 * (512 + 64) * 2 } });
    expect(tiny.override?.kvBytesPerTokenF16).toBe(6_912);
    expect(tiny.expertLayers).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    const flash = okArch(LING_FLASH);
    expect(flash.override?.kvBytesPerTokenF16).toBe(8 * 1152);
    expect(flash.override?.reason).toContain('MTP');
    expect(flash.expertLayers?.[0]).toBe(2);
    expect(flash.expertLayers).toHaveLength(40);
  });

  it('Muse Glimmer (muse_glimmer_text in text_config, VLM) takes the existing sliding-window path (10-20)', () => {
    // meta-models/Muse-Glimmer-30B config 모양 — 최상위 model_type 은 muse_glimmer 지만 분류기는 text_config 값을 본다
    const muse = okArch({
      architectures: ['MuseGlimmerForConditionalGeneration'], model_type: 'muse_glimmer', vision_config: {},
      text_config: {
        model_type: 'muse_glimmer_text', num_hidden_layers: 52, num_attention_heads: 32, num_key_value_heads: 2, head_dim: 128,
        hidden_size: 6656, max_position_embeddings: 131072, sliding_window: 2048,
        layer_types: repeat(13, 'sliding_attention', 'sliding_attention', 'sliding_attention', 'full_attention'),
      },
    });
    expect(muse).toMatchObject({ attnType: 'swa', vision: true, maxContext: 131072, arch: { layers: 52, kvHeads: 2, headDim: 128, kvBytesPerTokenF16: 13 * 2 * 128 * 4 } });
    expect(muse.arch.kvBytesPerTokenF16).toBe(13_312);
    expect(muse.moe).toBeUndefined();
    expect(muse.override?.reason).toContain('full attn 13/52');
  });

  it('Mellum2.1 (mellum MoE, every layer sparse) takes the existing sliding-window path (10-20)', () => {
    const mellum = okArch(MELLUM_CONFIG);
    expect(mellum).toMatchObject({ attnType: 'swa', vision: false, moe: { experts: 64, topK: 8 }, arch: { layers: 28, kvHeads: 4, headDim: 128, kvBytesPerTokenF16: 7 * 4 * 128 * 4 } });
    expect(mellum.arch.kvBytesPerTokenF16).toBe(14_336);
    expect(mellum.override?.reason).toContain('sliding win1024');
    // 28층 전부 전문가 층 — 균등 근사가 정확하므로 층 지도를 적지 않는다
    expect(mellum.expertLayers).toBeUndefined();
  });

  it('Kolibri-1 (kolibri1 MoE) takes the existing sliding-window path (10-20)', () => {
    const kolibri = okArch({
      architectures: ['Kolibri1ForCausalLM'], model_type: 'kolibri1', num_hidden_layers: 50, num_attention_heads: 48, num_key_value_heads: 4, head_dim: 128,
      max_position_embeddings: 262144, use_sliding_window: true, sliding_window: 513, num_experts: 384, num_experts_per_tok: 6,
      layer_types: repeat(10, 'sliding_attention', 'sliding_attention', 'sliding_attention', 'sliding_attention', 'full_attention'),
    });
    expect(kolibri).toMatchObject({ attnType: 'swa', moe: { experts: 384, topK: 6 }, arch: { layers: 50, kvHeads: 4, headDim: 128, kvBytesPerTokenF16: 10 * 4 * 128 * 4 } });
    expect(kolibri.arch.kvBytesPerTokenF16).toBe(20_480);
    expect(kolibri.expertLayers).toBeUndefined();
  });

  it.each([
    // 반복 층은 llama.cpp nanbeige 배치를 확인한 NanbeigeForCausalLM 만 계산한다(10-22 D114) — 다른 클래스·구조의 반복은 그대로 보류
    ['looped nanbeige under another class', { model_type: 'nanbeige', num_loops: 2, num_hidden_layers: 22 }, 'nanbeige 변형'],
    ['looped layers even on a known type', { model_type: 'llama', num_loops: 2, num_hidden_layers: 22, num_attention_heads: 8, head_dim: 128, max_position_embeddings: 4096 }, '반복 층'],
    ['looped layers (Ouro total_ut_steps)', { model_type: 'ouro', total_ut_steps: 4, num_hidden_layers: 24 }, '반복 층'],
    ['Ouro-style steps on a nanbeige config', { ...NANBEIGE42_CONFIG, total_ut_steps: 4 }, '반복 층'],
    // 원본 config 클래스의 LoopSplit·mHC·깊이 어텐션·n-gram 옵션 — llama.cpp 변환기는 num_loops·skip_loop_final_norm 만 옮긴다
    ['nanbeige LoopSplit (enable_double_loop_split)', { ...NANBEIGE42_CONFIG, enable_double_loop_split: true }, 'enable_double_loop_split'],
    ['nanbeige loop_share_kv', { ...NANBEIGE42_CONFIG, enable_double_loop_split: true, loop_share_kv: true }, 'loop_share_kv'],
    ['nanbeige loop_middle_layers', { ...NANBEIGE42_CONFIG, loop_middle_layers: 11 }, 'loop_middle_layers'],
    ['nanbeige loop_loss_weights (the original runs len + 1 loops instead of num_loops)', { ...NANBEIGE42_CONFIG, loop_loss_weights: [0.3] }, 'loop_loss_weights'],
    ['nanbeige mHC', { ...NANBEIGE42_CONFIG, enable_hyper_connection: true, enable_mhc: true }, 'enable_mhc'],
    ['nanbeige depth attention', { ...NANBEIGE42_CONFIG, enable_depth_attention: true }, 'enable_depth_attention'],
    ['nanbeige n-gram embeddings', { ...NANBEIGE42_CONFIG, emb_neighbor_num: 3 }, 'emb_neighbor_num'],
    ['nanbeige n-gram layer fusion', { ...NANBEIGE42_CONFIG, insert_ngram_layer_idx: [4] }, 'insert_ngram_layer_idx'],
    ['nanbeige q/k norm (no tensors in the llama.cpp loader)', { ...NANBEIGE42_CONFIG, qk_layernorm: true }, 'qk_layernorm'],
    ['nanbeige attention bias', { ...NANBEIGE42_CONFIG, attention_bias: true }, 'attention_bias'],
    // 슬라이딩·선형 층 지도(10-22 D114 리뷰) — llama.cpp nanbeige 는 읽지 않고 모든 논리 층이 전체 어텐션이라, swa·hybrid 분기가 loops 를 빼고 물리 층만 세지 않게
    ['nanbeige layer_types (sliding mix)', { ...NANBEIGE42_CONFIG, layer_types: Array.from({ length: 22 }, (_, i) => (i % 2 ? 'full_attention' : 'sliding_attention')), sliding_window: 4096 }, 'layer_types'],
    ['nanbeige layer_types (linear mix)', { ...NANBEIGE42_CONFIG, layer_types: Array.from({ length: 22 }, (_, i) => (i % 4 === 3 ? 'full_attention' : 'linear_attention')) }, 'layer_types'],
    ['nanbeige sliding_window_pattern', { ...NANBEIGE42_CONFIG, sliding_window: 4096, sliding_window_pattern: 4 }, 'sliding_window_pattern'],
    ['nanbeige use_sliding_window', { ...NANBEIGE42_CONFIG, use_sliding_window: true }, 'use_sliding_window'],
    ['disk-read n-gram embedding (Qwen3.8-Flash-Next)', { model_type: 'qwen4_exp', text_config: { model_type: 'qwen3_5_moe_text', ngram_vocab_size_base: 20000000, ple_layer_ids: [2] } }, 'n-gram'],
    // 층별 임베딩 표·KV 공유 층은 llama.cpp gemma4 규칙을 확인한 gemma4_text 만 계산한다(10-21 D112) — 다른 구조면 그대로 보류
    ['per-layer embeddings outside gemma4_text', { model_type: 'qwen3', hidden_size_per_layer_input: 256, num_hidden_layers: 28, num_attention_heads: 16, num_key_value_heads: 8, head_dim: 128, max_position_embeddings: 32768 }, 'PLE'],
    ['KV-shared layers outside gemma4_text', { model_type: 'llama', num_kv_shared_layers: 20, num_hidden_layers: 35, num_attention_heads: 8, num_key_value_heads: 1, head_dim: 256, max_position_embeddings: 32768 }, 'KV 공유 층 20개'],
    ['Gemma 4 E shape without a layer map', { model_type: 'gemma4', text_config: { ...GEMMA4_E4B_TEXT, layer_types: undefined } }, '층 지도'],
    ['Gemma 4 E shape whose layer map is shorter than the layer count', { model_type: 'gemma4', text_config: { ...GEMMA4_E4B_TEXT, layer_types: gemma4LayerTypes(41, 6) } }, '층 지도'],
    ['compressed attention on a known type', { model_type: 'llama', compress_ratios: [0, 4, 128], num_hidden_layers: 3 }, 'compress_ratios'],
    ['DSA layer type (GLM-5.3) on a known type', { model_type: 'qwen3_5_text', num_hidden_layers: 2, num_attention_heads: 4, num_key_value_heads: 1, head_dim: 64, max_position_embeddings: 4096, layer_types: ['deepseek_sparse_attention', 'linear_attention'] }, 'deepseek_sparse_attention'],
    ['Ling/Ring-2.5 (BailingMoeV2_5 — not converted by llama.cpp)', { ...LING_TINY, architectures: ['BailingMoeV2_5ForCausalLM'], no_kda_lora: undefined, kda_safe_gate: undefined }, 'bailing_hybrid'],
    ['BailingMoeV3 with a non-safe KDA gate', { ...LING_TINY, kda_safe_gate: false }, 'bailing_hybrid'],
    ['MLA keys without the Ling layer map', { ...LING_TINY, layer_group_size: undefined }, 'MLA'],
    ['Nemotron-H without a block map', { ...NEMOTRON_CONFIG, layers_block_type: undefined }, '층 지도'],
    ['Nemotron-H block map length mismatch', { ...NEMOTRON_CONFIG, layers_block_type: NEMOTRON_BLOCKS.slice(1) }, '층 지도'],
    ['pure Mamba (no attention block)', { ...NEMOTRON_CONFIG, n_routed_experts: undefined, num_experts_per_tok: undefined, num_hidden_layers: 4, layers_block_type: ['mamba', 'mlp', 'mamba', 'mlp'] }, '어텐션 블록 없음'],
    ['Nemotron-H MoE config without MoE blocks', { ...NEMOTRON_CONFIG, num_hidden_layers: 4, layers_block_type: ['mamba', 'attention', 'mamba', 'mlp'] }, 'MoE'],
    ['LFM2 embedding/encoder variant', { ...LFM2_CONFIG, architectures: ['Lfm2Model'] }, 'lfm2 변형'],
    ['LFM2 without a layer map', { ...LFM2_CONFIG, layer_types: undefined }, 'layer_types'],
    ['conv state keys outside LFM2', { model_type: 'llama', conv_L_cache: 3, num_hidden_layers: 2 }, 'conv_L_cache'],
    ['Mamba keys outside Nemotron-H', { model_type: 'qwen3_5_text', ssm_state_size: 128, num_hidden_layers: 2 }, 'ssm_state_size'],
    ['Mellum under another class (not converted by llama.cpp)', { ...MELLUM_CONFIG, architectures: ['MellumModel'] }, 'mellum 변형'],
    ['Mellum with dense FFN layers (llama.cpp loads every block as MoE)', { ...MELLUM_CONFIG, mlp_layer_types: ['dense', ...Array<string>(27).fill('sparse')] }, 'dense 층'],
  ] as const)('refuses %s', (_name, config, reason) => {
    const r = classifyArch(config);
    expect(r.kind).toBe('unsupported');
    if (r.kind === 'unsupported') expect(r.reason).toContain(reason);
  });
});

describe('classifyArch — looped layers (Nanbeige4.2 num_loops, 10-22 D114)', () => {
  it('Nanbeige4.2-3B: full attention, loops 2, KV per logical layer 22 × 2 × 8 × 128 × 4 = 180,224 B/tok, llama.cpp refs', () => {
    const r = classifyArch(NANBEIGE42_CONFIG);
    expect(r).toMatchObject({
      kind: 'ok',
      modelType: 'nanbeige',
      attnType: 'full',
      loops: 2,
      maxContext: 262_144,
      arch: { layers: 22, kvHeads: 8, headDim: 128, kvBytesPerTokenF16: 180_224 },
    });
    if (r.kind !== 'ok') return;
    expect(r.override).toBeUndefined();
    expect(r.moe).toBeUndefined();
    expect(r.refs).toEqual(NANBEIGE_LOOP_REFS);
    for (const ref of r.refs ?? []) expect(ref).toMatch(/^https:\/\/github\.com\/ggml-org\/llama\.cpp\/blob\/0a1ef309cdbb9f2024f58a38fb4c42352c5db569\//);
  });

  it('num_loops 1 (or absent) on a nanbeige config is a plain dense model — no loops field', () => {
    for (const num_loops of [1, undefined]) {
      const r = classifyArch({ ...NANBEIGE42_CONFIG, num_loops });
      expect(r).toMatchObject({ kind: 'ok', arch: { kvBytesPerTokenF16: 90_112 } });
      if (r.kind === 'ok') expect(r.loops).toBeUndefined();
    }
  });

  it('options left at their defaults (empty loop_loss_weights, null LoopSplit/n-gram keys, skip_loop_final_norm) are fine', () => {
    const r = classifyArch({ ...NANBEIGE42_CONFIG, loop_loss_weights: [], loop_middle_layers: null, emb_neighbor_num: null, insert_ngram_layer_idx: [], skip_loop_final_norm: true });
    expect(r).toMatchObject({ kind: 'ok', loops: 2 });
  });

  it('buildHfModel (calculator import) refuses looped models — rows need the header-measured loop block', () => {
    const r = buildHfModel({ hfId: 'Nanbeige/Nanbeige4.2-3B', ggufRepo: 'bartowski/Nanbeige_Nanbeige4.2-3B-GGUF', config: NANBEIGE42_CONFIG, tree: [] });
    expect(r.kind).toBe('unsupported');
    if (r.kind === 'unsupported') expect(r.reason).toContain('반복 층');
  });
});

describe('mapLicense — license_name when the card says "other" (10-03)', () => {
  it('maps OpenMDW and the LFM Open License to classified badge strings', () => {
    expect(mapLicense('openmdw-1.1')).toBe('OpenMDW-1.1'); // Laguna: license 자체가 openmdw-1.1
    expect(mapLicense('other', 'openmdw-1.1')).toBe('OpenMDW-1.1'); // Nemotron: other + license_name
    expect(mapLicense('other', 'lfm1.0')).toBe('LFM Open License 1.0');
    expect(classifyLicense('OpenMDW-1.1')).toBe('permissive');
    expect(classifyLicense('LFM Open License 1.0')).toBe('custom');
  });

  it('passes unknown names through (the badge test then asks a human to classify them)', () => {
    expect(mapLicense('other', 'acme-2.0')).toBe('acme-2.0');
    expect(mapLicense('other')).toBe('other');
    expect(mapLicense('apache-2.0', 'ignored')).toBe('Apache-2.0');
  });
});

describe('classifyArch — Gemma 3 style sliding_window_pattern without layer_types (10-01)', () => {
  const gemma3 = (layers: number, kvHeads: number, headDim: number) => ({
    model_type: 'gemma3',
    text_config: {
      model_type: 'gemma3_text',
      num_hidden_layers: layers,
      num_attention_heads: kvHeads * 2,
      num_key_value_heads: kvHeads,
      head_dim: headDim,
      max_position_embeddings: 131072,
      sliding_window: 1024,
      sliding_window_pattern: 6,
    },
    vision_config: {},
  });

  it.each([
    ['gemma-3-12b', 48, 8, 256, 65_536],
    ['gemma-3-27b', 62, 16, 128, 81_920],
  ] as const)('%s matches the catalog KV record', (_id, layers, kvHeads, headDim, kv) => {
    const r = classifyArch(gemma3(layers, kvHeads, headDim));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.attnType).toBe('swa');
    expect(r.override?.kvBytesPerTokenF16).toBe(kv);
    expect(r.vision).toBe(true);
  });

  it('still refuses every-layer sliding windows without a pattern', () => {
    const cfg = { model_type: 'mistral', num_hidden_layers: 32, num_attention_heads: 32, num_key_value_heads: 8, hidden_size: 4096, max_position_embeddings: 32768, sliding_window: 4096 };
    expect(classifyArch(cfg).kind).toBe('unsupported');
  });
});

describe('classifyArch — Gemma 4 E4B·E2B: per-layer embedding table and KV-shared layers (10-21 D112)', () => {
  // google/gemma-4-E4B-it · E2B-it config.json 의 text_config 구조 값 그대로(2026-10-21 확인). 전체 어텐션 층 = (i + 1) % 6 == 0(E4B)·% 5(E2B),
  // num_global_key_value_heads 는 null 이라 KV 헤드는 num_key_value_heads, 전체 어텐션 층 head_dim 은 global_head_dim 512
  const config = (text: Record<string, unknown>) => ({ model_type: 'gemma4', architectures: ['Gemma4ForConditionalGeneration'], text_config: text, vision_config: {}, audio_config: {} });

  it('E4B: KV only on the 4 full-attention layers inside the first 42 − 18 = 24 layers → 4 × 2 × 512 × 4 = 16,384 B/token (counting all 7 would be 28,672)', () => {
    const r = classifyArch(config(GEMMA4_E4B_TEXT));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r).toMatchObject({ modelType: 'gemma4_text', attnType: 'swa', ple: true, vision: true, maxContext: 131072 });
    expect(r.moe).toBeUndefined();
    expect(r.arch).toEqual({ layers: 42, kvHeads: 2, headDim: 256, kvBytesPerTokenF16: 16_384 });
    expect(r.override?.kvBytesPerTokenF16).toBe(16_384);
    expect(r.override?.reason).toContain('full attn 4/42');
    expect(r.override?.reason).toContain('num_kv_shared_layers');
    // 산식 근거 — llama.cpp 가 KV 를 두는 층(고정 커밋)
    expect(r.override?.refs).toEqual([
      expect.stringMatching(/^https:\/\/github\.com\/ggml-org\/llama\.cpp\/blob\/[0-9a-f]{40}\/src\/models\/gemma4\.cpp#L8-L11$/),
      expect.stringMatching(/llama-hparams\.cpp#L321-L332$/),
      expect.stringMatching(/llama-kv-cache\.cpp#L165-L169$/),
    ]);
  });

  it('E2B: 3 full-attention layers inside the first 35 − 20 = 15 layers → 3 × 1 × 512 × 4 = 6,144 B/token (counting all 7 would be 14,336)', () => {
    const r = classifyArch(config(GEMMA4_E2B_TEXT));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r).toMatchObject({ attnType: 'swa', ple: true, arch: { layers: 35, kvHeads: 1, headDim: 256, kvBytesPerTokenF16: 6_144 } });
    expect(r.override?.reason).toContain('full attn 3/35');
  });

  it('the KV-shared count changes the stored KV only through the layer prefix (no sharing → all 7 full layers)', () => {
    const r = classifyArch(config({ ...GEMMA4_E4B_TEXT, num_kv_shared_layers: 0 }));
    expect(r.kind === 'ok' && r.arch.kvBytesPerTokenF16).toBe(7 * 2 * 512 * 4);
    const noPle = classifyArch(config({ ...GEMMA4_E4B_TEXT, hidden_size_per_layer_input: 0 }));
    expect(noPle.kind === 'ok' && noPle.ple).toBeUndefined();
  });

  it('buildHfModel (calculator out-of-catalog path) still refuses per-layer embedding models — rows there carry no header measurement', () => {
    const r = buildHfModel({
      hfId: 'google/gemma-4-E4B-it',
      ggufRepo: 'unsloth/gemma-4-E4B-it-GGUF',
      config: config(GEMMA4_E4B_TEXT),
      tree: [file('gemma-4-E4B-it-Q4_K_M.gguf', 4.98)],
      info: { paramsB: 8 },
    });
    expect(r).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('PLE') });
  });
});

describe('classifyArch — Gemma 4 per-layer embedding and KV-sharing keys set to 0 (10-16 D98)', () => {
  it('Gemma 4 31B config (PLE 0, no KV-shared layers) still passes with the catalog KV record', () => {
    // google/gemma-4-31B-it config.json 그대로의 구조 값 — E 계열만 두 값이 0 보다 크다(위 refuses 표)
    const cfg = {
      model_type: 'gemma4',
      text_config: {
        model_type: 'gemma4_text',
        num_hidden_layers: 60,
        num_attention_heads: 32,
        num_key_value_heads: 16,
        num_global_key_value_heads: 4,
        head_dim: 256,
        global_head_dim: 512,
        max_position_embeddings: 262144,
        sliding_window: 1024,
        hidden_size_per_layer_input: 0,
        num_kv_shared_layers: 0,
        layer_types: Array.from({ length: 60 }, (_, i) => ((i + 1) % 6 === 0 ? 'full_attention' : 'sliding_attention')),
      },
      vision_config: {},
    };
    const r = classifyArch(cfg);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.attnType).toBe('swa');
    expect(r.override?.kvBytesPerTokenF16).toBe(81_920); // 카탈로그 gemma-4-31b — 10 × 4 × 512 × 4
  });
});

describe('browser limits (10-01 review)', () => {
  it('measureSplit refuses too many shards before fetching anything', async () => {
    let calls = 0;
    const f: FetchLike = async () => {
      calls += 1;
      return new Response(new Uint8Array(0), { status: 206 });
    };
    await expect(measureSplit('org/m-GGUF', 'm-Q4_K_M-00001-of-00300.gguf', { fetch: f, maxShards: 16 })).rejects.toThrow(/too many shards/);
    expect(calls).toBe(0);
  });

  it('buildHfModel validates the rounded parameter counts (a 0.004B model would reach the engine as 0)', () => {
    const tiny = buildHfModel({
      hfId: 'org/Tiny',
      ggufRepo: 'org/Tiny-GGUF',
      config: { model_type: 'qwen3', num_hidden_layers: 2, num_attention_heads: 2, num_key_value_heads: 1, head_dim: 64, max_position_embeddings: 2048 },
      tree: [file('Tiny-Q4_K_M.gguf', 0.003)],
      info: { paramsB: 0.004 },
    });
    expect(tiny.kind).toBe('no-params');
  });
});

describe('classifyArch — K2-Horizon dense and MoVA (k2_horizon, 10-21 D113)', () => {
  // IFM/K2-Horizon-7B · IFM/K2-Horizon-MoVA-36B-A4B config.json 의 구조 값 그대로(2026-10-21 확인)
  const K2_7B = {
    architectures: ['K2HorizonForCausalLM'], model_type: 'k2_horizon', attention_gate_func: null, decoder_sparse_step: 1,
    head_dim: 128, hidden_size: 4096, intermediate_size: 12288, layernorm_num_groups: 4, max_position_embeddings: 524288,
    mlp_only_layers: Array.from({ length: 36 }, (_, i) => i), moe_intermediate_size: 0, mova_num_experts: 0, mova_num_experts_per_tok: 0,
    num_attention_heads: 32, num_experts: 0, num_experts_per_tok: 0, num_hidden_layers: 36, num_key_value_heads: 8, num_shared_experts: 0,
    sliding_window: null, use_sliding_window: false, tie_word_embeddings: false, vocab_size: 250624,
  };
  const K2_MOVA = {
    architectures: ['K2HorizonForCausalLM'], model_type: 'k2_horizon', attention_gate_func: 'softplus', decoder_sparse_step: 1,
    head_dim: 128, hidden_size: 2560, intermediate_size: 6144, layernorm_num_groups: 2, max_position_embeddings: 524288,
    mlp_only_layers: [0, 1, 2], moe_intermediate_size: 768, mova_num_experts: 64, mova_num_experts_per_tok: 4,
    num_attention_heads: 32, num_experts: 100, num_experts_per_tok: 8, num_hidden_layers: 48, num_key_value_heads: 8, num_shared_experts: 1,
    sliding_window: null, use_sliding_window: false, tie_word_embeddings: false, vocab_size: 250624,
  };

  it('7B: plain GQA dense — every layer full attention, 36 × 8 × 128 × 4 = 147,456 B/token, no MoE fields or extra sources', () => {
    const r = okArch(K2_7B);
    expect(r).toMatchObject({ modelType: 'k2_horizon', attnType: 'full', vision: false, maxContext: 524288 });
    expect(r.arch).toEqual({ layers: 36, kvHeads: 8, headDim: 128, kvBytesPerTokenF16: 147_456 });
    expect(r.moe).toBeUndefined();
    expect(r.mova).toBeUndefined();
    expect(r.expertLayers).toBeUndefined();
    expect(r.refs).toBeUndefined();
    expect(r.override).toBeUndefined();
  });

  it('MoVA 36B-A4B: MoE 100 × top-8 on the 45 layers after the 3 leading dense layers, value experts 64 × top-4, standard KV 196,608 B/token', () => {
    const r = okArch(K2_MOVA);
    expect(r).toMatchObject({ attnType: 'full', moe: { experts: 100, topK: 8 }, mova: { experts: 64, topK: 4 } });
    // 값 전문가 합이 표준 V 와 같은 모양이라 KV 는 기본식 — 48 × 8 × 128 × 4
    expect(r.arch).toEqual({ layers: 48, kvHeads: 8, headDim: 128, kvBytesPerTokenF16: 196_608 });
    expect(r.expertLayers).toEqual(Array.from({ length: 45 }, (_, i) => i + 3));
    // 근거는 머지 커밋에 고정한 llama.cpp 소스
    expect(r.refs?.length).toBeGreaterThan(0);
    for (const url of r.refs ?? []) expect(url).toMatch(/^https:\/\/github\.com\/ggml-org\/llama\.cpp\/blob\/4625240437c6821ee5c2da99e12d4817c6a8f07f\//);
  });

  it('a K2-Horizon MoE without value experts (375B-A23B shape) keeps the layer map but no MoVA; num_dense_layers wins over mlp_only_layers', () => {
    const r = okArch({ ...K2_MOVA, attention_gate_func: null, num_hidden_layers: 61, num_experts: 192, mova_num_experts: 0, mova_num_experts_per_tok: 0 });
    expect(r.mova).toBeUndefined();
    expect(r.expertLayers?.[0]).toBe(3);
    expect(r.expertLayers).toHaveLength(58);
    const explicit = okArch({ ...K2_MOVA, num_dense_layers: 0, mlp_only_layers: [] });
    expect(explicit.expertLayers).toBeUndefined(); // 모든 층이 MoE — 균등 근사가 정확
  });

  it.each([
    ['another class', { ...K2_MOVA, architectures: ['K2HorizonModel'] }, 'k2_horizon 변형'],
    ['an attention gate the converter refuses', { ...K2_MOVA, attention_gate_func: 'sigmoid' }, 'softplus'],
    ['value experts without MoE', { ...K2_7B, mova_num_experts: 64, mova_num_experts_per_tok: 4 }, 'MoE 층에만'],
    ['only one of the value-expert counts', { ...K2_MOVA, mova_num_experts_per_tok: 0 }, '하나만'],
    ['value top-k ≥ value experts', { ...K2_MOVA, mova_num_experts_per_tok: 64 }, '≥ 값 전문가'],
    ['an MoE layer step other than 1', { ...K2_MOVA, decoder_sparse_step: 2 }, 'decoder_sparse_step'],
    ['a dense layer after the leading block', { ...K2_MOVA, mlp_only_layers: [0, 1, 2, 10] }, 'mlp_only_layers'],
    ['sliding layers', { ...K2_7B, layer_types: repeat(12, 'sliding_attention', 'sliding_attention', 'full_attention') }, '전체 어텐션'],
  ] as const)('refuses %s', (_name, config, reason) => {
    const r = classifyArch(config);
    expect(r.kind).toBe('unsupported');
    if (r.kind === 'unsupported') expect(r.reason).toContain(reason);
  });

  it('buildHfModel (calculator out-of-catalog path) takes the dense 7B but refuses MoVA — the label and active count need the catalog record', () => {
    const dense = ok(buildHfModel({ hfId: 'IFM/K2-Horizon-7B', ggufRepo: 'IFM/K2-Horizon-7B-GGUF', config: K2_7B, tree: [file('K2-Horizon-7B-Q4_K_M.gguf', 5.59)], info: { paramsB: 9.0 } }));
    expect(dense.model.arch).toMatchObject({ attnType: 'full', kvBytesPerTokenF16: 147_456 });
    const mova = buildHfModel({
      hfId: 'IFM/K2-Horizon-MoVA-36B-A4B', ggufRepo: 'IFM/K2-Horizon-MoVA-36B-A4B-GGUF', config: K2_MOVA,
      tree: [file('K2-Horizon-MoVA-36B-A4B-Q4_K_M.gguf', 22.37)], info: { paramsB: 37.44 },
    });
    expect(mova).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('MoVA') });
  });
});

describe('classifySplit — MoVA value experts stay on the GPU (10-21 D113)', () => {
  const Q4_K = 12;
  const F32 = 0;
  const header: GgufHeader = {
    version: 3,
    kv: { 'general.architecture': 'k2-horizon', 'k2-horizon.block_count': 2, 'k2-horizon.expert_count': 4, 'k2-horizon.expert_used_count': 2 },
    tensors: [
      { name: 'token_embd.weight', dims: [256, 4], type: Q4_K }, // 576 — CPU
      { name: 'output.weight', dims: [256, 4], type: Q4_K }, // 576
      { name: 'blk.0.attn_v.weight', dims: [256, 2], type: Q4_K }, // 288 — 앞 dense 층의 표준 V
      { name: 'blk.1.attn_v_gate.weight', dims: [256, 4], type: Q4_K }, // 576 — 값 라우터
      { name: 'blk.1.attn_v_exps.weight', dims: [256, 2, 4], type: Q4_K }, // 1152 — 값 전문가
      { name: 'blk.1.ffn_gate_exps.weight', dims: [256, 2, 4], type: Q4_K }, // 1152 — FFN 전문가
      { name: 'blk.1.ffn_gate_inp.weight', dims: [8, 4], type: F32 }, // 128
    ],
    headerBytes: 0,
  };

  it('attn_v_exps counts as non-expert (llama.cpp --n-cpu-moe/--fit move ffn_*_exps only) and is reported separately', () => {
    const m = classifySplit([header]);
    expect(m.bytes.expert).toBe(1152);
    expect(m.bytes.nonExpert).toBe(576 + 288 + 576 + 1152 + 128);
    expect(m.bytes.valueExpert).toBe(1152);
    expect(m.bytes.cpu).toBe(576);
    // 파라미터 수도 FFN 전문가만 전문가로 센다(값 전문가는 total 에만)
    expect(m.expertParams).toBe(256 * 2 * 4);
    expect(m.totalParams).toBe(256 * 4 + 256 * 4 + 256 * 2 + 256 * 4 + 256 * 2 * 4 + 256 * 2 * 4 + 8 * 4);
  });
});

// ---------------------------------------------------------------------------
// DeepSeek V4 Flash — 압축 어텐션(CSA·HCA)·하이퍼 커넥션 (10-22 D115)
// ---------------------------------------------------------------------------

/** deepseek-ai/DeepSeek-V4-Flash-0731 config.json (10-22 — 값 그대로, quantization_config·rope_scaling 일부 생략) */
const DSV4_RATIOS_46 = [0, 0, ...Array.from({ length: 41 }, (_, i) => (i % 2 === 0 ? 4 : 128)), 0, 0, 0];
const DSV4_CONFIG = {
  architectures: ['DeepseekV4ForCausalLM'], attention_bias: false, attention_dropout: 0.0, bos_token_id: 0, eos_token_id: 1, expert_dtype: 'fp4',
  hc_eps: 1e-6, hc_mult: 4, hc_sinkhorn_iters: 20, head_dim: 512, hidden_act: 'silu', hidden_size: 4096, index_head_dim: 128, index_n_heads: 64,
  index_topk: 512, initializer_range: 0.02, max_position_embeddings: 1048576, model_type: 'deepseek_v4', moe_intermediate_size: 2048,
  n_routed_experts: 256, n_shared_experts: 1, norm_topk_prob: true, num_attention_heads: 64, num_experts_per_tok: 6, num_hidden_layers: 43,
  num_hash_layers: 3, num_key_value_heads: 1, num_nextn_predict_layers: 1, o_groups: 8, o_lora_rank: 1024, q_lora_rank: 1024, qk_rope_head_dim: 64,
  quantization_config: { activation_scheme: 'dynamic', fmt: 'e4m3', quant_method: 'fp8' }, rms_norm_eps: 1e-6,
  rope_scaling: { beta_fast: 32, beta_slow: 1, factor: 16, original_max_position_embeddings: 65536, type: 'yarn' }, rope_theta: 10000,
  routed_scaling_factor: 1.5, scoring_func: 'sqrtsoftplus', sliding_window: 128, swiglu_limit: 10.0, tie_word_embeddings: false, topk_method: 'noaux_tc',
  torch_dtype: 'bfloat16', transformers_version: '4.57.1', use_cache: true, vocab_size: 129280, compress_rope_theta: 160000, compress_ratios: DSV4_RATIOS_46,
  dspark_block_size: 5, dspark_noise_token_id: 128799, dspark_target_layer_ids: [40, 41, 42], dspark_markov_rank: 256,
};

describe('classifyArch — DeepSeek V4 compressed attention and hyper-connections (deepseek_v4, 10-22 D115)', () => {
  it('the config of record matches the real compress_ratios (first 43 layers: 0,0 then 4/128 alternating — 21 CSA · 20 HCA)', () => {
    const first = DSV4_RATIOS_46.slice(0, 43);
    expect(DSV4_RATIOS_46).toHaveLength(46);
    expect(first.filter((r) => r === 4)).toHaveLength(21);
    expect(first.filter((r) => r === 128)).toHaveLength(20);
    expect(first.slice(0, 5)).toEqual([0, 0, 4, 128, 4]);
  });

  it('DeepSeek-V4-Flash-0731: compressed, KV = 21 × (512 + 128) × 2 / 4 + 20 × 512 × 2 / 128 = 6,880 B/tok, MoE 256 top-6, mHC, llama.cpp refs', () => {
    const r = classifyArch(DSV4_CONFIG);
    expect(r).toMatchObject({
      kind: 'ok',
      modelType: 'deepseek_v4',
      attnType: 'compressed',
      mhc: true,
      vision: false,
      maxContext: 1048576,
      moe: { experts: 256, topK: 6 },
      arch: { layers: 43, kvHeads: 1, headDim: 512, kvBytesPerTokenF16: 6880 },
    });
    if (r.kind !== 'ok') return;
    expect(r.override?.kvBytesPerTokenF16).toBe(6880);
    expect(r.override?.reason).toContain('CSA(비율 4) 21층');
    expect(r.override?.reason).toContain('HCA(비율 128) 20층');
    expect(r.expertLayers).toBeUndefined(); // 43층 모두 MoE
    expect(r.refs).toEqual(DEEPSEEK_V4_REFS);
    for (const ref of [...(r.refs ?? []), ...(r.override?.refs ?? [])]) {
      expect(ref).toMatch(/^https:\/\/github\.com\/ggml-org\/llama\.cpp\/blob\/0a1ef309cdbb9f2024f58a38fb4c42352c5db569\//);
    }
  });

  it('options left off (null, false, 0, empty) are not "new options"; first_k_dense_replace 0 is fine', () => {
    const r = classifyArch({ ...DSV4_CONFIG, some_future_flag: false, another: null, empty_list: [], first_k_dense_replace: 0, pad_token_id: 1 });
    expect(r).toMatchObject({ kind: 'ok', arch: { kvBytesPerTokenF16: 6880 } });
  });

  it('hc_mult 1 means no hyper-connections — no mhc flag, same KV', () => {
    const r = classifyArch({ ...DSV4_CONFIG, hc_mult: 1 });
    expect(r).toMatchObject({ kind: 'ok', attnType: 'compressed', arch: { kvBytesPerTokenF16: 6880 } });
    if (r.kind === 'ok') expect(r.mhc).toBeUndefined();
  });

  it.each([
    ['an option the llama.cpp converter does not read', { ...DSV4_CONFIG, enable_new_router: true }, '처음 보는 deepseek_v4 옵션(enable_new_router)'],
    ['the vision variant (vision keys)', { ...DSV4_CONFIG, vision_n_layers: 24 }, 'vision_n_layers'],
    ['the vision variant (vision_config)', { ...DSV4_CONFIG, vision_config: { hidden_size: 1024 } }, '비전 변형'],
    ['MLA keys (V3 style)', { ...DSV4_CONFIG, kv_lora_rank: 512 }, 'kv_lora_rank'],
    ['the DSpark drafter class', { ...DSV4_CONFIG, architectures: ['DeepseekV4DSparkModel'] }, 'deepseek_v4 변형'],
    ['a compression ratio the loader rejects', { ...DSV4_CONFIG, compress_ratios: [0, 0, 64, ...DSV4_RATIOS_46.slice(3)] }, '0·4·128 밖'],
    ['compress_ratios shorter than the layer count', { ...DSV4_CONFIG, compress_ratios: DSV4_RATIOS_46.slice(0, 40) }, '짧음'],
    ['no compressed layer at all', { ...DSV4_CONFIG, compress_ratios: Array<number>(46).fill(0) }, '압축 층'],
    ['more than one KV head', { ...DSV4_CONFIG, num_key_value_heads: 8 }, 'KV 헤드 8'],
    ['softmax MoE scoring (the loader takes sqrtsoftplus only)', { ...DSV4_CONFIG, scoring_func: 'softmax' }, 'scoring_func softmax'],
    ['a different top-k method', { ...DSV4_CONFIG, topk_method: 'greedy' }, 'topk_method greedy'],
    ['leading dense layers (llama.cpp reads every block as MoE)', { ...DSV4_CONFIG, first_k_dense_replace: 3 }, 'first_k_dense_replace'],
    ['tied embeddings (the loader needs output.weight)', { ...DSV4_CONFIG, tie_word_embeddings: true }, 'tie_word_embeddings'],
    ['a missing indexer width', { ...DSV4_CONFIG, index_head_dim: undefined }, 'index_head_dim'],
    ['hash layers beyond the layer count', { ...DSV4_CONFIG, num_hash_layers: 50 }, 'num_hash_layers'],
    ['hyper-connections on another known type', { model_type: 'qwen3', hc_mult: 4, num_hidden_layers: 28, num_attention_heads: 16, num_key_value_heads: 8, head_dim: 128, max_position_embeddings: 32768 }, '하이퍼 커넥션'],
  ] as const)('refuses %s', (_name, config, reason) => {
    const r = classifyArch(config);
    expect(r.kind).toBe('unsupported');
    if (r.kind === 'unsupported') expect(r.reason).toContain(reason);
  });

  it('buildHfModel (calculator import) takes the MXFP4 row as the baseline when there is no Q4_K_M, and carries compressed attention and mHC', () => {
    const f = (path: string, size: number): TreeEntry => ({ type: 'file', path, size });
    const tree = [
      f('DeepSeek-V4-Flash-0731-MXFP4-00001-of-00002.gguf', 5_250_752),
      f('DeepSeek-V4-Flash-0731-MXFP4-00002-of-00002.gguf', 154_986_288_576),
      f('DeepSeek-V4-Flash-0731-Q2_K-00001-of-00002.gguf', 5_250_752),
      f('DeepSeek-V4-Flash-0731-Q2_K-00002-of-00002.gguf', 117_344_187_840),
      f('DeepSeek-V4-Flash-0731-Q2_K_S-00001-of-00002.gguf', 5_250_752),
      f('DeepSeek-V4-Flash-0731-Q2_K_S-00002-of-00002.gguf', 98_587_260_352),
      f('dspark-DeepSeek-V4-Flash-0731-MXFP4.gguf', 10_826_882_016),
    ];
    const r = buildHfModel({
      hfId: 'someone/DeepSeek-V4-Flash-Finetune',
      ggufRepo: 'someone/DeepSeek-V4-Flash-Finetune-GGUF',
      config: DSV4_CONFIG,
      tree,
      info: { license: 'mit', paramsB: 284.33 },
      baseSplit: { expertGB: 147.17, nonExpertGB: 7.25, totalParamsB: 284.334567511, expertParamsB: 277.025390592 },
    });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.model.arch).toMatchObject({ attnType: 'compressed', kvBytesPerTokenF16: 6880, experts: 256, topK: 6, mhc: true });
    expect(r.model.activeParamsB).toBe(13.8);
    expect(r.rows.map((row) => [row.quant, row.fileGB, row.fileName])).toEqual([
      ['MXFP4', 154.99, 'DeepSeek-V4-Flash-0731-MXFP4-00001-of-00002.gguf'],
      ['Q2_K', 117.35, 'DeepSeek-V4-Flash-0731-Q2_K-00001-of-00002.gguf'],
    ]);
    expect(r.rows[0]).toMatchObject({ expertGB: 147.17, nonExpertGB: 7.25 });
    expect(r.notes).toContain('kv-full-layers-only');
  });
});
