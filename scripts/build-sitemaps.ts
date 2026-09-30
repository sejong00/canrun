/**
 * 사이트맵·robots.txt·RSS 생성 (P1-5, docs/04 §3·§5) — postbuild 마지막 단계에서 `out/` 에 쓴다.
 *
 * - 분할(docs/04 §3): sitemap.xml(인덱스) → pages · gpus · models · guides(published 만) · combos-en/-ko(`indexableCombos()` 만 —
 *   공개 콤보가 0 이면 파일·인덱스 항목을 만들지 않는다). URL 마다 en/ko/x-default `xhtml:link` 대체 링크(HTML hreflang 과 같은 규칙).
 * - lastmod: 가이드 = 레지스트리 dateModified, 나머지 = `data/meta.json` dataUpdated — 빌드 시각을 쓰지 않는다(D21 결정론).
 * - robots.txt: 전부 허용(네이버 Yeti 포함) + Sitemap 줄. `/can-i-run/` 를 막지 않는다(막으면 noindex 를 못 읽는다 — PROGRESS §5).
 * - RSS 2.0: `rss.xml`(en)·`ko/rss.xml`(ko) — published 가이드, 게시일 최신순.
 * 정답 검사: test/export-invariants.spec.ts — 사이트맵 URL 집합 = noindex 아닌 HTML 페이지의 캐노니컬 전체.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexableCombos, parseGpus, parseMeta, parseModels, parsePublish } from '../packages/data/src/index';
import { GUIDES, GUIDE_SLUGS } from '../apps/web/content/guides';
import { STATIC_PAGE_SLUGS } from '../apps/web/content/pages';
import { ADSENSE_CLIENT, SITE_URL } from '../apps/web/lib/site';

/** 페이지 캐노니컬과 바이트 동일 — Next 메타데이터는 루트를 슬래시 없이 낸다(`https://…pages.dev`) */
const absoluteUrl = (path: string) => (path === '/' ? SITE_URL : `${SITE_URL}${path}`);

const LOCALES = ['en', 'ko'] as const;
type Locale = (typeof LOCALES)[number];

/** `lib/links.ts` localeHref 와 같은 규칙 (en 무프리픽스) — 앱 모듈은 `@/` 별칭 때문에 여기서 import 하지 않는다 */
export function localePath(locale: Locale, bare: string): string {
  if (locale === 'en') return bare;
  return bare === '/' ? '/ko' : `/ko${bare}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Entry = { path: string; lastmod: string };

function urlXml(entry: Entry, locale: Locale): string {
  const alt = (hreflang: string, target: Locale) =>
    `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${esc(absoluteUrl(localePath(target, entry.path)))}"/>`;
  return [
    '<url>',
    `<loc>${esc(absoluteUrl(localePath(locale, entry.path)))}</loc>`,
    `<lastmod>${entry.lastmod}</lastmod>`,
    alt('en', 'en'),
    alt('ko', 'ko'),
    alt('x-default', 'en'),
    '</url>',
  ].join('');
}

function urlset(urls: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

const maxDate = (dates: readonly string[]) => dates.reduce((a, b) => (b > a ? b : a));

/** RFC 822 (RSS pubDate) — 고정 날짜 문자열을 변환할 뿐 빌드 시각이 아니다 */
const rfc822 = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).toUTCString();

