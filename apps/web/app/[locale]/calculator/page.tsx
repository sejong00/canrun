import { ENGINE_SPEC_VERSION } from '@canrun/engine';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Faq } from '@/components/faq';
import { CalculatorIsland } from '@/components/islands/calculator-island';
import { JsonLd } from '@/components/json-ld';
import { PageShell } from '@/components/page-shell';
import { VerdictLegend } from '@/components/verdict';
import type { Locale } from '@/i18n/routing';
import { getCatalogLite } from '@/lib/calc-catalog';
import { catalog } from '@/lib/catalog';
import { clientDict } from '@/lib/client-messages';
import { CALC_MESSAGE_SPEC } from '@/lib/i18n-lite';
import { softwareApplicationJsonLd } from '@/lib/jsonld';
import { calculatorHref, gpuHref, localeHref, NEW_MODEL_ISSUE_URL } from '@/lib/links';
import { gpuName, type Translate } from '@/lib/phrases';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale }> };

/** `/calculator` (docs/01 F4, docs/04 §2 "AIO 방어 핵심", P1-3 D24) — index, 캐노니컬은 쿼리 없는 경로 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Calculator' });
  return buildPageMetadata({
    href: calculatorHref(),
    locale,
    title: t('metaTitle'),
    description: t('metaDescription', { total: catalog.models.length }),
  });
}

export default async function CalculatorPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Calculator' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const tCommon = await getTranslations({ locale, namespace: 'Common' });
  const tNames = (await getTranslations({ locale, namespace: 'GpuName' })) as unknown as Translate & { has?: (key: string) => boolean };
  const dict = await clientDict(locale, CALC_MESSAGE_SPEC);
  const href = calculatorHref();
  const url = absoluteUrl(localeHref(locale, href));
  const description = t('metaDescription', { total: catalog.models.length });
  const faq = [1, 2, 3].map((i) => ({ question: t(`faq${i}Q`), answer: t(`faq${i}A`) }));
  const popular = catalog.gpus.filter((g) => g.popular).slice(0, 6);

  return (
    <PageShell locale={locale} href={href}>
      <JsonLd
        data={softwareApplicationJsonLd({
          name: t('appName'),
          url,
          description,
          inLanguage: locale,
          version: ENGINE_SPEC_VERSION,
        })}
      />
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Breadcrumbs
            crumbs={[
              { name: tBreadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
              { name: t('crumb'), href: localeHref(locale, href), url },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t('h1')}</h1>
          <p className="text-lg text-muted-foreground">{t('lede')}</p>
        </header>

        <CalculatorIsland locale={locale} catalog={getCatalogLite()} dict={dict} issueUrl={NEW_MODEL_ISSUE_URL} />

        <noscript>
          <p className="rounded-lg border border-border p-4 text-sm">
            {t('noscript')}{' '}
            {popular.map((gpu, i) => (
              <span key={gpu.id}>
                {i > 0 && ' · '}
                <a href={localeHref(locale, gpuHref(gpu.id))}>{gpuName(tNames, gpu)}</a>
              </span>
            ))}
          </p>
        </noscript>

        <VerdictLegend />
        <Faq items={faq} />
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{tCommon('estimateNotice')}</p>
      </article>
    </PageShell>
  );
}
