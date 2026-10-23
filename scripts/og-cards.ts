/**
 * 공유 카드(og:image) — GPU·모델 허브(10-01, PROGRESS §4 D60)와 공개 콤보·게시 가이드(10-16 D96)마다 en·ko 1장씩.
 * postbuild 가 정적 export 뒤에 `out/og/…` 로 쓴다(빌드마다 다시 — 판정 개수·속도가 데이터를 따라간다). 경로는 apps/web/lib/og-images.ts
 * (페이지 메타데이터와 같은 함수).
 * - 콤보는 **indexable 집합**(data/publish.json — 사이트맵과 같은 `indexableCombos`)만 그린다. 배치를 열면 카드도 따라 늘고,
 *   미공개 콤보는 기본 카드 그대로(전 조합을 그리면 파일 수 한도 D18 를 먹는다). 카드 = 페이지 제목의 판정 + description 의
 *   필요 메모리·속도 밴드·신뢰 라벨(규칙 3 — 숫자만 따로 두지 않는다). 같은 갈래인지는 export 테스트가 페이지와 대조한다
 * - 가이드는 published 만(초안은 noindex 라 기본 카드), 제목만 싣는다
 * - GPU 비교(10-19 D106)는 published 쌍만(초안·비교 목차는 기본 카드) — 두 기기 이름·판정 수·속도 배율(추정 중앙값, 페이지 요약과 같은 규칙)
 * 네이버는 og:image 를 검색 결과 썸네일로 쓰고, 여러 페이지에 같은 이미지가 반복되면 무시할 수 있다 — 그래서 페이지마다 다른 카드.
 *
 * 렌더러는 Next 에 들어 있는 OG 이미지 렌더러(@vercel/og = satori + resvg, wasm)를 그대로 쓴다 — 새 의존성 없음.
 * 글꼴은 Noto Sans KR Bold 서브셋(SIL OFL 1.1, apps/web/assets/og/) — 카드에 들어가는 글자만 담는다.
 * 카드 문구·GPU·모델 이름·가이드 제목이 바뀌어 새 글자가 생기면 scripts/og-cards.test.ts 가 잡고, `pnpm exec tsx scripts/og-font.ts` 로 다시 받는다.
 * 문구는 messages(`OgCard` 등) — 콤보 카드는 ICU 복수형(Confidence.measured)이 있어 i18n-lite 로 포맷한다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compareGpus,
  indexableCombos,
  parseBenchmarks,
  parseGpus,
  parseModelQuants,
  parseModels,
  parsePublish,
  parseQuantDefs,
  pickConfigCombo,
  summarizeGpu,
  summarizeModel,
  titleVerdict,
  type Gpu,
  type GpuHubData,
  type Model,
  type PublishPlan,
  type SeedCatalog,
} from '../packages/data/src/index';
import { COMPARES, publishedCompares, type CompareSlug } from '../apps/web/content/compares';
import { GUIDES, GUIDE_SLUGS, type GuideSlug } from '../apps/web/content/guides';
import { compareNames, speedFactorText, speedVerdict } from '../apps/web/lib/compare-phrases';
import { formatGB, formatSpeed, formatTokS } from '../apps/web/lib/format';
import { makeT, pickMessages, type MessageSpec, type TranslateWithHas } from '../apps/web/lib/i18n-lite';
import { comboOgImage, compareOgImage, guideOgImage, hubOgImage } from '../apps/web/lib/og-images';
import { confidenceText, gpuName, quantText, titleVerdictLabel, type Translate } from '../apps/web/lib/phrases';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OG_FONT_PATH = join(repoRoot, 'apps/web/assets/og/NotoSansKR-Bold-subset.ttf');
export const OG_FONT_CHARS_PATH = join(repoRoot, 'apps/web/assets/og/subset-chars.txt');

export const OG_LOCALES = ['en', 'ko'] as const;
export type OgLocale = (typeof OG_LOCALES)[number];
type Verdict = 'S' | 'A' | 'B' | 'F';
const VERDICTS: readonly Verdict[] = ['S', 'A', 'B', 'F'];

type Messages = {
  Verdict: Record<Verdict, string>;
  OgCard: { gpuSubtitle: string; modelSubtitle: string; unifiedMemory: string; vram: string; ram: string; active: string };
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

export function loadPublish(): PublishPlan {
  return parsePublish(readJson('data/publish.json'));
}

/** 공개 콤보 (gpuId, modelId) — 사이트맵(scripts/build-sitemaps.ts)과 같은 집합·순서 */
export function publishedCombos(plan: PublishPlan = loadPublish()): Array<{ gpuId: string; modelId: string }> {
  return [...indexableCombos(plan)].sort().map((key) => {
    const [gpuId, modelId] = key.split('/') as [string, string];
    return { gpuId, modelId };
  });
}

