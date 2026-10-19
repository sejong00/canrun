import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { VerdictSprite } from '@/components/verdict';
import { routing, type Locale } from '@/i18n/routing';
import { publishedGuides } from '@/lib/guides';
import { gpusHref, guidesHref, localeHref, modelsHref } from '@/lib/links';

const NAV_LINK = 'inline-flex min-h-9 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline';

/**
 * 페이지 셸 — 헤더(홈 링크 + 로케일 전환) + 본문.
 *
 * 로케일 전환 링크는 **현재 페이지의 짝**을 서버에서 계산한다: 각 페이지가 자기 `href`
 * (로케일 프리픽스 없는 내부 경로, buildAlternates 와 같은 값)를 넘긴다. 레이아웃은 페이지
 * 경로를 모르므로 헤더를 여기서 그린다 — 클라이언트 훅·NextIntlClientProvider 없이 (결정 D6).
 */
export function PageShell({
  locale,
  href,
  children,
}: {
  locale: Locale;
  href: string;
  children: ReactNode;
}) {
  const tSite = useTranslations('Site');
  const tSwitcher = useTranslations('LocaleSwitcher');
  return (
    <>
      <VerdictSprite />
      <header className="border-b border-border">
        {/* 좁은 화면: 1줄 = 사이트 이름 + 로캘 전환, 2줄 = 내비(링크 4개가 한 줄에 다 들어가지 않는다). sm 이상은 한 줄 */}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
          <a href={localeHref(locale, '/')} className="font-semibold tracking-tight">
            {tSite('name')}
          </a>
          <nav aria-label={tSite('navLabel')} className="order-last basis-full sm:order-none sm:basis-auto">
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {/* 계산기는 전 페이지에서 인바운드 링크를 갖는다 (docs/04 §2 고아 0, P1-3 D36) */}
              <li>
                <a href={localeHref(locale, '/calculator')} data-nav-calculator className={NAV_LINK}>
                  {tSite('navCalculator')}
                </a>
              </li>
              {/* 모델·GPU 목록 (10-19) — 카탈로그 전체를 둘러보는 입구 */}
              <li>
                <a href={localeHref(locale, modelsHref())} data-nav-models className={NAV_LINK}>
                  {tSite('navModels')}
                </a>
              </li>
              <li>
                <a href={localeHref(locale, gpusHref())} data-nav-gpus className={NAV_LINK}>
                  {tSite('navGpus')}
                </a>
              </li>
              {/* 가이드 목차는 published 가이드가 1편 이상일 때만 (초안은 URL 로만 — P1-4 D40) */}
              {publishedGuides().length > 0 && (
                <li>
                  <a href={localeHref(locale, guidesHref())} data-nav-guides className={NAV_LINK}>
                    {tSite('navGuides')}
                  </a>
                </li>
              )}
            </ul>
          </nav>
          <nav aria-label={tSwitcher('label')} className="ml-auto flex items-center gap-3 text-sm">
            {routing.locales.map((target) =>
              target === locale ? (
                <span key={target} aria-current="true" className="font-medium text-foreground">
                  {tSwitcher(target)}
                </span>
              ) : (
                <a
                  key={target}
                  href={localeHref(target, href)}
                  hrefLang={target}
                  lang={target}
                  data-locale-switch
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {tSwitcher(target)}
                </a>
              ),
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">{children}</main>
    </>
  );
}
