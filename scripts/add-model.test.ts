/** add-model 순수 코어 — 네트워크·fs 없음. config 픽스처는 09-30 실제 HF config 를 축약. */
import { describe, expect, it } from 'vitest';
import type { ModelQuantRecord } from '../packages/data/src/index';
import type { TreeEntry } from './hf-common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_MAKERS } from '../apps/web/content/model-makers';
import {
  MODEL_MAKERS_PATH,
  activeFromName,
  catalogDates,
  classifyArch,
  displayName,
  downloadsFields,
  familyOf,
  hasMakerEntry,
  insertMakerLine,
  makerLine,
  makerNameFrom,
  mapLicense,
  measureRows,
  orgDisplayName,
  parseArgs,
  popularityFrom,
  quantRowsFrom,
  rankGgufRepos,
  slugFromHfId,
} from './add-model';

const layers = (sliding: number, full: number, kind = 'sliding_attention') => [
  ...Array.from({ length: sliding }, () => kind),
  ...Array.from({ length: full }, () => 'full_attention'),
];

describe('classifyArch — 선례 있는 구조만 자동 (D53)', () => {
  it('SWA with global KV heads (Gemma 4 31B) → KV counts full layers with global kv × head_dim', () => {
    const r = classifyArch({
      model_type: 'gemma4',
      vision_config: {},
      text_config: {
        model_type: 'gemma4_text', num_hidden_layers: 60, num_attention_heads: 32, num_key_value_heads: 16, head_dim: 256,
        num_global_key_value_heads: 4, global_head_dim: 512, sliding_window: 1024, layer_types: layers(50, 10), max_position_embeddings: 262144,
      },
    });
    expect(r).toMatchObject({ kind: 'ok', attnType: 'swa', vision: true, maxContext: 262144, arch: { layers: 60, kvHeads: 16, headDim: 256, kvBytesPerTokenF16: 81920 } });
    expect(r.kind === 'ok' && r.override?.kvBytesPerTokenF16).toBe(81920);
  });

  it('hybrid linear (Qwen3.8 27B) and MoE hybrid (Qwen3.6 35B-A3B)', () => {
    expect(
      classifyArch({ model_type: 'qwen3_5_text', num_hidden_layers: 64, num_attention_heads: 24, num_key_value_heads: 4, head_dim: 256, layer_types: layers(48, 16, 'linear_attention'), max_position_embeddings: 262144 }),
    ).toMatchObject({ kind: 'ok', attnType: 'hybrid', arch: { kvBytesPerTokenF16: 65536 } });
    const moe = classifyArch({ model_type: 'qwen3_5_moe_text', num_hidden_layers: 40, num_attention_heads: 16, num_key_value_heads: 2, head_dim: 256, layer_types: layers(30, 10, 'linear_attention'), max_position_embeddings: 262144, num_experts: 256, num_experts_per_tok: 8 });
    expect(moe).toMatchObject({ kind: 'ok', attnType: 'hybrid', moe: { experts: 256, topK: 8 }, arch: { kvBytesPerTokenF16: 20480 } });
  });

  it('full attention derives head_dim from hidden/heads (Llama 3.2 3B = 114688 B/token); qwen2 with use_sliding_window false stays full', () => {
    expect(classifyArch({ model_type: 'llama', num_hidden_layers: 28, num_attention_heads: 24, num_key_value_heads: 8, hidden_size: 3072, max_position_embeddings: 131072 })).toMatchObject({
      kind: 'ok', attnType: 'full', arch: { headDim: 128, kvBytesPerTokenF16: 114688 },
    });
    expect(classifyArch({ model_type: 'qwen2', num_hidden_layers: 64, num_attention_heads: 40, num_key_value_heads: 8, hidden_size: 5120, sliding_window: 131072, use_sliding_window: false, max_position_embeddings: 131072 })).toMatchObject({ kind: 'ok', attnType: 'full' });
  });

  it('holds back structures the engine does not model', () => {
    const base = { num_hidden_layers: 24, num_attention_heads: 16, num_key_value_heads: 4, head_dim: 128, max_position_embeddings: 131072 };
    expect(classifyArch({ ...base, model_type: 'nemotron_h' })).toMatchObject({ kind: 'unsupported' });
    expect(classifyArch({ ...base, model_type: 'deepseek_v4' })).toMatchObject({ kind: 'unsupported' });
    expect(classifyArch({ ...base, model_type: 'llama', kv_lora_rank: 512 })).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('kv_lora_rank') });
    expect(classifyArch({ ...base, model_type: 'llama', layer_types: ['conv', 'full_attention'] })).toMatchObject({ kind: 'unsupported' });
    expect(classifyArch({ ...base, model_type: 'mistral', sliding_window: 4096 })).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('슬라이딩') });
    expect(classifyArch({ model_type: 'llama' })).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('누락') });
  });
});

