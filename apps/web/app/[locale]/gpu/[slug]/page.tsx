import { isFp16Crippled, type ComboAssessment, type Gpu, type GpuHubData } from '@canrun/data';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Pill } from '@/components/badges';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Faq } from '@/components/faq';
import { HubIntro } from '@/components/hub-intro';
import {
  BenchTable,
  ComboCells,
  ComboHeaderCells,
  ScrollTable,
  TABLE_CLASS,
} from '@/components/hub-table';
import { PageShell } from '@/components/page-shell';
import { VerdictBadge, VerdictLegend } from '@/components/verdict';
import type { Locale } from '@/i18n/routing';
import { catalog } from '@/lib/catalog';
import { formatGB, formatInt } from '@/lib/format';
import { formatPrice, krwNote } from '@/lib/price';
import { loadHubIntro } from '@/lib/hub-intros';
import { getGpuHub } from '@/lib/hubs';
import type { QA } from '@/lib/jsonld';
import { comboHref, gpuHref, localeHref, modelHref } from '@/lib/links';
import { isComboIndexable } from '@/lib/publish';
import { gpuName, modeKey, quantText, speedPhrase, type Translate } from '@/lib/phrases';
import { gpuAliasLabels } from '@/lib/search-names';
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
  const [hub, faq, common, confidence, verdict, mode, names, hint] = await Promise.all([
    getTranslations({ locale, namespace: 'GpuHub' }),
    getTranslations({ locale, namespace: 'Faq' }),
    getTranslations({ locale, namespace: 'Common' }),
    getTranslations({ locale, namespace: 'Confidence' }),
    getTranslations({ locale, namespace: 'Verdict' }),
    getTranslations({ locale, namespace: 'Mode' }),
    getTranslations({ locale, namespace: 'GpuName' }),
    getTranslations({ locale, namespace: 'Hint' }),
  ]);
  return { hub, faq, common, confidence, verdict, mode, names, hint } as unknown as Record<
    'hub' | 'faq' | 'common' | 'confidence' | 'verdict' | 'mode' | 'names' | 'hint',
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

function primaryCombos(hub: GpuHubData): ComboAssessment[] {
  return hub.rows.map((row) => row.combos[hub.primaryIndex]!);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const hub = getGpuHub(slug);
  if (!hub) return {};
  const t = await translators(locale);
  // 제목·설명의 이름 — 한국어는 그래픽카드(dGPU)면 "… 그래픽카드" (10-16 D94 — 맥·통합 메모리·CPU 는 이름 그대로)
  const display = gpuName(t.names, hub.gpu);
  const name = hub.gpu.kind === 'dgpu' ? t.hub('metaCard', { gpu: display }) : display;
  const memory = memoryLabel(t.hub, hub.gpu, locale);
  const primaryMemory = primaryMemoryLabel(t.hub, hub, locale);
  const counts = hub.counts[hub.primaryIndex]!;
  const good = counts.S + counts.A;
  // "원활 이상으로 도는 가장 큰 모델" — 가장 빠른 모델은 늘 가장 작은 모델이라 정보가 없다
  const paramsOf = (id: string) => catalog.models.find((m) => m.id === id)?.paramsB ?? 0;
  const biggest = primaryCombos(hub)
    .filter((c) => c.baseline.result.verdict === 'S' || c.baseline.result.verdict === 'A')
    .sort(
      (a, b) =>
        paramsOf(b.modelId) - paramsOf(a.modelId) ||
        b.baseline.result.tgTokS.est - a.baseline.result.tgTokS.est,
    )[0];
  const biggestModel = biggest && catalog.models.find((m) => m.id === biggest.modelId);

  return buildPageMetadata({
    href: gpuHref(hub.gpu.id),
    locale,
    ogImage: `/og/gpu/${hub.gpu.id}-${locale}.png`,
    title: t.hub('metaTitle', { gpu: name, memory }),
    description:
      biggest && biggestModel
        ? t.hub('metaDescription', {
            gpu: name,
            memory: primaryMemory,
            good,
            total: hub.rows.length,
            model: biggestModel.name,
            speed: speedPhrase(t.common, t.confidence, locale, biggest.baseline),
          })
        : t.hub('metaDescriptionNone', {
            gpu: name,
            memory: primaryMemory,
            total: hub.rows.length,
          }),
  });
}

