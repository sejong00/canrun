/** new-model-alert 순수 코어 테스트 — 시간은 주입(now), 네트워크 없음. */
import { describe, expect, it } from 'vitest';
import { parseModels } from '../packages/data/src/index';
import {
  DIGEST_MARKER,
  ORG_RELEASE_WINDOW_DAYS,
  TRENDING_MIN_LIKES,
  buildDigest,
  filterCandidates,
  isRepack,
  isThirdPartyDerivative,
  knownHfIds,
  reportedHfIds,
  type HfApiModel,
} from './new-model-alert';

const NOW = new Date('2026-08-19T00:00:00Z');
const DAY = 24 * 3600 * 1000;

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
    addedAt: '2026-08-16',
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

describe('isRepack', () => {
  it('flags quant/format repacks and uncensored/draft derivatives (09-28 트리아지 표본)', () => {
    for (const id of [
      'bartowski/NewModel-GGUF',
      'org/NewModel-AWQ',
      'Qwen/Qwen3.8-2.4T-A95B-FP8',
      'nvidia/Qwen3.8-27B-NVFP4',
      'prism-ml/Ternary-Bonsai-2-27B-mlx-2bit',
      'OBLITERATUS/Qwen3.8-27B-OBLITERATED',
      'audnai/penclaw-GLM-5.3-abliterated',
      'orcarouter/GLM-5.3-Flash-Uncensored-FP8',
      'z-lab/Qwen3.8-27B-DFlash2',
      'LiquidAI/LFM2.5-VL-3B-DSpark', // 추측 디코딩 드래프트 (10-06 D71)
      'ibm-granite/granite-4.2-8b-mxfp4', // 공식 형식 변형 (10-06 리뷰)
      'inclusionAI/Ling-3.0-flash-fp4',
      'LiquidAI/LFM2.5-2.6B-ONNX',
    ]) {
      expect(isRepack(id), id).toBe(true);
    }
  });

  it('keeps originals, including BF16-suffixed NVIDIA releases', () => {
    for (const id of [
      'nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16',
      'Qwen/Qwen3.8-27B',
      'openbmb/MiniCPM5-2B',
      'ibm-granite/granite-4.2-30b',
    ]) {
      expect(isRepack(id), id).toBe(false);
    }
  });
});

describe('isThirdPartyDerivative', () => {
  it('flags finetunes/quants whose base_model belongs to another org', () => {
    const m = model({
      id: 'XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B',
      tags: ['base_model:Qwen/Qwen3.5-9B', 'base_model:finetune:Qwen/Qwen3.5-9B'],
    });
    expect(isThirdPartyDerivative(m)).toBe(true);
  });

  it('keeps same-org Instruct built on its own Base', () => {
    const m = model({
      id: 'Qwen/Qwen3-0.6B',
      tags: ['base_model:Qwen/Qwen3-0.6B-Base', 'base_model:finetune:Qwen/Qwen3-0.6B-Base'],
    });
    expect(isThirdPartyDerivative(m)).toBe(false);
  });

  it('keeps models without base_model tags', () => {
    expect(isThirdPartyDerivative(model({ id: 'org/fresh', tags: ['license:mit'] }))).toBe(false);
  });
});

