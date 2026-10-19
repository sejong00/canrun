import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageShell } from '@/components/page-shell';
import { CONTENT_LOCALES, contentLocaleParams, isContentLocale } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';
import { formatGuideDate, guideEntry, publishedGuides } from '@/lib/guides';
import { guideHref, guidesHref, localeHref } from '@/lib/links';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale }> };

/**
 * 가이드 목차 (P1-4 D40) — published 가이드만 나열한다. published 가 0편이면 빈 안내 + noindex·미링크(헤더 내비도 숨김)
 * — 초안은 URL 로만 열린다. 장문 로캘(en·ko)만 — zh 목차는 만들지 않는다(D109)
 */
export function generateStaticParams() {
  return contentLocaleParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isContentLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'Guides' });
  return buildPageMetadata({
    href: guidesHref(),
    locale,
    title: t('indexMetaTitle'),
    description: t('indexMetaDescription'),
    noindex: publishedGuides().length === 0,
  });
}

export default async function GuidesIndexPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // 안전망 — zh 는 generateStaticParams 에서 이미 빠진다(D109)
  if (!isContentLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Guides' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const href = guidesHref();
  const guides = publishedGuides();

  return (
    <PageShell locale={locale} href={href} availableIn={CONTENT_LOCALES}>
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Breadcrumbs
            crumbs={[
              { name: tBreadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
              { name: tBreadcrumb('guides'), href: localeHref(locale, href), url: absoluteUrl(localeHref(locale, href)) },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight">{t('indexH1')}</h1>
          <p className="text-lg text-muted-foreground">{t('indexIntro')}</p>
        </header>
        {guides.length === 0 ? (
          <p data-guides-empty className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t('indexEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {guides.map((slug) => {
              const entry = guideEntry(slug);
              const { title, description } = entry.locales[locale];
              return (
                <li key={slug} data-guide-card className="flex flex-col gap-1 rounded-lg border border-border p-4">
                  <a href={localeHref(locale, guideHref(slug))} className="text-lg font-semibold">
                    {title}
                  </a>
                  <p className="text-sm text-muted-foreground">{description}</p>
                  <p className="text-xs text-muted-foreground">{formatGuideDate(locale, entry.dateModified)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </PageShell>
  );
}