export function buildSitemaps(repoRoot: string, outDir: string): string[] {
  const readData = (file: string): unknown => JSON.parse(readFileSync(join(repoRoot, 'data', file), 'utf8'));
  const gpus = parseGpus(readData('gpus.json'));
  const models = parseModels(readData('models.json'));
  const plan = parsePublish(readData('publish.json'));
  const dataUpdated = parseMeta(readData('meta.json')).dataUpdated;
  const published = GUIDE_SLUGS.filter((slug) => GUIDES[slug].status === 'published');

  const both = (entries: readonly Entry[]) => LOCALES.flatMap((locale) => entries.map((e) => urlXml(e, locale)));
  const files: Array<{ name: string; entries: Entry[]; xml: string }> = [];
  const add = (name: string, entries: Entry[], xml: string) => {
    if (entries.length > 0) files.push({ name, entries, xml });
  };

  const pages: Entry[] = [
    { path: '/', lastmod: dataUpdated },
    { path: '/calculator', lastmod: dataUpdated },
    ...(published.length > 0 ? [{ path: '/guides', lastmod: maxDate(published.map((s) => GUIDES[s].dateModified)) }] : []),
    ...STATIC_PAGE_SLUGS.map((slug) => ({ path: `/${slug}`, lastmod: dataUpdated })),
  ];
  add('sitemap-pages.xml', pages, urlset(both(pages)));

  const gpuEntries = gpus.map((g) => ({ path: `/gpu/${g.id}`, lastmod: dataUpdated }));
  add('sitemap-gpus.xml', gpuEntries, urlset(both(gpuEntries)));

  const modelEntries = models.map((m) => ({ path: `/model/${m.id}`, lastmod: dataUpdated }));
  add('sitemap-models.xml', modelEntries, urlset(both(modelEntries)));

  const guideEntries = published.map((slug) => ({ path: `/guides/${slug}`, lastmod: GUIDES[slug].dateModified }));
  add('sitemap-guides.xml', guideEntries, urlset(both(guideEntries)));

  // 콤보: 로캘별 분할 (docs/04 §3) — comboKey = `gpu/model`, URL = /can-i-run/{model}/on/{gpu}
  const comboEntries = [...indexableCombos(plan)].sort().map((key) => {
    const [gpuId, modelId] = key.split('/');
    return { path: `/can-i-run/${modelId}/on/${gpuId}`, lastmod: dataUpdated };
  });
  for (const locale of LOCALES) {
    add(`sitemap-combos-${locale}.xml`, comboEntries, urlset(comboEntries.map((e) => urlXml(e, locale))));
  }

  for (const file of files) writeFileSync(join(outDir, file.name), file.xml, 'utf8');
  const index = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...files.map(
      (f) => `<sitemap><loc>${esc(absoluteUrl(`/${f.name}`))}</loc><lastmod>${maxDate(f.entries.map((e) => e.lastmod))}</lastmod></sitemap>`,
    ),
    '</sitemapindex>',
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'sitemap.xml'), index, 'utf8');

  writeFileSync(join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`, 'utf8');

  // ads.txt (Phase 1.5 AdSense) — 게시자 ID 가 있을 때만. 형식: IAB ads.txt, Google 의 인증 기관 ID f08c47fec0942fa0
  const adsTxt = ADSENSE_CLIENT ? [`google.com, ${ADSENSE_CLIENT.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`] : [];
  if (adsTxt.length > 0) writeFileSync(join(outDir, 'ads.txt'), `${adsTxt.join('\n')}\n`, 'utf8');

  // RSS — 로캘별, 채널 문구는 messages 의 Guides.rss*
  for (const locale of LOCALES) {
    const messages = JSON.parse(readFileSync(join(repoRoot, 'apps/web/messages', `${locale}.json`), 'utf8')) as {
      Guides: { rssTitle: string; rssDescription: string };
    };
    const items = [...published]
      .sort((a, b) => GUIDES[b].datePublished.localeCompare(GUIDES[a].datePublished))
      .map((slug) => {
        const { title, description } = GUIDES[slug].locales[locale];
        const link = esc(absoluteUrl(localePath(locale, `/guides/${slug}`)));
        return [
          '<item>',
          `<title>${esc(title)}</title>`,
          `<link>${link}</link>`,
          `<guid isPermaLink="true">${link}</guid>`,
          `<description>${esc(description)}</description>`,
          `<pubDate>${rfc822(GUIDES[slug].datePublished)}</pubDate>`,
          '</item>',
        ].join('');
      });
    const self = esc(absoluteUrl(localePath(locale, '/rss.xml')));
    const lastBuild = published.length > 0 ? maxDate(published.map((s) => GUIDES[s].dateModified)) : dataUpdated;
    const rss = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '<channel>',
      `<title>${esc(messages.Guides.rssTitle)}</title>`,
      `<link>${esc(absoluteUrl(localePath(locale, '/guides')))}</link>`,
      `<description>${esc(messages.Guides.rssDescription)}</description>`,
      `<language>${locale}</language>`,
      `<lastBuildDate>${rfc822(lastBuild)}</lastBuildDate>`,
      `<atom:link href="${self}" rel="self" type="application/rss+xml"/>`,
      ...items,
      '</channel>',
      '</rss>',
      '',
    ].join('\n');
    writeFileSync(join(outDir, locale === 'en' ? 'rss.xml' : 'ko/rss.xml'), rss, 'utf8');
  }

  return ['sitemap.xml', ...files.map((f) => f.name), 'robots.txt', 'rss.xml', 'ko/rss.xml', ...(adsTxt.length > 0 ? ['ads.txt'] : [])];
}
