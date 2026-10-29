import { configKey, isFp16Crippled, type ComboAssessment, type ComboPick, type Gpu, type GpuHubData, type HwConfig } from '@canrun/data';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Pill } from '@/components/badges';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { CalcWidget } from '@/components/calc-widget';
import { Faq } from '@/components/faq';
import { HubIntro } from '@/components/hub-intro';
import {
  BenchTable,
  ComboCells,
  ComboHeaderCells,
  ScrollTable,
  TABLE_CLASS,
} from '@/components/hub-table';
import { OneUnitChip } from '@/components/one-unit';
import { PageShell } from '@/components/page-shell';
import { VerdictBadge, VerdictLegend } from '@/components/verdict';
import { isContentLocale, ogImageLocale } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';
import { catalog } from '@/lib/catalog';
import { formatGB, formatInt } from '@/lib/format';
import { formatPrice, krwNote } from '@/lib/price';
import { loadHubIntro } from '@/lib/hub-intros';
import { compareNames, type CompareTranslators } from '@/lib/compare-phrases';
import { compareLinksForGpu, getCompare } from '@/lib/compares';
import { gpuHubGuides } from '@/lib/gpu-hub-guides';
import { guideEntry } from '@/lib/guides';
import { getGpuHub } from '@/lib/hubs';
import type { QA } from '@/lib/jsonld';
import { msrpConfigRamGB } from '@/lib/krw';
import { comboHref, compareHref, comparesHref, gpuHref, gpusHref, guideHref, localeHref, modelHref } from '@/lib/links';
import { hubOgImage } from '@/lib/og-images';
import { isComboIndexable } from '@/lib/publish';
import { gpuName, modeKey, quantText, speedPhrase, type Translate } from '@/lib/phrases';
import { gpuAliasLabels, gpuSearchName, macLineList, macLineMemory, macLines } from '@/lib/search-names';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale; slug: string }> };

/** docs/04 §2 `/gpu/{slug}` — 카탈로그 전 GPU (결정 D1: 허브 전체 생성·index) */
export function generateStaticParams() {
  return catalog.gpus.map((gpu) => ({ slug: gpu.id }));
}

export const dynamicParams = false;

type Tr = Translate & { has?: (key: string) => boolean };

async function translators(locale: Locale) {
  const [hub, faq, common, confidence, verdict, mode, names, hint, mac] = await Promise.all([
    getTranslations({ locale, namespace: 'GpuHub' }),
    getTranslations({ locale, namespace: 'Faq' }),
    getTranslations({ locale, namespace: 'Common' }),
    getTranslations({ locale, namespace: 'Confidence' }),
    getTranslations({ locale, namespace: 'Verdict' }),
    getTranslations({ locale, namespace: 'Mode' }),
    getTranslations({ locale, namespace: 'GpuName' }),
    getTranslations({ locale, namespace: 'Hint' }),
    getTranslations({ locale, namespace: 'MacProduct' }),
  ]);
  return { hub, faq, common, confidence, verdict, mode, names, hint, mac } as unknown as Record<
    'hub' | 'faq' | 'common' | 'confidence' | 'verdict' | 'mode' | 'names' | 'hint' | 'mac',
    Tr
  >;
}

/** 제목·설명에 들어가는 메모리 표기 ("8 GB" / "36–128 GB unified" / "16–96 GB RAM") */
function memoryLabel(t: Translate, gpu: Gpu, locale: string): string {
  if (gpu.kind === 'dgpu') return t('memoryVram', { vram: formatInt(locale, gpu.vramGB ?? 0) });
  const opts = gpu.ramOptionsGB ?? [];
  const min = formatInt(locale, opts[0] ?? 0);
  const max = formatInt(locale, opts.at(-1) ?? 0);
  if (gpu.kind === 'cpu') return t('memoryRam', { min, max });
  return opts.length > 1 ? t('memoryUnified', { min, max }) : t('memoryUnifiedOne', { max });
}

/**
 * 요약 수치가 가리키는 구성의 메모리 표기 — 통합·CPU 는 정렬 기준 구성(최대 RAM) 하나.
 * 수치(카운트·가장 큰 모델)를 RAM 범위 전체에 대한 것처럼 쓰지 않는다 (P1-1 리뷰).
 */
