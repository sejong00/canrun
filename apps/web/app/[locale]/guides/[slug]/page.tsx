import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { CalcWidget } from '@/components/calc-widget';
import { GUIDE_MDX_COMPONENTS } from '@/components/guide/guide-components';
import { JsonLd } from '@/components/json-ld';
import { PageShell } from '@/components/page-shell';
import { GUIDE_SLUGS } from '@/content/guides';
import { CONTENT_LOCALES, HTML_LANG, isContentLocale } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';
import { formatGuideDate, guideEntry, guideOgImagePath, isGuideSlug, isPublished, loadGuideBody } from '@/lib/guides';
import { articleJsonLd } from '@/lib/jsonld';
import { guideHref, guidesHref, localeHref } from '@/lib/links';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale; slug: string }> };

/**
 * 전 슬러그 생성 — 초안도 URL 로 열려야 감수할 수 있다 (P1-4 D40: 초안 = noindex + 미링크).
 * 장문 로캘(en·ko)만 — 부모 레이아웃의 `locale` 을 덮어써 zh 가이드는 만들지 않는다(D109, `contentLocaleParams` 주석)
 */
export function generateStaticParams() {
  return CONTENT_LOCALES.flatMap((locale) => GUIDE_SLUGS.map((slug) => ({ locale, slug })));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isContentLocale(locale) || !isGuideSlug(slug)) return {};
  const entry = guideEntry(slug);
  return buildPageMetadata({
    href: guideHref(slug),
    locale,
    title: entry.locales[locale].title,
    description: entry.locales[locale].description,
    noindex: !isPublished(slug),
    article: { publishedTime: entry.datePublished, modifiedTime: entry.dateModified },
    ogImage: guideOgImagePath(slug, locale),
  });
}

/**
 * 가이드 (docs/04 §2·§5·§9, P1-4 D37~D45) — 제목·바이라인·본문(MDX, 로캘별 별도 집필)·계산기 위젯·관련 가이드.
 * 본문 수치는 전부 데이터 컴포넌트(`components/guide`)가 그린다 — 산문에 숫자를 쓰지 않는다 (D43).
 */
export default async function GuidePage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  // 안전망 — zh 는 generateStaticParams 에서 이미 빠진다(D109)
  if (!isContentLocale(locale) || !isGuideSlug(slug)) notFound();
  const entry = guideEntry(slug);
  const t = await getTranslations({ locale, namespace: 'Guides' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const Body = await loadGuideBody(slug, locale);
  const href = guideHref(slug);
  const url = absoluteUrl(localeHref(locale, href));
  const { title, description } = entry.locales[locale];
  const related = entry.related.filter(isPublished);

  return (
    <PageShell locale={locale} href={href} availableIn={CONTENT_LOCALES}>
      <JsonLd
        data={articleJsonLd({
          headline: title,
          description,
          url,
          inLanguage: HTML_LANG[locale],
          datePublished: entry.datePublished,
          dateModified: entry.dateModified,
          author: entry.author,
          siteUrl: absoluteUrl(localeHref(locale, '/')),
          // og:image 와 같은 카드 (10-16 D96)
          image: absoluteUrl(guideOgImagePath(slug, locale)),
        })}
      />
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Breadcrumbs
            crumbs={[
              { name: tBreadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
              { name: tBreadcrumb('guides'), href: localeHref(locale, guidesHref()), url: absoluteUrl(localeHref(locale, guidesHref())) },
              { name: title, href: localeHref(locale, href), url },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {t('byline', { author: entry.author, date: formatGuideDate(locale, entry.dateModified) })}
          </p>
          {!isPublished(slug) && (
            <p data-guide-draft className="rounded-lg border border-verdict-b-fg/40 bg-verdict-b-bg p-3 text-sm text-verdict-b-fg">
              {t('draftNotice')}
            </p>
          )}
        </header>

        <div data-guide-body className="flex max-w-3xl flex-col gap-5">
          <Body components={GUIDE_MDX_COMPONENTS} />
        </div>

        <p className="max-w-3xl rounded-lg border border-border p-4 text-sm text-muted-foreground">{t('dataNote')}</p>

        <CalcWidget locale={locale} idPrefix="guide" heading={t('widgetTitle')} />

        {related.length > 0 && (
          <section aria-labelledby="related-guides" className="flex flex-col gap-3">
            <h2 id="related-guides" className="text-xl font-semibold tracking-tight">
              {t('relatedTitle')}
            </h2>
            <ul className="flex flex-col gap-2">
              {related.map((other) => (
                <li key={other}>
                  <a href={localeHref(locale, guideHref(other))}>{guideEntry(other).locales[locale].title}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </PageShell>
  );
}
