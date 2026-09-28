/**
 * 정적 export 후처리 — i18n A안 (docs/05 §1 스파이크 결정 기록 참조).
 *
 * next-intl `localePrefix: 'as-needed'` 는 링크를 en 무프리픽스로 생성하지만,
 * 정적 산출물 파일 자체는 `out/en/**` 아래에 놓인다(미들웨어가 없으므로 아무도
 * `/` → `/en` 을 매핑해 주지 않는다). 이 스크립트가 산출물 단계에서 그 간극을 메운다:
 *
 *   1. `out/en/**` 를 `out/**` 루트로 평탄화 (en = 루트, docs/04 §2)
 *   2. `out/en.html` → `out/index.html` 등 로케일 루트 HTML 처리
 *   3. `data/aliases.json` → `out/_redirects` 생성 (scripts/build-redirects.ts)
 *
 * 검증은 test/export-invariants.spec.ts (pnpm test:export) 가 담당한다.
 */
import { cpSync, existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRedirects, loadAliases } from './build-redirects';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repoRoot, 'apps/web/out');
const enDir = join(outDir, 'en');

if (!existsSync(outDir)) {
  throw new Error(`expected export output at ${outDir} — run \`pnpm --filter @canrun/web build\` first`);
}

// --- 1+2. en 산출물을 루트로 평탄화 -----------------------------------------
// `/en` 페이지 자체의 HTML: out/en.html (trailingSlash:false 형태)
const enRootHtml = join(outDir, 'en.html');
const rootIndex = join(outDir, 'index.html');
if (existsSync(enRootHtml)) {
  if (existsSync(rootIndex)) {
    throw new Error('both out/index.html and out/en.html exist — unexpected export layout, aborting');
  }
  renameSync(enRootHtml, rootIndex);
}
// 홈 RSC 페이로드도 같이 이동 — 클라이언트 라우터는 `/` 의 페이로드를 /index.txt 로 요청한다
const enRootTxt = join(outDir, 'en.txt');
const rootIndexTxt = join(outDir, 'index.txt');
if (existsSync(enRootTxt)) {
  if (existsSync(rootIndexTxt)) {
    throw new Error('both out/index.txt and out/en.txt exist — unexpected export layout, aborting');
  }
  renameSync(enRootTxt, rootIndexTxt);
}

// `/en/**` 하위 페이지: out/en/** → out/** (충돌 = 즉시 실패, 조용한 덮어쓰기 금지)
if (existsSync(enDir)) {
  for (const entry of readdirSync(enDir)) {
    const from = join(enDir, entry);
    const to = join(outDir, entry);
    if (existsSync(to)) {
      throw new Error(`flattening out/en/${entry} would overwrite out/${entry} — aborting`);
    }
    cpSync(from, to, { recursive: true });
  }
  rmSync(enDir, { recursive: true });
}

if (!existsSync(rootIndex)) {
  throw new Error('flattening finished but out/index.html is missing — en root page was not exported');
}

// --- 3. _redirects 생성 ------------------------------------------------------
const redirects = buildRedirects(loadAliases(repoRoot));
writeFileSync(join(outDir, '_redirects'), redirects, 'utf8');

console.log('[postbuild] en flattened to root, _redirects written');
