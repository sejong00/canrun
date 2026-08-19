/** new-model-alert 순수 코어 테스트 — 시간은 주입(now), 네트워크 없음. */
import { describe, expect, it } from 'vitest';
import { parseModels } from '../packages/data/src/index';
import {
  TRENDING_MIN_LIKES,
  filterCandidates,
  knownHfIds,
  type HfApiModel,
} from './new-model-alert';

const NOW = new Date('2026-08-19T00:00:00Z');

const model = (over: Partial<HfApiModel> & { id: string }): HfApiModel => ({
  likes: 500,
  downloads: 10000,
  createdAt: '2026-08-18T00:00:00Z',
  pipeline_tag: 'text-generation',
  ...over,
});

const seedModels = parseModels([
  {
    id: 'llama-3.1-8b',
    family: 'llama',
    name: 'Llama 3.1 8B',
    hfId: 'meta-llama/Llama-3.1-8B-Instruct',
    paramsB: 8.03,
    arch: { layers: 32, kvHeads: 8, headDim: 128, attnType: 'full', kvBytesPerTokenF16: 131072 },
    maxContext: 131072,
    license: 'Llama 3.1',
    moe: false,
    category: ['chat'],
    popularity: 5,
    releasedAt: '2024-07-23',
    sources: ['https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct'],
  },
]);

describe('knownHfIds', () => {
  it('collects catalog hfIds and gguf repos, lowercased', () => {
    const known = knownHfIds(seedModels, ['bartowski/Meta-Llama-3.1-8B-Instruct-GGUF']);
    expect(known.has('meta-llama/llama-3.1-8b-instruct')).toBe(true);
    expect(known.has('bartowski/meta-llama-3.1-8b-instruct-gguf')).toBe(true);
  });
});

describe('filterCandidates', () => {
  const known = knownHfIds(seedModels, []);

  it('excludes catalog models case-insensitively', () => {
    const trending = [model({ id: 'meta-llama/Llama-3.1-8B-Instruct' })];
    expect(filterCandidates(known, trending, [], NOW)).toHaveLength(0);
  });

  it('excludes GGUF/quant mirrors', () => {
    const trending = [
      model({ id: 'bartowski/NewModel-GGUF' }),
      model({ id: 'org/NewModel-AWQ' }),
    ];
    expect(filterCandidates(known, trending, [], NOW)).toHaveLength(0);
  });

  it('applies the trending likes floor', () => {
    const trending = [
      model({ id: 'org/quiet-model', likes: TRENDING_MIN_LIKES - 1 }),
      model({ id: 'org/hot-model', likes: TRENDING_MIN_LIKES }),
    ];
    const out = filterCandidates(known, trending, [], NOW);
    expect(out.map((c) => c.hfId)).toEqual(['org/hot-model']);
    expect(out[0]?.reason).toBe('trending');
  });

  it('applies the 7-day window to org releases (likes floor 미적용)', () => {
    const releases = [
      model({ id: 'Qwen/Qwen4-9B', likes: 3, createdAt: '2026-08-15T12:00:00Z' }),
      model({ id: 'Qwen/Qwen-old', likes: 900, createdAt: '2026-08-01T00:00:00Z' }),
    ];
    const out = filterCandidates(known, [], releases, NOW);
    expect(out.map((c) => c.hfId)).toEqual(['Qwen/Qwen4-9B']);
    expect(out[0]?.reason).toBe('org-release');
  });

  it('dedupes across lists — org-release reason wins', () => {
    const dupe = model({ id: 'google/gemma-5-9b' });
    const out = filterCandidates(known, [dupe], [dupe], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe('org-release');
  });

  it('builds a deterministic issue title (워크플로 중복 제거 키)', () => {
    const out = filterCandidates(known, [model({ id: 'org/next-big-model' })], [], NOW);
    expect(out[0]?.issueTitle).toBe('[new-model] org/next-big-model');
    expect(out[0]?.issueBody).toContain('https://huggingface.co/org/next-big-model');
  });

  it('skips non-text-generation pipelines', () => {
    const trending = [model({ id: 'org/asr-model', pipeline_tag: 'automatic-speech-recognition' })];
    expect(filterCandidates(known, trending, [], NOW)).toHaveLength(0);
  });
});
