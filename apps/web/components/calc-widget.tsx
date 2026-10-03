import { getTranslations } from 'next-intl/server';
import { GpuPicker } from '@/components/islands/gpu-picker';
import type { Locale } from '@/i18n/routing';
import { getPickerGpus } from '@/lib/calc-catalog';
import { clientDict } from '@/lib/client-messages';
import { GPU_PICKER_MESSAGE_SPEC } from '@/lib/i18n-lite';
import { calculatorHref, localeHref } from '@/lib/links';

/**
 * 계산기 위젯 (P1-3 D25 · P1-4 D45) — no-JS GET 폼이 `/calculator?gpu=…` 로 보낸다. 홈과 모든 가이드가 같은 컴포넌트를 쓴다.
 * GPU 입력은 클라이언트 아일랜드 `GpuPicker`(계산기와 같은 그룹 목록 — 09-30 사용자 요청으로 D45 의 "JS 0" 을 대체).
 * 폼·버튼·링크는 서버 렌더 그대로라 JS 없이도 GET 으로 동작한다(하이드레이션 전엔 표시명만 담은 datalist).
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
  const dict = await clientDict(locale, GPU_PICKER_MESSAGE_SPEC);
  const calcAction = localeHref(locale, calculatorHref());
  const inputId = `${idPrefix}-gpu`;

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
        <GpuPicker
          locale={locale}
          gpus={getPickerGpus()}
          dict={dict}
          inputId={inputId}
          label={t('gpuLabel')}
          placeholder={t('gpuPlaceholder')}
        />
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
