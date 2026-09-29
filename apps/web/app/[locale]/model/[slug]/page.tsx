import type { ModelGpuRow, ModelHubData, PricedOption } from '@canrun/data';
import { computeBufferGB, kvGB } from '@canrun/engine';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GgufSourceBadge, LicenseBadge, Pill } from '@/components/badges';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Faq } from '@/components/faq';
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
import { formatCtx, formatGB, formatInt, formatParams, formatUSD } from '@/lib/format';
import { getModelHub } from '@/lib/hubs';
import type { QA } from '@/lib/jsonld';
import { comboHref, gpuHref, hfUrl, localeHref, modelHref } from '@/lib/links';
import { isComboIndexable } from '@/lib/publish';
import { gpuName, quantText, speedPhrase, type Translate } from '@/lib/phrases';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale; slug: string }> };

/** docs/04 §2 `/model/{slug}` — 카탈로그 전 모델 (결정 D1) */
export function generateStaticParams() {
  return catalog.models.map((model) => ({ slug: model.id }));
}

export const dynamicParams = false;

type Tr = Translate & { has?: (key: string) => boolean };

async function translators(locale: Locale) {
  const [hub, faq, common, confidence, verdict, names, hint] = await Promise.all([
    getTranslations({ locale, namespace: 'ModelHub' }),
    getTranslations({ locale, namespace: 'Faq' }),
    getTranslations({ locale, namespace: 'Common' }),
    getTranslations({ locale, namespace: 'Confidence' }),
    getTranslations({ locale, namespace: 'Verdict' }),
    getTranslations({ locale, namespace: 'GpuName' }),
    getTranslations({ locale, namespace: 'Hint' }),
  ]);
  return { hub, faq, common, confidence, verdict, names, hint } as unknown as Record<
    'hub' | 'faq' | 'common' | 'confidence' | 'verdict' | 'names' | 'hint',
    Tr
  >;
}

const REFERENCE_CTX = 8192;

/** 기준 quant·8k 필요 메모리 분해 (메모리 행렬과 같은 식 — 가중치 + KV + 버퍼) */
function needAt8k(hub: ModelHubData, quant: string) {
  const row = hub.quants.find((q) => q.row.quant === quant)!.row;
  const kv = kvGB(hub.model.arch.kvBytesPerTokenF16, REFERENCE_CTX);
  const buffer = computeBufferGB(REFERENCE_CTX);
  return { size: row.fileGB, kv, buffer, total: row.fileGB + kv + buffer };
}