describe('filterCandidates', () => {
  const known = knownHfIds(seedModels, []);

  it('excludes catalog models case-insensitively', () => {
    const trending = [model({ id: 'meta-llama/Llama-3.1-8B-Instruct' })];
    expect(filterCandidates(known, trending, [], NOW)).toHaveLength(0);
  });

  it('excludes repacks and third-party derivatives', () => {
    const trending = [
      model({ id: 'nvidia/Qwen3.8-27B-NVFP4' }),
      model({ id: 'Altworld/Hemmingway-1', tags: ['base_model:finetune:Qwen/Qwen3.8-27B'] }),
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

  it(`applies the ${ORG_RELEASE_WINDOW_DAYS}-day window to org releases (likes floor 미적용)`, () => {
    const inside = new Date(NOW.getTime() - (ORG_RELEASE_WINDOW_DAYS - 0.5) * DAY).toISOString();
    const outside = new Date(NOW.getTime() - (ORG_RELEASE_WINDOW_DAYS + 1) * DAY).toISOString();
    const releases = [
      model({ id: 'Qwen/Qwen4-9B', likes: 3, createdAt: inside }),
      model({ id: 'Qwen/Qwen-old', likes: 900, createdAt: outside }),
    ];
    const out = filterCandidates(known, [], releases, NOW);
    expect(out.map((c) => c.hfId)).toEqual(['Qwen/Qwen4-9B']);
    expect(out[0]?.reason).toBe('org-release');
  });

  it('takes a wider org-release window when asked (auto-add uses 14 days — D71)', () => {
    const tenDaysAgo = new Date(NOW.getTime() - 10 * DAY).toISOString();
    const releases = [model({ id: 'Qwen/Qwen4-14B', createdAt: tenDaysAgo })];
    expect(filterCandidates(known, [], releases, NOW)).toHaveLength(0);
    expect(filterCandidates(known, [], releases, NOW, 14).map((c) => c.hfId)).toEqual(['Qwen/Qwen4-14B']);
  });

  it('dedupes across lists — org-release reason wins', () => {
    const dupe = model({ id: 'google/gemma-5-9b' });
    const out = filterCandidates(known, [dupe], [dupe], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe('org-release');
  });

  it('accepts natively multimodal originals (image-text-to-text)', () => {
    const trending = [model({ id: 'Qwen/Qwen3.8-27B', pipeline_tag: 'image-text-to-text' })];
    expect(filterCandidates(known, trending, [], NOW).map((c) => c.hfId)).toEqual(['Qwen/Qwen3.8-27B']);
  });

  it('skips non-LLM pipelines', () => {
    const trending = [
      model({ id: 'org/asr-model', pipeline_tag: 'automatic-speech-recognition' }),
      model({ id: 'Qwen/Qwen-Image-2.1', pipeline_tag: 'text-to-image' }),
      model({ id: 'baidu/Unlimited-OCR', pipeline_tag: 'image-text-to-text' }),
    ];
    expect(filterCandidates(known, trending, [], NOW)).toHaveLength(0);
  });
});

describe('reportedHfIds', () => {
  it('reads legacy per-model issue titles and digest markers, lowercased', () => {
    const ids = reportedHfIds([
      { title: '[new-model] Qwen/Qwen3.8-2.4T-A95B', body: 'HF: …' },
      { title: '[new-model] 후보 2026-10-05 (2건)', body: `표…\n<!-- ${DIGEST_MARKER} org/A-7B,Org/B-1B -->` },
      { title: 'unrelated issue' },
    ]);
    expect([...ids].sort()).toEqual(['org/a-7b', 'org/b-1b', 'qwen/qwen3.8-2.4t-a95b']);
  });

  it('does not mistake a digest title for a model id', () => {
    expect(reportedHfIds([{ title: '[new-model] 후보 2026-10-05 (2건)' }]).size).toBe(0);
  });
});

describe('buildDigest', () => {
  const known = knownHfIds(seedModels, []);
  const candidates = filterCandidates(
    known,
    [model({ id: 'org/next-big-model' }), model({ id: 'org/old-news' })],
    [],
    NOW,
  );

  it('returns null when every candidate was already reported', () => {
    expect(buildDigest(candidates, new Set(['org/next-big-model', 'org/old-news']), NOW)).toBeNull();
  });

  it('lists only unreported candidates with a dated title and a dedup marker', () => {
    const digest = buildDigest(candidates, new Set(['org/old-news']), NOW);
    expect(digest?.title).toBe('[new-model] 후보 2026-08-19 (1건)');
    expect(digest?.hfIds).toEqual(['org/next-big-model']);
    expect(digest?.body).toContain('https://huggingface.co/org/next-big-model');
    expect(digest?.body).not.toContain('org/old-news');
  });

  it('round-trips: a posted digest counts as reported next run', () => {
    const digest = buildDigest(candidates, new Set(), NOW);
    if (digest === null) throw new Error('digest expected');
    const reported = reportedHfIds([{ title: digest.title, body: digest.body }]);
    expect(buildDigest(candidates, reported, NOW)).toBeNull();
  });
});
