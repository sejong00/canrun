/** 카탈로그 밖 모델 불러오기 (lib/calc/hf-load.ts, D57) — 가짜 fetch 로 HF 응답 흐름·오류 분기를 고정한다. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@canrun/data/hf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@canrun/data/hf')>();
  return {
    ...actual,
    // GGUF 헤더 Range 읽기는 별도 테스트(packages/data) — 여기선 결과만 주입
    measureSplit: vi.fn(async () => ({ expertGB: 17.55, nonExpertGB: 0.82, totalParams: 30.5e9, expertParams: 28.0e9 })),
  };
});

const { loadHfModel } = await import('@/lib/calc/hf-load');
const hf = await import('@canrun/data/hf');

type Routes = Record<string, unknown | ((url: URL) => unknown)>;

/** pathname(+필요 시 검색 쿼리) → JSON. 숫자면 그 상태 코드로 실패 */
function fakeFetch(routes: Routes): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const key = url.pathname === '/api/models' ? `/api/models?filter=${url.searchParams.get('filter')}` : url.pathname;
    const hit = routes[key];
    if (hit === undefined) return new Response('{}', { status: 404 });
    if (typeof hit === 'number') return new Response('{}', { status: hit });
    const body = typeof hit === 'function' ? (hit as (u: URL) => unknown)(url) : hit;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const QWEN3_8B = {
  model_type: 'qwen3',
  num_hidden_layers: 36,
  num_attention_heads: 32,
  num_key_value_heads: 8,
  head_dim: 128,
  hidden_size: 4096,
  max_position_embeddings: 40960,
};
const TREE_8B = [
  { type: 'file', path: 'Qwen3-8B-Q4_K_M.gguf', size: 5_027_783_488 },
  { type: 'file', path: 'Qwen3-8B-Q8_0.gguf', size: 8_709_518_624 },
];

