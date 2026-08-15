import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import NextLink from 'next/link';
import { getPathname, Link } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site';
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
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // 정적 렌더링 활성화 (next-intl): 이게 없으면 동적 렌더링으로 떨어져 export 가 실패한다.
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Site' });
  const tSwitcher = await getTranslations({ locale, namespace: 'LocaleSwitcher' });

  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <header className="border-b border-border">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
              <Link href="/" className="font-semibold tracking-tight">
                {t('name')}
              </Link>
              <nav aria-label={tSwitcher('label')} className="flex items-center gap-3 text-sm">
                {routing.locales.map((target) => (
                  // 로케일 전환 링크 — i18n/navigation.ts 주석 참조 (en 무프리픽스 유지)
                  <NextLink
                    key={target}
                    href={getPathname({ href: '/', locale: target })}
                    hrefLang={target}
                    aria-current={target === locale ? 'page' : undefined}
                    className={
                      target === locale
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }
                  >
                    {tSwitcher(target as Locale)}
                  </NextLink>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-3xl px-6 py-16">{children}</main>
          <footer className="border-t border-border">
            <p className="mx-auto max-w-3xl px-6 py-6 text-sm text-muted-foreground">
              {t('tagline')}
            </p>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
