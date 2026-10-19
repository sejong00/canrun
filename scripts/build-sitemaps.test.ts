/** 사이트맵·RSS 생성 (P1-5) — RSS 본문 정리(10-16 D93)·IndexNow 키 파일·엔진 날짜 lastmod. 산출물 전체 검사는 test/export-invariants.spec.ts */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GUIDES, GUIDE_SLUGS } from '../apps/web/content/guides';
import { GPU_INTRO_IDS, HUB_INTROS_UPDATED, MODEL_INTRO_IDS } from '../apps/web/content/hubs';
import { MODEL_ABOUT, hasModelAbout } from '../apps/web/content/model-about';
import { INDEXNOW_KEY, SITE_URL } from '../apps/web/lib/site';
import { ENGINE_SPEC_DATE } from '../packages/engine/src/index';
import { buildSitemaps, cdata, guideFeedHtml, localePath } from './build-sitemaps';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_URL = `${SITE_URL}/guides/example`;

/** export 된 가이드 페이지 모양을 줄인 것 — 머리말·본문·데이터 안내·위젯·RSC 스크립트 */
const page = (body: string) =>
  [
    '<!DOCTYPE html><html lang="en"><head><script>self.__next_f=[]</script></head><body>',
    '<header><nav aria-label="Breadcrumb"><a href="/">Home</a></nav><h1 class="text-3xl">Title</h1></header>',
    `<div data-guide-body="true" class="flex max-w-3xl flex-col gap-5">${body}</div>`,
    '<p class="max-w-3xl">data note</p><div data-calc-widget="true"><form><select></select></form></div>',
    '<script>self.__next_f.push([1,"<div data-guide-body>fake</div>"])</script></body></html>',
  ].join('');

describe('guideFeedHtml (RSS content:encoded — D93)', () => {
  it('keeps only the guide body: structure, text and links; drops scripts, nav, icons, decoration and screen-only attributes', () => {
    const body = [
      '<p class="leading-7">A model fits when <span data-guide-data="num" class="tabular-nums">6.3 GB</span> is free.<!-- --> Next.</p>',
      '<h2 class="mt-10 text-xl">Section</h2>',
      '<script>document.write("<div>")</script>',
      '<nav><a href="/x">skip</a></nav>',
      '<div data-guide-data="table" class="flex"><div role="region" tabindex="0" aria-label="scroll">',
      '<table class="w-full"><caption>Caption</caption><thead><tr><th scope="col">GPU</th></tr></thead><tbody><tr>',
      '<th scope="row"><a href="/gpu/rtx-4060">GeForce RTX 4060</a><span>8 GB</span></th>',
      '<td><div><span data-verdict="S"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#verdict-icon-S"></use></svg>Runs great</span>',
      '<div data-speed="true"><span>est. 7.5 tok/s</span><span>6.0–9.0</span><span data-confidence="calibrated">calibrated estimate ±20%</span></div>',
      '<span aria-hidden="true">S</span></div></td></tr></tbody></table></div></div>',
      '<div role="img" aria-label="11.1 of 12.0 GB used" class="flex h-5"><div style="width:71.33%"></div><div style="width:7.69%"></div></div>',
      '<p>See <a href="#faq">the FAQ</a>, <a href="https://github.com/ggml-org/llama.cpp">llama.cpp</a> and <a href="/ko">한국어</a>.<br/>Done</p>',
      '<pre><code>ollama run x</code></pre>',
    ].join('\n');
    expect(guideFeedHtml(page(body), PAGE_URL)).toBe(
      [
        '<p>A model fits when <span>6.3 GB</span> is free. Next.</p>',
        '<h2>Section</h2>',
        '',
        '',
        '<div><div>',
        '<table><caption>Caption</caption><thead><tr><th scope="col">GPU</th></tr></thead><tbody><tr>',
        `<th scope="row"><a href="${SITE_URL}/gpu/rtx-4060">GeForce RTX 4060</a> <span>8 GB</span></th>`,
        '<td><div><span>Runs great</span>',
        '<div><span>est. 7.5 tok/s</span> <span>6.0–9.0</span> <span>calibrated estimate ±20%</span></div>',
        '</div></td></tr></tbody></table></div></div>',
        '<div>11.1 of 12.0 GB used</div>',
        `<p>See <a href="${PAGE_URL}#faq">the FAQ</a>, <a href="https://github.com/ggml-org/llama.cpp">llama.cpp</a> and <a href="${SITE_URL}/ko">한국어</a>.<br>Done</p>`,
        '<pre><code>ollama run x</code></pre>',
      ].join('\n'),
    );
  });

  it('fails loudly when the body is missing or unclosed (unexpected export layout)', () => {
    expect(() => guideFeedHtml('<html><body><p>x</p></body></html>', PAGE_URL)).toThrow(/no \[data-guide-body\]/);
    expect(() => guideFeedHtml('<div data-guide-body="true"><div><p>x</p></div>', PAGE_URL)).toThrow(/not closed/);
  });

  it('cdata splits a literal ]]> so the section cannot end early', () => {
    expect(cdata('a]]>b')).toBe('<![CDATA[a]]]]><![CDATA[>b]]>');
    expect(cdata('plain')).toBe('<![CDATA[plain]]>');
  });
});

