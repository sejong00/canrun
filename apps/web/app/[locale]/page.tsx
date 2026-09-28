import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell } from '@/components/page-shell';
import type { Locale } from '@/i18n/routing';
import { catalog } from '@/lib/catalog';
import { gpuHref, localeHref, modelHref } from '@/lib/links';
import { gpuName, type Translate } from '@/lib/phrases';
import { buildPageMetadata } from '@/lib/seo';

type Props = {
  params: Promise<{ locale: Locale }>;
};

/** 홈에서 링크하는 인기 모델 기준 (사이트맵 전 발견 경로 — docs/04 §2 고아 페이지 0) */
const POPULAR_MODEL_MIN = 4;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });

  // CLAUDE.md 규칙 5 — 캐노니컬 자기참조 + hreflang 대칭은 템플릿이 생성한다.
  return buildPageMetadata({
    href: '/',
    locale,
    title: t('metaTitle'),
    description: t('metaDescription'),
    absoluteTitle: true,
  });
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Home' });
  const tNames = (await getTranslations({ locale, namespace: 'GpuName' })) as unknown as Translate & {
    has?: (key: string) => boolean;
  };
  const gpus = catalog.gpus.filter((gpu) => gpu.popular);
  const models = catalog.models
    .filter((model) => model.popularity >= POPULAR_MODEL_MIN)
    .sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name));

  return (
    <PageShell locale={locale} href="/">
      <article className="flex flex-col gap-8">
        <p className="text-sm font-medium text-muted-foreground">{t('status')}</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">{t('heading')}</h1>
        <p className="text-lg text-muted-foreground">{t('intro')}</p>
        {/* CLAUDE.md 규칙 3 — 추정치는 항상 밴드+신뢰 라벨. 첫 페이지부터 명시한다. */}
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          {t('estimateNotice')}
        </p>

        <section aria-labelledby="browse-gpus" className="flex flex-col gap-3">
          <h2 id="browse-gpus" className="text-xl font-semibold tracking-tight">
            {t('browseGpus')}
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {gpus.map((gpu) => (
              <li key={gpu.id}>
                <a href={localeHref(locale, gpuHref(gpu.id))}>{gpuName(tNames, gpu)}</a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="browse-models" className="flex flex-col gap-3">
          <h2 id="browse-models" className="text-xl font-semibold tracking-tight">
            {t('browseModels')}
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {models.map((model) => (
              <li key={model.id}>
                <a href={localeHref(locale, modelHref(model.id))}>{model.name}</a>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </PageShell>
  );
}
