import type { Alternative, Gpu, Model } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { VerdictBadge } from '@/components/verdict';
import type { Locale } from '@/i18n/routing';
import { formatGB, formatInt } from '@/lib/format';
import { comboHref, gpuHref, localeHref, modelHref } from '@/lib/links';
import { gpuName, speedPhrase } from '@/lib/phrases';
import { formatPrice, krwNote } from '@/lib/price';

/**
 * 대안 카드 (docs/04 §4 ⑥) — 0~3개. 콤보 링크는 호출 측이 링크 허용 여부(D9)를 판단해 `linkTo` 로 준다.
 */
export function AlternativeCards({
  items,
  gpu,
  model,
  /** 콤보 링크가 허용되는지 (공개 페이지는 공개 콤보만) */
  canLinkCombo,
}: {
  items: readonly Alternative[];
  gpu: Gpu;
  model: Model;
  canLinkCombo: (gpuId: string, modelId: string) => boolean;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('Alternatives');
  const tCommon = useTranslations('Common');
  const tConfidence = useTranslations('Confidence');
  const tVerdict = useTranslations('Verdict');
  const tNames = useTranslations('GpuName');
  const names = Object.assign((key: string) => tNames(key), { has: (key: string) => tNames.has(key) });
  const speed = (q: Parameters<typeof speedPhrase>[3]) => speedPhrase(tCommon, tConfidence, locale, q);
  const name = gpuName(names, gpu);
  if (items.length === 0) return null;

  // 콤보 링크가 막히면 "바뀐 쪽"의 허브로 — 다른 모델 카드는 그 모델 허브, 다른 칩 카드는 그 칩의 GPU 허브
  const link = (g: Gpu, m: Model, fallback: 'model' | 'gpu') =>
    canLinkCombo(g.id, m.id)
      ? localeHref(locale, comboHref(m.id, g.id))
      : localeHref(locale, fallback === 'model' ? modelHref(m.id) : gpuHref(g.id));

  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {items.map((alt) => {
        let title: string;
        let body: string;
        let href: string | undefined;
        let verdict: Parameters<typeof VerdictBadge>[0]['verdict'] | undefined;
        let note: string | undefined;
        switch (alt.kind) {
          case 'larger-model':
          case 'smaller-model':
          case 'faster-model':
            title = t(
              alt.kind === 'larger-model' ? 'largerModel' : alt.kind === 'smaller-model' ? 'smallerModel' : 'fasterModel',
              { gpu: name },
            );
            body = `${alt.model.name}: ${t('body', { verdict: tVerdict(alt.combo.baseline.result.verdict), speed: speed(alt.combo.display) })}`;
            href = link(gpu, alt.model, 'model');
            verdict = alt.combo.baseline.result.verdict;
            break;
          case 'lower-quant':
          case 'higher-quant':
            title = alt.kind === 'lower-quant' ? t('lowerQuant', { model: model.name }) : t('higherQuant');
            body = t(alt.desperate ? 'quantBodyDesperate' : 'quantBody', {
              quant: alt.q.quant,
              size: formatGB(locale, alt.q.fileGB, 2),
              verdict: tVerdict(alt.q.result.verdict),
              speed: speed(alt.q),
            });
            href = `#quant-${alt.q.quant}`;
            verdict = alt.q.result.verdict;
            break;
          case 'cpu-moe':
            title = t('cpuMoe');
            body =
              alt.nCpuMoe < alt.layers
                ? t('cpuMoeBody', { n: alt.nCpuMoe })
                : t('cpuMoeBodyAll', { n: alt.nCpuMoe });
            href = '#snippet';
            break;
          case 'ram-upgrade':
            title = t('ramUpgrade', { ram: formatInt(locale, alt.ramGB) });
            body = t('bodyQuant', {
              quant: alt.quant,
              verdict: tVerdict(alt.verdict),
              speed: speedPhrase(tCommon, tConfidence, locale, { result: alt.result, estimate: alt.result }),
            });
            verdict = alt.verdict;
            break;
          case 'ram-config':
            title = t('ramConfig', { ram: formatInt(locale, alt.ramGB) });
            body = t('bodyQuant', {
              quant: alt.combo.display.quant,
              verdict: tVerdict(alt.combo.baseline.result.verdict),
              speed: speed(alt.combo.display),
            });
            verdict = alt.combo.baseline.result.verdict;
            break;
          case 'chip':
            title = t('chip', { model: model.name, gpu: gpuName(names, alt.gpu) });
            body = t('bodyQuant', {
              quant: alt.combo.display.quant,
              verdict: tVerdict(alt.combo.baseline.result.verdict),
              speed: speed(alt.combo.display),
            });
            href = link(alt.gpu, model, 'gpu');
            verdict = alt.combo.baseline.result.verdict;
            break;
          case 'gpu':
            title = t('gpu', { model: model.name });
            body = t('gpuBody', {
              gpu: gpuName(names, alt.option.gpu),
              price: formatPrice(tCommon, locale, alt.option.priceUSD),
              date: alt.option.priceAsOf,
              speed: speed(alt.option.combo.baseline),
            });
            href = canLinkCombo(alt.option.gpu.id, model.id)
              ? localeHref(locale, comboHref(model.id, alt.option.gpu.id))
              : localeHref(locale, gpuHref(alt.option.gpu.id));
            verdict = alt.option.combo.baseline.result.verdict;
            note = krwNote(tCommon, locale);
            break;
        }
        return (
          <li key={alt.kind} data-alt-card className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium">{href ? <a href={href}>{title}</a> : title}</h3>
            {verdict && <VerdictBadge verdict={verdict} />}
            <p className="text-sm text-muted-foreground">{body}</p>
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