function primaryMemoryLabel(t: Translate, hub: GpuHubData, locale: string): string {
  const { gpu } = hub;
  if (gpu.kind === 'dgpu') return memoryLabel(t, gpu, locale);
  const max = formatInt(locale, hub.configs[hub.primaryIndex]!.ramGB);
  return gpu.kind === 'cpu' ? t('memoryRamOne', { max }) : t('memoryUnifiedOne', { max });
}

/** 통합·CPU 는 정렬 기준 구성(최대 RAM)을 문장에 명시 */
function configSuffix(t: Translate, hub: GpuHubData, locale: string): string {
  if (hub.gpu.kind === 'dgpu') return '';
  return t('summaryConfig', { ram: formatInt(locale, hub.configs[hub.primaryIndex]!.ramGB) });
}

/** 구성 라벨 — 1대는 "128 GB", 여러 대 연결(10-23 D118 — DGX Spark)은 "128 GB × 2" */
function configLabel(t: Translate, cfg: Pick<HwConfig, 'ramGB' | 'nodes'>, locale: string): string {
  const ram = formatInt(locale, cfg.ramGB);
  return cfg.nodes !== undefined && cfg.nodes > 1 ? t('clusterOption', { ram, nodes: cfg.nodes }) : t('ramOption', { ram });
}

function primaryCombos(hub: GpuHubData): ComboAssessment[] {
  return hub.rows.map((row) => row.combos[hub.primaryIndex]!);
}

/**
 * "가장 큰 모델"의 단일 정의 (10-16 D95) — description 과 FAQ Q1 이 같은 값을 쓴다: 그래픽카드·통합 메모리는 GPU 에
 * 전부 올라가는 가장 큰 모델(`faq.largestFullGpu`), CPU 프로필은 돌아가는 가장 큰 모델(`faq.largestRunnable`).
 * 예전 description 은 따로 "원활 이상 가장 큰 모델"을 골라(동률은 속도 순) FAQ 와 다른 모델을 말했다(RTX 5090: Qwen3.6 vs 3.5 35B-A3B)
 */
function largestPick(hub: GpuHubData): ComboPick | undefined {
  return hub.gpu.kind === 'cpu' ? hub.faq.largestRunnable : hub.faq.largestFullGpu;
}

const modelName = (id: string) => catalog.models.find((m) => m.id === id)?.name ?? id;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const hub = getGpuHub(slug);
  if (!hub) return {};
  const t = await translators(locale);
  // 제목·설명의 이름 — 한국어는 그래픽카드(dGPU)면 "… 그래픽카드" (10-16 D94), Apple 칩은 제목에 맥 계열 "Apple M4(맥 미니·…)" (D97),
  // 그 밖의 통합 메모리·CPU 는 이름 그대로
  const display = gpuName(t.names, hub.gpu);
  const name = hub.gpu.kind === 'dgpu' ? t.hub('metaCard', { gpu: display }) : gpuSearchName(t.mac, display, hub.gpu);
  const memory = memoryLabel(t.hub, hub.gpu, locale);
  const primaryMemory = primaryMemoryLabel(t.hub, hub, locale);
  const counts = hub.counts[hub.primaryIndex]!;
  const good = counts.S + counts.A;
  // Apple 칩 설명은 요약 구성(최대 메모리)으로 파는 맥만 — M4 Pro 64GB 는 맥 미니뿐이다(맥북 프로는 48GB 까지)
  const macs = macLines(hub.gpu, hub.configs[hub.primaryIndex]!.ramGB);
  const values = { memory: primaryMemory, good, total: hub.rows.length };
  const summary =
    macs.length > 0
      ? t.hub(good > 0 ? 'metaDescriptionMac' : 'metaDescriptionMacNone', {
          ...values,
          gpu: display,
          products: macLineList(t.mac, macs),
        })
      : t.hub(good > 0 ? 'metaDescription' : 'metaDescriptionNone', { ...values, gpu: name });
  // 가장 큰 모델 — FAQ Q1 과 같은 모델·양자화·속도 (가장 빠른 모델은 늘 가장 작은 모델이라 정보가 없다)
  const pick = largestPick(hub);
  const largest = pick
    ? t.hub(hub.gpu.kind === 'cpu' ? 'metaLargestCpu' : 'metaLargest', {
        memory: primaryMemory,
        model: modelName(pick.combo.modelId),
        quant: pick.q.quant,
        speed: speedPhrase(t.common, t.confidence, locale, pick.q),
      })
    : '';

  return buildPageMetadata({
    href: gpuHref(hub.gpu.id),
    locale,
    // zh 는 en 카드(D109 — 카드는 검색 노출 로캘만 그린다)
    ogImage: hubOgImage('gpu', hub.gpu.id, ogImageLocale(locale)),
    // 제목은 검색어 꼴 "{gpu} llm"·"{gpu} vram"에 맞춰 GPU 이름 바로 뒤에 LLM, 그래픽카드는 "VRAM 24GB" (10-29 GSC 검색어, D128)
    title: t.hub('metaTitle', {
      gpu: hub.gpu.kind === 'dgpu' ? display : name,
      memory: hub.gpu.kind === 'dgpu' ? t.hub('memoryVramTitle', { vram: formatInt(locale, hub.gpu.vramGB ?? 0) }) : memory,
    }),
    description: summary + largest,
  });
}

