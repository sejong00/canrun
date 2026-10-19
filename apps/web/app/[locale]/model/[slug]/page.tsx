import {
  isReasoning,
  MTP_LOADABLE_MODELS,
  rankableStreet,
  type ModelGpuRow,
  type ModelHubData,
  type PricedOption,
} from '@canrun/data';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GgufSourceBadge, LicenseBadge, Pill } from '@/components/badges';
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
import { PriceSort } from '@/components/islands/price-sort';
import { PageShell } from '@/components/page-shell';
import { VerdictBadge, VerdictLegend } from '@/components/verdict';
import type { Locale } from '@/i18n/routing';
import { catalog } from '@/lib/catalog';
import { formatCtx, formatGB, formatInt, formatParams } from '@/lib/format';
import { formatPrice, krwNote } from '@/lib/price';
import { loadHubIntro } from '@/lib/hub-intros';
import { needAt8k } from '@/lib/model-need';
import { getModelHub } from '@/lib/hubs';
import type { QA } from '@/lib/jsonld';
import { calculatorHref, comboHref, gpuHref, hfUrl, localeHref, modelHref, modelsHref } from '@/lib/links';
import { hubOgImage } from '@/lib/og-images';
import { isComboIndexable } from '@/lib/publish';
import { gpuName, quantText, speedPhrase, type Translate } from '@/lib/phrases';
import { searchModelName } from '@/lib/search-names';
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

/** 이보다 작은 차이(임베딩 공유 모델의 헤더 메타데이터 수십 MB)는 FAQ·행렬 캡션에서 따로 설명하지 않는다 */
const OFF_GPU_NOTE_MIN_GB = 0.05;

/**
 * 기준 quant 에서 그래픽카드에 안 올리는 몫이 있을 때 그 이유를 밝히는 문장 키(FAQ 답 꼬리·행렬 캡션 공용, 10-03 D62).
 * 입력 임베딩만 / MTP 블록도(켜면 불러옴) / MTP 블록도(llama.cpp 가 아직 안 씀 — EXAONE 4.5). 차이가 작으면 없음
 */
