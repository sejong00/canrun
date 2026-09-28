/**
 * 정적 export 산출물(apps/web/out) 로컬 서버 — Playwright 스모크·Lighthouse CI·`pnpm start` 공용 (P1-1).
 *
 * Cloudflare Pages 의 경로 매핑을 흉내 낸다(새 의존성 없이 node:http 만):
 *   1. 정확한 경로가 **파일**이면 그대로 (`/a.txt`). `/ko`·`/model/qwen3.5-9b` 같은 디렉터리는 파일이 아니다
 *   2. `경로 + .html`  (`/model/qwen3.5-9b` → model/qwen3.5-9b.html — 확장자 휴리스틱 없음, 점 슬러그 대표)
 *   3. `경로/index.html`
 *   `/` → index.html. 그 밖은 out/404.html 을 **상태 404** 로 (없으면 평문 404).
 *
 * 쿼리·해시는 무시(`?_rsc=` 등), 디코드 실패·NUL·`..` 세그먼트는 400, 결과는 outDir 밖으로 나가지 않는다.
 * GET/HEAD 만 허용(그 외 405). 텍스트 응답은 Accept-Encoding 에 gzip 이 있으면 압축한다.
 * `_redirects`(별칭 301)는 모사하지 않는다 — 별칭 검증은 test/export-invariants.spec.ts 담당.
 *
 * 실행: pnpm serve-out  (127.0.0.1:4173, PORT 환경변수로 변경)
 */
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, STATUS_CODES, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT_DIR = resolve(repoRoot, 'apps/web/out');
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4173;

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  // Next RSC 페이로드(.txt)는 text/plain 이어야 클라이언트 라우터가 받아들인다
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const DEFAULT_MIME = 'application/octet-stream';
const COMPRESSIBLE = new Set(['.html', '.txt', '.js', '.css', '.json', '.svg', '.xml']);

/** 요청 경로 해석 결과. `file === null` 이면 평문 상태 응답. */
export type Resolved =
  | { status: 200; file: string }
  | { status: 404; file: string | null }
  | { status: 400; file: null };

export function contentTypeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? DEFAULT_MIME;
}

export function isCompressible(file: string): boolean {
  return COMPRESSIBLE.has(extname(file).toLowerCase());
}

/** Accept-Encoding 에 q>0 인 gzip 이 있는지 */
export function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  return header.split(',').some((part) => {
    const [name = '', ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    if (name !== 'gzip') return false;
    const q = params.find((p) => p.startsWith('q='));
    return q === undefined || Number.parseFloat(q.slice(2)) > 0;
  });
}

/**
 * 어떤 stat 오류도 "파일 아님" 으로 — throwIfNoEntry 는 ENOENT/ENOTDIR 만 삼키고 ENAMETOOLONG 등은
 * 던진다. 요청 리스너 밖으로 새면 서버 프로세스가 죽는다 (P1-1 리뷰).
 */
function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}

/** outDir 안쪽(자기 자신 제외)인지 — 해석 규칙과 별개의 최종 방어선 */
function isInside(outDir: string, full: string): boolean {
  const rel = relative(outDir, full);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * 요청 URL(origin-form) → 제공할 파일과 상태. 파일 시스템은 stat 만 읽는다.
 * outDir 는 절대 경로여야 한다.
 */
export function resolveOutPath(outDir: string, rawUrl: string): Resolved {
  const bad: Resolved = { status: 400, file: null };
  if (!rawUrl.startsWith('/')) return bad;
  // URL 파서가 `..` 를 조용히 정규화하기 전에 원문에서 먼저 거부한다 (`/../etc`, `/%2e%2e/etc`)
  const rawPath = rawUrl.split(/[?#]/, 1)[0] ?? '';
  if (/(?:^|[/\\])(?:\.|%2e){1,2}(?:[/\\]|$)/i.test(rawPath)) return bad;

  let pathname: string;
  try {
    // 접두사 결합 — `//etc` 가 프로토콜 상대 URL(호스트 etc)로 해석되지 않게 한다
    pathname = new URL(`http://serve-out.local${rawUrl}`).pathname;
  } catch {
    return bad;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return bad;
  }
  if (decoded.includes('\0')) return bad;

  // 디코드 후 `%2e%2e`·`%2f`·`%5c` 로 만들어진 상위 이동도 거부 (Windows 구분자 포함)
  const segments = decoded.split(/[/\\]/).filter((s) => s !== '');
  if (segments.some((s) => s === '.' || s === '..')) return bad;

  const rel = segments.join('/');
  const candidates = rel === '' ? ['index.html'] : [rel, `${rel}.html`, `${rel}/index.html`];
  for (const candidate of candidates) {
    const full = join(outDir, candidate);
    if (isInside(outDir, full) && isFile(full)) return { status: 200, file: full };
  }

  const notFound = join(outDir, '404.html');
  return { status: 404, file: isFile(notFound) ? notFound : null };
}

/** out 디렉터리를 서빙하는 http.Server (listen 은 호출자가) */
export function createOutServer(outDir: string = DEFAULT_OUT_DIR): Server {
  const root = resolve(outDir);
  return createServer((req, res) => {
    const method = req.method ?? 'GET';
    const sendPlain = (status: number, extra: Record<string, string> = {}) => {
      const body = `${status} ${STATUS_CODES[status] ?? ''}\n`;
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-cache',
        ...extra,
      });
      res.end(method === 'HEAD' ? undefined : body);
    };

    if (method !== 'GET' && method !== 'HEAD') {
      sendPlain(405, { Allow: 'GET, HEAD' });
      return;
    }

    const resolved = resolveOutPath(root, req.url ?? '/');
    if (resolved.file === null) {
      sendPlain(resolved.status);
      return;
    }
    const { file, status } = resolved;

    readFile(file).then(
      (raw) => {
        const headers: Record<string, string | number> = {
          'Content-Type': contentTypeFor(file),
          'Cache-Control': 'no-cache',
        };
        let body = raw;
        if (isCompressible(file)) {
          headers.Vary = 'Accept-Encoding';
          if (acceptsGzip(req.headers['accept-encoding'])) {
            body = gzipSync(raw);
            headers['Content-Encoding'] = 'gzip';
          }
        }
        headers['Content-Length'] = body.length;
        res.writeHead(status, headers);
        res.end(method === 'HEAD' ? undefined : body);
      },
      (err: unknown) => {
        console.error(`[serve-out] failed to read ${file}:`, err);
        sendPlain(500);
      },
    );
  });
}

export type StartOptions = { outDir?: string; host?: string; port?: number };

/** 서버 기동. port 0 이면 임의 포트(테스트용) — 실제 URL 은 반환값으로 */
export async function startOutServer(
  options: StartOptions = {},
): Promise<{ server: Server; url: string }> {
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR);
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
    throw new Error(`export output not found at ${outDir} — run \`pnpm build\` first`);
  }
  const host = options.host ?? DEFAULT_HOST;
  const server = createOutServer(outDir);
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? DEFAULT_PORT, host, () => {
      server.off('error', fail);
      done();
    });
  });
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://${host}:${port}` };
}

async function main(): Promise<void> {
  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid PORT: ${process.env.PORT}`);
  }
  const { url } = await startOutServer({ port });
  // Lighthouse CI startServerReadyPattern 이 이 문구를 기다린다 (lighthouserc.json)
  console.log(`[serve-out] listening on ${url}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
