/**
 * IndexNow 전송 (10-16 D93) — 배포 뒤 새로 생기거나 lastmod 가 바뀐 URL 을 검색엔진에 바로 알린다.
 * 네이버 서치어드바이저는 2023-07 부터 IndexNow 를 받는다(https://searchadvisor.naver.com/guide/indexnow-request,
 * 프로토콜 https://www.indexnow.org/documentation). Google 은 IndexNow 를 쓰지 않고 sitemap ping 도 2023 년에 없앴다 — GSC 에서 따로.
 *
 * 흐름 (.github/workflows/deploy.yml — main 푸시·수동 실행·daily-rebuild 의 workflow_call 이 모두 같은 잡을 돈다):
 *   1. `fetch <dir>`  — Cloudflare 배포 **전**에 지금 사이트의 sitemap.xml·하위 사이트맵과 키 파일 응답을 `<dir>/live.json` 에 받아 둔다
 *   2. (배포)
 *   3. `submit <dir>` — 배포가 성공하면 `apps/web/out` 의 새 사이트맵을 1 과 비교해 바뀐 URL 만 보낸다 (`--dry` = 보내지 않고 목록만)
 * 어느 단계든 실패는 경고만 남기고 exit 0 — 색인 알림 때문에 배포가 실패하지 않는다.
 *
 * 규칙:
 *  - 보낼 URL = 새 사이트맵의 `<url>` 가운데 지금 사이트의 사이트맵에 없거나 `<lastmod>` 가 달라진 것. 사이트맵은 noindex 가 아닌
 *    캐노니컬 전체라(export 테스트) 색인 대상만 나간다. 사이트맵에서 빠진 URL 은 보내지 않는다(noindex 전환·리디렉션 — 크롤로 충분)
 *  - 지금 사이트에 이 키 파일이 없으면(404 — 이 키로 처음 보내는 배포) 전부 보낸다. 옛 사이트맵을 다 받지 못했을 때도 전부(놓치지 않게)
 *  - 요청 = POST JSON `{host, key, keyLocation, urlList}`, urlList 는 10,000 개씩. 200·202 = 접수, 그 밖(400·403·422·429 …)은 경고
 *  - 보내는 곳 = 네이버 + api.indexnow.org(Bing·Yandex·Seznam·네이버 등 참여 엔진이 나눠 받는다)
 * 시크릿 없음 — 키는 공개 값(apps/web/lib/site.ts `INDEXNOW_KEY`, docs/05 §8).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEXNOW_KEY, SITE_URL } from '../apps/web/lib/site';

export const INDEXNOW_ENDPOINTS = ['https://searchadvisor.naver.com/indexnow', 'https://api.indexnow.org/indexnow'] as const;
/** 요청 1건의 urlList 상한 — 프로토콜 한도 */
export const INDEXNOW_MAX_URLS = 10_000;
const USER_AGENT = `CanRun-IndexNow/1 (+${SITE_URL})`;
const TIMEOUT_MS = 30_000;

/** 배포 전에 받아 둔 지금 사이트의 상태 */
export type LiveSnapshot = {
  /** 키 파일 응답 상태 코드 (네트워크 오류면 null) */
  keyStatus: number | null;
  /** 키 파일이 200 이고 내용이 키와 같음 — 아니면 이 키로 처음 보내는 배포로 본다 */
  keyFound: boolean;
  /** sitemap.xml + 하위 사이트맵 원문 — 하나라도 못 받으면 null */
  sitemaps: string[] | null;
};

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** urlset 사이트맵들 → URL → lastmod (lastmod 없으면 ''). 사이트맵 인덱스의 `<sitemap>` 항목은 `<url>` 이 아니라 건너뛴다 */
export function sitemapUrls(xmls: readonly string[]): Map<string, string> {
  const urls = new Map<string, string>();
  for (const xml of xmls) {
    for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(block[1]!)?.[1];
      if (loc === undefined) continue;
      urls.set(decodeXml(loc), /<lastmod>\s*([^<]+?)\s*<\/lastmod>/.exec(block[1]!)?.[1] ?? '');
    }
  }
  return urls;
}

