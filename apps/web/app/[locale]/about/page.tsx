import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { StaticPage, staticPageMetadata } from '@/components/static-page';
import type { Locale } from '@/i18n/routing';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return staticPageMetadata(locale, 'about');
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StaticPage locale={locale} slug="about" />;
}
