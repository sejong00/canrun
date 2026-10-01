/**
 * 허브별 공유 카드(og:image) — GPU 허브·모델 허브마다 en·ko 1장씩 (10-01, PROGRESS §4 D60).
 * postbuild 가 정적 export 뒤에 `out/og/{gpu,model}/<id>-<locale>.png` 로 쓴다(빌드마다 다시 — 판정 개수가 데이터를 따라간다).
 *
 * 렌더러는 Next 에 들어 있는 OG 이미지 렌더러(@vercel/og = satori + resvg, wasm)를 그대로 쓴다 — 새 의존성 없음.
 * 글꼴은 Noto Sans KR Bold 서브셋(SIL OFL 1.1, apps/web/assets/og/) — 카드에 들어가는 글자만 담는다.
 * 카드 문구·GPU·모델 이름이 바뀌어 새 글자가 생기면 scripts/og-cards.test.ts 가 잡고, `pnpm exec tsx scripts/og-font.ts` 로 다시 받는다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseBenchmarks,
  parseGpus,
  parseModelQuants,
  parseModels,
  parseQuantDefs,
  summarizeGpu,
  summarizeModel,
  type Gpu,
  type Model,
  type SeedCatalog,
} from '../packages/data/src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OG_FONT_PATH = join(repoRoot, 'apps/web/assets/og/NotoSansKR-Bold-subset.ttf');
export const OG_FONT_CHARS_PATH = join(repoRoot, 'apps/web/assets/og/subset-chars.txt');

export const OG_LOCALES = ['en', 'ko'] as const;
export type OgLocale = (typeof OG_LOCALES)[number];
type Verdict = 'S' | 'A' | 'B' | 'F';
const VERDICTS: readonly Verdict[] = ['S', 'A', 'B', 'F'];

type Messages = {
  Verdict: Record<Verdict, string>;
  OgCard: { gpuSubtitle: string; modelSubtitle: string; unifiedMemory: string; vram: string; active: string };
  GpuName?: Record<string, string>;
};

const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));

export function loadMessages(locale: OgLocale): Messages {
  return readJson(`apps/web/messages/${locale}.json`) as Messages;
}

export function loadCatalog(): SeedCatalog {
  return {
    gpus: parseGpus(readJson('data/gpus.json')),
    models: parseModels(readJson('data/models.json')),
    modelQuants: parseModelQuants(readJson('data/model-quants.json')),
    quantDefs: parseQuantDefs(readJson('data/quants.json')),
    benchmarks: parseBenchmarks(readJson('data/benchmarks.json')),
  };
}

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

const gpuLabel = (m: Messages, gpu: Gpu): string => m.GpuName?.[gpu.id] ?? gpu.name;

/** GPU 카드의 메모리 줄 — dGPU 는 VRAM, 통합·CPU 는 고를 수 있는 메모리(최대) */
function gpuMemoryLine(m: Messages, gpu: Gpu): string {
  if (gpu.kind === 'dgpu') return fill(m.OgCard.vram, { mem: gpu.vramGB ?? 0 });
  const mem = Math.max(...(gpu.ramOptionsGB ?? [0]));
  return fill(m.OgCard.unifiedMemory, { mem });
}

export type CardText = { title: string; detail: string; subtitle: string; counts: Record<Verdict, number>; labels: Record<Verdict, string> };

export function gpuCardText(catalog: SeedCatalog, gpu: Gpu, m: Messages): CardText {
  const hub = summarizeGpu(catalog, gpu);
  const c = hub.counts[hub.primaryIndex]!;
  return {
    title: gpuLabel(m, gpu),
    detail: gpuMemoryLine(m, gpu),
    subtitle: m.OgCard.gpuSubtitle,
    counts: { S: c.S, A: c.A, B: c.B, F: c.F },
    labels: m.Verdict,
  };
}

export function modelCardText(catalog: SeedCatalog, model: Model, m: Messages): CardText {
  const hub = summarizeModel(catalog, model);
  const counts: Record<Verdict, number> = { S: 0, A: 0, B: 0, F: 0 };
  for (const row of hub.gpuRows) counts[row.combo.baseline.result.verdict] += 1;
  const params =
    model.activeParamsB !== undefined ? `${model.paramsB}B · ${fill(m.OgCard.active, { n: model.activeParamsB })}` : `${model.paramsB}B`;
  return { title: model.name, detail: `${params} · ${hub.baselineQuant}`, subtitle: m.OgCard.modelSubtitle, counts, labels: m.Verdict };
}

