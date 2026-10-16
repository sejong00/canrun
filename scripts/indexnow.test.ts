/** IndexNow 전송 (10-16 D93) — 바뀐 URL 고르기·요청 모양·실패해도 던지지 않기 */
import { describe, expect, it } from 'vitest';
import {
  accepted,
  chunk,
  fetchLiveSnapshot,
  indexNowPayload,
  INDEXNOW_ENDPOINTS,
  INDEXNOW_MAX_URLS,
  sitemapIndexLocs,
  sitemapUrls,
  submitUrls,
  urlsToSubmit,
  type LiveSnapshot,
} from './indexnow';

const SITE = 'https://example.test';
const HOST = 'example.test';
const KEY = 'k123'; // 테스트용 — 실제 키는 apps/web/lib/site.ts

const urlset = (entries: Array<[string, string]>) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    // build-sitemaps 와 같은 한 줄 모양 — 대체 링크 href 는 URL 로 세지 않는다
    ...entries.map(
      ([loc, lastmod]) =>
        `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><xhtml:link rel="alternate" hreflang="ko" href="${loc}/ko"/></url>`,
    ),
    '</urlset>',
  ].join('\n');

const index = (locs: string[]) =>
  [
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locs.map((loc) => `<sitemap><loc>${loc}</loc><lastmod>2026-10-16</lastmod></sitemap>`),
    '</sitemapindex>',
  ].join('\n');

const silent = { info: () => {}, warn: () => {} };

describe('sitemap parsing', () => {
  it('reads loc → lastmod from urlsets, decodes entities, ignores index entries and hreflang links', () => {
    const urls = sitemapUrls([index([`${SITE}/sitemap-a.xml`]), urlset([[`${SITE}/a?x=1&amp;y=2`, '2026-10-15'], [`${SITE}/b`, '2026-10-16']])]);
    expect([...urls]).toEqual([
      [`${SITE}/a?x=1&y=2`, '2026-10-15'],
      [`${SITE}/b`, '2026-10-16'],
    ]);
  });

  it('lists sub-sitemaps of an index', () => {
    expect(sitemapIndexLocs(index([`${SITE}/sitemap-a.xml`, `${SITE}/sitemap-b.xml`]))).toEqual([`${SITE}/sitemap-a.xml`, `${SITE}/sitemap-b.xml`]);
  });
});

describe('urlsToSubmit', () => {
  const next = [index([`${SITE}/sitemap-a.xml`]), urlset([[`${SITE}/same`, '2026-10-15'], [`${SITE}/changed`, '2026-10-16'], [`${SITE}/new`, '2026-10-16']])];
  const prevSitemaps = [urlset([[`${SITE}/same`, '2026-10-15'], [`${SITE}/changed`, '2026-10-15'], [`${SITE}/gone`, '2026-10-15']])];

  it('sends only new URLs and URLs whose lastmod changed (removed URLs are not sent)', () => {
    const live: LiveSnapshot = { keyStatus: 200, keyFound: true, sitemaps: prevSitemaps };
    expect(urlsToSubmit(next, live, HOST)).toEqual([`${SITE}/changed`, `${SITE}/new`]);
  });

  it('sends every URL when the live key file is missing (first run with this key)', () => {
    const live: LiveSnapshot = { keyStatus: 404, keyFound: false, sitemaps: prevSitemaps };
    expect(urlsToSubmit(next, live, HOST)).toEqual([`${SITE}/same`, `${SITE}/changed`, `${SITE}/new`]);
  });

  it('sends every URL when the live sitemaps could not be fetched', () => {
    const live: LiveSnapshot = { keyStatus: 200, keyFound: true, sitemaps: null };
    expect(urlsToSubmit(next, live, HOST)).toHaveLength(3);
  });

  it('sends nothing when nothing changed, and never a URL on another host', () => {
    const same = [urlset([[`${SITE}/same`, '2026-10-15'], ['https://other.test/x', '2026-10-16']])];
    expect(urlsToSubmit(same, { keyStatus: 200, keyFound: true, sitemaps: same }, HOST)).toEqual([]);
    expect(urlsToSubmit(same, { keyStatus: 404, keyFound: false, sitemaps: null }, HOST)).toEqual([`${SITE}/same`]);
  });
});

