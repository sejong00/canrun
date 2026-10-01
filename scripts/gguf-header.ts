/**
 * GGUF 헤더 실측 — MoE 텐서 분할(전문가 / GPU 상주 비전문가)을 파일 헤더에서 직접 잰다 (10-01).
 *
 * 왜: `packages/data/src/derive.ts` 의 bpw 균등 유도는 비전문가 텐서를 최대 3배 과소 추정한다
 * (gpt-oss-20b 유도 0.65GB vs 실측 1.30GB). 양자화 믹스가 텐서마다 달라서 — 헤더의 텐서 정보로만 정확하다.
 * 파일 전체를 받지 않는다: HTTP Range 로 앞쪽 8MB 부터 읽고, 모자라면 두 배씩(최대 64MB) 더 읽는다.
 *
 * 분할 규칙 (llama.cpp src/llama-model.cpp 기준):
 *  - 라우팅 전문가 = 이름에 `_exps`·`_chexps` (ffn_{gate,up,down,gate_up}_exps 의 weight/bias/scale).
 *    공유 전문가(`_shexp`)·라우터(`ffn_gate_inp`)·어텐션·노름·dense FFN·output 은 GPU 비전문가.
 *  - `token_embd*`(입력층)은 항상 CPU — cpuGB. 단 `output.weight` 가 없으면(임베딩 공유, gemma 등)
 *    llama.cpp 가 token_embd 를 출력층으로 GPU 에 복제하므로 token_embd.weight 를 비전문가에 한 번 더한다.
 *  - MTP/NextN 블록은 기본 미적재(load_mtp=false → TENSOR_SKIP): `<arch>.nextn_predict_layers` 개의 마지막 블록과
 *    이름에 `nextn`·`mtp.` 접두가 있는 텐서 — 두 합계 모두에서 빼고 mtpGB 로 따로 보고.
 *
 * GGUF v2/v3 (little-endian): magic 'GGUF', u32 version, u64 tensor_count, u64 kv_count,
 * KV(문자열 키 · u32 값 타입 · 값), 텐서 정보(이름 · u32 n_dims · u64 dims[n] · u32 ggml type · u64 offset).
 *
 * 실행(읽기 전용): pnpm exec tsx scripts/gguf-header.ts <repo> <fileName>  → JSON 출력
 * 시크릿 제로(CLAUDE.md 규칙 7): HF_TOKEN 은 env 로만 — 공개 repo 는 무토큰으로 충분.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authHeaders, fetchWithRetry, type FetchLike } from './hf-common';

// ---------------------------------------------------------------------------
// ggml 타입 표 — 출처: ggml/include/ggml.h (enum ggml_type), ggml/src/ggml-common.h (block 크기 static_assert),
// ggml/src/ggml.c (type_traits). 10-01 master 대조. 모르는 타입은 조용히 넘기지 않고 throw.
// ---------------------------------------------------------------------------

export type GgmlTypeInfo = { name: string; blockSize: number; typeSize: number };

export const GGML_TYPES: Readonly<Record<number, GgmlTypeInfo>> = Object.freeze({
  0: { name: 'F32', blockSize: 1, typeSize: 4 },
  1: { name: 'F16', blockSize: 1, typeSize: 2 },
  2: { name: 'Q4_0', blockSize: 32, typeSize: 18 },
  3: { name: 'Q4_1', blockSize: 32, typeSize: 20 },
  6: { name: 'Q5_0', blockSize: 32, typeSize: 22 },
  7: { name: 'Q5_1', blockSize: 32, typeSize: 24 },
  8: { name: 'Q8_0', blockSize: 32, typeSize: 34 },
  9: { name: 'Q8_1', blockSize: 32, typeSize: 36 },
  10: { name: 'Q2_K', blockSize: 256, typeSize: 84 },
  11: { name: 'Q3_K', blockSize: 256, typeSize: 110 },
  12: { name: 'Q4_K', blockSize: 256, typeSize: 144 },
  13: { name: 'Q5_K', blockSize: 256, typeSize: 176 },
  14: { name: 'Q6_K', blockSize: 256, typeSize: 210 },
  15: { name: 'Q8_K', blockSize: 256, typeSize: 292 },
  16: { name: 'IQ2_XXS', blockSize: 256, typeSize: 66 },
  17: { name: 'IQ2_XS', blockSize: 256, typeSize: 74 },
  18: { name: 'IQ3_XXS', blockSize: 256, typeSize: 98 },
  19: { name: 'IQ1_S', blockSize: 256, typeSize: 50 },
  20: { name: 'IQ4_NL', blockSize: 32, typeSize: 18 },
  21: { name: 'IQ3_S', blockSize: 256, typeSize: 110 },
  22: { name: 'IQ2_S', blockSize: 256, typeSize: 82 },
  23: { name: 'IQ4_XS', blockSize: 256, typeSize: 136 },
  24: { name: 'I8', blockSize: 1, typeSize: 1 },
  25: { name: 'I16', blockSize: 1, typeSize: 2 },
  26: { name: 'I32', blockSize: 1, typeSize: 4 },
  27: { name: 'I64', blockSize: 1, typeSize: 8 },
  28: { name: 'F64', blockSize: 1, typeSize: 8 },
  29: { name: 'IQ1_M', blockSize: 256, typeSize: 56 },
  30: { name: 'BF16', blockSize: 1, typeSize: 2 },
  34: { name: 'TQ1_0', blockSize: 256, typeSize: 54 },
  35: { name: 'TQ2_0', blockSize: 256, typeSize: 66 },
  39: { name: 'MXFP4', blockSize: 32, typeSize: 17 },
  40: { name: 'NVFP4', blockSize: 64, typeSize: 36 },
  41: { name: 'Q1_0', blockSize: 128, typeSize: 18 },
  42: { name: 'Q2_0', blockSize: 64, typeSize: 18 },
});

// ---------------------------------------------------------------------------
// 파서 (순수)
// ---------------------------------------------------------------------------

/** 버퍼가 헤더 끝까지 닿지 않음 — 호출자가 더 큰 Range 로 다시 읽는다. */
export class GgufNeedMoreBytesError extends Error {
  override readonly name = 'GgufNeedMoreBytesError';
  constructor(
    readonly have: number,
    /** 지금 읽던 필드를 끝내는 데 필요한 최소 바이트 (헤더 전체 크기는 아님) */
    readonly need: number,
  ) {
    super(`GGUF header needs more bytes (have ${have}, need at least ${need})`);
  }
}

