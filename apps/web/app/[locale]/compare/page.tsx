import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageShell } from '@/components/page-shell';
import { COMPARE_GROUPS, COMPARES, publishedCompares, type CompareGroup } from '@/content/compares';
import type { Locale } from '@/i18n/routing';
import { cardSpeedText, compareNameWithMemory, compareNames, type CompareTranslators } from '@/lib/compare-phrases';
import { getCompare } from '@/lib/compares';
import { compareHref, comparesHref, localeHref } from '@/lib/links';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale }> };

const GROUP_KEY: Readonly<Record<CompareGroup, string>> = {
  entry: 'groupEntry',
  midrange: 'groupMidrange',
  'high-end': 'groupHighEnd',
  'cross-platform': 'groupCrossPlatform',
};

/**
 * GPU 비교 목차 (10-19 D103) — published 쌍만 묶음별로. published 가 0이면 빈 안내 + noindex·미링크(가이드 목차와 같은 규칙, D40)
 * — 초안은 URL 로만 열린다. 헤더 내비 링크는 v1 에 두지 않는다(GPU 허브의 비교 블록이 입구)
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Compare' });
  return buildPageMetadata({
    href: comparesHref(),
    locale,
    title: t('indexMetaTitle'),
    description: t('indexMetaDescription'),
    noindex: publishedCompares().length === 0,
  });
}

export default async function CompareIndexPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [compare, hub, common, confidence, combo, names, breadcrumb] = await Promise.all([
    getTranslations({ locale, namespace: 'Compare' }),
    getTranslations({ locale, namespace: 'GpuHub' }),
    getTranslations({ locale, namespace: 'Common' }),
    getTranslations({ locale, namespace: 'Confidence' }),
    getTranslations({ locale, namespace: 'Combo' }),
    getTranslations({ locale, namespace: 'GpuName' }),
    getTranslations({ locale, namespace: 'Breadcrumb' }),
  ]);
  const t = { compare, hub, common, confidence, combo, names } as unknown as CompareTranslators;
  const href = comparesHref();
  const published = publishedCompares();
  const groups = COMPARE_GROUPS.map((group) => ({ group, slugs: published.filter((slug) => COMPARES[slug].group === group) })).filter(
    (g) => g.slugs.length > 0,
  );

  return (
    <PageShell locale={locale} href={href}>
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Breadcrumbs
            crumbs={[
              { name: breadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
              { name: breadcrumb('compare'), href: localeHref(locale, href), url: absoluteUrl(localeHref(locale, href)) },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight">{compare('indexH1')}</h1>
          <p className="text-lg text-muted-foreground">{compare('indexIntro')}</p>
        </header>
        {groups.length === 0 ? (
          <p data-compares-empty className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {compare('indexEmpty')}
          </p>
        ) : (
          groups.map(({ group, slugs }) => (
            <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-3">
              <h2 id={`group-${group}`} className="text-xl font-semibold tracking-tight">
                {compare(GROUP_KEY[group])}
              </h2>
              <ul className="flex flex-col gap-3">
                {slugs.map((slug) => {
                  const { cmp } = getCompare(slug)!;
                  const pair = compareNames(t, locale, cmp);
                  const speed = cardSpeedText(t, locale, cmp, pair);
                  return (
                    <li key={slug} data-compare-card className="flex flex-col gap-1 rounded-lg border border-border p-4">
                      <a href={localeHref(locale, compareHref(slug))} className="text-lg font-semibold">
                        {compare('cardTitle', pair)}
                      </a>
                      {speed && <p className="text-sm">{speed}</p>}
                      <p className="text-sm text-muted-foreground">
                        {compare('cardCounts', {
                          a: compareNameWithMemory(t, locale, cmp.a),
                          b: compareNameWithMemory(t, locale, cmp.b),
                          goodA: cmp.a.counts.S + cmp.a.counts.A,
                          goodB: cmp.b.counts.S + cmp.b.counts.A,
                          total: cmp.rows.length,
                        })}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </article>
    </PageShell>
  );
}
