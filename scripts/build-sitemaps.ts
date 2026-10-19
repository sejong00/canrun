/**
 * 사이트맵·robots.txt·RSS 생성 (P1-5, docs/04 §3·§5) — postbuild 마지막 단계에서 `out/` 에 쓴다.
 *
 * - 분할(docs/04 §3): sitemap.xml(인덱스) → pages · gpus · models · guides(published 만) · compare(published GPU 비교 쌍 + 쌍이 있을 때 목차 —
 *   10-19 D106) · combos-en/-ko(`indexableCombos()` 만 — 공개 콤보가 0 이면 파일·인덱스 항목을 만들지 않는다. 다른 파일도 항목이 0 이면 같다).
 *   URL 마다 en/ko/x-default `xhtml:link` 대체 링크(HTML hreflang 과 같은 규칙). 로캘은 검색 노출 로캘(`INDEXED_LOCALES`)만 — zh(10-19 D109)는
 *   공개 작업 전까지 noindex 라 사이트맵·RSS·대체 링크에 없다.
 * - lastmod: 가이드 = 레지스트리 dateModified, 업데이트 소식 = max(dataUpdated, 최신 항목 날짜 — content/updates.ts),
 *   엔진 수치를 그리는 페이지(계산기·GPU·모델 허브·콤보·GPU 목록) = max(dataUpdated, 엔진 `ENGINE_SPEC_DATE` — 10-16 D93: 엔진 개정은
 *   데이터 없이도 모든 수치를 바꾼다), 소개글이 붙은 허브는 여기에 content/hubs.ts HUB_INTROS_UPDATED 까지 넣은 최댓값,
 *   모델 소개("어떤 모델인가요", 10-19 D102)가 붙은 모델 허브는 여기에 그 모델의 소개 수정일(content/model-about.ts)까지 넣은 최댓값,
 *   GPU 비교 = 수치 기준일과 그 쌍의 dateModified(content/compares.ts) 중 늦은 날, 비교 목차 = 게시 쌍 lastmod 의 최댓값(10-19 D106),
 *   모델 목록 = 여기에 모델 30일 다운로드 기준일(`hfDownloadsAsOf`) 최댓값까지(10-19 D101 — 다운로드 수만 바뀐 주간 동기화는
 *   dataUpdated 를 올리지 않는데 목록은 그 수를 보인다), 나머지(홈·정적 페이지) = `data/meta.json` dataUpdated — 빌드 시각을 쓰지 않는다(D21 결정론).
 * - robots.txt: 전부 허용(네이버 Yeti 포함) + Sitemap 줄 + 맨 끝 다음(Daum) 웹마스터도구 확인 줄(D99). `/can-i-run/` 를 막지 않는다(막으면 noindex 를 못 읽는다 — PROGRESS §5).
 * - IndexNow 키 파일 `<INDEXNOW_KEY>.txt`(10-16 D93 — 내용 = 키 자체, 공개 값). 배포 뒤 `scripts/indexnow.ts` 가 이 키로 바뀐 URL 을 보낸다.
 * - RSS 2.0: `rss.xml`(en)·`ko/rss.xml`(ko) — published 가이드, 게시일 최신순. 업데이트 소식은 넣지 않는다(채널이 가이드 피드이고,
 *   항목마다 페이지가 따로 없어 item link 가 캐노니컬이 아니게 된다 — D72). `<description>` = 요약, `<content:encoded>` = 본문 전체
 *   (10-16 D93 — 네이버 서치어드바이저는 항목마다 본문 전체를 받는다, https://searchadvisor.naver.com/guide/request-feed): 이미 export 된 가이드 HTML 의 `[data-guide-body]` 를 피드용으로 정리하고
 *   (`guideFeedHtml` — 스크립트·내비·장식 아이콘·화면용 속성 제거, 링크 절대 URL) 끝에 데이터 안내 문장(Guides.dataNote)을 붙인다.
 * 정답 검사: test/export-invariants.spec.ts — 사이트맵 URL 집합 = noindex 아닌 HTML 페이지의 캐노니컬 전체.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexableCombos, parseGpus, parseMeta, parseModels, parsePublish } from '../packages/data/src/index';
import { ENGINE_SPEC_DATE } from '../packages/engine/src/index';
import { COMPARES, publishedCompares, type CompareSlug } from '../apps/web/content/compares';
import { INDEXED_LOCALES, type IndexedLocale } from '../apps/web/i18n/locales';
import { GUIDES, GUIDE_SLUGS } from '../apps/web/content/guides';
import { GPU_INTRO_IDS, HUB_INTROS_UPDATED, MODEL_INTRO_IDS } from '../apps/web/content/hubs';
import { MODEL_ABOUT, hasModelAbout } from '../apps/web/content/model-about';
import { STATIC_PAGE_SLUGS } from '../apps/web/content/pages';
import { latestSiteUpdate } from '../apps/web/content/updates';
import { ADSENSE_CLIENT, DAUM_WEBMASTER_LINE, INDEXNOW_KEY, SITE_URL } from '../apps/web/lib/site';

/** 페이지 캐노니컬과 바이트 동일 — Next 메타데이터는 루트를 슬래시 없이 낸다(`https://…pages.dev`) */
const absoluteUrl = (path: string) => (path === '/' ? SITE_URL : `${SITE_URL}${path}`);