function buildFaq(
  t: Awaited<ReturnType<typeof translators>>,
  hub: GpuHubData,
  locale: Locale,
  name: string,
): QA[] {
  const primaryRam = hub.configs[hub.primaryIndex]!.ramGB;
  const memory = primaryMemoryLabel(t.hub, hub, locale);
  const items: QA[] = [];

  // Q1 — 전부 올라가는 가장 큰 모델 (CPU 프로필은 돌아가는 가장 큰 모델) — description 과 같은 `largestPick`.
  // 기준 또는 비-desperate 추천 quant 중 조건을 만족하는 것 (assess.ts pickQuant)
  const pick = largestPick(hub);
  if (hub.gpu.kind === 'cpu') {
    items.push({
      question: t.faq('cpuLargestQ'),
      answer: pick
        ? t.faq('cpuLargestA', {
            model: modelName(pick.combo.modelId),
            quant: pick.q.quant,
            size: formatGB(locale, pick.q.fileGB, 2),
            ram: formatInt(locale, primaryRam),
            speed: speedPhrase(t.common, t.confidence, locale, pick.q),
          })
        : t.faq('cpuLargestNone', { total: hub.rows.length }),
    });
  } else {
    items.push({
      question: t.faq('gpuLargestQ', { gpu: name }),
      answer: pick
        ? t.faq('gpuLargestA', {
            model: modelName(pick.combo.modelId),
            quant: pick.q.quant,
            size: formatGB(locale, pick.q.fileGB, 2),
            memory,
            speed: speedPhrase(t.common, t.confidence, locale, pick.q),
          })
        : t.faq('gpuLargestNone', { total: hub.rows.length, memory }),
    });
  }

  // Q2 — 등급 분포
  const counts = hub.counts[hub.primaryIndex]!;
  items.push({
    question: t.faq('gpuCountQ', { gpu: name }),
    answer: t.faq('gpuCountA', {
      config: configSuffix(t.hub, hub, locale),
      s: counts.S,
      a: counts.A,
      b: counts.B,
      f: counts.F,
      total: hub.rows.length,
    }),
  });

  // Q3 — 70B급 대표 모델
  const ref = hub.faq.referenceLarge;
  if (ref) {
    const refName = modelName(ref.modelId);
    const runnable =
      ref.baseline.result.verdict !== 'F'
        ? ref.baseline
        : ref.recommended && ref.recommended.result.verdict !== 'F'
          ? ref.recommended
          : undefined;
    let answer: string;
    if (runnable) {
      answer = t.faq('gpuLargeFit', {
        verdict: t.verdict(runnable.result.verdict),
        mode: t.mode(modeKey(runnable.result.mode, hub.gpu.kind)),
        quant: quantText(t.hint, runnable),
        speed: speedPhrase(t.common, t.confidence, locale, runnable),
      });
    } else if (ref.baseline.fReason === 'too-slow') {
      answer = t.faq('gpuLargeTooSlow', {
        speed: speedPhrase(t.common, t.confidence, locale, ref.baseline),
      });
    } else {
      answer = t.faq('gpuLargeNoFit', {
        model: refName,
        quant: ref.baseline.quant,
        need: formatGB(locale, ref.baseline.memory.needGB),
        gpuUsable: formatGB(locale, ref.baseline.memory.gpuUsableGB),
        ramUsable: formatGB(locale, ref.baseline.memory.ramUsableGB),
      });
    }
    if (ref.ramHint) {
      answer += t.faq('gpuLargeHint', {
        ram: formatInt(locale, ref.ramHint.ramGB),
        verdict: t.verdict(ref.ramHint.verdict),
        mode: t.mode(modeKey(ref.ramHint.mode, hub.gpu.kind)),
      });
    }
    items.push({ question: t.faq('gpuLargeQ', { gpu: name, model: refName }), answer });
  }
  return items;
}