export type GgufScalar = number | boolean | string;
/** 큰 배열(토크나이저 어휘 등)은 값 없이 길이만 — 헤더 크기만큼 메모리를 쓰지 않게 */
export type GgufArray = { arrayType: number; count: number; values?: GgufScalar[] };
export type GgufValue = GgufScalar | GgufArray;

export type GgufTensorInfo = { name: string; dims: number[]; type: number };

export type GgufHeader = {
  version: number;
  kv: Record<string, GgufValue>;
  tensors: GgufTensorInfo[];
  /** 텐서 정보 끝 오프셋(정렬 패딩 전) */
  headerBytes: number;
};

const GGUF_MAGIC = 0x46554747; // 'GGUF' little-endian
const MAX_STORED_ARRAY = 1024;
const MAX_STRING_BYTES = 1 << 26;
const MAX_DIMS = 4;

const VT = {
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12,
} as const;

const utf8 = new TextDecoder('utf-8');

class Reader {
  pos = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(n: number): void {
    if (this.pos + n > this.bytes.byteLength) {
      throw new GgufNeedMoreBytesError(this.bytes.byteLength, this.pos + n);
    }
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  /** u64 → number. 2^53 초과는 손상 파일로 본다(카운트·차원·오프셋 어느 것도 닿지 않는다). */
  u64(): number {
    this.need(8);
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`GGUF u64 out of range at ${this.pos - 8}`);
    return Number(v);
  }
  i64(): number {
    this.need(8);
    const v = this.view.getBigInt64(this.pos, true);
    this.pos += 8;
    return Number(v);
  }
  str(): string {
    const len = this.u64();
    if (len > MAX_STRING_BYTES) throw new Error(`GGUF string too long (${len}) at ${this.pos - 8} — corrupt header`);
    this.need(len);
    const s = utf8.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
}

function readScalar(r: Reader, type: number): GgufScalar {
  switch (type) {
    case VT.UINT8:
      return r.u8();
    case VT.INT8:
      return r.i8();
    case VT.UINT16:
      return r.u16();
    case VT.INT16:
      return r.i16();
    case VT.UINT32:
      return r.u32();
    case VT.INT32:
      return r.i32();
    case VT.FLOAT32:
      return r.f32();
    case VT.BOOL:
      return r.u8() !== 0;
    case VT.STRING:
      return r.str();
    case VT.UINT64:
      return r.u64();
    case VT.INT64:
      return r.i64();
    case VT.FLOAT64:
      return r.f64();
    default:
      throw new Error(`unknown GGUF value type ${type}`);
  }
}

function readValue(r: Reader, type: number): GgufValue {
  if (type !== VT.ARRAY) return readScalar(r, type);
  const arrayType = r.u32();
  const count = r.u64();
  if (arrayType === VT.ARRAY) throw new Error('nested GGUF arrays are not supported');
  const keep = count <= MAX_STORED_ARRAY;
  const values: GgufScalar[] = [];
  for (let i = 0; i < count; i += 1) {
    const v = readScalar(r, arrayType);
    if (keep) values.push(v);
  }
  return keep ? { arrayType, count, values } : { arrayType, count };
}

/**
 * GGUF 헤더(메타데이터 + 텐서 정보) 파싱. 버퍼가 짧으면 GgufNeedMoreBytesError — 다른 오류(매직·버전·손상)는 일반 Error.
 */
export function parseGgufHeader(buf: Uint8Array): GgufHeader {
  const r = new Reader(buf);
  const magic = r.u32();
  if (magic !== GGUF_MAGIC) throw new Error('not a GGUF file (bad magic)');
  const version = r.u32();
  if (version !== 2 && version !== 3) throw new Error(`unsupported GGUF version ${version}`);
  const tensorCount = r.u64();
  const kvCount = r.u64();
  const kv: Record<string, GgufValue> = {};
  for (let i = 0; i < kvCount; i += 1) {
    const key = r.str();
    const type = r.u32();
    kv[key] = readValue(r, type);
  }
  const tensors: GgufTensorInfo[] = [];
  for (let i = 0; i < tensorCount; i += 1) {
    const name = r.str();
    const nDims = r.u32();
    if (nDims < 1 || nDims > MAX_DIMS) throw new Error(`tensor ${name}: invalid n_dims ${nDims}`);
    const dims: number[] = [];
    for (let d = 0; d < nDims; d += 1) dims.push(r.u64());
    const type = r.u32();
    r.u64(); // offset — 분할 측정에는 불필요
    tensors.push({ name, dims, type });
  }
  return { version, kv, tensors, headerBytes: r.pos };
}

/** 텐서 바이트 (ggml_nbytes 와 같은 산식: ne0/block × type_size × 나머지 차원). */
export function tensorBytes(t: GgufTensorInfo): number {
  const info = GGML_TYPES[t.type];
  if (!info) {
    throw new Error(`unknown ggml type ${t.type} (tensor ${t.name}) — add it from ggml/include/ggml.h + ggml-common.h`);
  }
  const [ne0 = 1, ...rest] = t.dims;
  if (ne0 % info.blockSize !== 0) {
    throw new Error(`tensor ${t.name}: ne0 ${ne0} not divisible by ${info.name} block ${info.blockSize}`);
  }
  return (ne0 / info.blockSize) * info.typeSize * rest.reduce((a, b) => a * b, 1);
}

// ---------------------------------------------------------------------------
// 분류·합산 (순수)
// ---------------------------------------------------------------------------

export type SplitMeasure = {
  /** 라우팅 전문가(트렁크 블록) — decimal GB 2자리 */
  expertGB: number;
  /** GPU 상주 비전문가 — token_embd 제외(공유 임베딩이면 1회 포함), MTP 제외 */
  nonExpertGB: number;
  /** token_embd* (입력층, 항상 CPU) */
  cpuGB: number;
  /** 기본 미적재 MTP/NextN 블록 */
  mtpGB: number;
  /** 전 텐서 합 (분할 파일 합산) */
  totalGB: number;
  arch: string;
  /** block_count − nextn_predict_layers */
  trunkLayers: number;
  mtpLayers: number;
  expertCount?: number;
  expertUsed?: number;
  /** output.weight 없음 → token_embd 를 출력층으로 공유 */
  tiedEmbeddings: boolean;
  /** 원시 바이트 — 반올림 전 정밀값 */
  bytes: { expert: number; nonExpert: number; cpu: number; mtp: number; total: number };
};

const round2 = (x: number): number => Math.round(x * 100) / 100;
const gb = (bytes: number): number => round2(bytes / 1e9);

function numKv(kv: Record<string, GgufValue>, key: string): number | undefined {
  const v = kv[key];
  return typeof v === 'number' ? v : undefined;
}

const EXPERT_RE = /_exps|_chexps/;
const BLOCK_RE = /^blk\.(\d+)\./;

/**
 * 헤더(분할이면 조각 순서대로 전부) → 전문가/비전문가/CPU/MTP 바이트.
 * 메타데이터는 첫 조각에서 읽는다(gguf-split 의 2번째 이후 조각은 split.* 만 가진다).
 */
export function classifySplit(shards: readonly GgufHeader[]): SplitMeasure {
  const first = shards[0];
  if (!first) throw new Error('classifySplit: no GGUF headers');
  const splitCount = numKv(first.kv, 'split.count');
  if (splitCount !== undefined && splitCount !== shards.length) {
    throw new Error(`split.count ${splitCount} but ${shards.length} shard header(s) given`);
  }
  const arch = first.kv['general.architecture'];
  if (typeof arch !== 'string') throw new Error('general.architecture missing');
  const blockCount = numKv(first.kv, `${arch}.block_count`);
  if (blockCount === undefined) throw new Error(`${arch}.block_count missing`);
  const mtpLayers = numKv(first.kv, `${arch}.nextn_predict_layers`) ?? 0;
  const trunkLayers = blockCount - mtpLayers;

  const tensors = shards.flatMap((h) => h.tensors);
  const tied = !tensors.some((t) => t.name === 'output.weight');
  const bytes = { expert: 0, nonExpert: 0, cpu: 0, mtp: 0, total: 0 };
  for (const t of tensors) {
    const size = tensorBytes(t);
    bytes.total += size;
    const block = BLOCK_RE.exec(t.name);
    const isMtp =
      (block !== null && Number(block[1]) >= trunkLayers) || t.name.includes('nextn') || t.name.startsWith('mtp.');
    if (isMtp) bytes.mtp += size;
    else if (t.name.startsWith('token_embd')) {
      bytes.cpu += size;
      if (tied && t.name === 'token_embd.weight') bytes.nonExpert += size; // GPU 출력층 복제
    } else if (EXPERT_RE.test(t.name)) bytes.expert += size;
    else bytes.nonExpert += size;
  }
  const expertCount = numKv(first.kv, `${arch}.expert_count`);
  const expertUsed = numKv(first.kv, `${arch}.expert_used_count`);
  return {
    expertGB: gb(bytes.expert),
    nonExpertGB: gb(bytes.nonExpert),
    cpuGB: gb(bytes.cpu),
    mtpGB: gb(bytes.mtp),
    totalGB: gb(bytes.total),
    arch,
    trunkLayers,
    mtpLayers,
    ...(expertCount !== undefined ? { expertCount } : {}),
    ...(expertUsed !== undefined ? { expertUsed } : {}),
    tiedEmbeddings: tied,
    bytes,
  };
}

const SHARD_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;

/** `…-00001-of-00003.gguf` → 3개 조각 경로. 분할이 아니면 그대로 1개. */
export function shardFileNames(fileName: string): string[] {
  const m = SHARD_RE.exec(fileName);
  if (!m) return [fileName];
  const total = Number(m[2]);
  const width = m[1]!.length;
  const prefix = fileName.slice(0, m.index);
  return Array.from({ length: total }, (_, i) => `${prefix}-${String(i + 1).padStart(width, '0')}-of-${m[2]}.gguf`);
}

// ---------------------------------------------------------------------------
// 네트워크 — Range 읽기
// ---------------------------------------------------------------------------

export type HeaderFetchOpts = {
  token?: string;
  fetchImpl?: FetchLike;
  /** 첫 Range 크기 (기본 8MB) */
  initialBytes?: number;
  /** 두 배씩 늘리는 상한 (기본 64MB) */
  maxBytes?: number;
};

const MB = 1024 * 1024;

export const resolveUrl = (repo: string, fileName: string): string =>
  `https://huggingface.co/${repo}/resolve/main/${fileName.split('/').map(encodeURIComponent).join('/')}`;

/** 본문을 cap 바이트까지만 읽고 끊는다 — 서버가 Range 를 무시(200)해도 수 GB 를 받지 않게. */
async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer()).subarray(0, cap);
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(got, cap));
  let at = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.length - at);
    out.set(chunk.subarray(0, take), at);
    at += take;
    if (at >= out.length) break;
  }
  return out;
}