function rowLabel(t: Awaited<ReturnType<typeof translators>>, row: ModelGpuRow, locale: string) {
  const name = gpuName(t.names, row.gpu);
  return row.gpu.kind === 'dgpu'
    ? name
    : `${name} · ${t.hub('configRam', { ram: formatInt(locale, row.combo.ramGB) })}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const hub = getModelHub(slug);
  if (!hub) return {};
  const t = await translators(locale);
  return buildPageMetadata({
    href: modelHref(hub.model.id),
    locale,
    title: t.hub('metaTitle', { model: hub.model.name }),
    description: t.hub('metaDescription', {
      model: hub.model.name,
      need: formatGB(locale, needAt8k(hub, hub.baselineQuant).total),
      quant: hub.baselineQuant,
      gpus: hub.gpuRows.length,
    }),
  });
}

function buildFaq(
  t: Awaited<ReturnType<typeof translators>>,
  hub: ModelHubData,
  locale: Locale,
): QA[] {
  const { model } = hub;
  const base = needAt8k(hub, hub.baselineQuant);
  const smallest = hub.quants[0]!;
  const baseValues = {
    quant: hub.baselineQuant,
    size: formatGB(locale, base.size, 2),
    need: formatGB(locale, base.total),
    kv: formatGB(locale, base.kv),
    buffer: formatGB(locale, base.buffer),
  };
  const items: QA[] = [
    {
      question: t.faq('modelVramQ', { model: model.name }),
      // 기준 파일이 곧 가장 작은 파일이면(gpt-oss MXFP4 단일 배포 등) 중복 문장을 뺀다
      answer:
        smallest.row.quant === hub.baselineQuant
          ? t.faq('modelVramOnly', baseValues)
          : t.faq('modelVramA', {
              ...baseValues,
              // desperate(2비트)를 인용할 때는 "품질 손실 큼" (docs/01 §3)
              minQuant: quantText(t.hint, { quant: smallest.row.quant, tier: smallest.tier }),
              minNeed: formatGB(locale, needAt8k(hub, smallest.row.quant).total),
            }),
    },
  ];

  // 최저가: 쾌적(S) 최저가 + 그보다 싼 원활(A) 최저가 (docs/01 §3 — "원활 이상 최저가" 질문에 둘 다 답한다)
  const best = hub.gpuRows[0]!;
  const { great, well } = hub.cheapest;
  const priced = (option: PricedOption) => ({
    gpu: gpuName(t.names, option.gpu),
    price: formatUSD(locale, option.priceUSD),
    date: option.priceAsOf,
    speed: speedPhrase(t.common, t.confidence, locale, option.combo.baseline),
  });
  let cheapAnswer: string;
  if (great) {
    cheapAnswer = t.faq('modelCheapA', priced(great));
    if (well) cheapAnswer += t.faq('modelCheapWellToo', priced(well));
  } else if (well) {
    cheapAnswer = t.faq('modelCheapWellOnly', priced(well));
  } else {
    cheapAnswer = t.faq('modelCheapNone', {
      quant: hub.baselineQuant,
      gpu: rowLabel(t, best, locale),
      verdict: t.verdict(best.combo.baseline.result.verdict),
    });
  }
  items.push({ question: t.faq('modelCheapQ', { model: model.name }), answer: cheapAnswer });

  const cards = hub.referenceRows.map((row) => {
    const q = row.combo.baseline;
    const gpu = gpuName(t.names, row.gpu);
    const verdict = t.verdict(q.result.verdict);
    return q.fReason === 'no-fit'
      ? t.faq('modelCard', { gpu, verdict })
      : t.faq('modelCardSpeed', {
          gpu,
          verdict,
          speed: speedPhrase(t.common, t.confidence, locale, q),
        });
  });
  items.push({
    question: t.faq('modelCardsQ', { model: model.name }),
    answer: t.faq('modelCardsA', { quant: hub.baselineQuant, cards: cards.join('; ') }),
  });
  return items;
}

export default async function ModelHubPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const hub = getModelHub(slug);
  if (!hub) notFound();

  const t = await translators(locale);
  const tTable = await getTranslations({ locale, namespace: 'Table' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const tTier = await getTranslations({ locale, namespace: 'QuantTier' });
  const tAttention = await getTranslations({ locale, namespace: 'Attention' });
  const tCategory = await getTranslations({ locale, namespace: 'Category' });
  const tGpuHub = await getTranslations({ locale, namespace: 'GpuHub' });

  const { model } = hub;
  const href = modelHref(model.id);
  const faq = buildFaq(t, hub, locale);
  const hasPartial = hub.gpuRows.some(
    (r) => r.combo.display.fReason !== 'no-fit' && r.combo.display.result.mode === 'partial-offload',
  );
  const hasUnsloth = hub.quants.some((q) => q.publisher.owner === 'unsloth');

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
              {
                name: model.name,
                href: localeHref(locale, href),
                url: absoluteUrl(localeHref(locale, href)),
              },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t.hub('h1', { model: model.name })}
          </h1>
          <div className="flex flex-wrap gap-2">
            <LicenseBadge license={model.license} hfId={model.hfId} />
            {model.korean && <Pill tone="info">{t.hub('factKorean')}</Pill>}
            {model.category.map((category) => (
              <Pill key={category}>{tCategory(category)}</Pill>
            ))}
          </div>
        </header>

        <section aria-labelledby="facts-heading" className="flex flex-col gap-3">
          <h2 id="facts-heading" className="text-xl font-semibold tracking-tight">
            {t.hub('factsTitle')}
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t.hub('factParams')}</dt>
              <dd className="font-medium">
                {model.activeParamsB !== undefined
                  ? t.hub('paramsMoe', {
                      total: formatParams(locale, model.paramsB),
                      active: formatParams(locale, model.activeParamsB),
                    })
                  : t.hub('paramsDense', { total: formatParams(locale, model.paramsB) })}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.hub('factAttention')}</dt>
              <dd className="font-medium">{tAttention(model.arch.attnType)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.hub('factContext')}</dt>
              <dd className="font-medium">
                {t.hub('contextValue', { ctx: formatInt(locale, model.maxContext) })}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.hub('factReleased')}</dt>
              <dd className="font-medium tabular-nums">{model.releasedAt}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">{t.hub('factCard')}</dt>
              <dd className="font-medium">
                <a href={hfUrl(model.hfId)}>{t.hub('hfLink', { model: model.name })}</a>
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="quants-heading" className="flex flex-col gap-3">
          <h2 id="quants-heading" className="text-xl font-semibold tracking-tight">
            {t.hub('quantTitle')}
          </h2>
          <ScrollTable label={t.hub('quantTitle')}>
            <table className={TABLE_CLASS}>
              <caption>{t.hub('quantCaption', { model: model.name })}</caption>
              <thead>
                <tr>
                  <th scope="col">{tTable('quant')}</th>
                  <th scope="col">{tTable('size')}</th>
                  <th scope="col">{tTable('quality')}</th>
                  <th scope="col">{tTable('publisher')}</th>
                </tr>
              </thead>
              <tbody>
                {hub.quants.map(({ row, tier, publisher }) => (
                  <tr key={row.quant}>
                    <th scope="row" className="whitespace-nowrap">
                      {row.quant}
                      {row.quant === hub.baselineQuant && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {t.hub('baselineMark')}
                        </span>
                      )}
                    </th>
                    <td className="tabular-nums whitespace-nowrap">
                      {t.common('gb', { value: formatGB(locale, row.fileGB, 2) })}
                    </td>
                    <td>{tTier(tier)}</td>
                    <td>
                      <GgufSourceBadge publisher={publisher} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
          {model.category.includes('vision') && (
            <p className="text-xs text-muted-foreground">{t.hub('visionNote')}</p>
          )}
          {hasUnsloth && <p className="text-xs text-muted-foreground">{t.hub('udNote')}</p>}
        </section>

        <section aria-labelledby="matrix-heading" className="flex flex-col gap-3">
          <h2 id="matrix-heading" className="text-xl font-semibold tracking-tight">
            {t.hub('matrixTitle')}
          </h2>
          <ScrollTable label={t.hub('matrixTitle')}>
            <table className={TABLE_CLASS}>
              <caption>{t.hub('matrixCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{tTable('quant')}</th>
                  {hub.matrix.ctxs.map((ctx) => (
                    <th key={ctx} scope="col" className="tabular-nums">
                      {formatCtx(ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hub.matrix.rows.map((row) => (
                  <tr key={row.quant}>
                    <th scope="row" className="whitespace-nowrap">
                      {row.quant}
                    </th>
                    {row.cellsGB.map((gb, i) => (
                      <td key={hub.matrix.ctxs[i]} className="tabular-nums">
                        {formatGB(locale, gb)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        </section>

        <section aria-labelledby="gpus-heading" className="flex flex-col gap-3">
          <h2 id="gpus-heading" className="text-xl font-semibold tracking-tight">
            {t.hub('gpuTitle', { model: model.name })}
          </h2>
          <VerdictLegend />
          {hasPartial && (
            <p className="rounded-lg border border-verdict-b-fg/40 bg-verdict-b-bg p-3 text-sm text-verdict-b-fg">
              {tGpuHub('partialWarning')}
            </p>
          )}
          <p className="text-xs text-muted-foreground sm:hidden">{tTable('scrollHint')}</p>
          <ScrollTable label={t.hub('gpuTitle', { model: model.name })}>
            <table className={TABLE_CLASS}>
              <caption>
                {t.hub('gpuCaption', { total: hub.gpuRows.length, quant: hub.baselineQuant })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{tTable('hardware')}</th>
                  <ComboHeaderCells />
                  <th scope="col">{tTable('price')}</th>
                </tr>
              </thead>
              <tbody>
                {hub.gpuRows.map((row) => {
                  const { gpu } = row;
                  const price =
                    gpu.streetUSD !== undefined && gpu.priceAsOf
                      ? tGpuHub('priceStreet', {
                          price: formatUSD(locale, gpu.streetUSD),
                          date: gpu.priceAsOf,
                        })
                      : gpu.msrpUSD !== undefined
                        ? tGpuHub('priceMsrp', { price: formatUSD(locale, gpu.msrpUSD) })
                        : t.common('none');
                  return (
                    <tr key={gpu.id}>
                      <th scope="row">
                        <a href={localeHref(locale, gpuHref(gpu.id))}>{rowLabel(t, row, locale)}</a>
                      </th>
                      <ComboCells
                        combo={row.combo}
                        gpu={gpu}
                        comboHref={
                          isComboIndexable(gpu.id, model.id)
                            ? localeHref(locale, comboHref(model.id, gpu.id))
                            : undefined
                        }
                        detailsLabel={tTable('detailsFor', { model: model.name, gpu: gpuName(t.names, gpu) })}
                      />
                      <td className="text-xs">{price}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
          {model.category.includes('reasoning') && (
            <p className="text-xs text-muted-foreground">{t.common('reasoningNote')}</p>
          )}
        </section>

        {/* 계획 순서 ⑤ GPU 표 → ⑥ 최저가 — 쾌적 최저가 + 그보다 싼 원활 최저가 (docs/01 §3) */}
        <section aria-labelledby="cheapest-heading" className="flex flex-col gap-3">
          <h2 id="cheapest-heading" className="text-xl font-semibold tracking-tight">
            {t.hub('cheapestTitle')}
          </h2>
          {hub.cheapest.great || hub.cheapest.well ? (
            <ul className="flex flex-col gap-2 rounded-lg border border-border p-4">
              {[hub.cheapest.great, hub.cheapest.well]
                .filter((option): option is PricedOption => option !== undefined)
                .map((option) => (
                  <li key={option.gpu.id} className="flex flex-wrap items-center gap-2">
                    <VerdictBadge verdict={option.combo.baseline.result.verdict} />
                    <a href={localeHref(locale, gpuHref(option.gpu.id))}>
                      {gpuName(t.names, option.gpu)}
                    </a>
                    <span>
                      {t.hub('cheapest', {
                        price: formatUSD(locale, option.priceUSD),
                        date: option.priceAsOf,
                        speed: speedPhrase(t.common, t.confidence, locale, option.combo.baseline),
                      })}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-border p-4">
              {t.hub('cheapestNone', { quant: hub.baselineQuant })}
            </p>
          )}
        </section>

        <section aria-labelledby="bench-heading" className="flex flex-col gap-3">
          <h2 id="bench-heading" className="text-xl font-semibold tracking-tight">
            {t.hub('benchTitle', { model: model.name })}
          </h2>
          {hub.benchmarks.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">{tTable('benchIntro')}</p>
              <BenchTable
                points={hub.benchmarks}
                firstColumn="hardware"
                models={catalog.models}
                gpus={catalog.gpus}
                gpuLabel={(g) => gpuName(t.names, g)}
                caption={t.hub('benchTitle', { model: model.name })}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.hub('benchEmpty')}</p>
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