export const publishedGuides = (): GuideSlug[] => GUIDE_SLUGS.filter((slug) => GUIDES[slug].status === 'published');

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

const gpuLabel = (m: Messages, gpu: Gpu): string => m.GpuName?.[gpu.id] ?? gpu.name;

/** GPU 카드의 메모리 줄 — dGPU 는 VRAM, 통합은 고를 수 있는 메모리(최대), CPU 프로필은 RAM(최대) */
function gpuMemoryLine(m: Messages, gpu: Gpu): string {
  if (gpu.kind === 'dgpu') return fill(m.OgCard.vram, { mem: gpu.vramGB ?? 0 });
  const mem = Math.max(...(gpu.ramOptionsGB ?? [0]));
  return fill(gpu.kind === 'cpu' ? m.OgCard.ram : m.OgCard.unifiedMemory, { mem });
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

// --- 콤보·가이드 카드 (D96) --------------------------------------------------

/** 콤보·가이드 카드가 쓰는 메시지 — 페이지(제목·description)와 같은 키 */
const OG_MESSAGE_SPEC: MessageSpec = {
  namespaces: ['OgCard', 'Verdict', 'Confidence', 'GpuName'],
  keys: [
    'Combo.titleVerdictQuant',
    'Combo.titleVerdictRam',
    'Combo.metaSplitRam',
    'Hint.quantDesperate',
    // GPU 비교 카드 (10-19 D106) — 페이지와 같은 이름 규칙·제목
    'Compare.nameMemory',
    'Compare.cardTitle',
  ],
};

export type OgTranslators = {
  og: Translate;
  verdict: Translate;
  combo: Translate;
  confidence: Translate;
  hint: Translate;
  names: TranslateWithHas;
  compare: Translate;
};

export function ogTranslators(locale: OgLocale): OgTranslators {
  const dict = pickMessages(loadMessages(locale) as unknown as Record<string, unknown>, OG_MESSAGE_SPEC);
  const t = (ns: string) => makeT(dict, locale, ns);
  return {
    og: t('OgCard'),
    verdict: t('Verdict'),
    combo: t('Combo'),
    confidence: t('Confidence'),
    hint: t('Hint'),
    names: t('GpuName'),
    compare: t('Compare'),
  };
}

export type ComboCardText = {
  /** 모델 이름 */
  title: string;
  /** GPU · 이 구성의 메모리 */
  detail: string;
  /** 칩 색 */
  verdict: Verdict;
  /** 페이지 제목과 같은 판정 ("Runs well at Q3_K_M" · "RAM 64GB면 원활") */
  verdictText: string;
  /** 필요 메모리 — description 과 같은 양자화·수치 */
  need: string;
  /** 속도 — 수치와 신뢰 라벨은 늘 함께 (규칙 3). 메모리에 안 들어가면 없음 */
  speed?: { value: string; label: string };
};

/** 콤보 카드 문구 — 콤보 페이지(lib/combos.ts getCombo)와 같은 구성, description(lib/combo-phrases.ts comboDescription)과 같은 갈래 */
export function comboCardText(hub: GpuHubData, modelId: string, t: OgTranslators, locale: OgLocale): ComboCardText {
  const { gpu } = hub;
  const row = hub.rows.find((r) => r.model.id === modelId);
  if (!row) throw new Error(`og card: model ${modelId} is not on the ${gpu.id} hub`);
  const combo = pickConfigCombo(row.combos, gpu);
  const config = hub.configs[row.combos.indexOf(combo)]!;
  const tv = titleVerdict(combo);
  // 수치는 제목 판정이 가리키는 양자화 — 기준, 추천(기준이 불가), RAM 힌트 구성
  const q = tv.kind === 'ram' ? combo.ramHint!.q : combo.display;

  const memory =
    gpu.kind === 'dgpu'
      ? t.og('vram', { mem: gpu.vramGB ?? 0 })
      : t.og(gpu.kind === 'cpu' ? 'ram' : 'unifiedMemory', { mem: config.ramGB });
  const args = { quant: quantText(t.hint, q), need: formatGB(locale, q.memory.needGB) };
  // 그래픽카드보다 큰 필요량이면 시스템 RAM 을 함께 쓴다는 것만 밝힌다 (description 과 같은 규칙)
  const split = gpu.kind === 'dgpu' && (q.result.mode === 'partial-offload' || q.result.mode === 'cpu-moe');
  const need =
    q.fReason === 'no-fit'
      ? t.og('comboNoFit', args)
      : q.fReason === 'too-slow'
        ? t.og('comboTooSlow', args)
        : t.og('comboNeed', { ...args, split: split ? t.combo('metaSplitRam') : '' });

  let speed: ComboCardText['speed'];
  if (q.fReason !== 'no-fit') {
    if (q.result.confidence === 'measured') {
      speed = {
        value: t.og('speedMeasured', { est: formatTokS(locale, q.result.tgTokS.est) }),
        label: confidenceText(t.confidence, q.result, q.measured),
      };
    } else {
      const s = formatSpeed(locale, q.result);
      speed = { value: t.og('speedBand', { low: s.low, high: s.high }), label: confidenceText(t.confidence, q.result) };
    }
  }

  return {
    title: row.model.name,
    detail: t.og('comboGpu', { gpu: gpuName(t.names, gpu), memory }),
    verdict: tv.verdict,
    verdictText: titleVerdictLabel(t.verdict, t.combo, locale, tv),
    need,
    ...(speed ? { speed } : {}),
  };
}

export type GuideCardText = { kicker: string; title: string };

export function guideCardText(slug: GuideSlug, t: OgTranslators, locale: OgLocale): GuideCardText {
  return { kicker: t.og('guideKicker'), title: GUIDES[slug].locales[locale].title };
}

export type CompareCardText = {
  /** 페이지 브레드크럼·목차 카드와 같은 "{a} vs {b}" */
  title: string;
  subtitle: string;
  /** 두 기기의 이름과 판정 수 (GPU 허브 요약 구성 — 페이지 "판정 요약"과 같은 값) */
  sides: Array<{ name: string; counts: Record<Verdict, number> }>;
  labels: Record<Verdict, string>;
  /** 속도 배율 — 페이지 요약과 같은 규칙(추정 중앙값, 0.95–1.05 는 "거의 같다"). 두 기기 모두에 전부 올라가는 모델이 없으면 없음 */
  speed?: string;
};

/** GPU 비교 카드 문구 (10-19 D106) — 비교 페이지(lib/compares.ts getCompare)와 같은 `compareGpus`·같은 이름 규칙 */
export function compareCardText(slug: CompareSlug, hubA: GpuHubData, hubB: GpuHubData, t: OgTranslators, locale: OgLocale): CompareCardText {
  const entry = COMPARES[slug];
  if (hubA.gpu.id !== entry.a || hubB.gpu.id !== entry.b) throw new Error(`og card: compare ${slug} got ${hubA.gpu.id} / ${hubB.gpu.id}`);
  const cmp = compareGpus(hubA, hubB);
  const names = compareNames(t, locale, cmp);
  const counts = (side: typeof cmp.a) => ({ S: side.counts.S, A: side.counts.A, B: side.counts.B, F: side.counts.F });
  let speed: string | undefined;
  if (cmp.speed) {
    const v = speedVerdict(cmp.speed.ratio);
    speed =
      v.kind === 'same'
        ? t.og('compareSame')
        : t.og('compareFaster', { gpu: v.faster === 'a' ? names.a : names.b, ratio: speedFactorText(locale, v.factor) });
  }
  return {
    title: t.compare('cardTitle', names),
    subtitle: t.og('compareSubtitle'),
    sides: [
      { name: names.a, counts: counts(cmp.a) },
      { name: names.b, counts: counts(cmp.b) },
    ],
    labels: Object.fromEntries(VERDICTS.map((v) => [v, t.verdict(v)])) as Record<Verdict, string>,
    ...(speed ? { speed } : {}),
  };
}

/** 카드에 나올 수 있는 모든 글자 — 글꼴 서브셋의 기준 (og-font.ts·테스트 공용) */
export function ogCardChars(catalog: SeedCatalog = loadCatalog()): string {
  const parts: string[] = ['CanRun canrunllm.com 0123456789 ·—–×…'];
  for (let c = 0x20; c <= 0x7e; c += 1) parts.push(String.fromCharCode(c));
  for (const locale of OG_LOCALES) {
    const m = loadMessages(locale);
    parts.push(...Object.values(m.Verdict), ...Object.values(m.OgCard), ...Object.values(m.GpuName ?? {}));
    parts.push(...Object.values(pickMessages(m as unknown as Record<string, unknown>, OG_MESSAGE_SPEC)));
    // 초안까지 — 게시로 바꿀 때 글꼴을 다시 받지 않아도 되게
    for (const slug of GUIDE_SLUGS) parts.push(GUIDES[slug].locales[locale].title);
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

const chip = (v: Verdict, text: string, fontSize: string): Node =>
  h('div', { display: 'flex', padding: '10px 22px', borderRadius: '999px', backgroundColor: CHIP[v].bg, color: CHIP[v].fg, fontSize }, text);

/** 모든 카드의 틀 — 위 줄(CanRun · 주소) + 본문 블록들(세로로 벌려 놓는다) */
function frame(blocks: Node[]): Node {
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
      ...blocks,
    ],
  );
}

function cardElement(t: CardText): Node {
  return frame([
    h('div', { display: 'flex', flexDirection: 'column' }, [
      h('div', { fontSize: t.title.length > 26 ? '64px' : '80px', lineHeight: 1.1, letterSpacing: '-1px' }, t.title),
      h('div', { marginTop: '14px', fontSize: '32px', color: '#94a3b8' }, t.detail),
      h('div', { marginTop: '26px', fontSize: '40px', color: '#e2e8f0' }, t.subtitle),
    ]),
    h('div', { display: 'flex', gap: '16px' }, VERDICTS.map((v) => chip(v, `${t.labels[v]} ${t.counts[v]}`, '30px'))),
  ]);
}

function comboCardElement(c: ComboCardText): Node {
  return frame([
    h('div', { display: 'flex', flexDirection: 'column' }, [
      h('div', { fontSize: c.title.length > 22 ? '64px' : '80px', lineHeight: 1.1, letterSpacing: '-1px' }, c.title),
      h('div', { marginTop: '14px', fontSize: '32px', color: '#94a3b8' }, c.detail),
    ]),
    h('div', { display: 'flex', flexDirection: 'column', gap: '14px' }, [
      h('div', { display: 'flex' }, [chip(c.verdict, c.verdictText, '36px')]),
      h('div', { fontSize: '32px', lineHeight: 1.3, color: '#e2e8f0' }, c.need),
      ...(c.speed
        ? [
            h('div', { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: '18px' }, [
              h('span', { fontSize: '44px' }, c.speed.value),
              h('span', { fontSize: '30px', color: '#94a3b8' }, c.speed.label),
            ]),
          ]
        : []),
    ]),
  ]);
}

/** 제목 글자 크기 — 한글은 대략 1em, 나머지 0.58em 으로 폭을 어림해 3줄 안에 들어가는 가장 큰 크기 */
function guideTitleSize(title: string): number {
  const em = [...title].reduce((sum, ch) => sum + (/[가-힣]/.test(ch) ? 1 : 0.58), 0);
  return [72, 64, 56].find((px) => Math.ceil((em * px) / 1040) <= 3) ?? 48;
}

function guideCardElement(g: GuideCardText): Node {
  const size = guideTitleSize(g.title);
  return frame([
    h('div', { display: 'flex', flexDirection: 'column' }, [
      h('div', { display: 'flex' }, [
        h('div', { display: 'flex', padding: '8px 20px', borderRadius: '999px', backgroundColor: '#1e293b', color: '#cbd5e1', fontSize: '30px' }, g.kicker),
      ]),
      h('div', { marginTop: '28px', fontSize: `${size}px`, lineHeight: 1.2, letterSpacing: '-0.5px' }, g.title),
    ]),
  ]);
}

function compareCardElement(c: CompareCardText): Node {
  const size = c.title.length > 56 ? '44px' : c.title.length > 44 ? '50px' : c.title.length > 30 ? '60px' : '72px';
  return frame([
    h('div', { display: 'flex', flexDirection: 'column' }, [
      h('div', { fontSize: size, lineHeight: 1.1, letterSpacing: '-1px' }, c.title),
      h('div', { marginTop: '14px', fontSize: '32px', color: '#94a3b8' }, c.subtitle),
    ]),
    h('div', { display: 'flex', flexDirection: 'column', gap: '18px' }, [
      ...c.sides.map((side) =>
        h('div', { display: 'flex', flexDirection: 'column', gap: '8px' }, [
          h('div', { fontSize: '30px', color: '#e2e8f0' }, side.name),
          h('div', { display: 'flex', gap: '12px' }, VERDICTS.map((v) => chip(v, `${c.labels[v]} ${side.counts[v]}`, '24px'))),
        ]),
      ),
      ...(c.speed ? [h('div', { fontSize: '34px', color: '#f8fafc' }, c.speed)] : []),
    ]),
  ]);
}

type ImageResponseCtor = new (element: unknown, init: Record<string, unknown>) => Response;

async function loadRenderer(): Promise<ImageResponseCtor> {
  // Next 에 번들된 @vercel/og (node 판) — apps/web 기준으로 찾는다
  const req = createRequire(join(repoRoot, 'apps/web/package.json'));
  const entry = req.resolve('next/dist/compiled/@vercel/og/index.node.js');
  const mod = (await import(pathToFileURL(entry).href)) as { ImageResponse: ImageResponseCtor };
  return mod.ImageResponse;
}

export type OgRenderStats = { hubs: number; combos: number; guides: number; compares: number };

/**
 * out/ 아래에 카드를 쓴다 — 허브 `og/{gpu,model}/<id>-<locale>.png`, 공개 콤보 `og/combo/<model>/<gpu>-<locale>.png`,
 * 게시 가이드 `og/guide/<slug>-<locale>.png`, 게시 GPU 비교 `og/compare/<slug>-<locale>.png` (apps/web/lib/og-images.ts). 반환: 종류별 장 수
 */
export async function renderOgImages(
  outDir: string,
  catalog: SeedCatalog = loadCatalog(),
  plan: PublishPlan = loadPublish(),
): Promise<OgRenderStats> {
  const ImageResponse = await loadRenderer();
  const font = readFileSync(OG_FONT_PATH);
  const fonts = [{ name: 'Noto Sans KR', data: font, weight: 700, style: 'normal' }];
  const stats: OgRenderStats = { hubs: 0, combos: 0, guides: 0, compares: 0 };
  const write = async (sitePath: string, element: Node, kind: keyof OgRenderStats) => {
    const res = new ImageResponse(element, { width: 1200, height: 630, fonts });
    const png = Buffer.from(await res.arrayBuffer());
    const file = join(outDir, sitePath.slice(1));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png);
    stats[kind] += 1;
  };
  const combos = publishedCombos(plan);
  const gpuHubs = new Map<string, GpuHubData>();
  const gpuHub = (gpuId: string): GpuHubData => {
    let hub = gpuHubs.get(gpuId);
    if (!hub) {
      const gpu = catalog.gpus.find((g) => g.id === gpuId);
      if (!gpu) throw new Error(`og card: published combo names unknown GPU ${gpuId}`);
      hub = summarizeGpu(catalog, gpu);
      gpuHubs.set(gpuId, hub);
    }
    return hub;
  };
  for (const locale of OG_LOCALES) {
    const m = loadMessages(locale);
    for (const gpu of catalog.gpus) await write(hubOgImage('gpu', gpu.id, locale), cardElement(gpuCardText(catalog, gpu, m)), 'hubs');
    for (const model of catalog.models) await write(hubOgImage('model', model.id, locale), cardElement(modelCardText(catalog, model, m)), 'hubs');
    const t = ogTranslators(locale);
    for (const { gpuId, modelId } of combos) {
      await write(comboOgImage(modelId, gpuId, locale), comboCardElement(comboCardText(gpuHub(gpuId), modelId, t, locale)), 'combos');
    }
    for (const slug of publishedGuides()) await write(guideOgImage(slug, locale), guideCardElement(guideCardText(slug, t, locale)), 'guides');
    for (const slug of publishedCompares()) {
      const { a, b } = COMPARES[slug];
      await write(compareOgImage(slug, locale), compareCardElement(compareCardText(slug, gpuHub(a), gpuHub(b), t, locale)), 'compares');
    }
  }
  return stats;
}
