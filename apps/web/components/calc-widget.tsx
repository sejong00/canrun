import { getTranslations } from 'next-intl/server';
import { GpuPicker } from '@/components/islands/gpu-picker';
import type { Locale } from '@/i18n/routing';
import { getPickerGpus } from '@/lib/calc-catalog';
import { clientDict } from '@/lib/client-messages';
import { GPU_PICKER_MESSAGE_SPEC } from '@/lib/i18n-lite';
import { calculatorHref, localeHref } from '@/lib/links';

/** 모델 허브 — GPU 칸을 비우면 계산기 모델 모드로 (10-03 D65 의 `?mode=model&m=` 와 같은 화면) */
const MODEL_MODE_FIELDS = { mode: 'model' } as const;

/** 위젯 아래 바로 가기 링크 — 상세 페이지의 "이 조합을 계산기에서 열기" 같은 딥 링크 (`data-calc-deep-link` = kind) */
export type CalcWidgetLink = { kind: string; href: string; text: string };

/** 상세 페이지(콤보·GPU·모델 허브·GPU 비교)용 미리 채운 값 (10-19 D107) */
export type CalcWidgetPrefill = {
  /** 미리 고른 GPU id — 바꾸지 않고 제출하면 그 GPU 로 열린다 */
  gpuId?: string;
  /** 계산기에 함께 넘길 모델 id (숨은 `m`) — 콤보·모델 허브 */
  modelId?: string;
  /** GPU 칸을 비워 둔 채 제출하면 계산기 모델 모드(`mode=model`)로 연다 — 모델 허브 */
  modelModeWhenEmpty?: boolean;
  /** 제목 아래 한 줄 안내 */
  note: string;
  /** 폼 아래 링크 — 홈·가이드의 기본 링크(CPU만·계산기 전체) 대신 */
  links: readonly CalcWidgetLink[];
};

/**
 * 계산기 위젯 (P1-3 D25 · P1-4 D45 · 10-19 D107) — no-JS GET 폼이 `/calculator?gpu=…` 로 보낸다. 홈·모든 가이드·상세 페이지가 같은 컴포넌트를 쓴다.
 * GPU 입력은 클라이언트 아일랜드 `GpuPicker`(계산기와 같은 그룹 목록 — 09-30 사용자 요청으로 D45 의 "JS 0" 을 대체).
 * 폼·버튼·링크는 서버 렌더 그대로라 JS 없이도 GET 으로 동작한다(하이드레이션 전엔 표시명만 담은 datalist).
 * `idPrefix` 로 label·input·datalist id 를 가른다(한 페이지 여러 개여도 a11y label 짝이 맞게).
 * 홈은 `data-home-form`(E2E·export 계약)을 유지하고, 모든 위젯은 `data-calc-widget` 을 단다.
 * 상세 페이지(`prefill`)는 그 페이지의 GPU·모델을 미리 채운 작은 폼 — 검색으로 들어온 사람이 계산기를 바로 써 보게 (10-19 사용자 요청).
 * 결과는 계산기에서만 나온다(정적 HTML 에 계산 결과 없음, 아일랜드는 GpuPicker 하나).
 */
export async function CalcWidget({
  locale,
  idPrefix,
  home = false,
  heading,
  prefill,
}: {
  locale: Locale;
  idPrefix: string;
  home?: boolean;
  /** 가이드 본문 뒤·상세 페이지 머리말 아래 — 폼 위에 붙는 제목 (홈은 h1 이 대신한다) */
  heading?: string;
  prefill?: CalcWidgetPrefill;
}) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  const tWidget = await getTranslations({ locale, namespace: 'CalcWidget' });
  const dict = await clientDict(locale, GPU_PICKER_MESSAGE_SPEC);
  const calcAction = localeHref(locale, calculatorHref());
  const inputId = `${idPrefix}-gpu`;

  const picker = (
    <GpuPicker
      locale={locale}
      gpus={getPickerGpus()}
      dict={dict}
      inputId={inputId}
      label={t('gpuLabel')}
      placeholder={t('gpuPlaceholder')}
      {...(prefill?.gpuId === undefined ? {} : { initialGpuId: prefill.gpuId })}
      {...(prefill?.modelModeWhenEmpty ? { emptyFields: MODEL_MODE_FIELDS } : {})}
    />
  );

  if (prefill) {
    return (
      <form
        data-calc-widget
        action={calcAction}
        method="get"
        role="search"
        aria-label={heading}
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        {prefill.modelId !== undefined && <input type="hidden" name="m" value={prefill.modelId} />}
        <div className="flex flex-col gap-1">
          {heading && <p className="text-base font-semibold">{heading}</p>}
          <p className="text-sm text-muted-foreground">{prefill.note}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor={inputId} className="text-sm font-medium sm:shrink-0">
            {t('gpuLabel')}
          </label>
          {picker}
          <button type="submit" className="h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground">
            {tWidget('submit')}
          </button>
        </div>
        {prefill.links.length > 0 && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {prefill.links.map((link) => (
              <a key={link.kind} href={link.href} data-calc-deep-link={link.kind}>
                {link.text}
              </a>
            ))}
          </p>
        )}
      </form>
    );
  }

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
        {picker}
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