describe('names, license, popularity', () => {
  it('slug and display name follow the catalog style', () => {
    expect(slugFromHfId('google/gemma-4-31B-it')).toBe('gemma-4-31b');
    expect(slugFromHfId('meta-llama/Llama-3.2-3B-Instruct')).toBe('llama-3.2-3b');
    expect(slugFromHfId('Qwen/Qwen3.6-35B-A3B')).toBe('qwen3.6-35b-a3b');
    expect(displayName('google/gemma-4-31B-it')).toBe('Gemma 4 31B');
    expect(displayName('meta-llama/Llama-3.2-3B-Instruct')).toBe('Llama 3.2 3B');
    expect(displayName('Qwen/Qwen3.6-35B-A3B')).toBe('Qwen3.6 35B-A3B');
    expect(displayName('ibm-granite/granite-4.2-30b')).toBe('Granite 4.2 30B');
    expect(displayName('openbmb/MiniCPM5-2B')).toBe('MiniCPM5 2B');
    expect(familyOf('Qwen3.6 35B-A3B')).toBe('qwen');
    expect(familyOf('MiniCPM5 2B')).toBe('minicpm');
  });

  it('maps HF license ids to badge strings, passes unknown ones through', () => {
    expect(mapLicense('apache-2.0')).toBe('Apache-2.0');
    expect(mapLicense('llama3.2')).toBe('Llama 3.2');
    expect(mapLicense('other')).toBe('other');
    expect(mapLicense(undefined)).toBe('unknown');
  });

  it('popularity from 30-day downloads; active params from the A3B-style name', () => {
    expect([9_900_000, 3_200_000, 900_000, 91_000, 18_000].map(popularityFrom)).toEqual([5, 4, 3, 2, 1]);
    expect(activeFromName('Qwen/Qwen3.6-35B-A3B')).toBe(3);
    expect(activeFromName('nvidia/Nemotron-3.5-Lightning-30B-A3B-BF16')).toBe(3);
    expect(activeFromName('google/gemma-4-31B-it')).toBeUndefined();
  });
});

