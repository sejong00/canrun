import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import NextLink from 'next/link';
import { Button } from '@/components/ui/button';
import { getPathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { buildAlternates } from '@/lib/seo';

type Props = {
  params: Promise<{ locale: Locale }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });

  return {
    title: { absolute: t('metaTitle') },
    description: t('metaDescription'),
    // CLAUDE.md 규칙 5 — 캐노니컬 자기참조 + hreflang 대칭은 템플릿이 생성한다.
    alternates: buildAlternates('/', locale),
  };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Home' });
  const tSwitcher = await getTranslations({ locale, namespace: 'LocaleSwitcher' });
  const other = routing.locales.find((candidate) => candidate !== locale) ?? routing.defaultLocale;

  return (
    <article className="flex flex-col gap-6">
      <p className="text-sm font-medium text-muted-foreground">{t('status')}</p>
      <h1 className="text-4xl font-semibold tracking-tight text-balance">{t('heading')}</h1>
      <p className="text-lg text-muted-foreground">{t('intro')}</p>
      {/* CLAUDE.md 규칙 3 — 추정치는 항상 밴드+신뢰 라벨. 첫 페이지부터 명시한다. */}
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        {t('estimateNotice')}
      </p>
      <div>
        <Button asChild variant="outline">
          {/* 로케일 전환 링크 — i18n/navigation.ts 주석 참조 (en 무프리픽스 유지) */}
          <NextLink href={getPathname({ href: '/', locale: other })} hrefLang={other}>
            {tSwitcher(other)}
          </NextLink>
        </Button>
      </div>
    </article>
  );
}
