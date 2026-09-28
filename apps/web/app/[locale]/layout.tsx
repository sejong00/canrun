import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
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

  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        {children}
        <footer className="border-t border-border">
          <p className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
            {t('tagline')}
          </p>
        </footer>
      </body>
    </html>
  );
}