describe('GGUF repo choice and quant rows', () => {
  it('keeps only conversions of the same model, official first, then ggml-org → bartowski → unsloth', () => {
    expect(
      rankGgufRepos(
        ['unsloth/Qwen3.8-27B-GGUF', 'someone/Qwen3.8-27B-abliterated-GGUF', 'bartowski/Qwen3.8-27B-GGUF', 'ggml-org/Qwen3.8-27B-GGUF', 'Qwen/Qwen3.8-27B-GGUF', 'random/Qwen3.8-27B-GGUF'],
        'Qwen/Qwen3.8-27B',
      ),
    ).toEqual(['Qwen/Qwen3.8-27B-GGUF', 'ggml-org/Qwen3.8-27B-GGUF', 'bartowski/Qwen3.8-27B-GGUF', 'unsloth/Qwen3.8-27B-GGUF']);
    expect(rankGgufRepos(['bartowski/Qwen_Qwen3.6-35B-A3B-GGUF', 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF'], 'Qwen/Qwen3.6-35B-A3B')).toEqual([
      'bartowski/Qwen_Qwen3.6-35B-A3B-GGUF',
      'unsloth/Qwen3.6-35B-A3B-MTP-GGUF',
    ]);
  });

  it('builds standard rows from a tree (Q4_K_M required; UD-Q2_K_XL when there is no Q2_K)', () => {
    const f = (path: string, size: number): TreeEntry => ({ type: 'file', path, size });
    const tree = [f('m-Q4_K_M.gguf', 18_320_000_000), f('m-IQ4_XS.gguf', 16_370_000_000), f('m-Q8_0.gguf', 32_640_000_000), f('m-UD-Q2_K_XL.gguf', 11_770_000_000), f('mmproj-m-f16.gguf', 1_000_000_000)];
    const rows = quantRowsFrom(tree, 'org/m-GGUF', 'm');
    expect(rows.map((r) => [r.quant, r.fileGB, r.fileName])).toEqual([
      ['Q4_K_M', 18.32, 'm-Q4_K_M.gguf'],
      ['IQ4_XS', 16.37, 'm-IQ4_XS.gguf'],
      ['Q8_0', 32.64, 'm-Q8_0.gguf'],
      ['UD-Q2_K_XL', 11.77, 'm-UD-Q2_K_XL.gguf'],
    ]);
    expect(rows[0]?.sources).toEqual(['https://huggingface.co/org/m-GGUF']);
    expect(quantRowsFrom([f('m-Q8_0.gguf', 1)], 'org/m-GGUF', 'm')).toEqual([]);
  });

  it('records the 30-day download count and its date with the model (D68), or neither', () => {
    expect(downloadsFields(6104298, '2026-10-06')).toEqual({ hfDownloads30d: 6104298, hfDownloadsAsOf: '2026-10-06' });
    expect(downloadsFields(undefined, '2026-10-06')).toEqual({});
  });

  it('dates the record: released = HF createdAt, added to the catalog = today (10-14 D72)', () => {
    expect(catalogDates('2026-10-07T03:12:44.000Z', '2026-10-13')).toEqual({ releasedAt: '2026-10-07', addedAt: '2026-10-13' });
    expect(Object.keys(catalogDates(undefined, '2026-10-13'))).toEqual(['releasedAt', 'addedAt']);
    expect(catalogDates(undefined, '2026-10-13')).toEqual({ releasedAt: '2026-10-13', addedAt: '2026-10-13' });
  });

  it('parses CLI args', () => {
    expect(parseArgs(['--', 'Qwen/Qwen3-4B', '--dry', '--category', 'chat,reasoning', '--popularity', '4'])).toMatchObject({
      hfId: 'Qwen/Qwen3-4B', dry: true, category: ['chat', 'reasoning'], popularity: 4,
    });
    expect(() => parseArgs(['--id'])).toThrow();
  });
});

describe('MoE — experts/topK from config, per-row split from the GGUF header (10-01)', () => {
  it('classifyArch reads Gemma 4 top_k_experts (MoE structure from config)', () => {
    const r = classifyArch({
      model_type: 'gemma4',
      text_config: {
        model_type: 'gemma4_text', num_hidden_layers: 30, num_attention_heads: 16, num_key_value_heads: 8, head_dim: 256,
        sliding_window: 1024, layer_types: layers(25, 5), max_position_embeddings: 262144, num_experts: 128, top_k_experts: 8,
      },
    });
    expect(r).toMatchObject({ kind: 'ok', moe: { experts: 128, topK: 8 } });
  });

  const row = (quant: ModelQuantRecord['quant'], fileGB: number): ModelQuantRecord => ({
    modelId: 'm', quant, fileGB, ggufRepo: 'org/m-GGUF', fileName: `m-${quant}.gguf`, sources: ['https://huggingface.co/org/m-GGUF'],
  });
  const ok = { expertGB: 17.55, nonExpertGB: 0.82, offGpuGB: 0.19, mtpGB: 0, trunkLayers: 48, expertCount: 128, expertUsed: 8 };

  it('writes expertGB/nonExpertGB right after fileGB for each measured row', async () => {
    const calls: string[] = [];
    const res = await measureRows([row('Q4_K_M', 18.56)], { experts: 128, topK: 8 }, 48, (repo, fileName) => {
      calls.push(`${repo}/${fileName}`);
      return Promise.resolve(ok);
    });
    expect(calls).toEqual(['org/m-GGUF/m-Q4_K_M.gguf']);
    expect(res.problems).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(Object.keys(res.rows[0]!)).toEqual(['modelId', 'quant', 'fileGB', 'expertGB', 'nonExpertGB', 'ggufRepo', 'fileName', 'sources']);
    expect(res.rows[0]).toMatchObject({ expertGB: 17.55, nonExpertGB: 0.82 });
  });

  it('stops on a header/config expert mismatch; warns on a trunk-layer mismatch', async () => {
    const res = await measureRows([row('Q4_K_M', 18.56)], { experts: 64, topK: 8 }, 40, () => Promise.resolve(ok));
    expect(res.problems).toEqual([expect.stringContaining('expert_count 128 ≠ config 64')]);
    expect(res.warnings).toEqual([expect.stringContaining('트렁크 층 48 ≠ config num_hidden_layers 40')]);
  });

  it('keeps the row without a split when the fetch fails or the split exceeds the file', async () => {
    const res = await measureRows([row('Q4_K_M', 18.56), row('Q8_0', 10)], { experts: 128, topK: 8 }, 48, (_repo, fileName) =>
      fileName === 'm-Q4_K_M.gguf' ? Promise.reject(new Error('HTTP 503')) : Promise.resolve(ok),
    );
    expect(res.rows.map((r) => r.expertGB)).toEqual([undefined, undefined]);
    expect(res.problems).toEqual([]);
    expect(res.warnings).toEqual([expect.stringContaining('HTTP 503'), expect.stringContaining('> fileGB 10')]);
  });

  it('records the MTP block after the split when the header has one (10-03)', async () => {
    const res = await measureRows([row('Q4_K_M', 22.29)], { experts: 256, topK: 8 }, 40, () =>
      Promise.resolve({ ...ok, expertGB: 19.5, nonExpertGB: 1.59, offGpuGB: 1.2, mtpGB: 0.9, trunkLayers: 40, expertCount: 256 }),
    );
    expect(Object.keys(res.rows[0]!).slice(2, 7)).toEqual(['fileGB', 'expertGB', 'nonExpertGB', 'mtpGB', 'ggufRepo']);
    expect(res.rows[0]).not.toHaveProperty('offGpuGB');
  });

  it('value experts (MoVA, 10-21 D113): valueExpertGB right after nonExpertGB; a row without it stops the write instead of a warning', async () => {
    const mova = { ...ok, expertGB: 15.99, nonExpertGB: 6.0, valueExpertGB: 4.25, offGpuGB: 0.38, trunkLayers: 48, expertCount: 100 };
    const moe = { experts: 100, topK: 8 };
    const res = await measureRows([row('Q4_K_M', 22.37)], moe, 48, () => Promise.resolve(mova), { valueExperts: true });
    expect(res.problems).toEqual([]);
    expect(Object.keys(res.rows[0]!).slice(2, 7)).toEqual(['fileGB', 'expertGB', 'nonExpertGB', 'valueExpertGB', 'ggufRepo']);
    expect(res.rows[0]).toMatchObject({ nonExpertGB: 6.0, valueExpertGB: 4.25 });
    // 측정 실패·값 전문가 텐서 없음 → 중단 사유(실측 없는 행은 모델 수준 유도 비전문가로 VRAM 을 적게 센다)
    const failed = await measureRows([row('Q4_K_M', 22.37)], moe, 48, () => Promise.reject(new Error('HTTP 503')), { valueExperts: true });
    expect(failed.problems).toEqual([expect.stringContaining('값 전문가(MoVA) 모델은 행마다 헤더 실측')]);
    const { valueExpertGB: _v, ...noValue } = mova;
    const missing = await measureRows([row('Q4_K_M', 22.37)], moe, 48, () => Promise.resolve(noValue), { valueExperts: true });
    expect(missing.problems).toEqual([expect.stringContaining('attn_v_exps')]);
    // 값 전문가가 없는 MoE 는 예전처럼 경고만
    const plain = await measureRows([row('Q4_K_M', 22.37)], moe, 48, () => Promise.reject(new Error('HTTP 503')));
    expect(plain.problems).toEqual([]);
    expect(plain.warnings).toEqual([expect.stringContaining('HTTP 503')]);
  });
});

describe('dense — per-row offGpuGB from the GGUF header (10-03 D62)', () => {
  const row = (quant: ModelQuantRecord['quant'], fileGB: number): ModelQuantRecord => ({
    modelId: 'd', quant, fileGB, ggufRepo: 'org/d-GGUF', fileName: `d-${quant}.gguf`, sources: ['https://huggingface.co/org/d-GGUF'],
  });
  const ok = { expertGB: 0, nonExpertGB: 5.12, offGpuGB: 0.75, mtpGB: 0.17, fileGB: 5.87, trunkLayers: 32 };

  it('writes offGpuGB (then mtpGB) right after fileGB — no expert checks for dense', async () => {
    const res = await measureRows([row('Q4_K_M', 5.87)], undefined, 32, () => Promise.resolve(ok));
    expect(res.problems).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(Object.keys(res.rows[0]!)).toEqual(['modelId', 'quant', 'fileGB', 'offGpuGB', 'mtpGB', 'ggufRepo', 'fileName', 'sources']);
    expect(res.rows[0]).toMatchObject({ offGpuGB: 0.75, mtpGB: 0.17 });
    expect(res.rows[0]).not.toHaveProperty('expertGB');
  });

  it('keeps the row on the whole-file fallback when the measurement does not match the file', async () => {
    const res = await measureRows([row('Q4_K_M', 5.87), row('Q8_0', 2)], undefined, 32, (_repo, fileName) =>
      Promise.resolve(fileName === 'd-Q4_K_M.gguf' ? { ...ok, fileGB: 6.5 } : { ...ok, fileGB: undefined }),
    );
    expect(res.rows.map((r) => r.offGpuGB)).toEqual([undefined, undefined]);
    expect(res.warnings).toEqual([expect.stringContaining('측정한 파일 크기 6.5GB'), expect.stringContaining('25%')]);
  });

  it('per-layer embedding table (Gemma 4 E4B, 10-21 D112): pleGB right after offGpuGB, the 25% cap applies to the rest only', async () => {
    // unsloth gemma-4-E4B-it-Q4_K_M 헤더 실측: 파일 4.98 · GPU 밖 1.95(층별 임베딩 표 1.94 + 헤더) — 표는 파일의 39%
    const e4b = { expertGB: 0, nonExpertGB: 3.02, offGpuGB: 1.95, pleGB: 1.94, mtpGB: 0, fileGB: 4.98, trunkLayers: 42 };
    const res = await measureRows([{ ...row('Q4_K_M', 4.98), modelId: 'gemma-4-e4b' }], undefined, 42, () => Promise.resolve(e4b));
    expect(res.warnings).toEqual([]);
    expect(Object.keys(res.rows[0]!)).toEqual(['modelId', 'quant', 'fileGB', 'offGpuGB', 'pleGB', 'ggufRepo', 'fileName', 'sources']);
    expect(res.rows[0]).toMatchObject({ offGpuGB: 1.95, pleGB: 1.94 });
    // 표를 뺀 나머지가 25% 를 넘으면 여전히 다른 파일을 잰 것으로 본다
    const odd = await measureRows([row('Q4_K_M', 4.98)], undefined, 42, () => Promise.resolve({ ...e4b, offGpuGB: 3.3 }));
    expect(odd.rows[0]).not.toHaveProperty('pleGB');
    expect(odd.warnings).toEqual([expect.stringContaining('층별 임베딩 표 1.94GB 제외')]);
  });
});

describe('organization names for model-makers.ts (10-19 D101)', () => {
  const registry = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), MODEL_MAKERS_PATH), 'utf8');

  it('cleans the Hugging Face fullname the way the registry header says, falling back to the organization id', () => {
    expect(orgDisplayName('Mistral AI_', 'mistralai')).toBe('Mistral AI');
    expect(orgDisplayName('upstage', 'upstage')).toBe('Upstage');
    expect(orgDisplayName('inclusionAI', 'inclusionAI')).toBe('inclusionAI');
    expect(orgDisplayName('Kakao Corp.', 'kakaocorp')).toBe('Kakao Corp.');
    expect(orgDisplayName(undefined, 'someone-new')).toBe('someone-new');
    expect(orgDisplayName('  ', 'someone-new')).toBe('someone-new');
  });

  it('reads every registry entry back from the file (quoted and bare keys) and knows a missing one', () => {
    for (const [org, name] of Object.entries(MODEL_MAKERS)) {
      expect(hasMakerEntry(registry, org), org).toBe(true);
      expect(makerNameFrom(registry, org), org).toBe(name);
    }
    expect(hasMakerEntry(registry, 'zai-org')).toBe(false);
    expect(makerNameFrom(registry, 'zai-org')).toBeUndefined();
    // 앞부분만 같은 조직 id 는 다른 조직
    expect(hasMakerEntry(registry, 'Qwe')).toBe(false);
  });

  it('inserts one line before the end of MODEL_MAKERS, quoting keys that are not identifiers and escaping quotes', () => {
    const line = makerLine('zai-org', "Z.ai's lab", '2026-10-19');
    expect(line).toBe("  'zai-org': 'Z.ai\\'s lab', // add-model 2026-10-19 — https://huggingface.co/api/organizations/zai-org/overview");
    expect(makerLine('tencent', 'Tencent', '2026-10-19')).toMatch(/^  tencent: 'Tencent', /);
    const next = insertMakerLine(registry, line);
    expect(next.split('\n').length).toBe(registry.split('\n').length + 1);
    expect(hasMakerEntry(next, 'zai-org')).toBe(true);
    expect(makerNameFrom(next, 'zai-org')).toBe("Z.ai's lab");
    // 블록 밖(함수들)은 그대로
    expect(next.slice(next.indexOf('/** `hfId` → Hugging Face 조직 id'))).toBe(registry.slice(registry.indexOf('/** `hfId` → Hugging Face 조직 id')));
    expect(() => insertMakerLine('export const OTHER = {};', line)).toThrow(/MODEL_MAKERS/);
  });
});