function offGpuNoteKey(hub: ModelHubData) {
  const base = needAt8k(hub, hub.baselineQuant);
  if (base.size - base.gpu < OFF_GPU_NOTE_MIN_GB) return undefined;
  if (!base.mtp) return 'modelVramOffGpu';
  return MTP_LOADABLE_MODELS.includes(hub.model.id) ? 'modelVramOffGpuMtp' : 'modelVramOffGpuMtpUnused';
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
  // 한국어는 한글로도 찾는 계열이면 "Gemma 4 26B-A4B(젬마 4)" — 제목·설명·H1 만 (10-16 D94, content/ko-names.ts)
  const name = searchModelName(locale, hub.model);
  return buildPageMetadata({
    href: modelHref(hub.model.id),
    locale,
    ogImage: hubOgImage('model', hub.model.id, locale),
    title: t.hub('metaTitle', { model: name }),
    description: t.hub('metaDescription', {
      model: name,
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
    gpu: formatGB(locale, base.gpu, 2),
    need: formatGB(locale, base.total),
    kv: formatGB(locale, base.kv),
    buffer: formatGB(locale, base.buffer),
  };
  // 그래픽카드에 안 올리는 몫이 있으면 왜 파일보다 작은지(입력 임베딩·MTP)와 맥은 파일 전체라는 점을 덧붙인다
  const offGpuKey = offGpuNoteKey(hub);
  const offGpuNote = offGpuKey ? ` ${t.faq(offGpuKey)}` : '';
  const items: QA[] = [
    {
      question: t.faq('modelVramQ', { model: model.name }),
      // 기준 파일이 곧 가장 작은 파일이면(gpt-oss MXFP4 단일 배포 등) 중복 문장을 뺀다
      answer:
        (smallest.row.quant === hub.baselineQuant
          ? t.faq('modelVramOnly', baseValues)
          : t.faq('modelVramA', {
              ...baseValues,
              // desperate(2비트)를 인용할 때는 "품질 손실 큼" (docs/01 §3)
              minQuant: quantText(t.hint, { quant: smallest.row.quant, tier: smallest.tier }),
              minNeed: formatGB(locale, needAt8k(hub, smallest.row.quant).total),
            })) + offGpuNote,
    },
  ];

  // 최저가: 쾌적(S) 최저가 + 그보다 싼 원활(A) 최저가 (docs/01 §3 — "원활 이상 최저가" 질문에 둘 다 답한다)
  const best = hub.gpuRows[0]!;
  const { great, well } = hub.cheapest;
  const priced = (option: PricedOption) => ({
    gpu: gpuName(t.names, option.gpu),
    price: formatPrice(t.common, locale, option.priceUSD),
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
  const tSort = await getTranslations({ locale, namespace: 'Sort' });
  /** 가격 순위 대상 = dGPU 실거래가(priceAsOf 동반)만 — MSRP·통합 메모리 기기는 순위 밖 (docs/01 §3, 규칙 2). 계산기 모델 모드와 같은 조건(D65) */
  const rankablePrice = (gpu: (typeof hub.gpuRows)[number]['gpu']): number | undefined => rankableStreet(gpu)?.usd;
  const unpricedRows = hub.gpuRows.filter((r) => rankablePrice(r.gpu) === undefined).length;

  const { model } = hub;
  const href = modelHref(model.id);
  const faq = buildFaq(t, hub, locale);
  const hasPartial = hub.gpuRows.some(
    (r) => r.combo.display.fReason !== 'no-fit' && r.combo.display.result.mode === 'partial-offload',
  );
  const hasUnsloth = hub.quants.some((q) => q.publisher.owner === 'unsloth');
  // 행렬 캡션도 FAQ 와 같은 조건으로 GPU 밖 몫을 설명한다(임베딩 공유 모델은 생략, MTP 모델은 MTP 까지)
  const matrixOffGpuKey = offGpuNoteKey(hub);
  // 손으로 쓴 소개글(10-14 D74) — 레지스트리(content/hubs.ts)에 있는 허브만
  const Intro = await loadHubIntro('model', model.id, locale);

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
              // 홈 › 모델 목록 › 허브 (10-19 — 목록 페이지가 생겨 가운데 단계에 URL 이 있다)
              {
                name: tBreadcrumb('models'),
                href: localeHref(locale, modelsHref()),
                url: absoluteUrl(localeHref(locale, modelsHref())),
              },
              {
                name: model.name,
                href: localeHref(locale, href),
                url: absoluteUrl(localeHref(locale, href)),
              },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t.hub('h1', { model: searchModelName(locale, model) })}
          </h1>
          <div className="flex flex-wrap gap-2">
            <LicenseBadge license={model.license} hfId={model.hfId} />
            {model.korean && <Pill tone="info">{t.hub('factKorean')}</Pill>}
            {model.category.map((category) => (
              <Pill key={category}>{tCategory(category)}</Pill>
            ))}
          </div>
        </header>

        {Intro && <HubIntro Body={Intro} title={t.hub('introTitle', { model: model.name })} />}

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
          {hub.sameSizeQuant && (
            <p className="text-xs text-muted-foreground">{t.hub('sameSizeNote', hub.sameSizeQuant)}</p>
          )}
        </section>

        <section aria-labelledby="matrix-heading" className="flex flex-col gap-3">
          <h2 id="matrix-heading" className="text-xl font-semibold tracking-tight">
            {t.hub('matrixTitle')}
          </h2>
          <ScrollTable label={t.hub('matrixTitle')}>
            <table className={TABLE_CLASS}>
              <caption>
                {t.hub('matrixCaption')}
                {matrixOffGpuKey && ` ${t.faq(matrixOffGpuKey)}`}
              </caption>
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
          {/* 정렬 컨트롤 (docs/01 F2, P1-3 이월) — 서버 기본 순서는 판정→속도, 가격 순위는 dGPU 실거래가만 (docs/01 §3) */}
          <PriceSort
            tableId="gpu-table"
            labels={{
              label: tSort('label'),
              verdict: tSort('verdict'),
              price: tSort('price'),
              bandwidth: tSort('bandwidth'),
              announceVerdict: tSort('announceVerdict'),
              announcePrice: tSort('announcePrice', { count: unpricedRows }),
              announceBandwidth: tSort('announceBandwidth'),
            }}
          />
          {/* 계산기 모델 모드(10-03 D65) — 예산·종류·컨텍스트로 거르기. 정적 링크라 스크립트 0 (홈 `?gpu=` 링크와 같은 선례) */}
          <p className="text-sm">
            <a data-calc-model-link href={localeHref(locale, calculatorHref(`?mode=model&m=${model.id}`))}>
              {t.hub('calcLink')}
            </a>
          </p>
          <p className="text-xs text-muted-foreground sm:hidden">{tTable('scrollHint')}</p>
          <ScrollTable label={t.hub('gpuTitle', { model: model.name })}>
            <table id="gpu-table" data-gpu-table className={TABLE_CLASS}>
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
                {hub.gpuRows.map((row, index) => {
                  const { gpu } = row;
                  const price =
                    gpu.streetUSD !== undefined && gpu.priceAsOf
                      ? tGpuHub('priceStreet', {
                          price: formatPrice(t.common, locale, gpu.streetUSD),
                          date: gpu.priceAsOf,
                        })
                      : gpu.msrpUSD !== undefined
                        ? tGpuHub('priceMsrp', { price: formatPrice(t.common, locale, gpu.msrpUSD) })
                        : t.common('none');
                  return (
                    <tr
                      key={gpu.id}
                      data-gpu-id={gpu.id}
                      data-sort-index={index}
                      data-bandwidth={gpu.memBandwidthGBs}
                      {...(rankablePrice(gpu) !== undefined ? { 'data-price': rankablePrice(gpu) } : {})}
                    >
                      <th scope="row">
                        <a href={localeHref(locale, gpuHref(gpu.id))}>{rowLabel(t, row, locale)}</a>
                      </th>
                      <ComboCells
                        combo={row.combo}
                        gpu={gpu}
                        comboLink={
                          isComboIndexable(gpu.id, model.id)
                            ? {
                                href: localeHref(locale, comboHref(model.id, gpu.id)),
                                text: tTable('comboLink', { model: model.name, gpu: gpuName(t.names, gpu) }),
                              }
                            : undefined
                        }
                      />
                      <td className="text-xs">{price}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
          {isReasoning(model) && (
            <p className="text-xs text-muted-foreground">{t.common('reasoningNote')}</p>
          )}
          {krwNote(t.common, locale) && (
            <p className="text-xs text-muted-foreground">{krwNote(t.common, locale)}</p>
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
                        price: formatPrice(t.common, locale, option.priceUSD),
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
