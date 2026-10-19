import { classifyLicense, type Model } from '@canrun/data';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { licenseTone, Pill } from '@/components/badges';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { ScrollTable, TABLE_CLASS } from '@/components/hub-table';
import { ListControls } from '@/components/islands/list-controls';
import { JsonLd } from '@/components/json-ld';
import { PageShell } from '@/components/page-shell';
import { modelMaker } from '@/content/model-makers';
import type { Locale } from '@/i18n/routing';
import { contextShort, downloadsAsOf, modelListOrder, modelRowData } from '@/lib/browse';
import { SIZE_BUCKETS } from '@/lib/calc/state';
import { catalog } from '@/lib/catalog';
import { formatCompact, formatParams } from '@/lib/format';
import { formatGuideDate } from '@/lib/guides';
import { itemListJsonLd } from '@/lib/jsonld';
import { localeHref, modelHref, modelsHref } from '@/lib/links';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale }> };

/** 표·ItemList 순서 — 인기순 (lib/browse.ts) */
const ORDERED = modelListOrder(catalog.models);

/**
 * 모델 목록 (10-19) — 카탈로그 전 모델을 한 표에. 서버 HTML 에 전 행이 들어가고(크롤러·JS 없는 방문자), 정렬·거르기는
 * `ListControls` 아일랜드가 행을 다시 놓고 숨기기만 한다. 페이지가 쓰는 수치는 데이터 값뿐(추정 없음 — 규칙 3 해당 없음)
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ModelList' });
  const count = catalog.models.length;
  return buildPageMetadata({
    href: modelsHref(),
    locale,
    title: t('metaTitle', { count }),
    description: t('metaDescription', { count }),
  });
}

export default async function ModelListPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'ModelList' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const tTable = await getTranslations({ locale, namespace: 'Table' });
  const tCommon = await getTranslations({ locale, namespace: 'Common' });
  const tShort = await getTranslations({ locale, namespace: 'LicenseShort' });
  const tHub = await getTranslations({ locale, namespace: 'ModelHub' });
  const tSort = await getTranslations({ locale, namespace: 'Sort' });
  const tCalc = await getTranslations({ locale, namespace: 'Calculator' });
  const href = modelsHref();
  const url = absoluteUrl(localeHref(locale, href));
  const count = ORDERED.length;
  const sizes = ORDERED.map((m) => m.paramsB);
  const asOf = downloadsAsOf(ORDERED);
  const asOfText = asOf
    ? asOf.from === asOf.to
      ? formatGuideDate(locale, asOf.to)
      : `${formatGuideDate(locale, asOf.from)}–${formatGuideDate(locale, asOf.to)}`
    : tCommon('none');

  const thinkingLabel = (thinking: Model['thinking']) => {
    switch (thinking) {
      case 'always':
        return t('thinkingAlways');
      case 'default-on':
        return t('thinkingDefaultOn');
      case 'default-off':
        return t('thinkingDefaultOff');
      case 'auto':
        return t('thinkingAuto');
      default:
        return tCommon('none');
    }
  };
  const sizeLabel = { s: tCalc('sizeS'), m: tCalc('sizeM'), l: tCalc('sizeL'), xl: tCalc('sizeXl') } as const;

  return (
    <PageShell locale={locale} href={href}>
      <JsonLd
        data={itemListJsonLd({
          name: t('h1'),
          url,
          items: ORDERED.map((m) => ({ name: m.name, url: absoluteUrl(localeHref(locale, modelHref(m.id))) })),
        })}
      />
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Breadcrumbs
            crumbs={[
              { name: tBreadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
              { name: tBreadcrumb('models'), href: localeHref(locale, href), url },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t('h1')}</h1>
          <p className="text-lg text-muted-foreground">
            {t('intro', {
              count,
              smallest: formatParams(locale, Math.min(...sizes)),
              largest: formatParams(locale, Math.max(...sizes)),
              gpus: catalog.gpus.length,
            })}
          </p>
        </header>

        <section aria-labelledby="models-heading" className="flex flex-col gap-3">
          <h2 id="models-heading" className="text-xl font-semibold tracking-tight">
            {t('tableTitle')}
          </h2>
          <ListControls
            list="models"
            sortLabel={tSort('label')}
            sorts={[
              { value: 'popular', label: t('sortPopular'), announce: t('announcePopular') },
              { value: 'newest', label: t('sortNewest'), key: 'released', desc: true, announce: t('announceNewest') },
              { value: 'downloads', label: t('sortDownloads'), key: 'downloads', desc: true, announce: t('announceDownloads') },
              { value: 'smallest', label: t('sortSmallest'), key: 'params', announce: t('announceSmallest') },
              { value: 'largest', label: t('sortLargest'), key: 'params', desc: true, announce: t('announceLargest') },
            ]}
            selects={[
              {
                name: 'size',
                label: tCalc('filterSize'),
                all: t('sizeAll'),
                options: SIZE_BUCKETS.map((bucket) => ({ value: bucket, label: sizeLabel[bucket] })),
              },
            ]}
            togglesLabel={t('togglesLabel')}
            toggles={[
              { name: 'thinking', label: t('toggleThinking') },
              { name: 'korean', label: t('toggleKorean') },
              { name: 'moe', label: t('toggleMoe') },
            ]}
            shownTemplate={t('shown', { shown: '{shown}', total: count })}
            emptyText={t('empty')}
          />
          <p className="text-xs text-muted-foreground sm:hidden">{tTable('scrollHint')}</p>
          <ScrollTable label={t('tableTitle')}>
            <table data-list="models" className={TABLE_CLASS}>
              <caption>{t('tableCaption', { count })}</caption>
              <thead>
                <tr>
                  <th scope="col">{tTable('model')}</th>
                  <th scope="col">{t('colMaker')}</th>
                  <th scope="col">{t('colParams')}</th>
                  <th scope="col">{t('colReleased')}</th>
                  <th scope="col">{t('colThinking')}</th>
                  <th scope="col">{t('colLicense')}</th>
                  <th scope="col">{t('colContext')}</th>
                  <th scope="col">{t('colDownloads')}</th>
                </tr>
              </thead>
              <tbody>
                {ORDERED.map((model, index) => {
                  const cls = classifyLicense(model.license);
                  return (
                    <tr key={model.id} data-sort-index={index} data-model-id={model.id} {...modelRowData(model)}>
                      <th scope="row" className="min-w-40">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <a href={localeHref(locale, modelHref(model.id))} data-browse-model>
                            {model.name}
                          </a>
                          {model.korean && <Pill tone="info">{tHub('factKorean')}</Pill>}
                        </span>
                      </th>
                      <td className="whitespace-nowrap">{modelMaker(model.hfId)}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {model.activeParamsB !== undefined
                          ? t('paramsMoe', {
                              total: formatParams(locale, model.paramsB),
                              active: formatParams(locale, model.activeParamsB),
                            })
                          : t('paramsDense', { total: formatParams(locale, model.paramsB) })}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{model.releasedAt}</td>
                      <td className="whitespace-nowrap">{thinkingLabel(model.thinking)}</td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Pill tone={licenseTone(cls)}>{tShort(cls)}</Pill>
                          <span className="text-xs text-muted-foreground">{model.license}</span>
                        </span>
                      </td>
                      <td className="tabular-nums">{contextShort(model.maxContext)}</td>
                      <td className="tabular-nums">
                        {model.hfDownloads30d !== undefined ? formatCompact(locale, model.hfDownloads30d) : tCommon('none')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
        </section>

        <section aria-labelledby="read-heading" className="flex flex-col gap-3">
          <h2 id="read-heading" className="text-xl font-semibold tracking-tight">
            {t('readTitle')}
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
            <li>{t('readMaker')}</li>
            <li>{t('readParams')}</li>
            <li>{t('readThinking')}</li>
            <li>{t('readLicense')}</li>
            <li>{t('readDownloads', { date: asOfText })}</li>
            <li>{t('readOrder')}</li>
          </ul>
        </section>
      </article>
    </PageShell>
  );
}