const LOCALES = INDEXED_LOCALES;
type Locale = IndexedLocale;

/** `lib/links.ts` localeHref 와 같은 규칙 (en 무프리픽스) — 앱 모듈은 `@/` 별칭 때문에 여기서 import 하지 않는다 */
export function localePath(locale: Locale, bare: string): string {
  if (locale === 'en') return bare;
  return bare === '/' ? `/${locale}` : `/${locale}${bare}`;
}

/** 로캘 RSS 파일 — en `rss.xml`, ko `ko/rss.xml` */
const rssFile = (locale: Locale) => (locale === 'en' ? 'rss.xml' : `${locale}/rss.xml`);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Entry = { path: string; lastmod: string };

function urlXml(entry: Entry, locale: Locale): string {
  const alt = (hreflang: string, target: Locale) =>
    `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${esc(absoluteUrl(localePath(target, entry.path)))}"/>`;
  return [
    '<url>',
    `<loc>${esc(absoluteUrl(localePath(locale, entry.path)))}</loc>`,
    `<lastmod>${entry.lastmod}</lastmod>`,
    ...LOCALES.map((target) => alt(target, target)),
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

/**
 * GPU 비교 사이트맵 항목 (10-19 D106) — 게시 쌍만(초안은 noindex), 목차는 게시 쌍이 1개 이상일 때만(가이드 목차와 같은 규칙).
 * 쌍 lastmod = 수치 기준일(데이터·엔진)과 그 쌍의 dateModified 중 늦은 날, 목차 = 쌍 lastmod 의 최댓값. 게시 쌍이 0 이면 빈 배열(파일을 만들지 않는다)
 */
export function compareSitemapEntries(published: readonly CompareSlug[], numbersUpdated: string): Entry[] {
  const pairs = published.map((slug) => ({ path: `/compare/${slug}`, lastmod: maxDate([numbersUpdated, COMPARES[slug].dateModified]) }));
  return pairs.length > 0 ? [{ path: '/compare', lastmod: maxDate(pairs.map((e) => e.lastmod)) }, ...pairs] : [];
}

/** RFC 822 (RSS pubDate) — 고정 날짜 문자열을 변환할 뿐 빌드 시각이 아니다 */
const rfc822 = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).toUTCString();

// --- RSS 본문 (10-16 D93) ------------------------------------------------------
// 입력은 React 가 그린 export HTML 이다: 속성값은 늘 큰따옴표이고 그 안의 `<`·`>` 는 이스케이프돼 있어 `<[^>]+>` 로 태그를 자를 수 있다.

/** 통째로 빼는 요소 — 스크립트·내비·폼 조작부, 장식 아이콘 svg(`<use>` 가 페이지 안 스프라이트를 가리켜 피드에서는 빈 칸이 된다) */
const FEED_DROP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'nav', 'svg', 'button', 'form', 'input', 'select', 'textarea', 'iframe']);
/** 남기는 속성 — 나머지(class·style·data-*·aria-*·role·tabindex)는 화면 스타일·스크립트용이라 피드에서 뜻이 없다 */
const FEED_KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'scope', 'start', 'lang']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** 사이트 경로(`/gpu/…`)·문서 안 앵커(`#…`)를 피드 리더가 따라갈 수 있게 절대 URL 로 */
function feedUrl(value: string, pageUrl: string): string {
  if (value.startsWith('#')) return `${pageUrl}${value}`;
  if (value.startsWith('/') && !value.startsWith('//')) return absoluteUrl(value);
  return value;
}

