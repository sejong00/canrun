import type { AdjacentCombos, Gpu, Model } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { isContentLocale } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';
import { guideEntry, relatedGuideFor } from '@/lib/guides';
import { comboHref, gpuHref, guideHref, localeHref, modelHref } from '@/lib/links';
import { gpuName } from '@/lib/phrases';
import { searchModelName } from '@/lib/search-names';

/**
 * 인접 콤보 4 + 양쪽 허브 (docs/04 §2 내부링크 규칙) — 탭 타깃 ≥24px 를 위해 py-2.
 * 이 콤보를 그리드로 다루는 **published** 가이드가 있으면 그 가이드로도 링크한다 (P1-4 D44 — 초안은 링크하지 않는다).
 * 가이드는 장문 로캘(en·ko)에만 있어 zh 는 링크하지 않는다(D109).
 * 모델 허브 링크는 한국어에서 한글 계열 이름을 붙인다 — 콤보 본문에서 한글 이름이 나오는 유일한 자리(10-16 D94, content/ko-names.ts)
 */
export function AdjacentLinks({ adjacent, gpu, model }: { adjacent: AdjacentCombos; gpu: Gpu; model: Model }) {
  const locale = useLocale() as Locale;
  const t = useTranslations('Adjacent');
  const tNames = useTranslations('GpuName');
  const names = Object.assign((key: string) => tNames(key), { has: (key: string) => tNames.has(key) });
  const name = gpuName(names, gpu);
  const item = 'block py-2 text-sm';
  const tGuides = useTranslations('Guides');
  const guideLocale = isContentLocale(locale) ? locale : undefined;
  const guide = guideLocale ? relatedGuideFor(gpu.id, model.id) : undefined;
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {guide && guideLocale && (
        <p className="sm:col-span-2">
          <a data-related-guide href={localeHref(guideLocale, guideHref(guide))} className={item}>
            {tGuides('relatedGuide', { title: guideEntry(guide).locales[guideLocale].title })}
          </a>
        </p>
      )}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground">{t('sameGpu', { gpu: name })}</h3>
        <ul>
          {adjacent.models.map((m) => (
            <li key={m.id}>
              <a data-adjacent href={localeHref(locale, comboHref(m.id, gpu.id))} className={item}>
                {m.name}
              </a>
            </li>
          ))}
          <li>
            <a href={localeHref(locale, gpuHref(gpu.id))} className={item}>
              {t('gpuHub', { gpu: name })}
            </a>
          </li>
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground">{t('sameModel', { model: model.name })}</h3>
        <ul>
          {adjacent.gpus.map((g) => (
            <li key={g.id}>
              <a data-adjacent href={localeHref(locale, comboHref(model.id, g.id))} className={item}>
                {gpuName(names, g)}
              </a>
            </li>
          ))}
          <li>
            <a href={localeHref(locale, modelHref(model.id))} className={item}>
              {t('modelHub', { model: searchModelName(locale, model) })}
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