describe('request shape', () => {
  it('chunks at the 10,000 URL protocol limit', () => {
    expect(INDEXNOW_MAX_URLS).toBe(10_000);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it('payload names the host, the key and the key file at the site root', () => {
    expect(indexNowPayload(SITE, KEY, [`${SITE}/a`])).toEqual({
      host: HOST,
      key: KEY,
      keyLocation: `${SITE}/${KEY}.txt`,
      urlList: [`${SITE}/a`],
    });
  });

  it('treats 200 and 202 as accepted, everything else as a warning', () => {
    expect([200, 202].every(accepted)).toBe(true);
    expect([400, 403, 422, 429, 500].some(accepted)).toBe(false);
  });

  it('posts each chunk to Naver and api.indexnow.org, and reports failures without throwing', async () => {
    expect(INDEXNOW_ENDPOINTS).toEqual(['https://searchadvisor.naver.com/indexnow', 'https://api.indexnow.org/indexnow']);
    const calls: Array<{ url: string; body: { urlList: string[] }; contentType: string }> = [];
    const warnings: string[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        body: JSON.parse(String(init?.body)) as { urlList: string[] },
        contentType: new Headers(init?.headers).get('content-type') ?? '',
      });
      if (url.includes('naver')) return new Response('', { status: 202 });
      throw new Error('network down');
    }) as typeof fetch;
    const urls = Array.from({ length: INDEXNOW_MAX_URLS + 1 }, (_, i) => `${SITE}/p${i}`);
    const results = await submitUrls(urls, {
      siteUrl: SITE,
      key: KEY,
      fetchImpl: fakeFetch,
      log: { info: () => {}, warn: (m) => warnings.push(m) },
    });
    expect(calls.map((c) => [c.url, c.body.urlList.length])).toEqual([
      ['https://searchadvisor.naver.com/indexnow', 10_000],
      ['https://api.indexnow.org/indexnow', 10_000],
      ['https://searchadvisor.naver.com/indexnow', 1],
      ['https://api.indexnow.org/indexnow', 1],
    ]);
    expect(calls.every((c) => c.contentType.startsWith('application/json'))).toBe(true);
    expect(results.map((r) => r.status)).toEqual([202, null, 202, null]);
    expect(warnings).toHaveLength(2);
  });

  it('warns with the status code on a rejected request', async () => {
    const warnings: string[] = [];
    const fakeFetch = (async () => new Response('key mismatch', { status: 422 })) as typeof fetch;
    const results = await submitUrls([`${SITE}/a`], {
      siteUrl: SITE,
      key: KEY,
      endpoints: ['https://api.indexnow.org/indexnow'],
      fetchImpl: fakeFetch,
      log: { info: () => {}, warn: (m) => warnings.push(m) },
    });
    expect(results).toEqual([{ endpoint: 'https://api.indexnow.org/indexnow', urls: 1, status: 422 }]);
    expect(warnings[0]).toMatch(/HTTP 422 key mismatch/);
  });
});

describe('fetchLiveSnapshot', () => {
  const site = (pages: Record<string, { status: number; body: string }>) =>
    (async (input: string | URL | Request) => {
      const page = pages[String(input)];
      return new Response(page?.body ?? 'not found', { status: page?.status ?? 404 });
    }) as typeof fetch;

  it('reads the key file and every sub-sitemap of the live index', async () => {
    const sub = urlset([[`${SITE}/a`, '2026-10-15']]);
    const snapshot = await fetchLiveSnapshot(
      SITE,
      KEY,
      site({
        [`${SITE}/${KEY}.txt`]: { status: 200, body: `${KEY}\n` },
        [`${SITE}/sitemap.xml`]: { status: 200, body: index([`${SITE}/sitemap-a.xml`]) },
        [`${SITE}/sitemap-a.xml`]: { status: 200, body: sub },
      }),
      silent,
    );
    expect(snapshot.keyStatus).toBe(200);
    expect(snapshot.keyFound).toBe(true);
    expect(snapshot.sitemaps).toHaveLength(2);
    expect(snapshot.sitemaps![1]).toBe(sub);
  });

  it('a 404 key file means first run; a missing sub-sitemap means no usable baseline', async () => {
    const snapshot = await fetchLiveSnapshot(
      SITE,
      KEY,
      site({ [`${SITE}/sitemap.xml`]: { status: 200, body: index([`${SITE}/sitemap-a.xml`]) } }),
      silent,
    );
    expect(snapshot).toEqual({ keyStatus: 404, keyFound: false, sitemaps: null });
  });

  it('a key file with other content (e.g. an HTML fallback) is not the key', async () => {
    const snapshot = await fetchLiveSnapshot(SITE, KEY, site({ [`${SITE}/${KEY}.txt`]: { status: 200, body: '<!doctype html>' } }), silent);
    expect(snapshot.keyFound).toBe(false);
  });

  it('never throws on network errors', async () => {
    const down = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    await expect(fetchLiveSnapshot(SITE, KEY, down, silent)).resolves.toEqual({ keyStatus: null, keyFound: false, sitemaps: null });
  });
});
