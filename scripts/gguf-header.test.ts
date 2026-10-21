/** GGUF 헤더 파서·분할 분류 — 합성 GGUF 버퍼로 검증(네트워크 없음, fetchImpl 주입). */
import { describe, expect, it } from 'vitest';
import type { FetchLike } from './hf-common';
import {
  GgufNeedMoreBytesError,
  classifySplit,
  fetchGgufHeader,
  measureSplit,
  parseGgufHeader,
  resolveUrl,
  shardFileNames,
  tensorBytes,
  type GgufHeader,
} from './gguf-header';

// --- 합성 GGUF 작성기 -------------------------------------------------------

type Kv =
  | { key: string; u32: number }
  | { key: string; u16: number }
  | { key: string; str: string }
  | { key: string; strArray: string[] }
  | { key: string; f32: number }
  | { key: string; bool: boolean };
type T = { name: string; dims: number[]; type: number };

class Writer {
  private readonly chunks: Uint8Array[] = [];
  private fixed(size: number, set: (v: DataView) => void): this {
    const b = new Uint8Array(size);
    set(new DataView(b.buffer));
    this.chunks.push(b);
    return this;
  }
  u16(v: number): this {
    return this.fixed(2, (d) => d.setUint16(0, v, true));
  }
  u32(v: number): this {
    return this.fixed(4, (d) => d.setUint32(0, v, true));
  }
  u64(v: number): this {
    return this.fixed(8, (d) => d.setBigUint64(0, BigInt(v), true));
  }
  f32(v: number): this {
    return this.fixed(4, (d) => d.setFloat32(0, v, true));
  }
  u8(v: number): this {
    return this.fixed(1, (d) => d.setUint8(0, v));
  }
  str(s: string): this {
    const bytes = new TextEncoder().encode(s);
    this.u64(bytes.length);
    this.chunks.push(bytes);
    return this;
  }
  build(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

function gguf(kvs: Kv[], tensors: T[]): Uint8Array {
  const w = new Writer().u32(0x46554747).u32(3).u64(tensors.length).u64(kvs.length);
  for (const kv of kvs) {
    w.str(kv.key);
    if ('u32' in kv) w.u32(4).u32(kv.u32);
    else if ('u16' in kv) w.u32(2).u16(kv.u16);
    else if ('str' in kv) w.u32(8).str(kv.str);
    else if ('f32' in kv) w.u32(6).f32(kv.f32);
    else if ('bool' in kv) w.u32(7).u8(kv.bool ? 1 : 0);
    else {
      w.u32(9).u32(8).u64(kv.strArray.length);
      for (const s of kv.strArray) w.str(s);
    }
  }
  let offset = 0;
  for (const t of tensors) {
    w.str(t.name).u32(t.dims.length);
    for (const d of t.dims) w.u64(d);
    w.u32(t.type).u64(offset);
    offset += 1024;
  }
  return w.build();
}

// ggml 타입 번호 (ggml.h)
const F32 = 0;
const F16 = 1;
const Q8_0 = 8;
const Q4_K = 12;
const MXFP4 = 39;

const META: Kv[] = [
  { key: 'general.architecture', str: 'qwen35moe' },
  { key: 'qwen35moe.block_count', u32: 3 },
  { key: 'qwen35moe.nextn_predict_layers', u32: 1 },
  { key: 'qwen35moe.expert_count', u32: 4 },
  { key: 'qwen35moe.expert_used_count', u32: 2 },
  { key: 'general.name', str: 'synthetic' },
  { key: 'qwen35moe.rope.freq_base', f32: 1e6 },
  { key: 'tokenizer.ggml.add_bos_token', bool: false },
  // 큰 문자열 배열 — 값은 저장하지 않고 길이만 (토크나이저 어휘 흉내)
  { key: 'tokenizer.ggml.tokens', strArray: Array.from({ length: 1500 }, (_, i) => `tok${i}`) },
];

/** 바이트: token_embd 160 · output 320 · output_norm 32 · attn_q 136 · router 128 · shexp 64 ·
 *  exps 1152+272+128 · MTP blk.2 68 · nextn 128 */
const TENSORS: T[] = [
  { name: 'token_embd.weight', dims: [8, 10], type: F16 },
  { name: 'output.weight', dims: [8, 10], type: F32 },
  { name: 'output_norm.weight', dims: [8], type: F32 },
  { name: 'blk.0.attn_q.weight', dims: [32, 4], type: Q8_0 },
  { name: 'blk.0.ffn_gate_inp.weight', dims: [8, 4], type: F32 },
  { name: 'blk.0.ffn_up_shexp.weight', dims: [8, 4], type: F16 },
  { name: 'blk.0.ffn_gate_exps.weight', dims: [256, 2, 4], type: Q4_K },
  { name: 'blk.1.ffn_down_exps.weight', dims: [32, 4, 4], type: MXFP4 },
  { name: 'blk.1.ffn_gate_up_exps.bias', dims: [8, 4], type: F32 },
  { name: 'blk.2.ffn_gate_exps.weight', dims: [32, 2], type: Q8_0 },
  { name: 'blk.2.nextn.eh_proj.weight', dims: [8, 8], type: F16 },
];

const untied = gguf(META, TENSORS);
const tied = gguf(META, TENSORS.filter((t) => t.name !== 'output.weight'));

// --- 파서 --------------------------------------------------------------------

describe('parseGgufHeader', () => {
  it('reads metadata and tensor infos (big arrays keep only their length)', () => {
    const h = parseGgufHeader(untied);
    expect(h.version).toBe(3);
    expect(h.kv['general.architecture']).toBe('qwen35moe');
    expect(h.kv['qwen35moe.block_count']).toBe(3);
    expect(h.kv['tokenizer.ggml.add_bos_token']).toBe(false);
    expect(h.kv['qwen35moe.rope.freq_base']).toBe(1e6);
    expect(h.kv['tokenizer.ggml.tokens']).toEqual({ arrayType: 8, count: 1500 });
    expect(h.tensors).toHaveLength(TENSORS.length);
    expect(h.tensors[6]).toEqual({ name: 'blk.0.ffn_gate_exps.weight', dims: [256, 2, 4], type: Q4_K });
    expect(h.headerBytes).toBe(untied.length);
  });

  it('throws GgufNeedMoreBytesError on any truncated prefix — and plain Error on a bad magic', () => {
    for (const n of [0, 3, 20, 100, 5000, untied.length - 1]) {
      expect(() => parseGgufHeader(untied.subarray(0, n)), `prefix ${n}`).toThrow(GgufNeedMoreBytesError);
    }
    const bad = untied.slice();
    bad[0] = 0x00;
    let caught: unknown;
    try {
      parseGgufHeader(bad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(GgufNeedMoreBytesError);
  });
});

describe('tensorBytes', () => {
  it('follows ggml_nbytes for block types and fails loudly on unknown types', () => {
    expect(tensorBytes({ name: 'a', dims: [256, 2, 4], type: Q4_K })).toBe(144 * 8);
    expect(tensorBytes({ name: 'b', dims: [2880, 2880], type: MXFP4 })).toBe((2880 / 32) * 17 * 2880);
    expect(() => tensorBytes({ name: 'c', dims: [32], type: 4 })).toThrow('unknown ggml type 4');
    expect(() => tensorBytes({ name: 'd', dims: [30], type: Q8_0 })).toThrow('not divisible');
  });
});

// --- 분류 --------------------------------------------------------------------

describe('classifySplit', () => {
  it('untied: token_embd → CPU only, MTP block + nextn excluded, routed experts vs the rest', () => {
    const m = classifySplit([parseGgufHeader(untied)]);
    expect(m.bytes).toEqual({
      expert: 1152 + 272 + 128,
      nonExpert: 320 + 32 + 136 + 128 + 64,
      valueExpert: 0,
      cpu: 160,
      ple: 0,
      mtp: 68 + 128,
      // 트렁크 blk.0~1 (MTP blk.2 제외) — 반복 층 모델의 반복 블록과 같은 합 (10-22 D114)
      block: 136 + 128 + 64 + 1152 + 272 + 128,
      total: 160 + 320 + 32 + 136 + 128 + 64 + 1152 + 272 + 128 + 68 + 128,
    });
    expect(m).toMatchObject({ arch: 'qwen35moe', trunkLayers: 2, mtpLayers: 1, expertCount: 4, expertUsed: 2, tiedEmbeddings: false });
    expect(m).not.toHaveProperty('numLoops');
  });

  it('tied (no output.weight): token_embd counted once on the GPU side as the output layer', () => {
    const m = classifySplit([parseGgufHeader(tied)]);
    expect(m.tiedEmbeddings).toBe(true);
    expect(m.bytes.nonExpert).toBe(32 + 136 + 128 + 64 + 160);
    expect(m.bytes.cpu).toBe(160);
  });

  it('split shards: metadata from the first shard, tensors summed across shards', () => {
    const shard1 = gguf([...META, { key: 'split.no', u16: 0 }, { key: 'split.count', u16: 2 }], TENSORS.slice(0, 5));
    const shard2 = gguf([{ key: 'split.no', u16: 1 }, { key: 'split.count', u16: 2 }], TENSORS.slice(5));
    const headers = [parseGgufHeader(shard1), parseGgufHeader(shard2)];
    expect(classifySplit(headers).bytes).toEqual(classifySplit([parseGgufHeader(untied)]).bytes);
    expect(() => classifySplit(headers.slice(0, 1))).toThrow('split.count 2');
  });

  it('input-layer tensors stay on the CPU; token_embd_norm is a repeating-layer tensor on the GPU (10-03 D62)', () => {
    const dense: Kv[] = [{ key: 'general.architecture', str: 'llama' }, { key: 'llama.block_count', u32: 1 }];
    const m = classifySplit([
      parseGgufHeader(
        gguf(dense, [
          { name: 'token_embd.weight', dims: [8, 10], type: F16 }, // 160
          { name: 'token_embd_norm.weight', dims: [8], type: F32 }, // 32 — GPU (반복층)
          { name: 'per_layer_token_embd.weight', dims: [8, 10], type: F16 }, // 160
          { name: 'position_embd.weight', dims: [8, 4], type: F16 }, // 64
          { name: 'token_types.weight', dims: [8, 2], type: F32 }, // 64
          { name: 'output.weight', dims: [8, 10], type: F32 }, // 320
          { name: 'blk.0.attn_q.weight', dims: [32, 4], type: Q8_0 }, // 136
        ]),
      ),
    ]);
    expect(m.bytes.cpu).toBe(160 + 160 + 64 + 64);
    expect(m.bytes.nonExpert).toBe(32 + 320 + 136);
    expect(m.bytes.expert).toBe(0);
    // 층별 임베딩 표(PLE)는 입력층 cpu 몫 안에 있고 따로도 보고한다 (10-21 D112)
    expect(m.bytes.ple).toBe(160);
    expect(m.pleGB).toBe(0);
  });

  it('Gemma 4 E4B shape: the per-layer embedding table is reported as pleGB inside the CPU share; the tied token_embd also counts as the GPU output layer (10-21 D112)', () => {
    // 실제 E4B 텐서 모양(262144 어휘 × 42층 × 256 = PLE, 2560 × 262144 = token_embd) — unsloth Q4_K_M 의 형식(PLE Q5_K · token_embd Q4_K)
    const Q5_K = 13;
    const meta: Kv[] = [{ key: 'general.architecture', str: 'gemma4' }, { key: 'gemma4.block_count', u32: 1 }];
    const m = classifySplit([
      parseGgufHeader(
        gguf(meta, [
          { name: 'token_embd.weight', dims: [2560, 262144], type: Q4_K }, // 377,487,360
          { name: 'per_layer_token_embd.weight', dims: [256 * 42, 262144], type: Q5_K }, // 1,937,768,448
          { name: 'blk.0.attn_q.weight', dims: [2560, 2048], type: Q4_K }, // 2,949,120
        ]),
      ),
    ]);
    expect(m.bytes.ple).toBe(1_937_768_448);
    expect(m.bytes.cpu).toBe(377_487_360 + 1_937_768_448);
    expect(m.bytes.nonExpert).toBe(377_487_360 + 2_949_120); // 출력층 사본 + 블록
    expect(m.pleGB).toBe(1.94);
    expect(m.tiedEmbeddings).toBe(true);
  });

  it('Nanbeige4.2 shape (10-22 D114): blockGB = trunk blk.N.* only (not token_embd·output), numLoops from <arch>.num_loops', () => {
    // 실제 bartowski Q4_K_M 의 입출력 모양(3072 × 166,144 — token_embd Q4_K · output Q6_K)과 블록 하나
    const Q6_K = 14;
    const meta: Kv[] = [
      { key: 'general.architecture', str: 'nanbeige' },
      { key: 'nanbeige.block_count', u32: 1 },
      { key: 'nanbeige.num_loops', u32: 2 },
      { key: 'nanbeige.skip_loop_final_norm', bool: false },
    ];
    const m = classifySplit([
      parseGgufHeader(
        gguf(meta, [
          { name: 'token_embd.weight', dims: [3072, 166_144], type: Q4_K }, // 287,096,832
          { name: 'output.weight', dims: [3072, 166_144], type: Q6_K }, // 418,682,880
          { name: 'output_norm.weight', dims: [3072], type: F32 }, // 12,288
          { name: 'blk.0.attn_q.weight', dims: [3072, 6144], type: Q4_K }, // 10,616,832
          { name: 'blk.0.attn_norm.weight', dims: [3072], type: F32 }, // 12,288
        ]),
      ),
    ]);
    expect(m.bytes.cpu).toBe(287_096_832);
    expect(m.bytes.block).toBe(10_616_832 + 12_288);
    expect(m.bytes.nonExpert).toBe(418_682_880 + 12_288 + 10_616_832 + 12_288);
    expect(m.blockGB).toBe(0.01);
    expect(m.numLoops).toBe(2);
    expect(m.tiedEmbeddings).toBe(false);
  });

  it('a model without MTP keeps every block in the trunk; missing arch keys fail', () => {
    const noMtp = gguf(
      META.filter((k) => k.key !== 'qwen35moe.nextn_predict_layers'),
      TENSORS.filter((t) => !t.name.includes('nextn')),
    );
    const m = classifySplit([parseGgufHeader(noMtp)]);
    expect(m.trunkLayers).toBe(3);
    expect(m.bytes.mtp).toBe(0);
    expect(m.bytes.expert).toBe(1152 + 272 + 128 + 68);
    const noArch: GgufHeader = { version: 3, kv: {}, tensors: [], headerBytes: 0 };
    expect(() => classifySplit([noArch])).toThrow('general.architecture');
  });
});

describe('shardFileNames / resolveUrl', () => {
  it('expands the first shard path to every shard; single files pass through', () => {
    expect(shardFileNames('Q8_0/M-Q8_0-00001-of-00003.gguf')).toEqual([
      'Q8_0/M-Q8_0-00001-of-00003.gguf',
      'Q8_0/M-Q8_0-00002-of-00003.gguf',
      'Q8_0/M-Q8_0-00003-of-00003.gguf',
    ]);
    expect(shardFileNames('m-Q4_K_M.gguf')).toEqual(['m-Q4_K_M.gguf']);
    expect(resolveUrl('org/m-GGUF', 'Q8_0/m Q8.gguf')).toBe('https://huggingface.co/org/m-GGUF/resolve/main/Q8_0/m%20Q8.gguf');
  });
});

// --- Range 읽기 (fetch 모킹) --------------------------------------------------

/** Range 를 지원하는 가짜 서버 — 요청 범위를 기록한다. ignoreRange 면 200 으로 전체를 준다. */
function rangeServer(files: Record<string, Uint8Array>, opts: { ignoreRange?: boolean } = {}) {
  const calls: Array<{ url: string; range: string | null }> = [];
  const fetchImpl: FetchLike = (input, init) => {
    const url = String(input);
    const range = new Headers(init?.headers).get('range');
    calls.push({ url, range });
    const body = files[url];
    if (!body) return Promise.resolve(new Response('', { status: 404 }));
    if (opts.ignoreRange || range === null) {
      return Promise.resolve(new Response(body.slice(), { status: 200, headers: { 'content-length': String(body.length) } }));
    }
    const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range)!;
    const start = Number(s);
    const end = Math.min(Number(e), body.length - 1);
    return Promise.resolve(
      new Response(body.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${body.length}` },
      }),
    );
  };
  return { fetchImpl, calls };
}

describe('fetchGgufHeader', () => {
  const url = resolveUrl('org/m-GGUF', 'm.gguf');
  const padded = new Uint8Array(untied.length + 4096); // 헤더 뒤 텐서 데이터 흉내
  padded.set(untied, 0);

  it('doubles the Range until the header fits, fetching only the missing tail each time', async () => {
    const { fetchImpl, calls } = rangeServer({ [url]: padded });
    const res = await fetchGgufHeader(url, { fetchImpl, initialBytes: 1024, maxBytes: 64 * 1024 });
    expect(res.header.tensors).toHaveLength(TENSORS.length);
    expect(res.fileBytes).toBe(padded.length);
    const expected = ['bytes=0-1023'];
    for (let s = 1024; expected.length < calls.length; s *= 2) expected.push(`bytes=${s}-${2 * s - 1}`);
    expect(calls.map((c) => c.range)).toEqual(expected);
    expect(calls.length).toBe(Math.ceil(Math.log2(untied.length / 1024)) + 1);
  });

  it('caps the read when the server ignores Range (200)', async () => {
    const { fetchImpl } = rangeServer({ [url]: padded }, { ignoreRange: true });
    const res = await fetchGgufHeader(url, { fetchImpl, initialBytes: 1024, maxBytes: 64 * 1024 });
    expect(res.header.kv['general.architecture']).toBe('qwen35moe');
  });

  it('fails when the header does not fit under maxBytes, on truncation and on HTTP errors', async () => {
    const { fetchImpl } = rangeServer({ [url]: padded });
    await expect(fetchGgufHeader(url, { fetchImpl, initialBytes: 512, maxBytes: 2048 })).rejects.toThrow('exceeds 2048');
    const cut = rangeServer({ [url]: untied.subarray(0, 3000) });
    await expect(fetchGgufHeader(url, { fetchImpl: cut.fetchImpl, initialBytes: 1024, maxBytes: 64 * 1024 })).rejects.toThrow('truncated');
    await expect(fetchGgufHeader(`${url}x`, { fetchImpl })).rejects.toThrow('HTTP 404');
  });
});

describe('measureSplit', () => {
  it('reads every shard header and sums file sizes', async () => {
    const shard1 = gguf([...META, { key: 'split.no', u16: 0 }, { key: 'split.count', u16: 2 }], TENSORS.slice(0, 5));
    const shard2 = gguf([{ key: 'split.no', u16: 1 }, { key: 'split.count', u16: 2 }], TENSORS.slice(5));
    const repo = 'org/m-GGUF';
    const { fetchImpl, calls } = rangeServer({
      [resolveUrl(repo, 'Q8_0/m-Q8_0-00001-of-00002.gguf')]: shard1,
      [resolveUrl(repo, 'Q8_0/m-Q8_0-00002-of-00002.gguf')]: shard2,
    });
    const m = await measureSplit(repo, 'Q8_0/m-Q8_0-00001-of-00002.gguf', { fetchImpl, initialBytes: 64 * 1024 });
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['m-Q8_0-00001-of-00002.gguf', 'm-Q8_0-00002-of-00002.gguf']);
    expect(m.shards).toBe(2);
    expect(m.bytes).toEqual(classifySplit([parseGgufHeader(untied)]).bytes);
    expect(m.fileGB).toBe(0); // 수 KB — 2자리 GB 로는 0
  });

  it('offGpuGB = file bytes − GPU-resident tensors (input layer, MTP block, header), gpuGB rounded once', async () => {
    // 텐서 데이터는 보내지 않고 크기만 선언한다 — Content-Range 의 전체 길이 = 헤더 + 텐서 합
    const meta: Kv[] = [
      { key: 'general.architecture', str: 'qwen35' },
      { key: 'qwen35.block_count', u32: 2 },
      { key: 'qwen35.nextn_predict_layers', u32: 1 },
    ];
    const tensors: T[] = [
      { name: 'token_embd.weight', dims: [4096, 151936], type: Q4_K }, // 350,060,544 — CPU
      { name: 'output.weight', dims: [4096, 151936], type: Q8_0 }, // 661,192,704
      { name: 'blk.0.attn_q.weight', dims: [4096, 1_000_000], type: Q4_K }, // 2,304,000,000
      { name: 'blk.1.attn_q.weight', dims: [4096, 200_000], type: Q8_0 }, // 870,400,000 — MTP 블록(미적재)
    ];
    const header = gguf(meta, tensors);
    const tensorBytesTotal = 350_060_544 + 661_192_704 + 2_304_000_000 + 870_400_000;
    const declared = header.length + tensorBytesTotal;
    const repo = 'org/dense-GGUF';
    const fetchImpl: FetchLike = (_input, init) => {
      const range = new Headers(init?.headers).get('range') ?? 'bytes=0-0';
      const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range)!;
      const start = Number(s);
      const end = Math.min(Number(e), header.length - 1);
      return Promise.resolve(
        new Response(header.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${declared}` } }),
      );
    };
    const m = await measureSplit(repo, 'dense-Q4_K_M.gguf', { fetchImpl });
    expect(m.gpuGB).toBe(Math.round((661_192_704 + 2_304_000_000) / 1e7) / 100);
    expect(m.mtpGB).toBe(0.87);
    expect(m.cpuGB).toBe(0.35);
    // 파일 4.19 − GPU 2.97 = 1.22 (입력 임베딩 0.35 + MTP 0.87 + 헤더 수 KB)
    expect(m.fileGB).toBe(4.19);
    expect(m.offGpuGB).toBe(Math.round((declared - 661_192_704 - 2_304_000_000) / 1e7) / 100);
    expect(m.offGpuGB).toBeCloseTo(m.cpuGB + m.mtpGB, 2);
  });
});
