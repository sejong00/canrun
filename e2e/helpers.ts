/**
 * E2E 공용 헬퍼 (smoke · calculator · islands 스펙이 공유).
 * DOM 전역(document 등)은 쓰지 않는다 — 루트 tsconfig 에 DOM lib 이 없다. locator API 와 문자열형 evaluate 만.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const LOCALES = ['en', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];

/** 로케일 무관 경로 → 해당 로케일 URL 경로 (en 무프리픽스, ko 홈은 `/ko`) */
export function localePath(locale: Locale, path: string): string {
  if (locale === 'en') return path;
  return path === '/' ? '/ko' : `/ko${path}`;
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'en' ? 'ko' : 'en';
}

/** 절대·상대 href → pathname (루트는 '/') */
export function pathnameOf(href: string | null, base: string): string {
  expect(href, 'href attribute').not.toBeNull();
  return new URL(href ?? '', base).pathname || '/';
}

/** 콤보 경로 → 카탈로그 id 쌍 */
export function comboIds(path: string): { modelId: string; gpuId: string } {
  const match = /^\/can-i-run\/([^/]+)\/on\/([^/]+)$/.exec(path);
  if (!match) throw new Error(`not a combo path: ${path}`);
  return { modelId: match[1] ?? '', gpuId: match[2] ?? '' };
}

type PublishPlan = {
  currentBatch: number;
  batches: readonly { batch: number; gpuIds: readonly string[]; modelIds: readonly string[] }[];
};

/**
 * data/publish.json 인덱싱 게이트 (D9) — 콤보 배치 = gpuIds·modelIds 가 **둘 다** 그 쌍을 포함하는 항목들의
 * 최소 batch, 공개 ⇔ batch ≤ currentBatch. packages/data 의 comboPublishState 와 같은 규칙을 독립 구현해
 * 렌더된 robots 메타와 교차 검증한다. 테스트 안에서 읽는다(파일 부재가 `--list` 를 깨지 않게).
 */
export function isComboIndexable(modelId: string, gpuId: string): boolean {
  const plan = JSON.parse(readFileSync(resolve(repoRoot, 'data/publish.json'), 'utf8')) as PublishPlan;
  const batches = plan.batches
    .filter((b) => b.gpuIds.includes(gpuId) && b.modelIds.includes(modelId))
    .map((b) => b.batch);
  return batches.length > 0 && Math.min(...batches) <= plan.currentBatch;
}

/** 콘솔 에러·페이지 예외·실패/4xx·5xx 요청을 모은다 (예외 없음) */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()} (${msg.location().url})`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) =>
    problems.push(`requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? '?'}`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  return problems;
}

/** 이동 후 네트워크가 잠잠해질 때까지 — 하이드레이션 뒤 늦게 나는 에러·프리페치 404 까지 잡는다 */
export async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState('networkidle');
  return response;
}

/** `<a>` 클릭으로 같은 탭 이동 → 문서 응답 상태·URL·h1 확인 */
export async function clickThrough(page: Page, link: Locator): Promise<string> {
  const target = pathnameOf(await link.getAttribute('href'), page.url());
  const [navResponse] = await Promise.all([
    page.waitForResponse(
      (res) => res.request().isNavigationRequest() && new URL(res.url()).pathname === target,
    ),
    link.click(),
  ]);
  expect(navResponse.status(), `status of ${target}`).toBe(200);
  await page.waitForLoadState('networkidle');
  expect(new URL(page.url()).pathname).toBe(target);
  await expect(page.locator('h1:visible')).toHaveCount(1);
  return target;
}

export async function readJsonLd(page: Page): Promise<unknown[]> {
  const texts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return texts.map((text, i) => {
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      throw new Error(`JSON-LD block #${i} does not parse: ${String(err)}\n${text.slice(0, 200)}`);
    }
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 최상위 노드(배열·@graph 포함)를 깊이 우선으로 방문 */
export function visitJsonLd(blocks: readonly unknown[], visit: (node: Record<string, unknown>) => void): void {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isRecord(node)) return;
    visit(node);
    if (node['@graph'] !== undefined) walk(node['@graph']);
  };
  blocks.forEach(walk);
}

