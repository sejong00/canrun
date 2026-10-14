import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { SITE_UPDATES } from '@/content/updates';
import type { Locale } from '@/i18n/routing';
import { catalog } from '@/lib/catalog';
import { formatParams } from '@/lib/format';
import { formatGuideDate } from '@/lib/guides';
import { localeHref, modelHref } from '@/lib/links';
import { catalogAdditions } from '@/lib/updates';

/**
 * 업데이트 소식 페이지(`/updates`, 10-14 D72)의 MDX 컴포넌트 — 서버 전용, 클라이언트 JS 0.
 *
 * - `<Update id="…">`: 바뀐 기능 한 건. 날짜는 레지스트리(`content/updates.ts`)에서 읽어 그린다 — MDX 에 날짜를 손으로 쓰지 않는다.
 *   본문(### 제목 + 문단)은 MDX 가 children 으로 넘긴다. 레지스트리에 없는 id 면 빌드 실패.
 * - `<CatalogAdditions />`: `data/models.json` 의 addedAt 날짜별 모델 목록(최신 날짜가 위) — 모델 허브 링크.
 */
export function Update({ id, children }: { id: string; children: ReactNode }) {
  const locale = useLocale() as Locale;
  const entry = SITE_UPDATES.find((u) => u.id === id);
  if (!entry) throw new Error(`updates MDX: unknown <Update id="${id}"> — add it to apps/web/content/updates.ts`);
  return (
    <section id={id} data-update={id} className="flex flex-col gap-3 border-l-2 border-border pl-4 [&>h3]:mt-0">
      <p className="text-sm text-muted-foreground">
        <time dateTime={entry.date}>{formatGuideDate(locale, entry.date)}</time>
      </p>
      {children}
    </section>
  );
}

export function CatalogAdditions() {
  const locale = useLocale() as Locale;
  const t = useTranslations('Updates');
  const tHub = useTranslations('ModelHub');
  const groups = catalogAdditions(catalog.models);
  return (
    <div data-catalog-additions className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t('catalogTotal', { count: catalog.models.length })}</p>
      {groups.map((group) => (
        <section key={group.date} data-added-on={group.date} aria-labelledby={`added-${group.date}`} className="flex flex-col gap-2">
          <h3 id={`added-${group.date}`} className="text-lg font-semibold">
            <time dateTime={group.date}>{formatGuideDate(locale, group.date)}</time>
            <span className="font-normal text-muted-foreground"> · {t('addedCount', { count: group.models.length })}</span>
          </h3>
          <ul className="grid gap-x-6 gap-y-1 leading-7 sm:grid-cols-2">
            {group.models.map((model) => (
              <li key={model.id}>
                <a href={localeHref(locale, modelHref(model.id))} data-added-model={model.id} className="underline underline-offset-4">
                  {model.name}
                </a>{' '}
                <span className="text-sm text-muted-foreground">
                  {model.activeParamsB !== undefined
                    ? tHub('paramsMoe', { total: formatParams(locale, model.paramsB), active: formatParams(locale, model.activeParamsB) })
                    : tHub('paramsDense', { total: formatParams(locale, model.paramsB) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
