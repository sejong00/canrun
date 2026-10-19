import { HUB_POLICY, type Gpu } from '@canrun/data';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { ScrollTable, TABLE_CLASS } from '@/components/hub-table';
import { ListControls } from '@/components/islands/list-controls';
import { JsonLd } from '@/components/json-ld';
import { PageShell } from '@/components/page-shell';
import type { Locale } from '@/i18n/routing';
import {
  MEMORY_STEPS_GB,
  cheapestByMemory,
  gpuListGroups,
  gpuRowData,
  msrpOnlyCount,
  type GoodCounts,
  type GpuListGroup,
} from '@/lib/browse';
import { catalog } from '@/lib/catalog';
import { formatGB, formatInt } from '@/lib/format';
import { getGpuHub } from '@/lib/hubs';
import { itemListJsonLd } from '@/lib/jsonld';
import { gpuHref, gpusHref, localeHref } from '@/lib/links';
import { gpuName, type Translate } from '@/lib/phrases';
import { formatPrice, krwNote } from '@/lib/price';
import { macLineList, macLines } from '@/lib/search-names';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale }> };

const GROUPS = gpuListGroups(catalog.gpus);
const CHEAPEST = cheapestByMemory(catalog.gpus);
const MSRP_ONLY = msrpOnlyCount(catalog.gpus);

/**
 * 판정 수 — GPU 허브 "판정 요약" 과 같은 함수·같은 구성(`summarizeGpu` 의 요약 구성: 그래픽카드는 허브 가정 RAM,
 * 통합 메모리·CPU 는 가장 큰 메모리). 쾌적·원활을 따로 보인다(합만 보이면 VRAM 이 같은 카드끼리 같은 숫자가 된다). 허브 캐시를 같이 쓴다
 */
function verdictCounts(gpu: Gpu): { counts: GoodCounts; ramGB: number } {
  const hub = getGpuHub(gpu.id)!;
  const { S, A, B } = hub.counts[hub.primaryIndex]!;
  return { counts: { S, A, B }, ramGB: hub.configs[hub.primaryIndex]!.ramGB };
}

