import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { catalog } from '@/lib/catalog';
import { calculatorHref, localeHref } from '@/lib/links';
import { gpuName, type Translate } from '@/lib/phrases';

/**
 * 계산기 위젯 (P1-3 D25 · P1-4 D45) — no-JS GET 폼이 `/calculator?gpu=…` 로 보낸다. 홈과 모든 가이드가 같은 컴포넌트를 쓴다.
 * 서버 컴포넌트(클라이언트 JS 0). datalist = 카탈로그 표시명 + 별칭 — 값 해석은 계산기(별칭·fuzzy)가 한다.
 * `idPrefix` 로 label·input·datalist id 를 가른다(한 페이지 여러 개여도 a11y label 짝이 맞게).
 * 홈은 `data-home-form`(E2E·export 계약)을 유지하고, 모든 위젯은 `data-calc-widget` 을 단다.
 */
export async function CalcWidget({
  locale,
  idPrefix,
  home = false,
  heading,
}: {
  locale: Locale;
  idPrefix: string;
  home?: boolean;
  /** 가이드 본문 뒤 등 — 폼 위에 붙는 제목 (홈은 h1 이 대신한다) */
  heading?: string;
}) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  const tNames = (await getTranslations({ locale, namespace: 'GpuName' })) as unknown as Translate & {
    has?: (key: string) => boolean;
  };
  const options = [...new Set(catalog.gpus.flatMap((gpu) => [gpuName(tNames, gpu), ...gpu.aliases]))];
  const calcAction = localeHref(locale, calculatorHref());
  const inputId = `${idPrefix}-gpu`;
  const listId = `${idPrefix}-gpu-list`;

  return (
    <form
      data-calc-widget
      {...(home ? { 'data-home-form': true } : {})}
      action={calcAction}
      method="get"
      role="search"
      aria-label={heading}
      className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:p-6"
    >
      {heading && <p className="text-base font-semibold">{heading}</p>}
      <label htmlFor={inputId} className="text-sm font-medium">
        {t('gpuLabel')}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          name="gpu"
          list={listId}
          required
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={t('gpuPlaceholder')}
          className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-base sm:text-sm"
        />
        <datalist id={listId}>
          {options.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <button type="submit" className="h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground">
          {t('submit')}
        </button>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={`${calcAction}?gpu=cpu-ddr5-5600-2ch`}>{t('noGpu')}</a>
        <a href={calcAction} data-open-calculator>
          {t('openCalculator')}
        </a>
      </p>
    </form>
  );
}
