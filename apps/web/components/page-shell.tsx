import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { VerdictSprite } from '@/components/verdict';
import { routing, type Locale } from '@/i18n/routing';
import { publishedGuides } from '@/lib/guides';
import { guidesHref, localeHref } from '@/lib/links';

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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <a href={localeHref(locale, '/')} className="font-semibold tracking-tight">
              {tSite('name')}
            </a>
            {/* 계산기는 전 페이지에서 인바운드 링크를 갖는다 (docs/04 §2 고아 0, P1-3 D36) */}
            <a href={localeHref(locale, '/calculator')} data-nav-calculator className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              {tSite('navCalculator')}
            </a>
            {/* 가이드 목차는 published 가이드가 1편 이상일 때만 (초안은 URL 로만 — P1-4 D40) */}
            {publishedGuides().length > 0 && (
              <a href={localeHref(locale, guidesHref())} data-nav-guides className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {tSite('navGuides')}
              </a>
            )}
          </div>
          <nav aria-label={tSwitcher('label')} className="flex items-center gap-3 text-sm">
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
