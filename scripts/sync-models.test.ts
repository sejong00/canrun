/** sync-models 순수 코어 테스트 — 네트워크·fs 없음. 픽스처는 실제 HF 응답 형태를 축약. */
import { describe, expect, it } from 'vitest';
import { parseModelQuants, parseModels } from '../packages/data/src/index';
import type { ConfigResult, TreeEntry } from './hf-common';
import {
  applyChanges,
  buildSyncPlan,
  extractArch,
  matchQuantFiles,
  parseArgs,
  renderReport,
  sumFileGB,
  type Change,
  type SyncInput,
} from './sync-models';

const file = (path: string, size?: number): TreeEntry => ({ type: 'file', path, size });

// --- matchQuantFiles --------------------------------------------------------

describe('matchQuantFiles', () => {
  const flat: TreeEntry[] = [
    file('.gitattributes', 100),
    file('README.md', 200),
    file('Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', 4_920_000_000),
    file('Meta-Llama-3.1-8B-Instruct-Q4_K_L.gguf', 5_000_000_000),
    file('Meta-Llama-3.1-8B-Instruct-Q4_K_M_L.gguf', 5_100_000_000),
    file('mmproj-Meta-Llama-F16.gguf', 800_000_000),
  ];

  it('matches the exact quant token in a flat layout', () => {
    const matched = matchQuantFiles(flat, 'Q4_K_M');
    expect(matched.map((e) => e.path)).toEqual(['Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf']);
  });

  it('sums split shards in per-quant folder layout', () => {
    const folders: TreeEntry[] = [
      { type: 'directory', path: 'Q8_0' },
      file('Q8_0/Model-Q8_0-00001-of-00002.gguf', 30_000_000_000),
      file('Q8_0/Model-Q8_0-00002-of-00002.gguf', 12_520_000_000),
    ];
    const matched = matchQuantFiles(folders, 'Q8_0');
    expect(matched).toHaveLength(2);
    expect(sumFileGB(matched)).toBe(42.52);
  });

  it('matches lowercase native quant names (mxfp4)', () => {
    const entries = [file('gpt-oss-20b-mxfp4.gguf', 12_110_000_000)];
    expect(matchQuantFiles(entries, 'MXFP4')).toHaveLength(1);
  });

  it('rejects near-miss quant names (prefix/suffix variants)', () => {
    expect(matchQuantFiles([file('m-IQ2_M_L.gguf', 1)], 'IQ2_M')).toHaveLength(0);
    expect(matchQuantFiles([file('m-XQ2_K.gguf', 1)], 'Q2_K')).toHaveLength(0);
  });

  it('separates UD variants from their base quants (합산 오염 방지)', () => {
    const both = [file('m-IQ2_M.gguf', 1_000_000_000), file('m-UD-IQ2_M.gguf', 2_000_000_000)];
    expect(matchQuantFiles(both, 'IQ2_M').map((e) => e.path)).toEqual(['m-IQ2_M.gguf']);
    expect(matchQuantFiles(both, 'UD-IQ2_M').map((e) => e.path)).toEqual(['m-UD-IQ2_M.gguf']);
    expect(matchQuantFiles([file('m-UD-Q2_K_XL.gguf', 1)], 'Q2_K')).toHaveLength(0);
    expect(matchQuantFiles([file('m-UD-Q2_K_XL.gguf', 1)], 'UD-Q2_K_XL')).toHaveLength(1);
  });

  it('falls back to the UD variant when only UD is deployed (unsloth MTP repos)', () => {
    const udOnly = [file('m-UD-Q4_K_M.gguf', 22_630_000_000)];
    expect(matchQuantFiles(udOnly, 'Q4_K_M').map((e) => e.path)).toEqual(['m-UD-Q4_K_M.gguf']);
  });

  it('excludes mmproj weights and non-gguf files', () => {
    expect(matchQuantFiles(flat, 'F16')).toHaveLength(0); // mmproj-…-F16.gguf 제외
    expect(matchQuantFiles([file('notes-Q4_K_M.txt', 1)], 'Q4_K_M')).toHaveLength(0);
  });
});

describe('sumFileGB', () => {
  it('sums bytes as decimal GB rounded to 2dp', () => {
    expect(sumFileGB([file('a.gguf', 4_918_000_000)])).toBe(4.92);
  });

  it('returns NaN when a matched entry has no size', () => {
    expect(Number.isNaN(sumFileGB([file('a.gguf')]))).toBe(true);
  });
});

// --- extractArch ------------------------------------------------------------