/** [start, end] 바이트 범위. 206 이 정상, 200(Range 무시)은 앞에서 잘라 맞춘다. fileBytes = 파일 전체 크기(알면). */
export async function fetchRange(
  url: string,
  start: number,
  end: number,
  opts: HeaderFetchOpts = {},
): Promise<{ bytes: Uint8Array; fileBytes?: number }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const res = await fetchWithRetry(url, { Range: `bytes=${start}-${end}`, ...authHeaders(opts.token) }, fetchImpl);
  if (res.status === 206) {
    const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1];
    const bytes = await readCapped(res, end - start + 1);
    return total !== undefined ? { bytes, fileBytes: Number(total) } : { bytes };
  }
  if (res.status === 200) {
    const length = res.headers.get('content-length');
    const all = await readCapped(res, end + 1);
    const bytes = all.subarray(Math.min(start, all.length));
    return length !== null ? { bytes, fileBytes: Number(length) } : { bytes };
  }
  await res.body?.cancel().catch(() => undefined);
  throw new Error(`HTTP ${res.status} for ${url}`);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** 헤더가 다 들어올 때까지 Range 를 두 배씩 늘려 읽는다(이미 받은 부분은 다시 받지 않음). */
export async function fetchGgufHeader(
  url: string,
  opts: HeaderFetchOpts = {},
): Promise<{ header: GgufHeader; fileBytes?: number }> {
  const max = opts.maxBytes ?? 64 * MB;
  let size = Math.min(opts.initialBytes ?? 8 * MB, max);
  const firstRead = await fetchRange(url, 0, size - 1, opts);
  let bytes = firstRead.bytes;
  const fileBytes = firstRead.fileBytes;
  for (;;) {
    try {
      const header = parseGgufHeader(bytes);
      return fileBytes !== undefined ? { header, fileBytes } : { header };
    } catch (err) {
      if (!(err instanceof GgufNeedMoreBytesError)) throw err;
      if (bytes.length < size || (fileBytes !== undefined && bytes.length >= fileBytes)) {
        throw new Error(`truncated GGUF header in ${url} (${bytes.length} bytes available)`);
      }
      if (size >= max) throw new Error(`GGUF header of ${url} exceeds ${max} bytes`);
      const next = Math.min(Math.max(size * 2, err.need), max);
      const more = await fetchRange(url, size, next - 1, opts);
      bytes = concat(bytes, more.bytes);
      size = next;
    }
  }
}

