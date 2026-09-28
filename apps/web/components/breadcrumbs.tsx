import { useTranslations } from 'next-intl';
import { JsonLd } from '@/components/json-ld';
import { breadcrumbJsonLd } from '@/lib/jsonld';

/**
 * 2단 브레드크럼 (결정 D7) — 가시 nav 와 BreadcrumbList JSON-LD 를 같은 데이터로 만든다.
 * `url` 은 절대 URL(JSON-LD), `href` 는 내부 경로(링크).
 */
export function Breadcrumbs({
  crumbs,
}: {
  crumbs: ReadonlyArray<{ name: string; href: string; url: string }>;
}) {
  const t = useTranslations('Breadcrumb');
  return (
    <>
      <nav aria-label={t('label')} className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={crumb.url} className="flex items-center gap-1.5">
                {last ? (
                  <span aria-current="page" className="text-foreground">
                    {crumb.name}
                  </span>
                ) : (
                  <a href={crumb.href} className="underline underline-offset-4 hover:text-foreground">
                    {crumb.name}
                  </a>
                )}
                {!last && <span aria-hidden="true">›</span>}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd data={breadcrumbJsonLd(crumbs.map(({ name, url }) => ({ name, url })))} />
    </>
  );
}