describe('extractArch', () => {
  it('derives head_dim from hidden_size / num_attention_heads (llama 계열)', () => {
    const config = {
      num_hidden_layers: 32,
      num_attention_heads: 32,
      num_key_value_heads: 8,
      hidden_size: 4096,
      max_position_embeddings: 131072,
    };
    expect(extractArch(config)).toEqual({
      arch: { layers: 32, kvHeads: 8, headDim: 128 },
      maxContext: 131072,
      missing: [],
    });
  });

  it('prefers text_config for multimodal wrappers (gemma-3 계열)', () => {
    const config = {
      model_type: 'gemma3',
      text_config: {
        num_hidden_layers: 48,
        num_attention_heads: 16,
        num_key_value_heads: 8,
        head_dim: 256,
        max_position_embeddings: 131072,
      },
    };
    expect(extractArch(config).arch).toEqual({ layers: 48, kvHeads: 8, headDim: 256 });
  });

  it('falls back kvHeads to num_attention_heads (MHA)', () => {
    const config = { num_hidden_layers: 24, num_attention_heads: 16, head_dim: 64 };
    expect(extractArch(config).arch?.kvHeads).toBe(16);
  });

  it('reports missing fields instead of guessing', () => {
    const res = extractArch({ num_attention_heads: 32 });
    expect(res.arch).toBeUndefined();
    expect(res.missing).toContain('num_hidden_layers');
    expect(res.missing).toContain('head_dim');
  });
});

// --- buildSyncPlan ----------------------------------------------------------

/** 시드와 같은 raw 형태로 만들고 zod 파싱본과 짝지어 SyncInput 구성. */
function makeInput(opts: {
  models: Record<string, unknown>[];
  quants: Record<string, unknown>[];
  treeByRepo?: Map<string, TreeEntry[] | { error: string }>;
  configByHfId?: Map<string, ConfigResult>;
}): SyncInput {
  return {
    rawModels: opts.models,
    rawQuants: opts.quants,
    models: parseModels(opts.models),
    quants: parseModelQuants(opts.quants),
    treeByRepo: opts.treeByRepo ?? new Map(),
    configByHfId: opts.configByHfId ?? new Map(),
  };
}

const fullModel = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'test-8b',
  family: 'test',
  name: 'Test 8B',
  hfId: 'org/test-8b',
  paramsB: 8,
  arch: { layers: 32, kvHeads: 8, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 131072 },
  maxContext: 131072,
  license: 'Apache-2.0',
  moe: false,
  category: ['chat'],
  popularity: 3,
  releasedAt: '2025-01-01',
  sources: ['https://huggingface.co/org/test-8b'],
  ...over,
});

const quantRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  modelId: 'test-8b',
  quant: 'Q4_K_M',
  fileGB: 4.92,
  ggufRepo: 'org/test-8b-GGUF',
  sources: ['https://huggingface.co/org/test-8b-GGUF'],
  ...over,
});

describe('buildSyncPlan — fileGB', () => {
  const tree = (gb: number): Map<string, TreeEntry[]> =>
    new Map([[
      'org/test-8b-GGUF',
      [file('test-8b-Q4_K_M.gguf', Math.round(gb * 1e9))],
    ]]);

  it('emits auto for a small drift with deltaPct', () => {
    const input = makeInput({ models: [fullModel()], quants: [quantRow()], treeByRepo: tree(5.02) });
    const changes = buildSyncPlan(input).filter((c) => c.field === 'fileGB');
    expect(changes).toEqual([
      expect.objectContaining({ id: 'test-8b/Q4_K_M', old: 4.92, next: 5.02, kind: 'auto' }),
    ]);
    expect(changes[0]?.deltaPct).toBeCloseTo(2.03, 2);
  });

  it('flags >5% drift as suspicious (적용은 하되 리뷰 표기)', () => {
    const input = makeInput({ models: [fullModel()], quants: [quantRow()], treeByRepo: tree(6.0) });
    const change = buildSyncPlan(input).find((c) => c.field === 'fileGB');
    expect(change?.kind).toBe('suspicious');
  });

  it('emits no fileGB change when size matches after rounding', () => {
    const input = makeInput({ models: [fullModel()], quants: [quantRow()], treeByRepo: tree(4.92) });
    expect(buildSyncPlan(input).filter((c) => c.field === 'fileGB')).toHaveLength(0);
  });

  it('errors loudly on zero-match and on tree fetch failure', () => {
    const emptyTree = new Map<string, TreeEntry[] | { error: string }>([
      ['org/test-8b-GGUF', [file('other-Q8_0.gguf', 1)]],
    ]);
    const failedTree = new Map<string, TreeEntry[] | { error: string }>([
      ['org/test-8b-GGUF', { error: 'HTTP 500' }],
    ]);
    for (const treeByRepo of [emptyTree, failedTree]) {
      const input = makeInput({ models: [fullModel()], quants: [quantRow()], treeByRepo });
      expect(buildSyncPlan(input).some((c) => c.kind === 'error')).toBe(true);
    }
  });

  it('adds the ggufRepo source URL when missing (규칙 2)', () => {
    const input = makeInput({
      models: [fullModel()],
      quants: [quantRow({ sources: ['https://example.com/elsewhere'] })],
      treeByRepo: tree(4.92),
    });
    const change = buildSyncPlan(input).find((c) => c.field === 'sources');
    expect(change).toEqual(
      expect.objectContaining({ kind: 'auto', next: 'https://huggingface.co/org/test-8b-GGUF' }),
    );
  });
});

