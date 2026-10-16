/**
 * 정적 export 후처리 — RSC 페이로드 프루닝(D18) + i18n A안 평탄화 (docs/05 §1 스파이크 결정 기록 참조).
 *
 * next-intl `localePrefix: 'as-needed'` 는 링크를 en 무프리픽스로 생성하지만,
 * 정적 산출물 파일 자체는 `out/en/**` 아래에 놓인다(미들웨어가 없으므로 아무도
 * `/` → `/en` 을 매핑해 주지 않는다). 이 스크립트가 산출물 단계에서 그 간극을 메운다:
 *
 *   0. RSC 페이로드 프루닝 — 평탄화·rename **전** (D18): `__next.*` 디렉터리 재귀 삭제 +
 *      허용목록(robots.txt·ads.txt·llms.txt — P1-5 대비, IndexNow 키 파일 — D93, 어느 경로든 유지) 외 `*.txt` 전부 삭제,
 *      그 결과 빈 디렉터리 정리. 페이지당 5파일 → 1파일: Cloudflare Pages 파일 한도 20,000 대비
 *      (콤보 3,132페이지 포함 ~3,300페이지, docs/05 §3).
 *      안전한 이유: 앱은 일반 `<a>` 만 쓰고 next/link·router 를 쓰지 않는다. Next 16.3.6 클라이언트가
 *      `.txt` 를 요청하는 경로는 `fetchServerResponse`(navigate/prefetch/refresh) 뿐이고 HTML 에는
 *      `.txt` 참조가 0건이며, `pageshow`/`popstate` 복원은 기존 CacheNode 를 재사용한다.
 *   1. `out/en.html` → `out/index.html` (en 루트 HTML)
 *   2. `out/en/**` 를 `out/**` 루트로 평탄화 (en = 루트, docs/04 §2) — 같은 볼륨이라 최상위 항목별 renameSync,
 *      충돌은 즉시 실패
 *   3. `data/aliases.json` → `out/_redirects` 생성 (scripts/build-redirects.ts)
 *   4. 사이트맵·robots.txt·RSS(가이드 본문 포함 — D93)·ads.txt·IndexNow 키 파일 생성 (scripts/build-sitemaps.ts — P1-5)
 *   5. GPU·모델 허브별 공유 카드 PNG `out/og/{gpu,model}/<id>-<locale>.png` (scripts/og-cards.ts — D60)
 *
 * 검증: test/export-invariants.spec.ts (pnpm test:export) — 허용목록 외 `.txt` 0건·`__next` 0·파일 수 한도,
 * 뒤로가기(history) 경로에서 실패 요청 0 은 e2e/smoke.spec.ts 가 본다.
 * 의존성 없음(node:fs/path 만).
 */
import { existsSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEXNOW_KEY } from '../apps/web/lib/site';
import { buildRedirects, loadAliases } from './build-redirects';
import { buildSitemaps } from './build-sitemaps';
import { renderHubOgImages } from './og-cards';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repoRoot, 'apps/web/out');
const enDir = join(outDir, 'en');

/**
 * 프루닝에서 살리는 `.txt` 베이스네임 — 사이트 파일이지 RSC 페이로드가 아니다 (P1-5 사이트맵·robots 대비).
 * IndexNow 키 파일(D93)은 4단계에서 프루닝 뒤에 쓰지만, `public/` 에 두게 되더라도 지워지지 않도록 여기 함께 둔다
 */
const KEEP_TXT = new Set(['robots.txt', 'ads.txt', 'llms.txt', `${INDEXNOW_KEY}.txt`]);

if (!existsSync(outDir)) {
  throw new Error(`expected export output at ${outDir} — run \`pnpm --filter @canrun/web build\` first`);
}

// --- 0. RSC 페이로드 프루닝 (D18) ---------------------------------------------
type PruneStats = { txtFiles: number; nextDirs: number; emptyDirs: number };

/** `__next.*` 디렉터리·허용목록 외 `*.txt` 를 재귀 삭제하고 비게 된 디렉터리를 정리한다. 반환: dir 이 비었는지 */
function prune(dir: string, stats: PruneStats): boolean {
  let remaining = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `__next.$d$locale/`·`__next._not-found/` 등 세그먼트 프리페치 디렉터리 (`_next/` 정적 청크는 무관)
      if (entry.name.startsWith('__next.')) {
        rmSync(full, { recursive: true });
        stats.nextDirs += 1;
        continue;
      }
      if (prune(full, stats)) {
        rmdirSync(full);
        stats.emptyDirs += 1;
        continue;
      }
      remaining += 1;
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.txt') && !KEEP_TXT.has(lower)) {
      rmSync(full);
      stats.txtFiles += 1;
      continue;
    }
    remaining += 1;
  }
  return remaining === 0;
}

const pruned: PruneStats = { txtFiles: 0, nextDirs: 0, emptyDirs: 0 };
if (prune(outDir, pruned)) {
  throw new Error('pruning left out/ empty — unexpected export layout, aborting');
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

// `/en/**` 하위 페이지: out/en/** → out/** (충돌 = 즉시 실패, 조용한 덮어쓰기 금지)
let flattened = 0;
if (existsSync(enDir)) {
  for (const entry of readdirSync(enDir)) {
    const from = join(enDir, entry);
    const to = join(outDir, entry);
    if (existsSync(to)) {
      throw new Error(`flattening out/en/${entry} would overwrite out/${entry} — aborting`);
    }
    renameSync(from, to);
    flattened += 1;
  }
  // 전부 옮겼으므로 비어 있어야 한다 — 아니면 ENOTEMPTY 로 실패시킨다
  rmdirSync(enDir);
}

if (!existsSync(rootIndex)) {
  throw new Error('flattening finished but out/index.html is missing — en root page was not exported');
}

// --- 3. _redirects 생성 ------------------------------------------------------
const redirects = buildRedirects(loadAliases(repoRoot));
writeFileSync(join(outDir, '_redirects'), redirects, 'utf8');

// --- 4. 사이트맵·robots·RSS (P1-5) -------------------------------------------
const seoFiles = buildSitemaps(repoRoot, outDir);
// 5. 허브별 공유 카드 (10-01 D60) — 판정 개수가 데이터를 따라가도록 빌드마다 다시 그린다
const ogCards = await renderHubOgImages(outDir);

console.log(
  `[postbuild] pruned ${pruned.txtFiles} RSC .txt + ${pruned.nextDirs} __next.* dirs ` +
    `(${pruned.emptyDirs} emptied dirs removed), flattened ${flattened} en entries to root, _redirects written, ${seoFiles.join(' ')}, ${ogCards} og cards`,
);