/** 사이트맵 인덱스 → 하위 사이트맵 URL */
export function sitemapIndexLocs(xml: string): string[] {
  return [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>[\s\S]*?<\/sitemap>/g)].map((m) => decodeXml(m[1]!));
}

/**
 * 보낼 URL (순수 함수) — 새 사이트맵 순서 그대로. host 가 다른 URL 은 뺀다(IndexNow 는 키의 host 만 받는다 — 422).
 * 키 파일이 없었거나(첫 실행) 옛 사이트맵을 다 못 받았으면 전부, 아니면 새로 생겼거나 lastmod 가 바뀐 URL 만.
 */
export function urlsToSubmit(nextSitemaps: readonly string[], live: LiveSnapshot, host: string): string[] {
  const next = sitemapUrls(nextSitemaps);
  const prev = live.keyFound && live.sitemaps !== null ? sitemapUrls(live.sitemaps) : undefined;
  return [...next]
    .filter(([url, lastmod]) => new URL(url).host === host && (prev === undefined || prev.get(url) !== lastmod))
    .map(([url]) => url);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type IndexNowPayload = { host: string; key: string; keyLocation: string; urlList: string[] };

export function indexNowPayload(siteUrl: string, key: string, urlList: string[]): IndexNowPayload {
  return { host: new URL(siteUrl).host, key, keyLocation: `${siteUrl}/${key}.txt`, urlList };
}

/** 200 = 접수·처리, 202 = 접수(키 확인 대기) — 둘 다 성공. 그 밖은 경고만 */
export const accepted = (status: number) => status === 200 || status === 202;

type Fetch = typeof fetch;
type Log = { info: (msg: string) => void; warn: (msg: string) => void };

const consoleLog: Log = {
  info: (msg) => console.log(`[indexnow] ${msg}`),
  // GitHub Actions 에서는 실행 요약에 경고로 뜨게 한다
  warn: (msg) => console.log(process.env.GITHUB_ACTIONS === 'true' ? `::warning title=IndexNow::${msg}` : `[indexnow] warning: ${msg}`),
};

async function getText(fetchImpl: Fetch, url: string): Promise<{ status: number; text: string }> {
  const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  return { status: res.status, text: await res.text() };
}

/** 지금 사이트의 키 파일·사이트맵 받기 — 예외를 던지지 않는다(못 받은 부분은 null·false) */
export async function fetchLiveSnapshot(siteUrl: string, key: string, fetchImpl: Fetch = fetch, log: Log = consoleLog): Promise<LiveSnapshot> {
  let keyStatus: number | null = null;
  let keyFound = false;
  try {
    const res = await getText(fetchImpl, `${siteUrl}/${key}.txt`);
    keyStatus = res.status;
    keyFound = res.status === 200 && res.text.trim() === key;
  } catch (err) {
    log.warn(`key file fetch failed: ${String(err)}`);
  }

  let sitemaps: string[] | null = null;
  try {
    const index = await getText(fetchImpl, `${siteUrl}/sitemap.xml`);
    if (index.status !== 200) throw new Error(`sitemap.xml HTTP ${index.status}`);
    const subs: string[] = [];
    for (const loc of sitemapIndexLocs(index.text)) {
      const sub = await getText(fetchImpl, loc);
      if (sub.status !== 200) throw new Error(`${loc} HTTP ${sub.status}`);
      subs.push(sub.text);
    }
    sitemaps = [index.text, ...subs];
  } catch (err) {
    log.warn(`live sitemap fetch failed — every URL will be submitted: ${String(err)}`);
  }
  log.info(`live: key file ${keyStatus ?? 'unreachable'}${keyFound ? ' (matches)' : ''}, ${sitemaps === null ? 'no sitemaps' : `${sitemaps.length} sitemap file(s)`}`);
  return { keyStatus, keyFound, sitemaps };
}

export type SubmitResult = { endpoint: string; urls: number; status: number | null };

/** 엔드포인트마다 10,000 개씩 POST — 예외를 던지지 않고 상태 코드를 돌려준다 */
export async function submitUrls(
  urls: readonly string[],
  opts: { siteUrl: string; key: string; endpoints?: readonly string[]; fetchImpl?: Fetch; log?: Log },
): Promise<SubmitResult[]> {
  const { siteUrl, key, endpoints = INDEXNOW_ENDPOINTS, fetchImpl = fetch, log = consoleLog } = opts;
  const results: SubmitResult[] = [];
  for (const part of chunk(urls, INDEXNOW_MAX_URLS)) {
    const body = JSON.stringify(indexNowPayload(siteUrl, key, part));
    for (const endpoint of endpoints) {
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': USER_AGENT },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const line = `${endpoint} ← ${part.length} URL(s): HTTP ${res.status}`;
        if (accepted(res.status)) log.info(line);
        else log.warn(`${line} ${(await res.text()).slice(0, 200).replace(/\s+/g, ' ')}`.trim());
        results.push({ endpoint, urls: part.length, status: res.status });
      } catch (err) {
        log.warn(`${endpoint} ← ${part.length} URL(s): request failed: ${String(err)}`);
        results.push({ endpoint, urls: part.length, status: null });
      }
    }
  }
  return results;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'apps/web/out');