describe('buildSyncPlan — MoE nonExpertGB 연쇄', () => {
  // MOE_ARCH 에 실재하는 id 사용 (qwen3-30b-a3b-2507: total 30.5, active 3.3, 128E top-8)
  const moeModel = fullModel({
    id: 'qwen3-30b-a3b-2507',
    hfId: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
    paramsB: 30.5,
    activeParamsB: 3.3,
    moe: true,
    nonExpertGB: 0.91,
    arch: { layers: 48, kvHeads: 4, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 98304 },
    sources: ['https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507'],
  });
  const moeQuant = quantRow({
    modelId: 'qwen3-30b-a3b-2507',
    fileGB: 18.6,
    ggufRepo: 'unsloth/Qwen3-30B-A3B-GGUF',
    sources: ['https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF'],
  });

  it('recomputes nonExpertGB when the base quant size shifts beyond tolerance', () => {
    const input = makeInput({
      models: [moeModel],
      quants: [moeQuant],
      treeByRepo: new Map([[
        'unsloth/Qwen3-30B-A3B-GGUF',
        [file('m-Q4_K_M.gguf', 20_000_000_000)],
      ]]),
    });
    const change = buildSyncPlan(input).find((c) => c.field === 'nonExpertGB');
    // derive: E = 27.2/0.9375 ≈ 29.013B, N ≈ 1.487B → 1.487 × (20 / 30.5) ≈ 0.97
    expect(change).toEqual(
      expect.objectContaining({ file: 'models.json', kind: 'auto', old: 0.91, next: 0.97 }),
    );
  });

  it('stays silent within the 0.02GB validateAll tolerance', () => {
    const input = makeInput({
      models: [moeModel],
      quants: [moeQuant],
      treeByRepo: new Map([[
        'unsloth/Qwen3-30B-A3B-GGUF',
        [file('m-Q4_K_M.gguf', 18_600_000_000)],
      ]]),
    });
    expect(buildSyncPlan(input).filter((c) => c.field === 'nonExpertGB')).toHaveLength(0);
  });

  it('reports manual for MoE models without MOE_ARCH (근거 없는 상수 금지)', () => {
    const undocumented = fullModel({ id: 'mystery-moe', moe: true, activeParamsB: 4 });
    const input = makeInput({ models: [undocumented], quants: [] });
    const change = buildSyncPlan(input).find((c) => c.field === 'nonExpertGB');
    expect(change?.kind).toBe('manual');
  });
});

