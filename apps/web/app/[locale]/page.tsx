import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CalcWidget } from '@/components/calc-widget';
import { JsonLd } from '@/components/json-ld';
import { PageShell } from '@/components/page-shell';
import { HTML_LANG } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';
import { catalog } from '@/lib/catalog';
import { webSiteJsonLd } from '@/lib/jsonld';
import { calculatorHref, comboHref, gpuHref, gpusHref, localeHref, modelHref, modelsHref } from '@/lib/links';
import { gpuName, shortGpuName, type Translate } from '@/lib/phrases';
import { HOME_QUICK_PICKS, popularCombos } from '@/lib/popular-combos';
import { buildPageMetadata } from '@/lib/seo';
import { SITE_ALTERNATE_NAMES, absoluteUrl } from '@/lib/site';

type Props = {
  params: Promise<{ locale: Locale }>;
};

/** 홈에서 링크하는 인기 모델 기준 (사이트맵 전 발견 경로 — docs/04 §2 고아 페이지 0) */
const POPULAR_MODEL_MIN = 4;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });

  // CLAUDE.md 규칙 5 — 캐노니컬 자기참조 + hreflang 대칭은 템플릿이 생성한다.
  return buildPageMetadata({
    href: '/',
    locale,
    title: t('metaTitle'),
    description: t('metaDescription'),
    absoluteTitle: true,
  });
}

/**
 * 홈 = 간이 계산기 (docs/04 §2 T1, P1-3 D25): no-JS GET 폼이 `/calculator?gpu=…` 로 보낸다 — 아일랜드 0, JS 예산 유지.
 * datalist 는 카탈로그 표시명 + 별칭. 값 해석은 계산기(별칭·fuzzy)가 한다.
 */
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Home' });
  const tSite = await getTranslations({ locale, namespace: 'Site' });
  const tNames = (await getTranslations({ locale, namespace: 'GpuName' })) as unknown as Translate & {
    has?: (key: string) => boolean;
  };
  const gpus = catalog.gpus.filter((gpu) => gpu.popular);
  const models = catalog.models
    .filter((model) => model.popularity >= POPULAR_MODEL_MIN)
    .sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name));
  const quickPicks = HOME_QUICK_PICKS.map((id) => catalog.gpus.find((g) => g.id === id)).filter((g): g is (typeof catalog.gpus)[number] => g !== undefined);
  const benchCount = catalog.benchmarks.length;
  const calcAction = localeHref(locale, calculatorHref());
  // 많이 찾는 조합 (10-16 D95) — 공개 콤보로만, 링크 텍스트는 콤보 제목과 같은 짧은 GPU 이름 ("RTX 4060에서 gpt-oss-20b")
  const combos = popularCombos();

  return (
    <PageShell locale={locale} href="/">
      <JsonLd
        data={webSiteJsonLd({
          name: tSite('name'),
          alternateName: SITE_ALTERNATE_NAMES,
          url: absoluteUrl(localeHref(locale, '/')),
          inLanguage: HTML_LANG[locale],
          description: t('metaDescription'),
        })}
      />
      <article className="flex flex-col gap-8">
        <h1 className="text-4xl font-semibold tracking-tight text-balance">{t('heading')}</h1>
        <p className="text-lg text-muted-foreground">{t('intro')}</p>

        <CalcWidget locale={locale} idPrefix="home" home />

        <section aria-labelledby="quick-picks" className="flex flex-col gap-3">
          <h2 id="quick-picks" className="text-xl font-semibold tracking-tight">
            {t('popularPicks')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {quickPicks.map((gpu) => (
              <li key={gpu.id}>
                <a href={`${calcAction}?gpu=${gpu.id}`} className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm no-underline hover:bg-muted">
                  {gpuName(tNames, gpu)}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-it-works" className="flex flex-col gap-3">
          <h2 id="how-it-works" className="text-xl font-semibold tracking-tight">
            {t('howTitle')}
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t('how1')}</li>
            <li>{t('how2', { n: benchCount })}</li>
            <li>{t('how3')}</li>
          </ol>
          {/* CLAUDE.md 규칙 3 — 추정치는 항상 밴드+신뢰 라벨. 첫 페이지부터 명시한다. */}
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{t('estimateNotice')}</p>
        </section>

        {combos.length > 0 && (
          <section aria-labelledby="popular-combos" className="flex flex-col gap-3">
            <h2 id="popular-combos" className="text-xl font-semibold tracking-tight">
              {t('popularCombosTitle')}
            </h2>
            <ul className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              {combos.map(({ gpu, model }) => (
                <li key={`${gpu.id}/${model.id}`}>
                  <a href={localeHref(locale, comboHref(model.id, gpu.id))} data-combo-link>
                    {t('popularCombo', { model: model.name, gpu: shortGpuName(gpuName(tNames, gpu)) })}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="browse-gpus" className="flex flex-col gap-3">
          <h2 id="browse-gpus" className="text-xl font-semibold tracking-tight">
            {t('browseGpus')}
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {gpus.map((gpu) => (
              <li key={gpu.id}>
                <a href={localeHref(locale, gpuHref(gpu.id))}>{gpuName(tNames, gpu)}</a>
              </li>
            ))}
          </ul>
          {/* 전체 목록 (10-19) */}
          <p className="text-sm">
            <a href={localeHref(locale, gpusHref())} data-browse-all="gpus">
              {t('allGpus', { count: catalog.gpus.length })}
            </a>
          </p>
        </section>

        <section aria-labelledby="browse-models" className="flex flex-col gap-3">
          <h2 id="browse-models" className="text-xl font-semibold tracking-tight">
            {t('browseModels')}
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {models.map((model) => (
              <li key={model.id}>
                <a href={localeHref(locale, modelHref(model.id))}>{model.name}</a>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            <a href={localeHref(locale, modelsHref())} data-browse-all="models">
              {t('allModels', { count: catalog.models.length })}
            </a>
          </p>
        </section>
      </article>
    </PageShell>
  );
}
