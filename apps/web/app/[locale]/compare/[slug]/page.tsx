import type { CompareSide, Gpu, GpuComparison } from '@canrun/data';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { CalcWidget } from '@/components/calc-widget';
import { CompareIntro } from '@/components/compare-intro';
import { CompareTable } from '@/components/compare-table';
import { Faq } from '@/components/faq';
import { BenchTable, ScrollTable, TABLE_CLASS } from '@/components/hub-table';
import { PageShell } from '@/components/page-shell';
import { VerdictBadge, VerdictLegend } from '@/components/verdict';
import { COMPARE_SLUGS, isComparePublished } from '@/content/compares';
import type { Locale } from '@/i18n/routing';
import { calcDeepQuery } from '@/lib/calc-catalog';
import { catalog } from '@/lib/catalog';
import { loadCompareIntro } from '@/lib/compare-intros';
import {
  compareDescription,
  compareFaq,
  compareNames,
  compareTitle,
  overlapSentence,
  ppSummary,
  sideMemoryLabel,
  speedSentence,
  type CompareNames,
  type CompareTranslators,
} from '@/lib/compare-phrases';
import { compareOgImagePath, getCompare } from '@/lib/compares';
import { formatGB, formatInt, formatRatio } from '@/lib/format';
import { msrpConfigRamGB } from '@/lib/krw';
import { calculatorHref, compareHref, comparesHref, gpuHref, localeHref } from '@/lib/links';
import { gpuName, speedPhrase, type Translate } from '@/lib/phrases';
import { formatPrice, krwNote } from '@/lib/price';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale; slug: string }> };

