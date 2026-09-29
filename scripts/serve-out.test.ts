/** serve-out 경로 해석(Cloudflare Pages 모사) + HTTP 동작 — 임시 디렉터리 픽스처, 네트워크는 루프백만. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptsGzip, contentTypeFor, resolveOutPath, startOutServer } from './serve-out';

let outDir = '';

const FIXTURE: Readonly<Record<string, string>> = {
  'index.html': '<!doctype html><title>home</title>',
  'ko.html': '<!doctype html><title>ko</title>',
  'ko/__next._tree.txt': 'ko-tree',
  'gpu/rtx-4060.html': '<!doctype html><title>gpu</title>',
  'model/qwen3.5-9b.html': '<!doctype html><title>model</title>',
  'model/qwen3.5-9b/__next._tree.txt': 'model-tree',
  // 콤보 — 점 슬러그가 중간 세그먼트에 있는 중첩 경로 (P1-2)
  'can-i-run/qwen3.5-9b/on/rtx-4060.html': '<!doctype html><title>combo</title>',
  'a.txt': 'rsc payload',
  'docs/index.html': '<!doctype html><title>docs</title>',
  '404.html': '<!doctype html><title>not found</title>',
};

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'serve-out-'));
  for (const [file, body] of Object.entries(FIXTURE)) {
    const full = join(outDir, file);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const at = (rel: string) => join(outDir, rel);

describe('resolveOutPath', () => {
  it('maps / to index.html', () => {
    expect(resolveOutPath(outDir, '/')).toEqual({ status: 200, file: at('index.html') });
  });

  it('prefers <path>.html over a same-named directory (/ko)', () => {
    expect(resolveOutPath(outDir, '/ko')).toEqual({ status: 200, file: at('ko.html') });
  });

  it('has no extension heuristic — dotted slug maps to .html', () => {
    expect(resolveOutPath(outDir, '/model/qwen3.5-9b')).toEqual({
      status: 200,
      file: at('model/qwen3.5-9b.html'),
    });
  });

  it('nested combo path with a dotted middle segment maps to .html', () => {
    expect(resolveOutPath(outDir, '/can-i-run/qwen3.5-9b/on/rtx-4060')).toEqual({
      status: 200,
      file: at('can-i-run/qwen3.5-9b/on/rtx-4060.html'),
    });
    expect(resolveOutPath(outDir, '/can-i-run/qwen3.5-9b/on/nope')).toEqual({
      status: 404,
      file: at('404.html'),
    });
  });

  it('ignores query string and hash', () => {
    expect(resolveOutPath(outDir, '/gpu/rtx-4060?x=1')).toEqual({
      status: 200,
      file: at('gpu/rtx-4060.html'),
    });
    expect(resolveOutPath(outDir, '/gpu/rtx-4060#faq')).toEqual({
      status: 200,
      file: at('gpu/rtx-4060.html'),
    });
  });

  it('serves exact files first (RSC payloads)', () => {
    expect(resolveOutPath(outDir, '/a.txt')).toEqual({ status: 200, file: at('a.txt') });
    expect(resolveOutPath(outDir, '/model/qwen3.5-9b/__next._tree.txt?_rsc=abc')).toEqual({
      status: 200,
      file: at('model/qwen3.5-9b/__next._tree.txt'),
    });
  });

  it('falls back to <path>/index.html', () => {
    expect(resolveOutPath(outDir, '/docs')).toEqual({ status: 200, file: at('docs/index.html') });
  });

  it('decodes percent-encoded paths', () => {
    expect(resolveOutPath(outDir, '/model/qwen3%2E5-9b')).toEqual({
      status: 200,
      file: at('model/qwen3.5-9b.html'),
    });
  });

  it('serves 404.html with status 404 for unknown paths', () => {
    expect(resolveOutPath(outDir, '/nope')).toEqual({ status: 404, file: at('404.html') });
    expect(resolveOutPath(outDir, '/model/does.not-exist')).toEqual({
      status: 404,
      file: at('404.html'),
    });
  });

  it('rejects traversal, NUL and malformed encodings without leaving outDir', () => {
    for (const raw of [
      '/../etc',
      '/..%2fetc',
      '/%2e%2e/etc',
      '/ko/..\\..\\secret',
      '/ko/%2e%2e%5c..%5csecret',
      '/%00',
      '/index.html%00',
      '/%E0%A4%A',
      '%00',
      'http://evil.example/',
    ]) {
      expect(resolveOutPath(outDir, raw), raw).toEqual({ status: 400, file: null });
    }
  });

  it('treats stat errors other than ENOENT (e.g. ENAMETOOLONG) as "not found" instead of throwing', () => {
    // 이름 한도(NAME_MAX 255)를 넘는 세그먼트 — Linux 에서 stat 가 ENAMETOOLONG 을 던진다
    const long = `/${'a'.repeat(300)}`;
    expect(() => resolveOutPath(outDir, long)).not.toThrow();
    expect(resolveOutPath(outDir, long)).toEqual({ status: 404, file: at('404.html') });
    const veryLong = `/${'a'.repeat(40_000)}`;
    expect(() => resolveOutPath(outDir, veryLong)).not.toThrow();
  });

  it('returns a plain 404 when 404.html is missing', () => {
    const bare = mkdtempSync(join(tmpdir(), 'serve-out-bare-'));
    try {
      expect(resolveOutPath(bare, '/nope')).toEqual({ status: 404, file: null });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('helpers', () => {
  it('content types — RSC .txt must be text/plain', () => {
    expect(contentTypeFor('x/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('x/__next._tree.txt')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('x.woff2')).toBe('font/woff2');
    expect(contentTypeFor('x.bin')).toBe('application/octet-stream');
  });

  it('acceptsGzip honours q=0', () => {
    expect(acceptsGzip('gzip, deflate, br')).toBe(true);
    expect(acceptsGzip('br;q=1.0, gzip;q=0.8')).toBe(true);
    expect(acceptsGzip('gzip;q=0')).toBe(false);
    expect(acceptsGzip('br')).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });
});

describe('HTTP server', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    ({ server, url: base } = await startOutServer({ outDir, port: 0 }));
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
  const send = (method: string, path: string, headers: Record<string, string> = {}) =>
    new Promise<Res>((done, fail) => {
      const req = request(`${base}${path}`, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      });
      req.on('error', fail);
      req.end();
    });

  it('GET with gzip', async () => {
    const res = await send('GET', '/model/qwen3.5-9b', { 'Accept-Encoding': 'gzip' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.vary).toBe('Accept-Encoding');
    expect(gunzipSync(res.body).toString()).toBe(FIXTURE['model/qwen3.5-9b.html']);
  });

  it('GET without gzip, .txt as text/plain', async () => {
    const res = await send('GET', '/a.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.toString()).toBe('rsc payload');
  });

  it('HEAD sends headers only', async () => {
    const res = await send('HEAD', '/ko');
    expect(res.status).toBe(200);
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(FIXTURE['ko.html'] ?? ''));
    expect(res.body.length).toBe(0);
  });

  it('404 page carries status 404', async () => {
    const res = await send('GET', '/nope');
    expect(res.status).toBe(404);
    expect(res.body.toString()).toBe(FIXTURE['404.html']);
  });

  it('400 for traversal, 405 for other methods', async () => {
    expect((await send('GET', '/..%2f..%2fetc')).status).toBe(400);
    const post = await send('POST', '/');
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
  });
});
