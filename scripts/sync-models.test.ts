/** sync-models 순수 코어 테스트 — 네트워크·fs 없음. 픽스처는 실제 HF 응답 형태를 축약. */
import { describe, expect, it } from 'vitest';
import { parseModelQuants, parseModels } from '../packages/data/src/index';
import type { ConfigResult, TreeEntry } from './hf-common';
import {
  applyChanges,
  applyDownloads,
  buildSyncPlan,
  extractArch,
  extractMoe,
  matchQuantFiles,
  parseArgs,
  planDownloads,
  planSplitChanges,
  renderReport,
  sumFileGB,
  type Change,
  type MeasureSplitFn,
  type MeasuredSplit,
  type SyncInput,
  primaryFile,
  withKeyAfter,
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

  it('excludes draft heads (mtp-*, eagle3-*) by basename prefix only — repo names with MTP are unaffected', () => {
    const entries = [
      file('MTP/mtp-gemma-4-12b-it-Q8_0.gguf', 470_000_000),
      file('mtp-gemma-4-12b-it.gguf', 460_000_000),
      file('eagle3-gpt-oss-20b-Q8_0.gguf', 920_000_000),
      file('gemma-4-12b-it-Q8_0.gguf', 12_670_000_000),
      file('Qwen3.5-9B-MTP-Q8_0.gguf', 9_790_000_000),
    ];
    expect(matchQuantFiles(entries, 'Q8_0').map((e) => e.path)).toEqual([
      'gemma-4-12b-it-Q8_0.gguf',
      'Qwen3.5-9B-MTP-Q8_0.gguf',
    ]);
  });

  it('excludes mmproj weights and non-gguf files', () => {
    expect(matchQuantFiles(flat, 'F16')).toHaveLength(0); // mmproj-…-F16.gguf 제외
    expect(matchQuantFiles([file('notes-Q4_K_M.txt', 1)], 'Q4_K_M')).toHaveLength(0);
  });
});