function buildFaq(
  t: Awaited<ReturnType<typeof translators>>,
  hub: GpuHubData,
  locale: Locale,
  name: string,
): QA[] {
  const modelName = (id: string) => catalog.models.find((m) => m.id === id)?.name ?? id;
  const primaryRam = hub.configs[hub.primaryIndex]!.ramGB;
  const memory = primaryMemoryLabel(t.hub, hub, locale);
  const items: QA[] = [];

  // Q1 — 전부 올라가는 가장 큰 모델 (CPU 프로필은 돌아가는 가장 큰 모델).
  // 기준 또는 비-desperate 추천 quant 중 조건을 만족하는 것 (assess.ts pickQuant)
  if (hub.gpu.kind === 'cpu') {
    const pick = hub.faq.largestRunnable;
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
    const pick = hub.faq.largestFullGpu;
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
  const { gpu } = hub;
  const name = gpuName(t.names, gpu);
  const href = gpuHref(gpu.id);
  const primary = primaryCombos(hub);
  const multiConfig = hub.configs.length > 1;
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

  const price =
    gpu.streetUSD !== undefined && gpu.priceAsOf
      ? tSpec('priceStreet', { price: formatPrice(t.common, locale, gpu.streetUSD), date: gpu.priceAsOf })
      : gpu.msrpUSD !== undefined
        ? tSpec('priceMsrp', { price: formatPrice(t.common, locale, gpu.msrpUSD) })
        : undefined;

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
              { name, href: localeHref(locale, href), url: absoluteUrl(localeHref(locale, href)) },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {tSpec('h1', { gpu: name })}
          </h1>
          <div className="flex flex-wrap gap-2">
            {gpu.form === 'laptop' && <Pill tone="caution">{tSpec('badgeLaptop')}</Pill>}
            {gpu.kind === 'unified' && <Pill tone="info">{tSpec('badgeUnified')}</Pill>}
            {gpu.kind === 'cpu' && <Pill tone="info">{tSpec('badgeCpu')}</Pill>}
            {isFp16Crippled(gpu) && <Pill tone="caution">{tSpec('badgeFp16')}</Pill>}
          </div>
          <p className="text-muted-foreground">{assumption}</p>
        </header>

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
                {tSpec('specBandwidthValue', { value: formatGB(locale, gpu.memBandwidthGBs) })}
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
            {hub.configs.map((cfg, index) => {
              const counts = hub.counts[index]!;
              return (
                <li key={cfg.ramGB} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {multiConfig && (
                    <span className="w-16 font-medium tabular-nums">
                      {tSpec('ramOption', { ram: formatInt(locale, cfg.ramGB) })}
                    </span>
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
                </li>
              );
            })}
          </ul>
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
                      comboHref={
                        isComboIndexable(gpu.id, row.model.id)
                          ? localeHref(locale, comboHref(row.model.id, gpu.id))
                          : undefined
                      }
                      detailsLabel={tTable('detailsFor', { model: row.model.name, gpu: name })}
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
                    {hub.configs.map((cfg) => (
                      <th key={cfg.ramGB} scope="col" className="tabular-nums">
                        {tSpec('ramOption', { ram: formatInt(locale, cfg.ramGB) })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hub.rows.map((row) => (
                    <tr key={row.model.id}>
                      <th scope="row">{row.model.name}</th>
                      {row.combos.map((combo) => (
                        <td key={combo.ramGB}>
                          <VerdictBadge verdict={combo.baseline.result.verdict} compact />
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
      </article>
    </PageShell>
  );
}
