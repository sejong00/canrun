import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { StaticPage, staticPageMetadata } from '@/components/static-page';
import { contentLocaleParams } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';

type Props = { params: Promise<{ locale: Locale }> };

/** 장문(MDX) 페이지 — en·ko 만 생성한다. 부모 레이아웃의 zh 를 덮어쓴다(D109, `contentLocaleParams` 주석) */
export function generateStaticParams() {
  return contentLocaleParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return staticPageMetadata(locale, 'contact');
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StaticPage locale={locale} slug="contact" />;
}
