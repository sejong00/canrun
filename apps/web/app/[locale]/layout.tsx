import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { STATIC_PAGE_SLUGS, type StaticPageSlug } from '@/content/pages';
import { routing, type Locale } from '@/i18n/routing';
import { DATA_UPDATED } from '@/lib/data-meta';
import { formatGuideDate } from '@/lib/guides';
import { gpusHref, localeHref, modelsHref, staticHref } from '@/lib/links';
import { ADSENSE_CLIENT, SEARCH_VERIFICATION, SITE_URL } from '@/lib/site';
import '../globals.css';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

/** docs/05 §3 — 정적 export 이므로 모든 로케일을 빌드 타임에 열거한다. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Omit<Props, 'children'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Site' });

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t('name'), template: `%s — ${t('name')}` },
    // 검색엔진 소유 확인 (P1-5) — 코드가 있을 때만 메타 태그
    ...(SEARCH_VERIFICATION.google || SEARCH_VERIFICATION.naver
      ? {
          verification: {
            ...(SEARCH_VERIFICATION.google ? { google: SEARCH_VERIFICATION.google } : {}),
            ...(SEARCH_VERIFICATION.naver ? { other: { 'naver-site-verification': SEARCH_VERIFICATION.naver } } : {}),
          },
        }
      : {}),
    // AdSense 사이트 확인 (Phase 1.5) — 스크립트 없이 메타 태그만. 게시자 ID 가 있을 때만
    ...(ADSENSE_CLIENT ? { other: { 'google-adsense-account': ADSENSE_CLIENT } } : {}),
  };
}

/**
 * 헤더(로케일 전환 포함)는 페이지 경로를 아는 PageShell 이 그린다.
 * NextIntlClientProvider 는 두지 않는다 — 클라이언트에서 번역을 쓰는 컴포넌트가 없고, 두면
 * 모든 페이지에 messages 전체와 intl-messageformat 번들이 실린다 (결정 D6, JS 예산 docs/01 §7).
 * 클라이언트 컴포넌트가 번역이 필요해지면 그 서브트리에만 필요한 네임스페이스로 프로바이더를 둔다.
 */
export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // 정적 렌더링 활성화 (next-intl): 이게 없으면 동적 렌더링으로 떨어져 export 가 실패한다.
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Site' });
  const tFooter = await getTranslations({ locale, namespace: 'Footer' });
  const footerLabel = (slug: StaticPageSlug) => {
    switch (slug) {
      case 'about':
        return tFooter('about');
      case 'methodology':
        return tFooter('methodology');
      case 'updates':
        return tFooter('updates');
      case 'privacy':
        return tFooter('privacy');
      case 'contact':
        return tFooter('contact');
    }
  };

  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        {children}
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
            <p>{t('tagline')}</p>
            {/* 모델·GPU 목록 (10-19) — 헤더 내비와 같은 입구를 페이지 끝에도 */}
            <nav aria-label={tFooter('browse')}>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                <li>
                  <a href={localeHref(locale as Locale, modelsHref())} data-footer-link="models" className="underline underline-offset-4 hover:text-foreground">
                    {tFooter('models')}
                  </a>
                </li>
                <li>
                  <a href={localeHref(locale as Locale, gpusHref())} data-footer-link="gpus" className="underline underline-offset-4 hover:text-foreground">
                    {tFooter('gpus')}
                  </a>
                </li>
              </ul>
            </nav>
            {/* 정적 페이지 링크 (P1-5 — 고아 방지·AdSense 필수 페이지) + 데이터 기준일 (docs/01 §7) */}
            <nav aria-label={tFooter('nav')}>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {STATIC_PAGE_SLUGS.map((slug) => (
                  <li key={slug}>
                    <a href={localeHref(locale as Locale, staticHref(slug))} data-footer-link={slug} className="underline underline-offset-4 hover:text-foreground">
                      {footerLabel(slug)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <p data-data-updated={DATA_UPDATED}>{tFooter('dataUpdated', { date: formatGuideDate(locale as Locale, DATA_UPDATED) })}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
