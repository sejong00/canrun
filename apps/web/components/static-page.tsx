import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Threshold } from '@/components/guide/guide-components';
import { PageShell } from '@/components/page-shell';
import { CatalogAdditions, Update } from '@/components/updates';
import type { StaticPageSlug } from '@/content/pages';
import { CONTENT_LOCALES, isContentLocale } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';
import { DATA_UPDATED } from '@/lib/data-meta';
import { formatGuideDate } from '@/lib/guides';
import { localeHref, staticHref } from '@/lib/links';
import { loadPageBody } from '@/lib/pages';
import { buildPageMetadata } from '@/lib/seo';
import { CONTACT_EMAIL, absoluteUrl } from '@/lib/site';

type PagesT = Awaited<ReturnType<typeof getTranslations<'Pages'>>>;

/** 제목·설명 — 리터럴 키(메시지 정적 검사·타입) */
function pageText(t: PagesT, slug: StaticPageSlug): { title: string; description: string } {
  switch (slug) {
    case 'about':
      return { title: t('aboutTitle'), description: t('aboutDescription') };
    case 'methodology':
      return { title: t('methodologyTitle'), description: t('methodologyDescription') };
    case 'updates':
      return { title: t('updatesTitle'), description: t('updatesDescription') };
    case 'privacy':
      return { title: t('privacyTitle'), description: t('privacyDescription') };
    case 'terms':
      return { title: t('termsTitle'), description: t('termsDescription') };
    case 'contact':
      return { title: t('contactTitle'), description: t('contactDescription') };
  }
}

export async function staticPageMetadata(locale: Locale, slug: StaticPageSlug): Promise<Metadata> {
  if (!isContentLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'Pages' });
  return buildPageMetadata({ href: staticHref(slug), locale, ...pageText(t, slug) });
}

/** 문의 이메일 — 주소는 `lib/site.ts` 한 곳에서 (MDX 에 직접 쓰지 않는다) */
function ContactEmail() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

/** 데이터 기준일 (`data/meta.json`) — 로캘 날짜 형식 */
function DataUpdated() {
  const locale = useLocale() as Locale;
  return <>{formatGuideDate(locale, DATA_UPDATED)}</>;
}

/** 사이트 내부 링크 — `to` 는 로캘 없는 경로(`/methodology`, `/calculator`). ko 페이지면 `/ko/…` 로 바꾼다 */
function SiteLink({ to, children }: { to: string; children: ReactNode }) {
  const locale = useLocale() as Locale;
  if (!to.startsWith('/') || to.startsWith('//')) throw new Error(`static page SiteLink: "${to}" is not an internal path`);
  return <a href={localeHref(locale, to)}>{children}</a>;
}

/** 업데이트 소식(10-14 D72)의 `Update`·`CatalogAdditions` 도 같은 맵 — 다른 정적 페이지 MDX 는 쓰지 않는다 */
const PAGE_MDX_COMPONENTS = { Threshold, ContactEmail, DataUpdated, SiteLink, Update, CatalogAdditions };

/**
 * 정적 페이지 (P1-5 — 소개·계산 방법·개인정보처리방침·문의, 10-14 업데이트 소식 D72, 10-25 이용약관 D126). 본문 = 로캘별 MDX(`content/{en,ko}/pages`), 클라이언트 JS 0.
 * 라우트 폴더 6개가 이 컴포넌트를 공유한다(동적 세그먼트를 두면 다른 최상위 경로와 겹친다).
 * 장문 로캘(en·ko)만 — 각 라우트가 `generateStaticParams = contentLocaleParams` 로 zh 를 뺀다(D109). 아래 notFound 는 안전망
 */
export async function StaticPage({ locale, slug }: { locale: Locale; slug: StaticPageSlug }) {
  if (!isContentLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Pages' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const Body = await loadPageBody(slug, locale);
  const href = staticHref(slug);
  const url = absoluteUrl(localeHref(locale, href));
  const { title } = pageText(t, slug);

  return (
    <PageShell locale={locale} href={href} availableIn={CONTENT_LOCALES}>
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Breadcrumbs
            crumbs={[
              { name: tBreadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
              { name: title, href: localeHref(locale, href), url },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
        </header>
        <div data-static-body className="flex max-w-3xl flex-col gap-5">
          <Body components={PAGE_MDX_COMPONENTS} />
        </div>
      </article>
    </PageShell>
  );
}
