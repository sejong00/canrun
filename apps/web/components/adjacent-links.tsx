import type { AdjacentCombos, Gpu, Model } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { comboHref, gpuHref, localeHref, modelHref } from '@/lib/links';
import { gpuName } from '@/lib/phrases';

/** 인접 콤보 4 + 양쪽 허브 (docs/04 §2 내부링크 규칙) — 탭 타깃 ≥24px 를 위해 py-2 */
export function AdjacentLinks({ adjacent, gpu, model }: { adjacent: AdjacentCombos; gpu: Gpu; model: Model }) {
  const locale = useLocale() as Locale;
  const t = useTranslations('Adjacent');
  const tNames = useTranslations('GpuName');
  const names = Object.assign((key: string) => tNames(key), { has: (key: string) => tNames.has(key) });
  const name = gpuName(names, gpu);
  const item = 'block py-2 text-sm';
  return (
    <div className="grid gap-6 sm:grid-cols-2">
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
              {t('modelHub', { model: model.name })}
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