export type SplitMeasureWithFile = SplitMeasure & {
  /** 조각 파일 크기 합 (Content-Range 기준, 헤더 포함) — 알 수 없으면 생략 */
  fileGB?: number;
  shards: number;
};

/** repo 의 GGUF 파일(분할이면 첫 조각 경로) → 분할 실측. 조각마다 헤더를 읽는다(텐서 정보는 조각별). */
export async function measureSplit(
  repo: string,
  fileName: string,
  opts: HeaderFetchOpts = {},
): Promise<SplitMeasureWithFile> {
  const names = shardFileNames(fileName);
  const headers: GgufHeader[] = [];
  let fileBytes: number | undefined = 0;
  for (const name of names) {
    const res = await fetchGgufHeader(resolveUrl(repo, name), opts);
    headers.push(res.header);
    fileBytes = fileBytes !== undefined && res.fileBytes !== undefined ? fileBytes + res.fileBytes : undefined;
  }
  const measure = classifySplit(headers);
  return {
    ...measure,
    ...(fileBytes !== undefined ? { fileGB: gb(fileBytes) } : {}),
    shards: names.length,
  };
}

// ---------------------------------------------------------------------------
// CLI (읽기 전용 — 저장소에 아무것도 쓰지 않는다)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [repo, fileName] = process.argv.slice(2).filter((a) => a !== '--');
  if (!repo || !fileName) throw new Error('usage: tsx scripts/gguf-header.ts <repo> <fileName>');
  const res = await measureSplit(repo, fileName, { token: process.env['HF_TOKEN'] });
  console.log(JSON.stringify({ repo, fileName, ...res }, null, 2));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