describe('buildSitemaps on a minimal out/ (RSS body · IndexNow key · lastmod)', () => {
  const published = GUIDE_SLUGS.filter((slug) => GUIDES[slug].status === 'published');
  const dataUpdated = (JSON.parse(readFileSync(join(repoRoot, 'data/meta.json'), 'utf8')) as { dataUpdated: string }).dataUpdated;
  const later = (a: string, b: string) => (a > b ? a : b);
  let out = '';
  let written: string[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'canrun-sitemaps-'));
    for (const locale of ['en', 'ko'] as const) {
      mkdirSync(join(out, localePath(locale, '/guides').slice(1)), { recursive: true });
      for (const slug of published) {
        const body = `<h2 class="x">${slug} ${locale}</h2><p><a href="/gpu/rtx-4060">GPU</a></p>`;
        writeFileSync(join(out, `${localePath(locale, `/guides/${slug}`).slice(1)}.html`), page(body), 'utf8');
      }
    }
    written = buildSitemaps(repoRoot, out);
  });
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const read = (rel: string) => readFileSync(join(out, rel), 'utf8');

  it('writes the IndexNow key file at the root, containing just the key', () => {
    expect(INDEXNOW_KEY).toMatch(/^[0-9a-f]{32}$/);
    expect(written).toContain(`${INDEXNOW_KEY}.txt`);
    expect(read(`${INDEXNOW_KEY}.txt`)).toBe(INDEXNOW_KEY);
  });

  it('each RSS item keeps the summary in <description> and carries the cleaned full body in <content:encoded>', () => {
    for (const [rel, locale] of [
      ['rss.xml', 'en'],
      ['ko/rss.xml', 'ko'],
    ] as const) {
      const xml = read(rel);
      expect(xml, rel).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]!);
      expect(items, rel).toHaveLength(published.length);
      const dataNote = (JSON.parse(readFileSync(join(repoRoot, 'apps/web/messages', `${locale}.json`), 'utf8')) as { Guides: { dataNote: string } })
        .Guides.dataNote;
      for (const item of items) {
        const slug = /\/guides\/([^<]+)<\/link>/.exec(item)![1]!;
        expect(item).toContain(`<description>`);
        expect(item).toContain(
          `<content:encoded><![CDATA[<h2>${slug} ${locale}</h2><p><a href="${SITE_URL}/gpu/rtx-4060">GPU</a></p>\n<p>${dataNote}</p>]]></content:encoded>`,
        );
      }
    }
  });

  it('calculator, hub, combo and list lastmod follow the later of the data date and the engine date (the model list also its download dates); home stays on the data date', () => {
    const numbers = later(dataUpdated, ENGINE_SPEC_DATE);
    const lastmods = (rel: string) =>
      new Map([...read(rel).matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1]!.slice(SITE_URL.length) || '/', m[2]!]));
    const pages = lastmods('sitemap-pages.xml');
    expect(pages.get('/')).toBe(dataUpdated);
    expect(pages.get('/calculator')).toBe(numbers);
    expect(pages.get('/ko/calculator')).toBe(numbers);
    // 목록 페이지(10-19): 모델 목록은 필요 메모리(엔진 식)와 30일 다운로드 수(기준일 hfDownloadsAsOf — D101), GPU 목록은 판정 수(엔진)를 보인다
    const downloadsDate = (JSON.parse(readFileSync(join(repoRoot, 'data/models.json'), 'utf8')) as Array<{ hfDownloadsAsOf?: string }>)
      .map((m) => m.hfDownloadsAsOf)
      .filter((d): d is string => d !== undefined)
      .reduce(later, numbers);
    expect([pages.get('/models'), pages.get('/ko/models')]).toEqual([downloadsDate, downloadsDate]);
    expect([pages.get('/gpus'), pages.get('/ko/gpus')]).toEqual([numbers, numbers]);
    for (const [file, introIds] of [
      ['sitemap-gpus.xml', GPU_INTRO_IDS],
      ['sitemap-models.xml', MODEL_INTRO_IDS],
    ] as const) {
      const hubs = lastmods(file);
      expect(hubs.size, file).toBeGreaterThan(introIds.length * 2);
      for (const [path, lastmod] of hubs) {
        const id = path.split('/').pop()!;
        const hub = (introIds as readonly string[]).includes(id) ? later(numbers, HUB_INTROS_UPDATED) : numbers;
        // 모델 허브는 소개("어떤 모델인가요", D102)를 고친 날까지
        const about = file === 'sitemap-models.xml' && hasModelAbout(id) ? MODEL_ABOUT[id] : undefined;
        expect(lastmod, path).toBe(about ? later(hub, about) : hub);
      }
    }
    for (const locale of ['en', 'ko']) {
      for (const [path, lastmod] of lastmods(`sitemap-combos-${locale}.xml`)) expect(lastmod, path).toBe(numbers);
    }
  });
});