describe('buildSyncPlan — config/arch', () => {
  const llamaConfig: ConfigResult = {
    config: {
      num_hidden_layers: 32,
      num_attention_heads: 32,
      num_key_value_heads: 8,
      hidden_size: 4096,
      max_position_embeddings: 131072,
    },
  };

  it('auto-applies arch diffs + recomputed KV for full-attention models', () => {
    const stale = fullModel({
      arch: { layers: 30, kvHeads: 8, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 122880 },
    });
    const input = makeInput({
      models: [stale],
      quants: [],
      configByHfId: new Map([['org/test-8b', llamaConfig]]),
    });
    const changes = buildSyncPlan(input);
    expect(changes.find((c) => c.field === 'arch.layers')).toEqual(
      expect.objectContaining({ old: 30, next: 32, kind: 'auto' }),
    );
    expect(changes.find((c) => c.field === 'arch.kvBytesPerTokenF16')).toEqual(
      expect.objectContaining({ old: 122880, next: 131072, kind: 'auto' }),
    );
  });

  it('never auto-touches non-full models — reference values go manual', () => {
    const hybrid = fullModel({
      arch: { layers: 30, kvHeads: 8, headDim: 128, attnType: 'hybrid', kvBytesPerTokenF16: 32768 },
    });
    const input = makeInput({
      models: [hybrid],
      quants: [],
      configByHfId: new Map([['org/test-8b', llamaConfig]]),
    });
    const changes = buildSyncPlan(input);
    expect(changes.every((c) => c.kind !== 'auto')).toBe(true);
    const kvRef = changes.find((c) => c.field === 'arch.kvBytesPerTokenF16');
    expect(kvRef?.kind).toBe('manual');
    expect(kvRef?.note).toContain('131072'); // full-attn 공식 참조값
  });

  it('suppresses the KV reference row once attnOverrides is set (주간 PR 노이즈 제거)', () => {
    const locked = fullModel({
      arch: { layers: 32, kvHeads: 8, headDim: 128, attnType: 'hybrid', kvBytesPerTokenF16: 32768 },
      attnOverrides: {
        kvBytesPerTokenF16: 32768,
        reason: 'hybrid — full attn 8/32 layers',
        sources: ['https://example.com/config'],
      },
    });
    const input = makeInput({
      models: [locked],
      quants: [],
      configByHfId: new Map([['org/test-8b', llamaConfig]]),
    });
    const changes = buildSyncPlan(input);
    expect(changes.find((c) => c.field === 'arch.kvBytesPerTokenF16')).toBeUndefined();
  });

  it('reports gated configs as skipped, fetch errors as error', () => {
    const input = makeInput({
      models: [fullModel(), fullModel({ id: 'test-err', hfId: 'org/err', name: 'E' })],
      quants: [],
      configByHfId: new Map<string, ConfigResult>([
        ['org/test-8b', { gated: true }],
        ['org/err', { error: 'HTTP 500' }],
      ]),
    });
    const kinds = buildSyncPlan(input).map((c) => c.kind);
    expect(kinds).toContain('skipped');
    expect(kinds).toContain('error');
  });

  it('reports maxContext drift as manual (큐레이션 값 보호)', () => {
    const yarnModel = fullModel({ maxContext: 32768 });
    const input = makeInput({
      models: [yarnModel],
      quants: [],
      configByHfId: new Map([['org/test-8b', llamaConfig]]),
    });
    const change = buildSyncPlan(input).find((c) => c.field === 'maxContext');
    expect(change).toEqual(expect.objectContaining({ old: 32768, next: 131072, kind: 'manual' }));
  });
});

// --- applyChanges / renderReport / parseArgs --------------------------------

describe('applyChanges', () => {
  it('applies auto+suspicious only, preserving raw key order', () => {
    const rawQuant = quantRow();
    const rawModel = fullModel();
    const input = makeInput({ models: [rawModel], quants: [rawQuant] });
    const changes: Change[] = [
      { file: 'model-quants.json', id: 'test-8b/Q4_K_M', field: 'fileGB', old: 4.92, next: 5.1, kind: 'suspicious' },
      { file: 'model-quants.json', id: 'test-8b/Q4_K_M', field: 'sources', next: 'https://huggingface.co/x', kind: 'auto' },
      { file: 'models.json', id: 'test-8b', field: 'arch.layers', old: 32, next: 36, kind: 'auto' },
      { file: 'models.json', id: 'test-8b', field: 'maxContext', old: 131072, next: 999, kind: 'manual' },
    ];
    const before = Object.keys(rawQuant);
    applyChanges(changes, input);
    expect(rawQuant['fileGB']).toBe(5.1);
    expect(rawQuant['sources']).toContain('https://huggingface.co/x');
    expect((rawModel['arch'] as Record<string, unknown>)['layers']).toBe(36);
    expect(rawModel['maxContext']).toBe(131072); // manual 은 미반영
    expect(Object.keys(rawQuant)).toEqual(before);
  });
});

describe('renderReport', () => {
  it('renders grouped markdown tables with a summary line', () => {
    const changes: Change[] = [
      { file: 'model-quants.json', id: 'a/Q4_K_M', field: 'fileGB', old: 4.92, next: 5.02, deltaPct: 2.03, kind: 'auto' },
      { file: 'models.json', id: 'b', field: 'config', kind: 'skipped', note: 'gated' },
    ];
    const report = renderReport(changes);
    expect(report).toContain('## model-quants.json');
    expect(report).toContain('| a/Q4_K_M | fileGB | 4.92 | 5.02 | +2.03% | auto |');
    expect(report).toContain('1 auto, 0 suspicious, 0 manual, 1 skipped, 0 error');
  });
});

describe('parseArgs', () => {
  it('parses --dry, --report, --only', () => {
    expect(parseArgs(['--dry', '--report', 'r.md', '--only', 'llama-3.1-8b'])).toEqual({
      dry: true,
      report: 'r.md',
      only: 'llama-3.1-8b',
    });
  });

  it('rejects unknown flags and missing values', () => {
    expect(() => parseArgs(['--nope'])).toThrow('unknown argument');
    expect(() => parseArgs(['--report'])).toThrow('requires a value');
    expect(() => parseArgs(['--report', '--dry'])).toThrow('requires a value');
  });
});