/**
 * GPU 목록 (10-19) — 카탈로그 전 GPU·칩·CPU 프로필을 종류별 표로. 서버 HTML 에 전 행이 들어가고, 정렬은 `ListControls` 가
 * 묶음 안에서만 행을 다시 놓는다. 가격은 GPU 허브와 같은 규칙(실거래가는 priceAsOf 와 함께 — 규칙 2, ko 는 원화 참고값 + 안내)
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'GpuList' });
  return buildPageMetadata({
    href: gpusHref(),
    locale,
    title: t('metaTitle', { count: catalog.gpus.length }),
    description: t('metaDescription', { count: catalog.gpus.length, models: catalog.models.length }),
  });
}

export default async function GpuListPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'GpuList' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const tTable = await getTranslations({ locale, namespace: 'Table' });
  const tCommon = (await getTranslations({ locale, namespace: 'Common' })) as unknown as Translate;
  const tHub = await getTranslations({ locale, namespace: 'GpuHub' });
  const tSort = await getTranslations({ locale, namespace: 'Sort' });
  const tNames = (await getTranslations({ locale, namespace: 'GpuName' })) as unknown as Translate & { has?: (key: string) => boolean };
  const tMac = (await getTranslations({ locale, namespace: 'MacProduct' })) as unknown as Translate;
  const href = gpusHref();
  const url = absoluteUrl(localeHref(locale, href));
  const models = catalog.models.length;

  const groupTitle = (group: GpuListGroup) => {
    switch (group) {
      case 'nvidia':
        return t('groupNvidia');
      case 'amd':
        return t('groupAmd');
      case 'intel':
        return t('groupIntel');
      case 'laptop':
        return t('groupLaptop');
      case 'apple':
        return t('groupApple');
      case 'apu':
        return t('groupApu');
      case 'cpu':
        return t('groupCpu');
    }
  };
  const groupNote = (group: GpuListGroup) => {
    switch (group) {
      case 'laptop':
        return t('noteLaptop');
      case 'apple':
        return t('noteApple');
      case 'apu':
        return t('noteApu');
      case 'cpu':
        return t('noteCpu');
      default:
        return undefined;
    }
  };
  const memory = (gpu: Gpu) =>
    gpu.kind === 'dgpu'
      ? tHub('memoryVram', { vram: formatInt(locale, gpu.vramGB ?? 0) })
      : (gpu.ramOptionsGB ?? []).map((ram) => tHub('ramOption', { ram: formatInt(locale, ram) })).join(' · ');
  // 통합 메모리 PC 의 출시가는 가장 큰 메모리 구성의 완제품 값(data/gpus.json note·출처) — 어느 구성인지 함께 적는다
  const price = (gpu: Gpu) =>
    gpu.streetUSD !== undefined && gpu.priceAsOf
      ? tHub('priceStreet', { price: formatPrice(tCommon, locale, gpu.streetUSD), date: gpu.priceAsOf })
      : gpu.msrpUSD !== undefined
        ? gpu.kind === 'unified' && gpu.ramOptionsGB?.length
          ? t('priceMsrpConfig', { price: formatPrice(tCommon, locale, gpu.msrpUSD), ram: formatInt(locale, gpu.ramOptionsGB.at(-1)!) })
          : tHub('priceMsrp', { price: formatPrice(tCommon, locale, gpu.msrpUSD) })
        : tCommon('none');
  const countCell = (gpu: Gpu) => {
    const { counts, ramGB } = verdictCounts(gpu);
    const ram = formatInt(locale, ramGB);
    if (gpu.kind === 'cpu') return t('runsAt', { runs: counts.S + counts.A + counts.B, ram });
    return gpu.kind === 'dgpu' ? t('good', { great: counts.S, well: counts.A }) : t('goodAt', { great: counts.S, well: counts.A, ram });
  };
  const note = krwNote(tCommon, locale);

  return (
    <PageShell locale={locale} href={href}>
      <JsonLd
        data={itemListJsonLd({
          name: t('h1'),
          url,
          items: GROUPS.flatMap(({ gpus }) =>
            gpus.map((gpu) => ({ name: gpuName(tNames, gpu), url: absoluteUrl(localeHref(locale, gpuHref(gpu.id))) })),
          ),
        })}
      />
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Breadcrumbs
            crumbs={[
              { name: tBreadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
              { name: tBreadcrumb('gpus'), href: localeHref(locale, href), url },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t('h1')}</h1>
          <p className="text-lg text-muted-foreground">{t('intro', { count: catalog.gpus.length, models })}</p>
          <nav aria-label={t('jumpLabel')} className="text-sm">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {GROUPS.map(({ group, gpus }) => (
                <li key={group}>
                  <a href={`#group-${group}`}>
                    {groupTitle(group)} ({formatInt(locale, gpus.length)})
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        {CHEAPEST.length > 0 && (
          <section aria-labelledby="cheapest-heading" className="flex flex-col gap-3">
            <h2 id="cheapest-heading" className="text-xl font-semibold tracking-tight">
              {t('cheapTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('cheapIntro')}</p>
            <ScrollTable label={t('cheapTitle')}>
              <table data-cheapest-by-memory className={TABLE_CLASS}>
                <caption>{t('cheapCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colVram')}</th>
                    <th scope="col">{t('colCheapest')}</th>
                    <th scope="col">{tTable('price')}</th>
                    <th scope="col">{t('colGood')}</th>
                  </tr>
                </thead>
                <tbody>
                  {CHEAPEST.map(({ vramGB, gpu, usd, asOf }) => {
                    const { counts } = verdictCounts(gpu);
                    return (
                      <tr key={vramGB} data-cheapest-vram={vramGB}>
                        <th scope="row" className="whitespace-nowrap tabular-nums">
                          {tHub('memoryVram', { vram: formatInt(locale, vramGB) })}
                        </th>
                        <td>
                          <a href={localeHref(locale, gpuHref(gpu.id))} data-cheapest-gpu={gpu.id}>
                            {gpuName(tNames, gpu)}
                          </a>
                        </td>
                        <td className="text-xs">{tHub('priceStreet', { price: formatPrice(tCommon, locale, usd), date: asOf })}</td>
                        <td className="whitespace-nowrap tabular-nums">{t('good', { great: counts.S, well: counts.A })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          </section>
        )}

        <ListControls
          list="gpus"
          sortLabel={tSort('label')}
          sorts={[
            { value: 'lineup', label: t('sortDefault'), announce: t('announceDefault') },
            { value: 'memory', label: t('sortMemory'), key: 'memory', desc: true, announce: t('announceMemory') },
            { value: 'bandwidth', label: tSort('bandwidth'), key: 'bandwidth', desc: true, announce: t('announceBandwidth') },
            { value: 'price', label: tSort('price'), key: 'price', announce: t('announcePrice', { msrpOnly: MSRP_ONLY }) },
            { value: 'good', label: t('sortGood'), key: 'great', then: ['good', 'runs'], desc: true, announce: t('announceGood') },
          ]}
          selects={[
            {
              name: 'memory',
              label: t('filterMemory'),
              all: t('memoryAll'),
              compare: 'min',
              options: MEMORY_STEPS_GB.map((gb) => ({ value: String(gb), label: t('memoryAtLeast', { gb: formatInt(locale, gb) }) })),
            },
          ]}
          shownTemplate={t('shown', { shown: '{shown}', total: catalog.gpus.length })}
          emptyText={t('empty')}
        />

        {GROUPS.map(({ group, gpus }) => {
          const title = groupTitle(group);
          const groupNoteText = groupNote(group);
          return (
            <section
              key={group}
              id={`group-${group}`}
              aria-labelledby={`group-${group}-heading`}
              data-list-section
              className="flex scroll-mt-4 flex-col gap-3"
            >
              <h2 id={`group-${group}-heading`} className="text-xl font-semibold tracking-tight">
                {title}
              </h2>
              {groupNoteText && <p className="text-sm text-muted-foreground">{groupNoteText}</p>}
              <ScrollTable label={title}>
                <table data-list="gpus" data-gpu-group={group} className={TABLE_CLASS}>
                  <caption>{t('groupCount', { count: gpus.length })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{tTable('hardware')}</th>
                      <th scope="col">{tTable('memory')}</th>
                      <th scope="col">{tHub('specBandwidth')}</th>
                      <th scope="col">{tTable('price')}</th>
                      <th scope="col">{group === 'cpu' ? t('colRuns') : t('colGood')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gpus.map((gpu, index) => {
                      const macs = macLines(gpu);
                      return (
                        <tr key={gpu.id} data-sort-index={index} data-gpu-id={gpu.id} {...gpuRowData(gpu, verdictCounts(gpu).counts)}>
                          <th scope="row">
                            <a href={localeHref(locale, gpuHref(gpu.id))} data-browse-gpu>
                              {gpuName(tNames, gpu)}
                            </a>
                            {macs.length > 0 && (
                              <span className="block text-xs font-normal text-muted-foreground">{macLineList(tMac, macs)}</span>
                            )}
                          </th>
                          <td className="tabular-nums">{memory(gpu)}</td>
                          <td className="whitespace-nowrap tabular-nums">
                            {tHub('specBandwidthValue', {
                              // 구성마다 대역폭이 다른 칩(10-20 Apple M6)은 가장 낮은 값–가장 높은 값 (GPU 허브 사양 표와 같다)
                              value: gpu.memBandwidthByRam
                                ? tCommon('range', {
                                    low: formatGB(locale, Math.min(...gpu.memBandwidthByRam.map((b) => b.memBandwidthGBs))),
                                    high: formatGB(locale, gpu.memBandwidthGBs),
                                  })
                                : formatGB(locale, gpu.memBandwidthGBs),
                            })}
                          </td>
                          <td className="text-xs">{price(gpu)}</td>
                          <td className="whitespace-nowrap tabular-nums" data-good-cell>
                            {countCell(gpu)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollTable>
            </section>
          );
        })}

        {note && <p className="text-xs text-muted-foreground">{note}</p>}

        <section aria-labelledby="read-heading" className="flex flex-col gap-3">
          <h2 id="read-heading" className="text-xl font-semibold tracking-tight">
            {t('readTitle')}
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
            <li>{t('readMemory')}</li>
            <li>{t('readBandwidth')}</li>
            <li>{t('readPrice')}</li>
            <li>{t('readCount', { models, ram: formatInt(locale, HUB_POLICY.dgpuRamGB) })}</li>
          </ul>
        </section>
      </article>
    </PageShell>
  );
}