/** 레지스트리(content/compares.ts)의 쌍 전부 — 초안도 URL 로는 열린다(noindex, 미링크 — D40 과 같은 규칙) */
export function generateStaticParams() {
  return COMPARE_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

type Tr = Translate & { has?: (key: string) => boolean };

async function translators(locale: Locale) {
  const [compare, hub, common, confidence, combo, names, breadcrumb] = await Promise.all([
    getTranslations({ locale, namespace: 'Compare' }),
    getTranslations({ locale, namespace: 'GpuHub' }),
    getTranslations({ locale, namespace: 'Common' }),
    getTranslations({ locale, namespace: 'Confidence' }),
    getTranslations({ locale, namespace: 'Combo' }),
    getTranslations({ locale, namespace: 'GpuName' }),
    getTranslations({ locale, namespace: 'Breadcrumb' }),
  ]);
  return { compare, hub, common, confidence, combo, names, breadcrumb } as unknown as CompareTranslators &
    Record<'breadcrumb', Tr>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = getCompare(slug);
  if (!page) return {};
  const t = await translators(locale);
  const names = compareNames(t, locale, page.cmp);
  return buildPageMetadata({
    href: compareHref(page.slug),
    locale,
    title: compareTitle(t, page.cmp, names),
    description: compareDescription(t, locale, page.cmp, names),
    absoluteTitle: true,
    // 초안 = noindex,follow (사용자가 채팅으로 승인한 쌍만 published — D40 과 같은 규칙)
    noindex: !isComparePublished(page.slug),
    ogImage: compareOgImagePath(page.slug, locale),
  });
}

/** 가격 칸 — GPU 허브와 같은 규칙: 실거래가는 기준일과 함께(규칙 2, `rankableStreet`), 없으면 출시가(통합 메모리 PC 는 그 구성), 없으면 대시 */
function priceText(t: Awaited<ReturnType<typeof translators>>, locale: Locale, side: CompareSide): string | undefined {
  const { gpu } = side;
  if (side.street) return t.hub('priceStreet', { price: formatPrice(t.common, locale, side.street.usd), date: side.street.asOf });
  if (gpu.msrpUSD === undefined) return undefined;
  const msrpRam = msrpConfigRamGB(gpu);
  if (msrpRam !== undefined) {
    return t.hub('priceMsrpConfig', { price: formatPrice(t.common, locale, gpu.msrpUSD), ram: formatInt(locale, msrpRam) });
  }
  return t.hub('priceMsrp', { price: formatPrice(t.common, locale, gpu.msrpUSD) });
}

/** 가정 문장 — 그래픽카드는 GPU 허브 문장 그대로, 통합 메모리·CPU 는 비교에 쓴 구성(가장 큰 메모리) 하나 */
function assumption(t: Awaited<ReturnType<typeof translators>>, locale: Locale, side: CompareSide): string {
  const ram = formatInt(locale, side.config.ramGB);
  if (side.gpu.kind === 'dgpu') return t.hub('assumeDgpu', { ram });
  return t.compare(side.gpu.kind === 'cpu' ? 'assumeCpu' : 'assumeUnified', { ram });
}

/** 차이 칸 — 값이 큰 쪽 이름과 배율(대역폭·FP16) 또는 GB 차(같은 종류의 메모리끼리만) */
function ratioCell(t: Awaited<ReturnType<typeof translators>>, locale: Locale, names: CompareNames, ratio: number | undefined): string {
  if (ratio === undefined) return t.common('none');
  if (Math.abs(ratio - 1) < 0.005) return t.compare('diffSame');
  return ratio > 1
    ? t.compare('diffRatio', { gpu: names.b, ratio: formatRatio(locale, ratio, 2) })
    : t.compare('diffRatio', { gpu: names.a, ratio: formatRatio(locale, 1 / ratio, 2) });
}

function memoryCell(t: Awaited<ReturnType<typeof translators>>, locale: Locale, names: CompareNames, cmp: GpuComparison): string {
  const memory = (side: CompareSide) => (side.gpu.kind === 'dgpu' ? (side.gpu.vramGB ?? 0) : side.config.ramGB);
  // 그래픽카드 VRAM 과 통합 메모리는 GPU 가 쓸 수 있는 몫이 달라(통합은 약 70%) 단순 차이를 보이지 않는다
  if ((cmp.a.gpu.kind === 'dgpu') !== (cmp.b.gpu.kind === 'dgpu')) return t.common('none');
  const diff = memory(cmp.b) - memory(cmp.a);
  if (diff === 0) return t.compare('diffSame');
  return t.compare('diffMore', { gpu: diff > 0 ? names.b : names.a, value: t.common('gb', { value: formatInt(locale, Math.abs(diff)) }) });
}

export default async function ComparePage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const page = getCompare(slug);
  if (!page) notFound();
  const { cmp } = page;

  const t = await translators(locale);
  const tTable = await getTranslations({ locale, namespace: 'Table' });
  const tWidget = await getTranslations({ locale, namespace: 'CalcWidget' });
  const names = compareNames(t, locale, cmp);
  const href = compareHref(page.slug);
  const sides = [
    { side: cmp.a, name: names.a },
    { side: cmp.b, name: names.b },
  ] as const;
  const faq = compareFaq(t, locale, cmp, names);
  const differ = cmp.rows.filter((row) => row.verdictDiffers);
  const Intro = await loadCompareIntro(page.slug, locale);
  const title = t.compare('cardTitle', names);

  // 가정 문장 — 두 기기가 같으면(그래픽카드 둘) 한 번만
  const assumptions = sides.map(({ side, name }) => ({ name, text: assumption(t, locale, side) }));
  const sameAssumption = assumptions[0]!.text === assumptions[1]!.text;

  const prices = sides.map(({ side }) => priceText(t, locale, side));
  const fp16 = (gpu: Gpu) => (gpu.fp16Tflops !== undefined ? t.hub('specFp16Value', { value: formatGB(locale, gpu.fp16Tflops) }) : t.common('none'));
  const specRows: Array<{ label: string; a: string; b: string; diff: string }> = [
    {
      label: t.compare('rowMemory'),
      a: sideMemoryLabel(t, locale, cmp.a),
      b: sideMemoryLabel(t, locale, cmp.b),
      diff: memoryCell(t, locale, names, cmp),
    },
    {
      label: t.hub('specBandwidth'),
      a: t.hub('specBandwidthValue', { value: formatGB(locale, cmp.a.gpu.memBandwidthGBs) }),
      b: t.hub('specBandwidthValue', { value: formatGB(locale, cmp.b.gpu.memBandwidthGBs) }),
      diff: ratioCell(t, locale, names, cmp.specRatio.bandwidth),
    },
    { label: t.hub('specFp16'), a: fp16(cmp.a.gpu), b: fp16(cmp.b.gpu), diff: ratioCell(t, locale, names, cmp.specRatio.fp16) },
    { label: t.hub('specLaunch'), a: String(cmp.a.gpu.launchYear), b: String(cmp.b.gpu.launchYear), diff: t.common('none') },
    { label: t.hub('specPrice'), a: prices[0] ?? t.common('none'), b: prices[1] ?? t.common('none'), diff: t.common('none') },
    {
      label: t.compare('rowBench'),
      a: t.compare('benchCount', { count: cmp.a.benchmarks }),
      b: t.compare('benchCount', { count: cmp.b.benchmarks }),
      diff: t.common('none'),
    },
  ];
  const showKrw = prices.some((p) => p !== undefined) && krwNote(t.common, locale);

  const speed = cmp.speed;
  const overlap = overlapSentence(t, cmp);
  const pp = ppSummary(t, locale, cmp, names);
  const crumbs = [
    { name: t.breadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
    // 홈 › 비교 목차 › 이 쌍 (가이드와 같은 3단)
    { name: t.breadcrumb('compare'), href: localeHref(locale, comparesHref()), url: absoluteUrl(localeHref(locale, comparesHref())) },
    { name: title, href: localeHref(locale, href), url: absoluteUrl(localeHref(locale, href)) },
  ];

  return (
    <PageShell locale={locale} href={href}>
      <article className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <Breadcrumbs crumbs={crumbs} />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t.compare('h1', names)}</h1>
          {sameAssumption ? (
            <p className="text-muted-foreground">{assumptions[0]!.text}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {assumptions.map(({ name, text }) => (
                <li key={name}>{t.compare('assumeFor', { gpu: name, assumption: text })}</li>
              ))}
            </ul>
          )}
        </header>

        {/* 계산기 위젯 (10-19 D107) — 앞쪽 기기를 미리 고른 채, 두 기기 각각 비교에 쓴 구성(통합·CPU 는 그 메모리)으로 여는 링크 */}
        <CalcWidget
          locale={locale}
          idPrefix="compare-calc"
          heading={tWidget('title')}
          prefill={{
            gpuId: cmp.a.gpu.id,
            note: tWidget('note'),
            links: (['a', 'b'] as const).map((kind) => ({
              kind,
              href: localeHref(locale, calculatorHref(calcDeepQuery({ gpuId: cmp[kind].gpu.id, ramGB: cmp[kind].config.ramGB }))),
              text: tWidget('openGpu', { gpu: names[kind] }),
            })),
          }}
        />

        {Intro && <CompareIntro Body={Intro} title={t.compare('introTitle')} />}

        <section aria-labelledby="speed-heading" data-compare-summary className="flex flex-col gap-3">
          <h2 id="speed-heading" className="text-xl font-semibold tracking-tight">
            {t.compare('summaryTitle')}
          </h2>
          <p>{speedSentence(t, locale, cmp, names)}</p>
          {overlap && <p className="text-sm text-muted-foreground">{overlap}</p>}
          {speed && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t.compare('refModel')}</dt>
                <dd className="font-medium">{t.compare('refModelValue', { model: speed.reference.model.name, quant: speed.reference.a.baseline.quant })}</dd>
              </div>
              {[
                { name: names.a, q: speed.reference.a.baseline },
                { name: names.b, q: speed.reference.b.baseline },
              ].map(({ name, q }) => (
                <div key={name}>
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="font-medium">{speedPhrase(t.common, t.confidence, locale, q)}</dd>
                </div>
              ))}
              {pp && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">{t.compare('ppLabel', { model: speed.reference.model.name })}</dt>
                  <dd>{pp}</dd>
                </div>
              )}
            </dl>
          )}
        </section>

        <section aria-labelledby="specs-heading" className="flex flex-col gap-3">
          <h2 id="specs-heading" className="text-xl font-semibold tracking-tight">
            {t.compare('specsTitle')}
          </h2>
          <ScrollTable label={t.compare('specsTitle')}>
            <table className={TABLE_CLASS}>
              <caption>{t.compare('specsCaption', names)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.compare('colSpec')}</th>
                  <th scope="col">{names.a}</th>
                  <th scope="col">{names.b}</th>
                  <th scope="col">{t.compare('colDiff')}</th>
                </tr>
              </thead>
              <tbody>
                {specRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td className="tabular-nums">{row.a}</td>
                    <td className="tabular-nums">{row.b}</td>
                    <td className="text-muted-foreground">{row.diff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
          {showKrw && <p className="text-xs text-muted-foreground">{krwNote(t.common, locale)}</p>}
        </section>

        <section aria-labelledby="counts-heading" className="flex flex-col gap-3">
          <h2 id="counts-heading" className="text-xl font-semibold tracking-tight">
            {t.compare('countsTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t.compare('countsCaption', { total: cmp.rows.length })}</p>
          <ul className="flex flex-col gap-3">
            {sides.map(({ side, name }) => (
              <li key={name} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="min-w-40 font-medium">{name}</span>
                {(['S', 'A', 'B', 'F'] as const).map((v) => (
                  <span key={v} className="flex items-center gap-1.5 text-sm">
                    <VerdictBadge verdict={v} />
                    <span className="tabular-nums">{t.hub('countLabel', { count: side.counts[v] })}</span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {/* GPU·모델 허브와 같은 판정 기준 — 표 아래 생각 모드 안내(Common.reasoningNote)가 이 기준을 1.5배로 잡는다 */}
          <VerdictLegend className="mt-2" />
        </section>

        <section aria-labelledby="differ-heading" className="flex flex-col gap-3">
          <h2 id="differ-heading" className="text-xl font-semibold tracking-tight">
            {t.compare('differTitle')}
          </h2>
          {differ.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">{t.compare('differIntro', { count: differ.length })}</p>
              <p className="text-xs text-muted-foreground sm:hidden">{tTable('scrollHint')}</p>
              <CompareTable
                rows={differ}
                a={{ gpu: cmp.a.gpu, name: names.a }}
                b={{ gpu: cmp.b.gpu, name: names.b }}
                caption={t.compare('differCaption', names)}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.compare('differNone')}</p>
          )}
        </section>

        <section aria-labelledby="models-heading" className="flex flex-col gap-3">
          <h2 id="models-heading" className="text-xl font-semibold tracking-tight">
            {t.compare('tableTitle')}
          </h2>
          <p className="text-xs text-muted-foreground sm:hidden">{tTable('scrollHint')}</p>
          <CompareTable
            rows={cmp.rows}
            a={{ gpu: cmp.a.gpu, name: names.a }}
            b={{ gpu: cmp.b.gpu, name: names.b }}
            caption={t.compare('tableCaption', { total: cmp.rows.length })}
          />
          <p className="text-xs text-muted-foreground">{t.common('reasoningNote')}</p>
        </section>

        <section aria-labelledby="bench-heading" className="flex flex-col gap-4">
          <h2 id="bench-heading" className="text-xl font-semibold tracking-tight">
            {t.compare('benchTitle')}
          </h2>
          {sides.map(({ side, name }) => {
            const points = catalog.benchmarks.filter((bp) => bp.gpuId === side.gpu.id);
            return (
              <div key={name} className="flex flex-col gap-2">
                <h3 className="font-medium">{t.hub('benchTitle', { gpu: name })}</h3>
                {points.length > 0 ? (
                  <BenchTable
                    points={points}
                    firstColumn="model"
                    models={catalog.models}
                    gpus={catalog.gpus}
                    gpuLabel={(g) => gpuName(t.names, g)}
                    caption={t.hub('benchTitle', { gpu: name })}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t.hub('benchEmpty')}</p>
                )}
              </div>
            );
          })}
          <p className="text-sm text-muted-foreground">{tTable('benchIntro')}</p>
        </section>

        <Faq items={faq} />

        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{t.common('estimateNotice')}</p>

        <section aria-labelledby="more-heading" className="flex flex-col gap-3">
          <h2 id="more-heading" className="text-xl font-semibold tracking-tight">
            {t.compare('linksTitle')}
          </h2>
          <ul className="flex flex-col gap-2">
            {sides.map(({ side, name }) => (
              <li key={name}>
                <a href={localeHref(locale, gpuHref(side.gpu.id))}>{t.hub('tableTitle', { gpu: name })}</a>
              </li>
            ))}
            <li>
              <a href={localeHref(locale, comparesHref())}>{t.compare('allLink')}</a>
            </li>
          </ul>
        </section>
      </article>
    </PageShell>
  );
}