describe('loadHfModel', () => {
  it('original repo → finds the official GGUF repo → dense model with rows (theoretical path)', async () => {
    const f = fakeFetch({
      '/api/models/Qwen/Qwen3-8B': { id: 'Qwen/Qwen3-8B', siblings: [{ rfilename: 'config.json' }], cardData: { license: 'apache-2.0' }, safetensors: { total: 8.19e9 } },
      '/api/models?filter=gguf': [{ id: 'someone/Qwen3-8B-abliterated-GGUF' }, { id: 'unsloth/Qwen3-8B-GGUF' }, { id: 'Qwen/Qwen3-8B-GGUF' }],
      '/api/models/Qwen/Qwen3-8B-GGUF/tree/main': TREE_8B,
      '/Qwen/Qwen3-8B/resolve/main/config.json': QWEN3_8B,
    });
    const r = await loadHfModel('https://huggingface.co/Qwen/Qwen3-8B', f);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r).toMatchObject({ hfId: 'Qwen/Qwen3-8B', baseId: 'Qwen/Qwen3-8B', ggufRepo: 'Qwen/Qwen3-8B-GGUF' });
    expect(r.model.id.startsWith('hf-')).toBe(true);
    expect(r.model.paramsB).toBeCloseTo(8.19, 2);
    expect(r.model.arch.kvBytesPerTokenF16).toBe(36 * 8 * 128 * 4);
    expect(r.rows.map((x) => x.quant)).toEqual(expect.arrayContaining(['Q4_K_M', 'Q8_0']));
  });

  it('a Q4_K file name taken as the Q4_K_M baseline (alias, 10-22 ⑧-b 리뷰) is checked against the header file_type even for a dense model', async () => {
    const routes = (tree: unknown[]) =>
      fakeFetch({
        '/api/models/Qwen/Qwen3-8B': { id: 'Qwen/Qwen3-8B', siblings: [], safetensors: { total: 8.19e9 } },
        '/api/models?filter=gguf': [{ id: 'Qwen/Qwen3-8B-GGUF' }],
        '/api/models/Qwen/Qwen3-8B-GGUF/tree/main': tree,
        '/Qwen/Qwen3-8B/resolve/main/config.json': QWEN3_8B,
      });
    const aliasTree = [
      { type: 'file', path: 'Qwen3-8B-Q4_K.gguf', size: 5_027_783_488 },
      { type: 'file', path: 'Qwen3-8B-MXFP4.gguf', size: 4_600_000_000 },
      { type: 'file', path: 'Qwen3-8B-Q8_0.gguf', size: 8_709_518_624 },
    ];
    const measure = vi.mocked(hf.measureSplit);
    // 헤더 file_type 15(LLAMA_FTYPE_MOSTLY_Q4_K_M) — Q4_K_M 행으로 받는다
    measure.mockClear().mockResolvedValueOnce({ expertGB: 0, nonExpertGB: 5.03, fileType: 15 } as never);
    const ok = await loadHfModel('Qwen/Qwen3-8B', routes(aliasTree));
    expect(measure).toHaveBeenCalledTimes(1);
    expect(ok.kind).toBe('ok');
    if (ok.kind !== 'ok') return;
    expect(ok.rows[0]).toMatchObject({ quant: 'Q4_K_M', fileName: 'Qwen3-8B-Q4_K.gguf' });
    // dense 는 헤더 분할을 쓰지 않는다(파일 형식 대조만)
    expect(ok.rows[0]).not.toHaveProperty('expertGB');
    // 다른 형식(14 = Q4_K_S)이면 그 파일을 빼고 기준 행을 다시 고른다 — MXFP4 가 기준, Q4_K_M 행 없음
    measure.mockClear().mockResolvedValueOnce({ expertGB: 0, nonExpertGB: 4.8, fileType: 14 } as never);
    const wrong = await loadHfModel('Qwen/Qwen3-8B', routes(aliasTree));
    expect(wrong.kind).toBe('ok');
    if (wrong.kind !== 'ok') return;
    expect(wrong.rows.map((x) => x.quant)).toEqual(['MXFP4', 'Q8_0']);
    // 기준 후보가 별칭 파일뿐이면 기준 양자화가 없다
    measure.mockClear().mockResolvedValueOnce({ expertGB: 0, nonExpertGB: 4.8, fileType: 14 } as never);
    expect(await loadHfModel('Qwen/Qwen3-8B', routes([aliasTree[0], aliasTree[2]]))).toMatchObject({ kind: 'error', code: 'no-gguf' });
    // 헤더를 못 읽으면 이름대로 둔다(add-model 과 같다)
    measure.mockClear().mockRejectedValueOnce(new Error('HTTP 503'));
    const unread = await loadHfModel('Qwen/Qwen3-8B', routes(aliasTree));
    expect(unread.kind === 'ok' && unread.rows[0]?.quant).toBe('Q4_K_M');
    // 정확한 Q4_K_M 파일이면 dense 는 헤더를 읽지 않는다(지금까지와 같다)
    measure.mockClear();
    await loadHfModel('Qwen/Qwen3-8B', routes(TREE_8B));
    expect(measure).not.toHaveBeenCalled();
  });

  it('GGUF repo input → base_model config; gated base falls back to the unsloth mirror config', async () => {
    const f = fakeFetch({
      '/api/models/unsloth/Llama-3.1-8B-Instruct-GGUF': {
        id: 'unsloth/Llama-3.1-8B-Instruct-GGUF',
        siblings: [{ rfilename: 'Llama-3.1-8B-Instruct-Q4_K_M.gguf' }],
        cardData: { base_model: 'meta-llama/Llama-3.1-8B-Instruct' },
      },
      '/api/models/meta-llama/Llama-3.1-8B-Instruct': { id: 'meta-llama/Llama-3.1-8B-Instruct', gated: 'manual', safetensors: { total: 8.03e9 }, cardData: { license: 'llama3.1' } },
      '/meta-llama/Llama-3.1-8B-Instruct/resolve/main/config.json': 401,
      '/unsloth/Llama-3.1-8B-Instruct/resolve/main/config.json': {
        model_type: 'llama',
        num_hidden_layers: 32,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        hidden_size: 4096,
        max_position_embeddings: 131072,
      },
      '/api/models/unsloth/Llama-3.1-8B-Instruct-GGUF/tree/main': [{ type: 'file', path: 'Llama-3.1-8B-Instruct-Q4_K_M.gguf', size: 4_920_000_000 }],
    });
    const r = await loadHfModel('hf.co/unsloth/Llama-3.1-8B-Instruct-GGUF:Q4_K_M', f);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.baseId).toBe('meta-llama/Llama-3.1-8B-Instruct');
    expect(r.ggufRepo).toBe('unsloth/Llama-3.1-8B-Instruct-GGUF');
    expect(r.model.arch.kvBytesPerTokenF16).toBe(32 * 8 * 128 * 4);
  });

  it('MoE → measures the baseline file header for the expert split', async () => {
    const f = fakeFetch({
      '/api/models/Qwen/Qwen3-30B-A3B-Instruct-2507': { id: 'Qwen/Qwen3-30B-A3B-Instruct-2507', siblings: [], safetensors: { total: 30.5e9 } },
      '/api/models?filter=gguf': [{ id: 'unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF' }],
      '/api/models/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF/tree/main': [
        { type: 'file', path: 'Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf', size: 18_551_000_000 },
      ],
      '/Qwen/Qwen3-30B-A3B-Instruct-2507/resolve/main/config.json': {
        model_type: 'qwen3_moe',
        num_hidden_layers: 48,
        num_attention_heads: 32,
        num_key_value_heads: 4,
        head_dim: 128,
        hidden_size: 2048,
        max_position_embeddings: 262144,
        num_experts: 128,
        num_experts_per_tok: 8,
      },
    });
    const r = await loadHfModel('Qwen/Qwen3-30B-A3B-Instruct-2507', f);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.model.moe).toBe(true);
    expect(r.model.arch.experts).toBe(128);
    const base = r.rows.find((x) => x.quant === 'Q4_K_M');
    expect(base).toMatchObject({ expertGB: 17.55, nonExpertGB: 0.82 });
  });

  it.each([
    ['not a model', 'invalid'],
    ['https://huggingface.co/datasets/foo/bar', 'invalid'],
  ] as const)('%s → %s', async (text, code) => {
    expect(await loadHfModel(text, fakeFetch({}))).toMatchObject({ kind: 'error', code });
  });

  it('unknown repo → not-found; unsupported architecture → model_type in the error; HF down → network', async () => {
    expect(await loadHfModel('nobody/nothing', fakeFetch({}))).toMatchObject({ kind: 'error', code: 'not-found' });
    const unsupported = fakeFetch({
      '/api/models/state-spaces/mamba2-2.7b': { id: 'state-spaces/mamba2-2.7b', siblings: [] },
      '/state-spaces/mamba2-2.7b/resolve/main/config.json': { model_type: 'mamba2' },
    });
    expect(await loadHfModel('state-spaces/mamba2-2.7b', unsupported)).toMatchObject({ kind: 'error', code: 'unsupported', modelType: 'mamba2' });
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await loadHfModel('Qwen/Qwen3-8B', down)).toMatchObject({ kind: 'error', code: 'network' });
  });

  it('catalog models short-circuit: original id before any request, GGUF repo input after resolving base_model', async () => {
    const catalogIdFor = (id: string) => (id.toLowerCase() === 'qwen/qwen3-8b' ? 'qwen3-8b' : undefined);
    const none = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    expect(await loadHfModel('qwen/QWEN3-8B', none, { catalogIdFor })).toEqual({ kind: 'catalog', hfId: 'qwen/QWEN3-8B', modelId: 'qwen3-8b' });
    expect(none).not.toHaveBeenCalled();
    const f = fakeFetch({
      '/api/models/unsloth/Qwen3-8B-GGUF': { id: 'unsloth/Qwen3-8B-GGUF', siblings: [{ rfilename: 'Qwen3-8B-Q4_K_M.gguf' }], cardData: { base_model: 'Qwen/Qwen3-8B' } },
    });
    expect(await loadHfModel('unsloth/Qwen3-8B-GGUF', f, { catalogIdFor })).toMatchObject({ kind: 'catalog', modelId: 'qwen3-8b' });
  });

  it('renamed repos: the canonical id HF returns is checked against the catalog too', async () => {
    const catalogIdFor = (id: string) => (id.toLowerCase() === 'qwen/qwen3-8b' ? 'qwen3-8b' : undefined);
    const f = fakeFetch({ '/api/models/Qwen/Qwen3-8B-Old': { id: 'Qwen/Qwen3-8B', siblings: [] } });
    expect(await loadHfModel('Qwen/Qwen3-8B-Old', f, { catalogIdFor })).toMatchObject({ kind: 'catalog', modelId: 'qwen3-8b' });
  });

  it('GGUF repo without base_model → no-base; GGUF repo without Q4_K_M → no-base-quant', async () => {
    const noBase = fakeFetch({ '/api/models/x/Thing-GGUF': { id: 'x/Thing-GGUF', siblings: [{ rfilename: 'Thing-Q4_K_M.gguf' }] } });
    expect(await loadHfModel('x/Thing-GGUF', noBase)).toMatchObject({ kind: 'error', code: 'no-base' });
    const noQ4 = fakeFetch({
      '/api/models/x/Qwen3-4B-GGUF': { id: 'x/Qwen3-4B-GGUF', siblings: [{ rfilename: 'Qwen3-4B-Q8_0.gguf' }], cardData: { base_model: 'Qwen/Qwen3-4B' } },
      '/api/models/Qwen/Qwen3-4B': { id: 'Qwen/Qwen3-4B', safetensors: { total: 4.02e9 } },
      '/Qwen/Qwen3-4B/resolve/main/config.json': QWEN3_8B,
      '/api/models/x/Qwen3-4B-GGUF/tree/main': [{ type: 'file', path: 'Qwen3-4B-Q8_0.gguf', size: 4.28e9 }],
    });
    expect(await loadHfModel('x/Qwen3-4B-GGUF', noQ4)).toMatchObject({ kind: 'error', code: 'no-base-quant' });
  });

  it('a known model_type rejected for another reason does not blame the model_type', async () => {
    const f = fakeFetch({
      '/api/models/x/SlidingAll': { id: 'x/SlidingAll', siblings: [] },
      '/x/SlidingAll/resolve/main/config.json': {
        model_type: 'mistral', num_hidden_layers: 32, num_attention_heads: 32, num_key_value_heads: 8, hidden_size: 4096, max_position_embeddings: 32768, sliding_window: 4096,
      },
    });
    const r = await loadHfModel('x/SlidingAll', f);
    expect(r).toMatchObject({ kind: 'error', code: 'unsupported' });
    expect(r).not.toHaveProperty('modelType');
  });

  it('no Q4_K_M GGUF anywhere → no-gguf', async () => {
    const f = fakeFetch({
      '/api/models/Qwen/Qwen3-8B': { id: 'Qwen/Qwen3-8B', siblings: [], safetensors: { total: 8.19e9 } },
      '/api/models?filter=gguf': [{ id: 'Qwen/Qwen3-8B-GGUF' }],
      '/api/models/Qwen/Qwen3-8B-GGUF/tree/main': [{ type: 'file', path: 'Qwen3-8B-Q8_0.gguf', size: 8.7e9 }],
      '/Qwen/Qwen3-8B/resolve/main/config.json': QWEN3_8B,
    });
    expect(await loadHfModel('Qwen/Qwen3-8B', f)).toMatchObject({ kind: 'error', code: 'no-gguf' });
  });
});