/** 최상위 노드의 @type 집합 */
export function jsonLdTypes(blocks: readonly unknown[]): Set<string> {
  const types = new Set<string>();
  visitJsonLd(blocks, (node) => {
    const type = node['@type'];
    for (const t of Array.isArray(type) ? type : [type]) {
      if (typeof t === 'string') types.add(t);
    }
  });
  return types;
}

/** BreadcrumbList 의 itemListElement (전 블록 합산) */
export function breadcrumbItems(blocks: readonly unknown[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  visitJsonLd(blocks, (node) => {
    if (node['@type'] !== 'BreadcrumbList') return;
    const list = node.itemListElement;
    if (Array.isArray(list)) items.push(...list.filter(isRecord));
  });
  return items;
}

/** 규칙 3 — 속도 문장은 "a–b" 범위를 동반한다 */
export const RANGE_RE = /\d[\d.,]*\s*[–-]\s*\d[\d.,]*/;

/** 누적 레이아웃 이동(입력 직후 제외) — `page.addInitScript` 로 로드 전에 심고 `window.__cls` 를 읽는다 (계산기 딥링크 — D65·D73) */
export const CLS_OBSERVER = `
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: 'layout-shift', buffered: true });
`;

/** `_next/static/chunks` 요청 수 — 지연 청크·프리페치 회귀 감시 */
export function trackChunkRequests(page: Page): () => number {
  let count = 0;
  page.on('request', (req) => {
    if (req.url().includes('/_next/static/chunks/')) count += 1;
  });
  return () => count;
}

const QWEN3_4B_CONFIG = {
  model_type: 'qwen3',
  num_hidden_layers: 36,
  num_attention_heads: 32,
  num_key_value_heads: 8,
  head_dim: 128,
  hidden_size: 2560,
  max_position_embeddings: 40960,
};

/**
 * huggingface.co 요청 가짜 응답 — 모르는 주소는 404 (실제 망으로 새지 않게). CI 는 외부망을 쓰지 않는다.
 * 계산기 "목록에 없는 모델"(hf-model.spec, D57)과 모델 모드(calculator-model.spec, D65)가 같이 쓴다
 */
export async function mockHf(page: Page) {
  await page.route('https://huggingface.co/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === '/api/models/Qwen/Qwen3-4B') {
      return json({ id: 'Qwen/Qwen3-4B', siblings: [{ rfilename: 'config.json' }], cardData: { license: 'apache-2.0' }, safetensors: { total: 4_022_468_096 } });
    }
    if (p === '/api/models' && url.searchParams.get('filter') === 'gguf') {
      return json([{ id: 'unsloth/Qwen3-4B-GGUF' }, { id: 'Qwen/Qwen3-4B-GGUF' }]);
    }
    if (p === '/api/models/Qwen/Qwen3-4B-GGUF/tree/main') {
      return json([
        { type: 'file', path: 'Qwen3-4B-Q4_K_M.gguf', size: 2_497_280_256 },
        { type: 'file', path: 'Qwen3-4B-Q8_0.gguf', size: 4_280_404_736 },
        { type: 'file', path: 'README.md', size: 1200 },
      ]);
    }
    if (p === '/Qwen/Qwen3-4B/resolve/main/config.json') return json(QWEN3_4B_CONFIG);
    if (p === '/api/models/state-spaces/mamba2-2.7b') {
      return json({ id: 'state-spaces/mamba2-2.7b', siblings: [{ rfilename: 'config.json' }], safetensors: { total: 2_700_000_000 } });
    }
    if (p === '/api/models/state-spaces/mamba2-2.7b/tree/main' || p === '/api/models/state-spaces/mamba2-2.7b-GGUF/tree/main') {
      return json([{ type: 'file', path: 'mamba2-2.7b-Q4_K_M.gguf', size: 1_600_000_000 }]);
    }
    if (p === '/state-spaces/mamba2-2.7b/resolve/main/config.json') return json({ model_type: 'mamba2', num_hidden_layers: 64 });
    return json({ error: 'not found' }, 404);
  });
}