function feedAttrs(raw: string, pageUrl: string): string {
  let kept = '';
  for (const m of raw.matchAll(/\s([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g)) {
    const name = m[1]!.toLowerCase();
    if (!FEED_KEEP_ATTRS.has(name)) continue;
    const value = m[2] ?? '';
    kept += ` ${name}="${name === 'href' || name === 'src' ? feedUrl(value, pageUrl) : value}"`;
  }
  return kept;
}

/**
 * export 된 가이드 페이지 HTML → RSS `<content:encoded>` 용 본문 HTML (순수 함수).
 * `[data-guide-body]` 안쪽만 쓴다(머리말·바이라인·계산기 위젯·관련 가이드·RSC 페이로드는 그 밖이다). 그 안에서
 * 스크립트·내비·장식 요소(aria-hidden)를 빼고, 막대 그림(`role="img"`)은 aria-label 문장으로 바꾸고, 속성은 FEED_KEEP_ATTRS 만 남긴다.
 * 화면에서 CSS 간격으로 떨어져 있던 인라인 칩(`</span><span>` — 속도·범위·신뢰 라벨, GPU 이름·용량)은 공백 하나로 띄운다.
 */
export function guideFeedHtml(pageHtml: string, pageUrl: string): string {
  // 문자열 속 `<div` 를 세지 않도록 스크립트류를 먼저 뺀다
  const html = pageHtml.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const open = /<div\b[^>]*\sdata-guide-body\b[^>]*>/.exec(html);
  if (!open) throw new Error(`no [data-guide-body] in the exported page for ${pageUrl}`);

  const out: string[] = [];
  let skip: { tag: string; depth: number } | undefined;
  let divDepth = 0; // 본문 div 안에서 연 div 수 — 0 에서 만나는 </div> 가 본문의 끝
  for (const token of html.slice(open.index + open[0].length).split(/(<!--[\s\S]*?-->|<[^>]+>)/)) {
    if (token === '' || token.startsWith('<!--')) continue;
    const tag = /^<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>$/.exec(token);
    if (!tag) {
      if (!skip) out.push(token);
      continue;
    }
    const [, closing, rawName, attrs, selfClosing] = tag as unknown as [string, string, string, string, string];
    const name = rawName.toLowerCase();
    const isVoid = VOID_TAGS.has(name) || selfClosing === '/';
    if (skip) {
      if (name === skip.tag && !isVoid) skip.depth += closing ? -1 : 1;
      if (skip.depth === 0) skip = undefined;
      continue;
    }
    if (closing) {
      if (name === 'div') {
        if (divDepth === 0) {
          return out.join('').replace(/<\/(span|a)>(?=<(?:span|a)[\s>])/g, '</$1> ').trim();
        }
        divDepth -= 1;
      }
      out.push(`</${name}>`);
      continue;
    }
    if (FEED_DROP_TAGS.has(name) || /\saria-hidden="true"/.test(attrs)) {
      if (!isVoid) skip = { tag: name, depth: 1 };
      continue;
    }
    const label = /\srole="img"/.test(attrs) ? /\saria-label="([^"]*)"/.exec(attrs)?.[1] : undefined;
    if (label !== undefined && !isVoid) {
      out.push(`<${name}>${label}</${name}>`);
      skip = { tag: name, depth: 1 };
      continue;
    }
    if (name === 'div') divDepth += 1;
    out.push(`<${name}${feedAttrs(attrs, pageUrl)}>`);
  }
  throw new Error(`[data-guide-body] is not closed in the exported page for ${pageUrl}`);
}