export default async function GpuHubPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const hub = getGpuHub(slug);
  if (!hub) notFound();

  const t = await translators(locale);
  const tSpec = t.hub;
  const tTable = await getTranslations({ locale, namespace: 'Table' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const tGuides = await getTranslations({ locale, namespace: 'Guides' });
  const tCompare = await getTranslations({ locale, namespace: 'Compare' });
  const tWidget = await getTranslations({ locale, namespace: 'CalcWidget' });
  const { gpu } = hub;
  const name = gpuName(t.names, gpu);
  const href = gpuHref(gpu.id);
  // 관련 가이드 2~3편 — 하드웨어 종류별, published 만 (10-16 D95, D40). 가이드는 장문 로캘에만 있어 zh 는 링크하지 않는다(D109)
  const guideLocale = isContentLocale(locale) ? locale : undefined;
  const guides = guideLocale ? gpuHubGuides(gpu) : [];
  // 이 GPU 가 든 게시 비교 쌍 (10-19 D106) — 초안은 링크하지 않는다(D40 과 같은 규칙), 없으면 블록을 그리지 않는다
  const compareNamesT = { compare: tCompare, names: t.names } as unknown as Pick<CompareTranslators, 'compare' | 'names'>;
  const compares = compareLinksForGpu(gpu.id).map(({ slug }) => ({
    slug,
    text: tCompare('cardTitle', compareNames(compareNamesT, locale, getCompare(slug)!.cmp)),
  }));
  const primary = primaryCombos(hub);
  const multiConfig = hub.configs.length > 1;
  // 요약 목록·"메모리 구성별 판정" 표 — 1대 구성 뒤에 2대·4대 연결 구성(10-23 D118 — 있는 기기만). 정렬·대표 판정·FAQ 는 1대 구성 그대로
  const clusterConfigs = hub.clusterConfigs ?? [];
  const summaryConfigs = [...hub.configs, ...clusterConfigs];
  // 여러 대 행의 판정 수는 연결이 필요한 모델만 세고, 같은 메모리 1대로 충분한 모델은 `oneUnit` 에 따로 센다(10-23 D121)
  const summaryCounts: Array<GpuHubData['counts'][number] & { oneUnit?: number }> = [...hub.counts, ...(hub.clusterCounts ?? [])];
  const config = configSuffix(t.hub, hub, locale);
  const faq = buildFaq(t, hub, locale, name);
  const hasPartial = primary.some(
    (c) => c.display.fReason !== 'no-fit' && c.display.result.mode === 'partial-offload',
  );
  const korean = hub.rows.filter((row) => row.model.korean);
  // 손으로 쓴 소개글(10-14 D74) — 레지스트리(content/hubs.ts)에 있는 허브만
  const Intro = await loadHubIntro('gpu', gpu.id, locale);

  const assumption =
    gpu.kind === 'dgpu'
      ? tSpec('assumeDgpu', { ram: formatInt(locale, hub.configs[0]!.ramGB) })
      : gpu.kind === 'unified'
        ? tSpec('assumeUnified')
        : tSpec('assumeCpu');

  // 다른 표기(10-16 D94) — 별칭이 있을 때만, 사양 목록에 한 줄
  const aliases = gpuAliasLabels(gpu);
  // 이 칩이 들어간 맥과 메모리 구성(10-16 D97, 애플 사양 페이지) — Apple 칩만
  const macMemory = macLineMemory(gpu);

  // 통합 메모리 PC 의 출시가는 가장 큰 구성의 값 — 어느 구성인지 적는다(/gpus·비교와 같은 규칙, 10-23 D117 리뷰 — DGX Spark 64GB 는 OEM 판이라 출시가가 다르다)
  const msrpRam = msrpConfigRamGB(gpu);
  const price =
    gpu.streetUSD !== undefined && gpu.priceAsOf
      ? tSpec('priceStreet', { price: formatPrice(t.common, locale, gpu.streetUSD), date: gpu.priceAsOf })
      : gpu.msrpUSD === undefined
        ? undefined
        : msrpRam !== undefined
          ? tSpec('priceMsrpConfig', { price: formatPrice(t.common, locale, gpu.msrpUSD), ram: formatInt(locale, msrpRam) })
          : tSpec('priceMsrp', { price: formatPrice(t.common, locale, gpu.msrpUSD) });

  return (
    <PageShell locale={locale} href={href}>
      <article className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <Breadcrumbs
            crumbs={[
              {
                name: tBreadcrumb('home'),
                href: localeHref(locale, '/'),
                url: absoluteUrl(localeHref(locale, '/')),
              },
              // 홈 › GPU 목록 › 허브 (10-19 — 목록 페이지가 생겨 가운데 단계에 URL 이 있다)
              { name: tBreadcrumb('gpus'), href: localeHref(locale, gpusHref()), url: absoluteUrl(localeHref(locale, gpusHref())) },
              { name, href: localeHref(locale, href), url: absoluteUrl(localeHref(locale, href)) },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {tSpec('h1', { gpu: gpuSearchName(t.mac, name, gpu) })}
          </h1>
          <div className="flex flex-wrap gap-2">
            {gpu.form === 'laptop' && <Pill tone="caution">{tSpec('badgeLaptop')}</Pill>}
            {/* 기기 근거 사용 가능량이 있는 통합 메모리 기기(10-23 D117 — DGX Spark)는 70% 문구 대신 */}
            {gpu.kind === 'unified' && <Pill tone="info">{tSpec(gpu.usableGBByRam ? 'badgeUnifiedDevice' : 'badgeUnified')}</Pill>}
            {gpu.kind === 'cpu' && <Pill tone="info">{tSpec('badgeCpu')}</Pill>}
            {isFp16Crippled(gpu) && <Pill tone="caution">{tSpec('badgeFp16')}</Pill>}
          </div>
          <p className="text-muted-foreground">{assumption}</p>
        </header>

        {/* 계산기 위젯 (10-19 D107) — 이 GPU 를 미리 고른 채. 허브의 가정 구성(통합·CPU = 가장 큰 메모리)이 계산기 기본값과 같다 */}
        <CalcWidget
          locale={locale}
          idPrefix="gpu-calc"
          heading={tWidget('title')}
          prefill={{ gpuId: gpu.id, note: tWidget('note'), links: [] }}
        />

        {Intro && <HubIntro Body={Intro} title={tSpec('introTitle', { gpu: name })} />}

        <section aria-labelledby="specs-heading" className="flex flex-col gap-3">
          <h2 id="specs-heading" className="text-xl font-semibold tracking-tight">
            {tSpec('specsTitle')}
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {gpu.kind === 'dgpu' ? (
              <div>
                <dt className="text-muted-foreground">{tSpec('specVram')}</dt>
                <dd className="font-medium">
                  {tSpec('memoryVram', { vram: formatInt(locale, gpu.vramGB ?? 0) })}
                </dd>
              </div>
            ) : (
              <div>
                <dt className="text-muted-foreground">{tSpec('specMemory')}</dt>
                <dd className="font-medium">
                  {(gpu.ramOptionsGB ?? [])
                    .map((ram) => tSpec('ramOption', { ram: formatInt(locale, ram) }))
                    .join(' · ')}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">{tSpec('specBandwidth')}</dt>
              <dd className="font-medium">
                {tSpec('specBandwidthValue', {
                  // 구성마다 대역폭이 다른 칩(10-20 Apple M6)은 가장 낮은 값–가장 높은 값
                  value: gpu.memBandwidthByRam
                    ? t.common('range', {
                        low: formatGB(locale, Math.min(...gpu.memBandwidthByRam.map((b) => b.memBandwidthGBs))),
                        high: formatGB(locale, gpu.memBandwidthGBs),
                      })
                    : formatGB(locale, gpu.memBandwidthGBs),
                })}
              </dd>
            </div>
            {gpu.fp16Tflops !== undefined && (
              <div>
                <dt className="text-muted-foreground">{tSpec('specFp16')}</dt>
                <dd className="font-medium">
                  {tSpec('specFp16Value', { value: formatGB(locale, gpu.fp16Tflops) })}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">{tSpec('specLaunch')}</dt>
              <dd className="font-medium">{gpu.launchYear}</dd>
            </div>
            {price && (
              <div>
                <dt className="text-muted-foreground">{tSpec('specPrice')}</dt>
                <dd className="font-medium">{price}</dd>
              </div>
            )}
            {macMemory.length > 0 && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-muted-foreground">{tSpec('specProducts')}</dt>
                <dd>
                  <ul className="flex flex-col gap-1">
                    {macMemory.map(({ line, memoryGB }) => (
                      <li key={line}>
                        {tSpec('productMemory', {
                          product: t.mac(line),
                          memory: memoryGB.map((ram) => tSpec('ramOption', { ram: formatInt(locale, ram) })).join(' · '),
                        })}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {aliases.length > 0 && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-muted-foreground">{tSpec('specAliases')}</dt>
                <dd>{aliases.join(', ')}</dd>
              </div>
            )}
          </dl>
          {price && krwNote(t.common, locale) && (
            <p className="text-xs text-muted-foreground">{krwNote(t.common, locale)}</p>
          )}
        </section>

        <section aria-labelledby="summary-heading" className="flex flex-col gap-3">
          <h2 id="summary-heading" className="text-xl font-semibold tracking-tight">
            {tSpec('summaryTitle')}
          </h2>
          {/* 여러 구성이면 행마다 RAM 라벨이 있으므로 캡션에 구성을 넣지 않는다 */}
          <p className="text-sm text-muted-foreground">
            {tSpec('summaryCaption', { config: multiConfig ? '' : config })}
          </p>
          <ul className="flex flex-col gap-2">
            {summaryConfigs.map((cfg, index) => {
              const counts = summaryCounts[index]!;
              return (
                <li key={configKey(cfg)} data-config={configKey(cfg)} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {multiConfig && (
                    <span className={`${clusterConfigs.length > 0 ? 'w-28' : 'w-16'} font-medium tabular-nums`}>{configLabel(tSpec, cfg, locale)}</span>
                  )}
                  {(['S', 'A', 'B', 'F'] as const).map((v) => (
                    <span key={v} className="flex items-center gap-1.5 text-sm">
                      <VerdictBadge verdict={v} />
                      <span className="tabular-nums">{tSpec('countLabel', { count: counts[v] })}</span>
                    </span>
                  ))}
                  {counts.otherQuant > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {tSpec('summaryOther', { count: counts.otherQuant })}
                    </span>
                  )}
                  {counts.oneUnit !== undefined && (
                    <span data-one-unit-count={counts.oneUnit} className="flex items-center gap-1.5 text-sm">
                      <OneUnitChip />
                      <span className="tabular-nums">{tSpec('countLabel', { count: counts.oneUnit })}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {clusterConfigs.length > 0 && (
            <p data-cluster-note className="text-sm text-muted-foreground">
              {/* 판정 수 안내는 요약 목록이 있는 허브에만 — 콤보·가이드 그리드의 같은 안내 문장에는 판정 수가 없다(10-23 D121 리뷰) */}
              {tSpec('clusterNote')} <span data-cluster-count-note>{tSpec('clusterCountNote')}</span>
            </p>
          )}
          <VerdictLegend className="mt-2" />
        </section>

        {locale === 'ko' && korean.length > 0 && (
          <section aria-labelledby="korean-heading" className="flex flex-col gap-3">
            <h2 id="korean-heading" className="text-xl font-semibold tracking-tight">
              {tSpec('koreanTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{tSpec('koreanIntro')}</p>
            <ul className="flex flex-wrap gap-2">
              {korean.map((row) => (
                <li
                  key={row.model.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm"
                >
                  <a href={localeHref(locale, modelHref(row.model.id))}>{row.model.name}</a>
                  <VerdictBadge verdict={row.combos[hub.primaryIndex]!.baseline.result.verdict} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="models-heading" className="flex flex-col gap-3">
          <h2 id="models-heading" className="text-xl font-semibold tracking-tight">
            {tSpec('tableTitle', { gpu: name })}
          </h2>
          {hasPartial && (
            <p className="rounded-lg border border-verdict-b-fg/40 bg-verdict-b-bg p-3 text-sm text-verdict-b-fg">
              {tSpec('partialWarning')}
            </p>
          )}
          <p className="text-xs text-muted-foreground sm:hidden">{tTable('scrollHint')}</p>
          <ScrollTable label={tSpec('tableTitle', { gpu: name })}>
            <table className={TABLE_CLASS}>
              <caption>{tSpec('tableCaption', { total: hub.rows.length, config })}</caption>
              <thead>
                <tr>
                  <th scope="col">{tTable('model')}</th>
                  <ComboHeaderCells />
                </tr>
              </thead>
              <tbody>
                {hub.rows.map((row) => (
                  <tr key={row.model.id}>
                    <th scope="row">
                      <a href={localeHref(locale, modelHref(row.model.id))}>{row.model.name}</a>
                    </th>
                    <ComboCells
                      combo={row.combos[hub.primaryIndex]!}
                      gpu={gpu}
                      showReasoning
                      comboLink={
                        isComboIndexable(gpu.id, row.model.id)
                          ? {
                              href: localeHref(locale, comboHref(row.model.id, gpu.id)),
                              text: tTable('comboLink', { model: row.model.name, gpu: name }),
                            }
                          : undefined
                      }
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
          <p className="text-xs text-muted-foreground">{t.common('reasoningNote')}</p>
        </section>

        {multiConfig && (
          <section aria-labelledby="matrix-heading" className="flex flex-col gap-3">
            <h2 id="matrix-heading" className="text-xl font-semibold tracking-tight">
              {tSpec('matrixTitle')}
            </h2>
            <ScrollTable label={tSpec('matrixTitle')}>
              <table className={TABLE_CLASS}>
                <caption>{tSpec('matrixCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{tTable('model')}</th>
                    {summaryConfigs.map((cfg) => (
                      <th key={configKey(cfg)} scope="col" className="tabular-nums">
                        {configLabel(tSpec, cfg, locale)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hub.rows.map((row) => (
                    <tr key={row.model.id}>
                      <th scope="row">{row.model.name}</th>
                      {row.combos.map((combo) => (
                        <td key={configKey(combo)}>
                          <VerdictBadge verdict={combo.baseline.result.verdict} compact />
                        </td>
                      ))}
                      {/* 여러 대 연결 칸(10-23 D121): 같은 메모리 1대에 이미 들어가는 모델은 판정 대신 '1대로 충분' */}
                      {(row.clusterCombos ?? []).map((combo, i) => (
                        <td key={configKey(combo)}>
                          {row.clusterOneUnit?.[i] ? <OneUnitChip /> : <VerdictBadge verdict={combo.baseline.result.verdict} compact />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          </section>
        )}

        <section aria-labelledby="bench-heading" className="flex flex-col gap-3">
          <h2 id="bench-heading" className="text-xl font-semibold tracking-tight">
            {tSpec('benchTitle', { gpu: name })}
          </h2>
          {hub.benchmarks.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">{tTable('benchIntro')}</p>
              <BenchTable
                points={hub.benchmarks}
                firstColumn="model"
                models={catalog.models}
                gpus={catalog.gpus}
                gpuLabel={(g) => gpuName(t.names, g)}
                caption={tSpec('benchTitle', { gpu: name })}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{tSpec('benchEmpty')}</p>
          )}
        </section>

        <Faq items={faq} />

        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          {t.common('estimateNotice')}
        </p>

        {guideLocale && guides.length > 0 && (
          <section aria-labelledby="guides-heading" className="flex flex-col gap-3">
            <h2 id="guides-heading" className="text-xl font-semibold tracking-tight">
              {tGuides('relatedTitle')}
            </h2>
            <ul className="flex flex-col gap-2">
              {guides.map((slug) => (
                <li key={slug}>
                  <a href={localeHref(guideLocale, guideHref(slug))}>{guideEntry(slug).locales[guideLocale].title}</a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {compares.length > 0 && (
          <section aria-labelledby="compare-heading" data-compare-links className="flex flex-col gap-3">
            <h2 id="compare-heading" className="text-xl font-semibold tracking-tight">
              {tCompare('hubTitle', { gpu: name })}
            </h2>
            <ul className="flex flex-col gap-2">
              {compares.map(({ slug, text }) => (
                <li key={slug}>
                  <a href={localeHref(locale, compareHref(slug))} data-compare-link>
                    {text}
                  </a>
                </li>
              ))}
              <li>
                <a href={localeHref(locale, comparesHref())}>{tCompare('allLink')}</a>
              </li>
            </ul>
          </section>
        )}
      </article>
    </PageShell>
  );
}
