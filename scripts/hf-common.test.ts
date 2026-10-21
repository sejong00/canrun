/** hf-common 단위 테스트 — 네트워크 없음(fetchImpl 주입), 시드 라운드트립이 핵심 회귀 가드. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registeredDataFiles } from '../packages/data/src/index';
import { downloadsFields, fetchConfig, fetchDownloads, fetchTree, nextPageUrl, serializeRecords, type FetchLike } from './hf-common';

const dataDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'data');

describe('serializeRecords', () => {
  it('round-trips every record-array seed file byte-identically (git diff 최소화의 전제)', () => {
    let checked = 0;
    for (const file of registeredDataFiles()) {
      const raw = readFileSync(join(dataDir, file), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      // publish.json 은 단일 객체(운영 계획)라 레코드 직렬화 대상이 아니다 — sync 도 건드리지 않는다
      if (!Array.isArray(parsed)) continue;
      expect(serializeRecords(parsed), `data/${file}`).toBe(raw);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it('renders an empty array as []', () => {
    expect(serializeRecords([])).toBe('[]\n');
  });

  it('keeps .0 on integral float fields (fileGB 등) but not on int fields', () => {
    const out = serializeRecords([{ fileGB: 9, layers: 32, tgTokS: 42, ppTokS: 100 }]);
    expect(out).toBe('[\n  { "fileGB": 9.0, "layers": 32, "tgTokS": 42.0, "ppTokS": 100 }\n]\n');
    // 층별 임베딩 표(10-21 D112)도 GB 물리량 표식
    expect(serializeRecords([{ offGpuGB: 2, pleGB: 2 }])).toBe('[\n  { "offGpuGB": 2.0, "pleGB": 2.0 }\n]\n');
  });

  it('preserves input key order (raw JSON.parse 레코드 전제)', () => {
    const out = serializeRecords([{ b: 1, a: 2 }]);
    expect(out).toBe('[\n  { "b": 1, "a": 2 }\n]\n');
  });
});

describe('nextPageUrl', () => {
  it('extracts rel="next" and ignores other rels', () => {
    expect(nextPageUrl('<https://x/y?cursor=abc>; rel="next"')).toBe('https://x/y?cursor=abc');
    expect(nextPageUrl('<https://x/y>; rel="prev"')).toBeUndefined();
    expect(nextPageUrl(null)).toBeUndefined();
  });
});

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), init);

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchTree', () => {
  it('follows Link rel="next" pagination and concatenates pages', async () => {
    const page1 = [{ type: 'file', path: 'a.gguf', size: 1 }];
    const page2 = [{ type: 'file', path: 'b.gguf', size: 2 }];
    const calls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return Promise.resolve(
          jsonResponse(page1, { headers: { link: '<https://next.page>; rel="next"' } }),
        );
      }
      return Promise.resolve(jsonResponse(page2));
    };
    const entries = await fetchTree('org/repo', { fetchImpl });
    expect(entries).toEqual([...page1, ...page2]);
    expect(calls[0]).toContain('/api/models/org/repo/tree/main?recursive=true');
    expect(calls[1]).toBe('https://next.page');
  });

  it('retries once on 5xx then succeeds', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      return Promise.resolve(
        n === 1 ? new Response('', { status: 503 }) : jsonResponse([]),
      );
    };
    const pending = fetchTree('org/repo', { fetchImpl });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual([]);
    expect(n).toBe(2);
  });

  it('throws on persistent HTTP error', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(new Response('', { status: 404 }));
    await expect(fetchTree('org/gone', { fetchImpl })).rejects.toThrow('HTTP 404');
  });

  it('sends Authorization header when token given', async () => {
    let auth: string | null = null;
    const fetchImpl: FetchLike = (_url, init) => {
      auth = new Headers(init?.headers).get('authorization');
      return Promise.resolve(jsonResponse([]));
    };
    await fetchTree('org/repo', { fetchImpl, token: 'hf_x' });
    expect(auth).toBe('Bearer hf_x');
  });
});

describe('fetchConfig', () => {
  it('reports gated on 401/403 instead of throwing', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(new Response('', { status: 401 }));
    await expect(fetchConfig('meta-llama/x', { fetchImpl })).resolves.toEqual({ gated: true });
  });

  it('returns parsed config on 200', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(jsonResponse({ num_hidden_layers: 32 }));
    await expect(fetchConfig('org/x', { fetchImpl })).resolves.toEqual({
      config: { num_hidden_layers: 32 },
    });
  });

  it('returns error string on other HTTP failures', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(new Response('', { status: 404 }));
    const res = await fetchConfig('org/missing', { fetchImpl });
    expect(res.gated).toBeUndefined();
    expect(res.error).toContain('HTTP 404');
  });
});

describe('fetchDownloads (10-06 D68)', () => {
  it('reads the 30-day downloads from the model info API', async () => {
    let url = '';
    const fetchImpl: FetchLike = (u) => {
      url = String(u);
      return Promise.resolve(jsonResponse({ id: 'meta-llama/Llama-3.1-8B-Instruct', gated: 'manual', downloads: 6104298 }));
    };
    await expect(fetchDownloads('meta-llama/Llama-3.1-8B-Instruct', { fetchImpl })).resolves.toEqual({ downloads: 6104298 });
    expect(url).toBe('https://huggingface.co/api/models/meta-llama/Llama-3.1-8B-Instruct');
  });

  it('returns an error instead of throwing on HTTP errors, a missing count or a network failure', async () => {
    const notFound: FetchLike = () => Promise.resolve(new Response('', { status: 404 }));
    expect((await fetchDownloads('org/missing', { fetchImpl: notFound })).error).toContain('HTTP 404');
    const noCount: FetchLike = () => Promise.resolve(jsonResponse({ id: 'org/x' }));
    expect(await fetchDownloads('org/x', { fetchImpl: noCount })).toEqual({ error: 'model info org/x: no downloads' });
    const offline: FetchLike = () => Promise.reject(new Error('ECONNRESET'));
    expect((await fetchDownloads('org/x', { fetchImpl: offline })).error).toContain('ECONNRESET');
  });

  it('downloadsFields writes both fields or none', () => {
    expect(downloadsFields(1234, '2026-10-06')).toEqual({ hfDownloads30d: 1234, hfDownloadsAsOf: '2026-10-06' });
    expect(downloadsFields(0, '2026-10-06')).toEqual({ hfDownloads30d: 0, hfDownloadsAsOf: '2026-10-06' });
    expect(downloadsFields(undefined, '2026-10-06')).toEqual({});
    expect(downloadsFields(1.5, '2026-10-06')).toEqual({});
    expect(downloadsFields('12', '2026-10-06')).toEqual({});
  });
});