describe('primaryFile', () => {
  it('returns the single file with shards 1', () => {
    expect(primaryFile([file('a-Q4_K_M.gguf', 1)])).toEqual({ path: 'a-Q4_K_M.gguf', shards: 1 });
  });

  it('returns the 00001 shard of a consistent split set', () => {
    const shards = [
      file('Q8_0/a-Q8_0-00002-of-00003.gguf', 1),
      file('Q8_0/a-Q8_0-00001-of-00003.gguf', 1),
      file('Q8_0/a-Q8_0-00003-of-00003.gguf', 1),
    ];
    expect(primaryFile(shards)).toEqual({ path: 'Q8_0/a-Q8_0-00001-of-00003.gguf', shards: 3 });
  });

  it('reports ambiguity for non-shard multiples or incomplete shard sets', () => {
    expect(primaryFile([file('a-Q8_0.gguf', 1), file('b-Q8_0.gguf', 1)])).toEqual({
      error: 'ambiguous match: a-Q8_0.gguf, b-Q8_0.gguf',
    });
    expect('error' in primaryFile([file('a-00001-of-00003.gguf', 1), file('a-00002-of-00003.gguf', 1)])).toBe(true);
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

describe('buildSyncPlan — fileName (P1-2)', () => {
  it('records the real file name as auto when missing or different, silent when equal', () => {
    const treeByRepo = new Map([['org/test-8b-GGUF', [file('test-8b-Q4_K_M.gguf', 4_920_000_000)]]]);
    const missing = makeInput({ models: [fullModel()], quants: [quantRow()], treeByRepo });
    expect(buildSyncPlan(missing).filter((c) => c.field === 'fileName')).toEqual([
      expect.objectContaining({ id: 'test-8b/Q4_K_M', old: undefined, next: 'test-8b-Q4_K_M.gguf', kind: 'auto' }),
    ]);
    const same = makeInput({
      models: [fullModel()],
      quants: [quantRow({ fileName: 'test-8b-Q4_K_M.gguf' })],
      treeByRepo,
    });
    expect(buildSyncPlan(same).filter((c) => c.field === 'fileName')).toHaveLength(0);
  });

  it('notes shard count and errors on ambiguous matches', () => {
    const sharded = new Map([[
      'org/test-8b-GGUF',
      [file('Q4_K_M/test-8b-Q4_K_M-00001-of-00002.gguf', 2_000_000_000), file('Q4_K_M/test-8b-Q4_K_M-00002-of-00002.gguf', 2_920_000_000)],
    ]]);
    const change = buildSyncPlan(makeInput({ models: [fullModel()], quants: [quantRow()], treeByRepo: sharded })).find((c) => c.field === 'fileName');
    expect(change).toEqual(expect.objectContaining({ next: 'Q4_K_M/test-8b-Q4_K_M-00001-of-00002.gguf', note: '2개 분할(첫 조각)' }));
    const ambiguous = new Map([[
      'org/test-8b-GGUF',
      [file('test-8b-Q4_K_M.gguf', 1), file('test-8b-Q4_K_M-imatrix.gguf', 1)],
    ]]);
    const errors = buildSyncPlan(makeInput({ models: [fullModel()], quants: [quantRow()], treeByRepo: ambiguous }));
    expect(errors.some((c) => c.kind === 'error' && c.field === 'fileName')).toBe(true);
    expect(errors.some((c) => c.field === 'fileGB')).toBe(false);
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

describe('applyChanges — fileName 삽입 위치', () => {
  it('inserts fileName right after ggufRepo when absent, updates in place when present', () => {
    const rawQuant = quantRow();
    const input = makeInput({ models: [fullModel()], quants: [rawQuant] });
    applyChanges(
      [{ file: 'model-quants.json', id: 'test-8b/Q4_K_M', field: 'fileName', next: 'test-8b-Q4_K_M.gguf', kind: 'auto' }],
      input,
    );
    expect(Object.keys(input.rawQuants[0]!)).toEqual(['modelId', 'quant', 'fileGB', 'ggufRepo', 'fileName', 'sources']);
    applyChanges(
      [{ file: 'model-quants.json', id: 'test-8b/Q4_K_M', field: 'fileName', old: 'test-8b-Q4_K_M.gguf', next: 'x.gguf', kind: 'auto' }],
      input,
    );
    expect(input.rawQuants[0]!['fileName']).toBe('x.gguf');
    expect(withKeyAfter({ a: 1, c: 3 }, 'b', 2, 'a')).toEqual({ a: 1, b: 2, c: 3 });
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

describe('downloads — planDownloads / applyDownloads / report line (10-06 D68)', () => {
  const twoModels = () => [fullModel(), fullModel({ id: 'other-1b', hfId: 'org/other-1b', name: 'O', sources: ['https://huggingface.co/org/other-1b'] })];

  it('writes the count and date right after popularity, updates in place next week', () => {
    const input = makeInput({ models: twoModels(), quants: [quantRow()] });
    const plan = planDownloads(input.models, new Map([['org/test-8b', { downloads: 1200 }], ['org/other-1b', { downloads: 0 }]]), '2026-10-06');
    expect(plan).toEqual({ asOf: '2026-10-06', updates: [{ id: 'test-8b', downloads: 1200 }, { id: 'other-1b', downloads: 0 }], failed: [] });
    applyDownloads(plan, input);
    const keys = Object.keys(input.rawModels[0]!);
    expect(keys.slice(keys.indexOf('popularity'), keys.indexOf('popularity') + 4)).toEqual(['popularity', 'hfDownloads30d', 'hfDownloadsAsOf', 'releasedAt']);
    expect(parseModels(input.rawModels).map((m) => [m.hfDownloads30d, m.hfDownloadsAsOf])).toEqual([[1200, '2026-10-06'], [0, '2026-10-06']]);

    const next = makeInput({ models: input.rawModels, quants: [quantRow()] });
    applyDownloads(planDownloads(next.models, new Map([['org/test-8b', { downloads: 1500 }]]), '2026-10-13'), next);
    expect(Object.keys(next.rawModels[0]!)).toEqual(keys);
    expect(next.rawModels[0]).toMatchObject({ hfDownloads30d: 1500, hfDownloadsAsOf: '2026-10-13' });
    expect(next.rawModels[1]).toMatchObject({ hfDownloads30d: 0, hfDownloadsAsOf: '2026-10-06' }); // 이번엔 읽지 않은 모델(--only 등)은 그대로
  });

  it('keeps the old value on a read failure and reports one summary line, never an ERROR row', () => {
    const input = makeInput({ models: [fullModel({ hfDownloads30d: 900, hfDownloadsAsOf: '2026-09-29' }), twoModels()[1]!], quants: [quantRow()] });
    const plan = planDownloads(input.models, new Map([['org/test-8b', { error: 'HTTP 503' }], ['org/other-1b', { downloads: 77 }]]), '2026-10-06');
    expect(plan.failed).toEqual(['test-8b']);
    applyDownloads(plan, input);
    expect(input.rawModels[0]).toMatchObject({ hfDownloads30d: 900, hfDownloadsAsOf: '2026-09-29' });
    expect(input.rawModels[1]).toMatchObject({ hfDownloads30d: 77, hfDownloadsAsOf: '2026-10-06' });
    const report = renderReport([], plan);
    expect(report).toContain('다운로드 수(원본 저장소 최근 30일) 1종 갱신, 기준일 2026-10-06 · 읽기 실패 1종은 기존 값 유지(test-8b)');
    expect(report).toContain('0 auto, 0 suspicious, 0 manual, 0 skipped, 0 error');
    expect(report).not.toContain('| test-8b |');
  });

  it('adds no line when nothing was read (old callers unchanged)', () => {
    expect(renderReport([], { asOf: '2026-10-06', updates: [], failed: [] })).toBe(renderReport([]));
  });

  it('schema: count and date go together, and the HF model URL must be a source', () => {
    expect(() => parseModels([fullModel({ hfDownloads30d: 5 })])).toThrow('must be set together');
    expect(() => parseModels([fullModel({ hfDownloadsAsOf: '2026-10-06' })])).toThrow('must be set together');
    expect(() => parseModels([fullModel({ hfDownloads30d: 5, hfDownloadsAsOf: '2026-10-06', sources: ['https://example.com/x'] })])).toThrow('Hugging Face model URL');
    expect(() => parseModels([fullModel({ hfDownloads30d: -1, hfDownloadsAsOf: '2026-10-06' })])).toThrow();
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

describe('buildSyncPlan — 새 양자화 행 (카탈로그 확장 자동화, 09-30)', () => {
  const tree = new Map<string, TreeEntry[]>([
    [
      'org/test-8b-GGUF',
      [
        file('test-8b-Q4_K_M.gguf', 4_920_000_000),
        file('test-8b-IQ4_XS.gguf', 4_450_000_000),
        file('test-8b-Q8_0.gguf', 8_540_000_000),
        file('test-8b-Q2_K.gguf', 3_180_000_000),
        file('test-8b-Q5_K_M.gguf', 5_730_000_000),
      ],
    ],
  ]);
  const baseRow = quantRow({ fileName: 'test-8b-Q4_K_M.gguf' });

  it('adds IQ4_XS / Q8_0 / Q2_K rows found in the base repo as auto, with file name and size', () => {
    const rows = buildSyncPlan(makeInput({ models: [fullModel()], quants: [baseRow], treeByRepo: tree })).filter((c) => c.field === 'row');
    expect(rows.map((c) => [c.id, c.next, c.kind])).toEqual([
      ['test-8b/IQ4_XS', 4.45, 'auto'],
      ['test-8b/Q8_0', 8.54, 'auto'],
      ['test-8b/Q2_K', 3.18, 'auto'],
    ]);
    expect(rows[0]?.newRow).toEqual({ ggufRepo: 'org/test-8b-GGUF', fileName: 'test-8b-IQ4_XS.gguf', fileGB: 4.45 });
  });

  it('never adds Q4_K_M (baseline is curated) and skips quants that already have a row', () => {
    const mxfp4Only = quantRow({ quant: 'MXFP4', fileName: 'test-8b-mxfp4.gguf' });
    const withQ8 = quantRow({ quant: 'Q8_0', fileGB: 8.54, fileName: 'test-8b-Q8_0.gguf' });
    const rows = buildSyncPlan(
      makeInput({ models: [fullModel()], quants: [mxfp4Only, withQ8], treeByRepo: tree }),
    ).filter((c) => c.field === 'row');
    expect(rows.map((c) => c.id)).toEqual(['test-8b/IQ4_XS', 'test-8b/Q2_K']);
  });

  it('skips Q2_K when the model already has a 2-bit row (UD-Q2_K_XL)', () => {
    const ud = quantRow({ quant: 'UD-Q2_K_XL', fileGB: 3.3, fileName: 'test-8b-UD-Q2_K_XL.gguf' });
    const rows = buildSyncPlan(makeInput({ models: [fullModel()], quants: [baseRow, ud], treeByRepo: tree })).filter((c) => c.field === 'row');
    expect(rows.map((c) => c.id)).toEqual(['test-8b/IQ4_XS', 'test-8b/Q8_0']);
  });

  it('applyChanges inserts new rows right after the model’s last row with the repo as source', () => {
    const other = quantRow({ modelId: 'other-1b', ggufRepo: 'org/other-GGUF', sources: ['https://huggingface.co/org/other-GGUF'], fileName: 'o.gguf' });
    const input = makeInput({ models: [fullModel(), fullModel({ id: 'other-1b', hfId: 'org/other-1b' })], quants: [baseRow, other], treeByRepo: tree });
    applyChanges(buildSyncPlan(input), input);
    expect(input.rawQuants.map((r) => `${String(r['modelId'])}/${String(r['quant'])}`)).toEqual([
      'test-8b/Q4_K_M',
      'test-8b/IQ4_XS',
      'test-8b/Q8_0',
      'test-8b/Q2_K',
      'other-1b/Q4_K_M',
    ]);
    expect(input.rawQuants[1]).toEqual({
      modelId: 'test-8b',
      quant: 'IQ4_XS',
      fileGB: 4.45,
      ggufRepo: 'org/test-8b-GGUF',
      fileName: 'test-8b-IQ4_XS.gguf',
      sources: ['https://huggingface.co/org/test-8b-GGUF'],
    });
    expect(() => parseModelQuants(input.rawQuants)).not.toThrow();
  });
});

// --- MoE 행별 분할 (GGUF 헤더 실측, 10-01) ----------------------------------

describe('extractMoe', () => {
  it('reads the routed-expert count and top-k under each family key name', () => {
    expect(extractMoe({ num_experts: 128, num_experts_per_tok: 8 })).toEqual({ experts: 128, topK: 8 }); // Qwen3
    expect(extractMoe({ num_local_experts: 32, experts_per_token: 4, num_experts_per_tok: 4 })).toEqual({ experts: 32, topK: 4 }); // gpt-oss
    expect(extractMoe({ text_config: { num_experts: 128, top_k_experts: 8 } })).toEqual({ experts: 128, topK: 8 }); // Gemma 4
    expect(extractMoe({ n_routed_experts: 320, n_shared_experts: 1, num_experts_per_tok: 8 })).toEqual({ experts: 320, topK: 8 }); // Solar Open2
    expect(extractMoe({ num_hidden_layers: 32 })).toBeUndefined();
    expect(extractMoe(null)).toBeUndefined();
  });
});

describe('planSplitChanges + applyChanges — MoE split', () => {
  const moeModel = fullModel({
    id: 'moe-30b',
    hfId: 'org/moe-30b',
    paramsB: 30.5,
    activeParamsB: 3.3,
    moe: true,
    arch: { layers: 48, kvHeads: 4, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 98304, experts: 128, topK: 8 },
  });
  const repo = 'org/moe-30b-GGUF';
  const row = (over: Record<string, unknown> = {}): Record<string, unknown> =>
    quantRow({ modelId: 'moe-30b', fileGB: 18.56, ggufRepo: repo, fileName: 'm-Q4_K_M.gguf', sources: [`https://huggingface.co/${repo}`], ...over });
  const measured = { expertGB: 17.55, nonExpertGB: 0.82 };
  /** 헤더 측정 결과 모양 — MoE 행은 분할만 기록한다(MTP 0 이면 mtpGB 없음) */
  const header = (v: { expertGB: number; nonExpertGB: number }, extra: Partial<MeasuredSplit> = {}): MeasuredSplit => ({
    ...v,
    offGpuGB: 0.19,
    mtpGB: 0,
    ...extra,
  });
  type Values = Record<string, MeasuredSplit | Error>;
  const fakeMeasure = (values: Values): { fn: MeasureSplitFn; calls: string[] } => {
    const calls: string[] = [];
    const fn: MeasureSplitFn = (r, fileName) => {
      calls.push(`${r}:${fileName}`);
      const v = values[fileName];
      if (v === undefined) return Promise.reject(new Error(`unexpected ${fileName}`));
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    };
    return { fn, calls };
  };

  it('measures MoE rows without a split, writes expertGB/nonExpertGB right after fileGB', async () => {
    const input = makeInput({ models: [moeModel], quants: [row()] });
    const { fn, calls } = fakeMeasure({ 'm-Q4_K_M.gguf': header(measured) });
    const changes = await planSplitChanges(input, buildSyncPlan(input), fn);
    expect(calls).toEqual([`${repo}:m-Q4_K_M.gguf`]);
    expect(changes).toEqual([
      expect.objectContaining({ id: 'moe-30b/Q4_K_M', field: 'split', kind: 'auto', next: 'expert 17.55 / non-expert 0.82', split: measured }),
    ]);
    applyChanges(changes, input);
    expect(Object.keys(input.rawQuants[0]!).slice(0, 6)).toEqual(['modelId', 'quant', 'fileGB', 'expertGB', 'nonExpertGB', 'ggufRepo']);
    expect(input.rawQuants[0]).toMatchObject(measured);
    expect(() => parseModelQuants(input.rawQuants)).not.toThrow();
  });

  it('skips rows that already have a split unless this sync changed their size', async () => {
    const tree = (gb: number) => new Map([[repo, [file('m-Q4_K_M.gguf', Math.round(gb * 1e9))]]]);
    const steady = makeInput({ models: [moeModel], quants: [row(measured)], treeByRepo: tree(18.56) });
    const idle = fakeMeasure({});
    expect(await planSplitChanges(steady, buildSyncPlan(steady), idle.fn)).toEqual([]);
    expect(idle.calls).toEqual([]);

    const grown = makeInput({ models: [moeModel], quants: [row(measured)], treeByRepo: tree(18.9) });
    const remeasure = fakeMeasure({ 'm-Q4_K_M.gguf': header({ expertGB: 17.86, nonExpertGB: 0.84 }) });
    expect(await planSplitChanges(grown, buildSyncPlan(grown), remeasure.fn)).toEqual([
      expect.objectContaining({
        kind: 'auto',
        old: 'expert 17.55 / non-expert 0.82',
        next: 'expert 17.86 / non-expert 0.84',
        note: 'GGUF 헤더 실측 — 파일 크기 변경',
      }),
    ]);

    const same = makeInput({ models: [moeModel], quants: [row(measured)], treeByRepo: tree(18.9) });
    const unchanged = fakeMeasure({ 'm-Q4_K_M.gguf': header(measured) });
    expect(await planSplitChanges(same, buildSyncPlan(same), unchanged.fn)).toEqual([]);
    expect(unchanged.calls).toHaveLength(1);
  });

  it('measures new auto quant rows of MoE models and applies the split after the row is inserted', async () => {
    const tree = new Map([[repo, [file('m-Q4_K_M.gguf', 18_560_000_000), file('m-Q8_0.gguf', 32_480_000_000)]]]);
    const input = makeInput({ models: [moeModel], quants: [row(measured)], treeByRepo: tree });
    const { fn } = fakeMeasure({ 'm-Q8_0.gguf': header({ expertGB: 30.8, nonExpertGB: 1.34 }) });
    const planned = buildSyncPlan(input);
    const changes = [...planned, ...(await planSplitChanges(input, planned, fn))];
    expect(changes.find((c) => c.field === 'split')).toEqual(
      expect.objectContaining({ id: 'moe-30b/Q8_0', note: 'GGUF 헤더 실측 — 새 양자화 행' }),
    );
    applyChanges(changes, input);
    expect(input.rawQuants[1]).toEqual({
      modelId: 'moe-30b',
      quant: 'Q8_0',
      fileGB: 32.48,
      expertGB: 30.8,
      nonExpertGB: 1.34,
      ggufRepo: repo,
      fileName: 'm-Q8_0.gguf',
      sources: [`https://huggingface.co/${repo}`],
    });
  });

  it('reports a failed or implausible measurement as manual and leaves the row untouched', async () => {
    const input = makeInput({
      models: [moeModel],
      quants: [row(), row({ quant: 'Q8_0', fileGB: 32.48, fileName: 'm-Q8_0.gguf' })],
    });
    const { fn } = fakeMeasure({ 'm-Q4_K_M.gguf': new Error('HTTP 503 for x'), 'm-Q8_0.gguf': header({ expertGB: 40, nonExpertGB: 2 }) });
    const changes = await planSplitChanges(input, [], fn);
    expect(changes.map((c) => [c.id, c.kind])).toEqual([
      ['moe-30b/Q4_K_M', 'manual'],
      ['moe-30b/Q8_0', 'manual'],
    ]);
    expect(changes[0]?.note).toContain('HTTP 503');
    expect(changes[1]?.note).toContain('fileGB 32.48 초과');
    const before = JSON.stringify(input.rawQuants);
    applyChanges(changes, input);
    expect(JSON.stringify(input.rawQuants)).toBe(before);
    expect(renderReport(changes)).toContain('| moe-30b/Q8_0 | split | — | expert 40 / non-expert 2 | — | manual |');
  });

  it('flags a failed re-measurement of a changed file as suspicious (stale split would stay)', async () => {
    const input = makeInput({ models: [moeModel], quants: [row(measured)] });
    const sizeChange: Change = { file: 'model-quants.json', id: 'moe-30b/Q4_K_M', field: 'fileGB', old: 18.55, next: 18.9, kind: 'auto' };
    const { fn } = fakeMeasure({ 'm-Q4_K_M.gguf': new Error('HTTP 503 for x') });
    const changes = await planSplitChanges(input, [sizeChange], fn);
    expect(changes.map((c) => [c.id, c.field, c.kind])).toEqual([['moe-30b/Q4_K_M', 'split', 'suspicious']]);
    expect(changes[0]?.note).toContain('파일 크기 변경');
    // 적용할 값은 없다 — 분할은 그대로, 위임 머지만 멈춘다
    const before = JSON.stringify(input.rawQuants);
    applyChanges(changes, input);
    expect(JSON.stringify(input.rawQuants)).toBe(before);
  });

  it('records the MTP block of a MoE row next to its split, and drops a stale mtpGB on re-measure (10-03)', async () => {
    const input = makeInput({ models: [moeModel], quants: [row()] });
    const { fn } = fakeMeasure({ 'm-Q4_K_M.gguf': header(measured, { mtpGB: 0.9 }) });
    const changes = await planSplitChanges(input, [], fn);
    expect(changes[0]).toEqual(expect.objectContaining({ next: 'expert 17.55 / non-expert 0.82 / MTP 0.9', split: { ...measured, mtpGB: 0.9 } }));
    applyChanges(changes, input);
    expect(Object.keys(input.rawQuants[0]!).slice(2, 7)).toEqual(['fileGB', 'expertGB', 'nonExpertGB', 'mtpGB', 'ggufRepo']);

    const sizeChange: Change = { file: 'model-quants.json', id: 'moe-30b/Q4_K_M', field: 'fileGB', old: 18.56, next: 18.4, kind: 'auto' };
    const again = makeInput({ models: [moeModel], quants: [row({ ...measured, mtpGB: 0.9 })] });
    const noMtp = fakeMeasure({ 'm-Q4_K_M.gguf': header({ expertGB: 17.4, nonExpertGB: 0.82 }) });
    const next = await planSplitChanges(again, [sizeChange], noMtp.fn);
    expect(next[0]).toEqual(expect.objectContaining({ old: 'expert 17.55 / non-expert 0.82 / MTP 0.9', kind: 'auto' }));
    applyChanges(next, again);
    expect(again.rawQuants[0]).not.toHaveProperty('mtpGB');
    expect(again.rawQuants[0]).toMatchObject({ expertGB: 17.4, nonExpertGB: 0.82 });
  });

  it('holds a MoE split far below the file size (another file) — validateAll lower bound', async () => {
    const input = makeInput({ models: [moeModel], quants: [row()] });
    const { fn } = fakeMeasure({ 'm-Q4_K_M.gguf': header({ expertGB: 9, nonExpertGB: 0.8 }) });
    const changes = await planSplitChanges(input, [], fn);
    expect(changes.map((c) => [c.kind, c.note?.includes('75% 미만')])).toEqual([['manual', true]]);
  });

  it('honours the --only model filter', async () => {
    const input = makeInput({ models: [moeModel], quants: [row()] });
    const { fn, calls } = fakeMeasure({});
    expect(await planSplitChanges(input, [], fn, { modelIds: new Set(['other']) })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('flags a config experts/topK drift as manual; no model-level nonExpertGB noise once every row is measured', () => {
    const drifted: ConfigResult = {
      config: { num_hidden_layers: 48, num_attention_heads: 32, num_key_value_heads: 4, head_dim: 128, num_experts: 64, num_experts_per_tok: 8 },
    };
    const input = makeInput({ models: [moeModel], quants: [row(measured)], configByHfId: new Map([['org/moe-30b', drifted]]) });
    const changes = buildSyncPlan(input);
    expect(changes.find((c) => c.field === 'arch.experts')).toEqual(expect.objectContaining({ old: 128, next: 64, kind: 'manual' }));
    expect(changes.find((c) => c.field === 'arch.topK')).toBeUndefined();
    expect(changes.find((c) => c.field === 'nonExpertGB')).toBeUndefined();
  });
});

describe('planSplitChanges + applyChanges — dense offGpuGB (10-03 D62)', () => {
  const dense = fullModel();
  const repo = 'org/test-8b-GGUF';
  const drow = (over: Record<string, unknown> = {}): Record<string, unknown> =>
    quantRow({ fileName: 'test-8b-Q4_K_M.gguf', ...over });
  const header = (offGpuGB: number, extra: Partial<MeasuredSplit> = {}): MeasuredSplit => ({
    expertGB: 0,
    nonExpertGB: 4.92 - offGpuGB,
    offGpuGB,
    mtpGB: 0,
    fileGB: 4.92,
    ...extra,
  });
  const measureWith = (v: MeasuredSplit | Error): { fn: MeasureSplitFn; calls: string[] } => {
    const calls: string[] = [];
    const fn: MeasureSplitFn = (r, fileName) => {
      calls.push(`${r}:${fileName}`);
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    };
    return { fn, calls };
  };

  it('measures dense rows without offGpuGB and writes it (then mtpGB) right after fileGB', async () => {
    const input = makeInput({ models: [dense], quants: [drow()] });
    const { fn, calls } = measureWith(header(0.75, { mtpGB: 0.17 }));
    const changes = await planSplitChanges(input, buildSyncPlan(input), fn);
    expect(calls).toEqual([`${repo}:test-8b-Q4_K_M.gguf`]);
    expect(changes).toEqual([
      expect.objectContaining({
        id: 'test-8b/Q4_K_M',
        field: 'offgpu',
        kind: 'auto',
        next: 'off-GPU 0.75 / MTP 0.17',
        note: 'GGUF 헤더 실측 — 그래픽카드 밖 몫 없음',
        split: { offGpuGB: 0.75, mtpGB: 0.17 },
      }),
    ]);
    applyChanges(changes, input);
    expect(Object.keys(input.rawQuants[0]!).slice(0, 6)).toEqual(['modelId', 'quant', 'fileGB', 'offGpuGB', 'mtpGB', 'ggufRepo']);
    expect(() => parseModelQuants(input.rawQuants)).not.toThrow();
  });

  it('skips measured rows until their file changes; a failed re-measure of a changed file is suspicious', async () => {
    const steady = makeInput({ models: [dense], quants: [drow({ offGpuGB: 0.3 })] });
    const idle = measureWith(new Error('should not be called'));
    expect(await planSplitChanges(steady, [], idle.fn)).toEqual([]);
    expect(idle.calls).toEqual([]);

    const sizeChange: Change = { file: 'model-quants.json', id: 'test-8b/Q4_K_M', field: 'fileGB', old: 4.92, next: 4.95, kind: 'auto' };
    const failed = await planSplitChanges(steady, [sizeChange], measureWith(new Error('HTTP 503 for x')).fn);
    expect(failed.map((c) => [c.field, c.kind])).toEqual([['offgpu', 'suspicious']]);
    expect(failed[0]?.note).toContain('옛 파일의 값이 남음');
  });

  it('reports a first failure as manual and leaves the row on the whole-file fallback', async () => {
    const input = makeInput({ models: [dense], quants: [drow()] });
    const changes = await planSplitChanges(input, [], measureWith(new Error('HTTP 404 for x')).fn);
    expect(changes.map((c) => [c.field, c.kind])).toEqual([['offgpu', 'manual']]);
    expect(changes[0]?.note).toContain('offGpuGB 그대로');
    const before = JSON.stringify(input.rawQuants);
    applyChanges(changes, input);
    expect(JSON.stringify(input.rawQuants)).toBe(before);
  });

  it('holds implausible measurements: another file size, or more than 25% of the file off the GPU', async () => {
    const input = makeInput({ models: [dense], quants: [drow()] });
    const otherFile = await planSplitChanges(input, [], measureWith(header(0.3, { fileGB: 5.5 })).fn);
    expect(otherFile.map((c) => [c.kind, c.note?.includes('측정한 파일 크기 5.5GB')])).toEqual([['manual', true]]);
    const tooMuch = await planSplitChanges(input, [], measureWith(header(1.5, { fileGB: undefined })).fn);
    expect(tooMuch.map((c) => [c.kind, c.note?.includes('25% 초과')])).toEqual([['manual', true]]);
  });

  it('measures new auto quant rows of dense models after the row is inserted', async () => {
    const tree = new Map([[repo, [file('test-8b-Q4_K_M.gguf', 4_920_000_000), file('test-8b-Q8_0.gguf', 8_540_000_000)]]]);
    const input = makeInput({ models: [dense], quants: [drow({ offGpuGB: 0.3 })], treeByRepo: tree });
    const planned = buildSyncPlan(input);
    const { fn } = measureWith(header(0.57, { fileGB: 8.54 }));
    const changes = [...planned, ...(await planSplitChanges(input, planned, fn))];
    expect(changes.find((c) => c.field === 'offgpu')).toEqual(expect.objectContaining({ id: 'test-8b/Q8_0', note: 'GGUF 헤더 실측 — 새 양자화 행' }));
    applyChanges(changes, input);
    expect(input.rawQuants[1]).toEqual({
      modelId: 'test-8b',
      quant: 'Q8_0',
      fileGB: 8.54,
      offGpuGB: 0.57,
      ggufRepo: repo,
      fileName: 'test-8b-Q8_0.gguf',
      sources: [`https://huggingface.co/${repo}`],
    });
  });
});