const SNAPSHOT = 'live.json';

/** apps/web/out 의 새 사이트맵 — 인덱스가 가리키는 하위 파일까지 */
function readBuiltSitemaps(): string[] {
  const index = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
  const subs = sitemapIndexLocs(index).map((loc) => {
    if (!loc.startsWith(`${SITE_URL}/`)) throw new Error(`sitemap index points outside ${SITE_URL}: ${loc}`);
    return readFileSync(join(outDir, loc.slice(SITE_URL.length + 1)), 'utf8');
  });
  return [index, ...subs];
}

function readSnapshot(dir: string): LiveSnapshot {
  const path = join(dir, SNAPSHOT);
  if (!existsSync(path)) {
    consoleLog.warn(`${path} not found (fetch step skipped or failed) — every URL will be submitted`);
    return { keyStatus: null, keyFound: false, sitemaps: null };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as LiveSnapshot;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const [command, dir] = args.filter((a) => !a.startsWith('--'));
  if ((command !== 'fetch' && command !== 'submit') || dir === undefined) {
    throw new Error('usage: tsx scripts/indexnow.ts fetch <dir> | submit <dir> [--dry]');
  }
  if (command === 'fetch') {
    const snapshot = await fetchLiveSnapshot(SITE_URL, INDEXNOW_KEY);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SNAPSHOT), JSON.stringify(snapshot), 'utf8');
    return;
  }
  const live = readSnapshot(dir);
  const urls = urlsToSubmit(readBuiltSitemaps(), live, new URL(SITE_URL).host);
  const why = live.keyFound && live.sitemaps !== null ? 'new or lastmod changed' : 'all (first run with this key or no live sitemaps)';
  consoleLog.info(`${urls.length} URL(s) to submit — ${why}`);
  if (urls.length === 0) return;
  if (args.includes('--dry')) {
    for (const url of urls.slice(0, 50)) consoleLog.info(`  ${url}`);
    if (urls.length > 50) consoleLog.info(`  … ${urls.length - 50} more`);
    return;
  }
  await submitUrls(urls, { siteUrl: SITE_URL, key: INDEXNOW_KEY });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 배포를 실패시키지 않는다 — 어떤 오류든 경고로 남기고 exit 0
  main().catch((err: unknown) => {
    consoleLog.warn(`skipped: ${err instanceof Error ? err.message : String(err)}`);
  });
}