/** CDATA 구역 — 본문에 `]]>` 가 있으면 구역을 나눠 잇는다 */
export const cdata = (text: string) => `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

export function buildSitemaps(repoRoot: string, outDir: string): string[] {
  const readData = (file: string): unknown => JSON.parse(readFileSync(join(repoRoot, 'data', file), 'utf8'));
  const gpus = parseGpus(readData('gpus.json'));
  const models = parseModels(readData('models.json'));
  const plan = parsePublish(readData('publish.json'));
  const dataUpdated = parseMeta(readData('meta.json')).dataUpdated;
  // 엔진 수치를 그리는 페이지(계산기 예시·허브 표·콤보)는 엔진을 고친 날에도 내용이 바뀐다 (10-16 D93)
  const numbersUpdated = maxDate([dataUpdated, ENGINE_SPEC_DATE]);
  const published = GUIDE_SLUGS.filter((slug) => GUIDES[slug].status === 'published');

  const both = (entries: readonly Entry[]) => LOCALES.flatMap((locale) => entries.map((e) => urlXml(e, locale)));
  const files: Array<{ name: string; entries: Entry[]; xml: string }> = [];
  const add = (name: string, entries: Entry[], xml: string) => {
    if (entries.length > 0) files.push({ name, entries, xml });
  };

  const pages: Entry[] = [
    { path: '/', lastmod: dataUpdated },
    { path: '/calculator', lastmod: numbersUpdated },
    // 목록 페이지(10-19): 모델 목록은 필요 메모리(엔진 식)와 30일 다운로드 수(주간 동기화가 기준일과 함께 바꾼다 — D101)를,
    // GPU 목록은 판정 수(엔진)를 보인다
    { path: '/models', lastmod: maxDate([numbersUpdated, ...models.flatMap((m) => (m.hfDownloadsAsOf ? [m.hfDownloadsAsOf] : []))]) },
    { path: '/gpus', lastmod: numbersUpdated },
    ...(published.length > 0 ? [{ path: '/guides', lastmod: maxDate(published.map((s) => GUIDES[s].dateModified)) }] : []),
    // 업데이트 소식(10-14 D72)은 손으로 쓴 항목이 데이터 없이 늘 수 있다 — 최신 항목 날짜와 데이터 기준일 중 늦은 날
    ...STATIC_PAGE_SLUGS.map((slug) => ({ path: `/${slug}`, lastmod: slug === 'updates' ? maxDate([dataUpdated, latestSiteUpdate()]) : dataUpdated })),
  ];
  add('sitemap-pages.xml', pages, urlset(both(pages)));

  // 손으로 쓴 소개글이 붙은 허브(10-14 D74)는 소개글을 고친 날까지 넣어 가장 늦은 날
  const introLastmod = maxDate([numbersUpdated, HUB_INTROS_UPDATED]);
  const hubLastmod = (ids: readonly string[], id: string) => (ids.includes(id) ? introLastmod : numbersUpdated);
  const gpuEntries = gpus.map((g) => ({ path: `/gpu/${g.id}`, lastmod: hubLastmod(GPU_INTRO_IDS, g.id) }));
  add('sitemap-gpus.xml', gpuEntries, urlset(both(gpuEntries)));

  // 모델 소개(10-19 D102)는 모델마다 고친 날이 다르다 — 매일 신모델과 함께 소개가 늘어난다
  const modelLastmod = (id: string) => (hasModelAbout(id) ? maxDate([hubLastmod(MODEL_INTRO_IDS, id), MODEL_ABOUT[id]]) : hubLastmod(MODEL_INTRO_IDS, id));
  const modelEntries = models.map((m) => ({ path: `/model/${m.id}`, lastmod: modelLastmod(m.id) }));
  add('sitemap-models.xml', modelEntries, urlset(both(modelEntries)));

  const guideEntries = published.map((slug) => ({ path: `/guides/${slug}`, lastmod: GUIDES[slug].dateModified }));
  add('sitemap-guides.xml', guideEntries, urlset(both(guideEntries)));

  const compareEntries = compareSitemapEntries(publishedCompares(), numbersUpdated);
  add('sitemap-compare.xml', compareEntries, urlset(both(compareEntries)));

  // 콤보: 로캘별 분할 (docs/04 §3) — comboKey = `gpu/model`, URL = /can-i-run/{model}/on/{gpu}
  const comboEntries = [...indexableCombos(plan)].sort().map((key) => {
    const [gpuId, modelId] = key.split('/');
    return { path: `/can-i-run/${modelId}/on/${gpuId}`, lastmod: numbersUpdated };
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

  // 다음 확인 줄은 다음 안내대로 맨 끝에 — `#` 주석 줄이라 다른 로봇은 무시한다 (10-19 D99)
  const daumLine = DAUM_WEBMASTER_LINE ? `\n${DAUM_WEBMASTER_LINE}\n` : '';
  writeFileSync(
    join(outDir, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n${daumLine}`,
    'utf8',
  );

  // ads.txt (Phase 1.5 AdSense) — 게시자 ID 가 있을 때만. 형식: IAB ads.txt, Google 의 인증 기관 ID f08c47fec0942fa0
  const adsTxt = ADSENSE_CLIENT ? [`google.com, ${ADSENSE_CLIENT.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`] : [];
  if (adsTxt.length > 0) writeFileSync(join(outDir, 'ads.txt'), `${adsTxt.join('\n')}\n`, 'utf8');

  // IndexNow 키 파일 (10-16 D93) — 검색엔진이 전송 요청의 keyLocation 에서 읽어 키와 같은지 본다. 내용은 키 한 줄
  const indexNowFile = `${INDEXNOW_KEY}.txt`;
  writeFileSync(join(outDir, indexNowFile), INDEXNOW_KEY, 'utf8');

  // RSS — 로캘별, 채널 문구는 messages 의 Guides.rss*. 본문은 이미 export·평탄화된 가이드 HTML 에서 읽는다 (postbuild 1·2단계 뒤)
  for (const locale of LOCALES) {
    const messages = JSON.parse(readFileSync(join(repoRoot, 'apps/web/messages', `${locale}.json`), 'utf8')) as {
      Guides: { rssTitle: string; rssDescription: string; dataNote: string };
    };
    const items = [...published]
      .sort((a, b) => GUIDES[b].datePublished.localeCompare(GUIDES[a].datePublished))
      .map((slug) => {
        const { title, description } = GUIDES[slug].locales[locale];
        const path = localePath(locale, `/guides/${slug}`);
        const url = absoluteUrl(path);
        const link = esc(url);
        const page = readFileSync(join(outDir, `${path.slice(1)}.html`), 'utf8');
        const body = `${guideFeedHtml(page, url)}\n<p>${esc(messages.Guides.dataNote)}</p>`;
        return [
          '<item>',
          `<title>${esc(title)}</title>`,
          `<link>${link}</link>`,
          `<guid isPermaLink="true">${link}</guid>`,
          `<description>${esc(description)}</description>`,
          `<content:encoded>${cdata(body)}</content:encoded>`,
          `<pubDate>${rfc822(GUIDES[slug].datePublished)}</pubDate>`,
          '</item>',
        ].join('');
      });
    const self = esc(absoluteUrl(localePath(locale, '/rss.xml')));
    const lastBuild = published.length > 0 ? maxDate(published.map((s) => GUIDES[s].dateModified)) : dataUpdated;
    const rss = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
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
    writeFileSync(join(outDir, rssFile(locale)), rss, 'utf8');
  }

  return [
    'sitemap.xml',
    ...files.map((f) => f.name),
    'robots.txt',
    ...LOCALES.map(rssFile),
    ...(adsTxt.length > 0 ? ['ads.txt'] : []),
    indexNowFile,
  ];
}