/** 카드에 나올 수 있는 모든 글자 — 글꼴 서브셋의 기준 (og-font.ts·테스트 공용) */
export function ogCardChars(catalog: SeedCatalog = loadCatalog()): string {
  const parts: string[] = ['CanRun canrunllm.com 0123456789 ·—–×…'];
  for (let c = 0x20; c <= 0x7e; c += 1) parts.push(String.fromCharCode(c));
  for (const locale of OG_LOCALES) {
    const m = loadMessages(locale);
    parts.push(...Object.values(m.Verdict), ...Object.values(m.OgCard), ...Object.values(m.GpuName ?? {}));
  }
  for (const gpu of catalog.gpus) parts.push(gpu.name);
  for (const model of catalog.models) parts.push(model.name);
  return [...new Set(parts.join(''))].filter((ch) => ch.trim() !== '' || ch === ' ').sort().join('');
}

// 카드 색 — 기본 카드(scripts/make-og.ts)와 같은 팔레트
const CHIP: Record<Verdict, { bg: string; fg: string }> = {
  S: { bg: '#14532d', fg: '#bbf7d0' },
  A: { bg: '#1e3a8a', fg: '#bfdbfe' },
  B: { bg: '#713f12', fg: '#fde68a' },
  F: { bg: '#7f1d1d', fg: '#fecaca' },
};

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({ type, props: { style, children } });

function cardElement(t: CardText): Node {
  return h(
    'div',
    {
      width: '1200px',
      height: '630px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px 80px',
      backgroundColor: '#0f172a',
      color: '#f8fafc',
      fontFamily: 'Noto Sans KR',
    },
    [
      h('div', { display: 'flex', justifyContent: 'space-between', fontSize: '34px', color: '#cbd5e1' }, [
        h('span', {}, 'CanRun'),
        h('span', {}, 'canrunllm.com'),
      ]),
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('div', { fontSize: t.title.length > 26 ? '64px' : '80px', lineHeight: 1.1, letterSpacing: '-1px' }, t.title),
        h('div', { marginTop: '14px', fontSize: '32px', color: '#94a3b8' }, t.detail),
        h('div', { marginTop: '26px', fontSize: '40px', color: '#e2e8f0' }, t.subtitle),
      ]),
      h(
        'div',
        { display: 'flex', gap: '16px' },
        VERDICTS.map((v) =>
          h('div', { display: 'flex', padding: '10px 22px', borderRadius: '999px', backgroundColor: CHIP[v].bg, color: CHIP[v].fg, fontSize: '30px' }, `${t.labels[v]} ${t.counts[v]}`),
        ),
      ),
    ],
  );
}

type ImageResponseCtor = new (element: unknown, init: Record<string, unknown>) => Response;

async function loadRenderer(): Promise<ImageResponseCtor> {
  // Next 에 번들된 @vercel/og (node 판) — apps/web 기준으로 찾는다
  const req = createRequire(join(repoRoot, 'apps/web/package.json'));
  const entry = req.resolve('next/dist/compiled/@vercel/og/index.node.js');
  const mod = (await import(pathToFileURL(entry).href)) as { ImageResponse: ImageResponseCtor };
  return mod.ImageResponse;
}

/** out/og/{gpu,model}/<id>-<locale>.png 를 쓴다. 반환: 쓴 파일 수 */
export async function renderHubOgImages(outDir: string, catalog: SeedCatalog = loadCatalog()): Promise<number> {
  const ImageResponse = await loadRenderer();
  const font = readFileSync(OG_FONT_PATH);
  const fonts = [{ name: 'Noto Sans KR', data: font, weight: 700, style: 'normal' }];
  let n = 0;
  const write = async (kind: 'gpu' | 'model', id: string, locale: OgLocale, text: CardText) => {
    const res = new ImageResponse(cardElement(text), { width: 1200, height: 630, fonts });
    const png = Buffer.from(await res.arrayBuffer());
    const dir = join(outDir, 'og', kind);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}-${locale}.png`), png);
    n += 1;
  };
  for (const locale of OG_LOCALES) {
    const m = loadMessages(locale);
    for (const gpu of catalog.gpus) await write('gpu', gpu.id, locale, gpuCardText(catalog, gpu, m));
    for (const model of catalog.models) await write('model', model.id, locale, modelCardText(catalog, model, m));
  }
  return n;
}
