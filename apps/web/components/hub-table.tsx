import type { BenchPoint, ComboAssessment, Gpu, Model } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { SpeedCell } from '@/components/estimate';
import { VerdictBadge } from '@/components/verdict';
import type { Locale } from '@/i18n/routing';
import { formatCtx, formatTokS } from '@/lib/format';
import { gpuHref, localeHref, modelHref } from '@/lib/links';
import { memoryText, modeKey, noteLines } from '@/lib/phrases';
import { cn } from '@/lib/utils';

/**
 * 넓은 표의 가로 스크롤 래퍼 — 링크 없는 표도 키보드로 스크롤할 수 있게 region + tabindex
 * (axe scrollable-region-focusable).
 */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="-mx-4 overflow-x-auto px-4 focus-visible:outline-2 focus-visible:outline-ring sm:mx-0 sm:px-0"
    >
      {children}
    </div>
  );
}

/** 표 공통 스타일 — 셀마다 클래스를 반복하지 않는다 (HTML·RSC 페이로드 절약) */
export const TABLE_CLASS = cn(
  'w-full border-collapse text-sm',
  '[&_caption]:mb-2 [&_caption]:text-left [&_caption]:text-sm [&_caption]:text-muted-foreground',
  '[&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:px-2 [&_thead_th]:py-2 [&_thead_th]:text-left [&_thead_th]:font-medium [&_thead_th]:whitespace-nowrap',
  '[&_tbody_th]:px-2 [&_tbody_th]:py-2 [&_tbody_th]:text-left [&_tbody_th]:align-top [&_tbody_th]:font-medium',
  '[&_tbody_td]:px-2 [&_tbody_td]:py-2 [&_tbody_td]:align-top',
  '[&_tbody_tr]:border-b [&_tbody_tr]:border-border',
);

function MemoryText({ combo, gpu }: { combo: ComboAssessment; gpu: Gpu }) {
  const locale = useLocale();
  const t = useTranslations('Memory');
  return <>{memoryText(t, locale, combo.display, gpu)}</>;
}

/** 판정 사유(실제로 걸린 규칙)·추천·최후 수단·RAM 힌트 (결정 D4) — 문장은 `noteLines`(계산기 카드 공용) */
export function Notes({
  combo,
  gpu,
  showReasoning,
}: {
  combo: ComboAssessment;
  gpu: Gpu;
  showReasoning: boolean;
}) {
  const locale = useLocale();
  const tCommon = useTranslations('Common');
  const lines = noteLines(
    {
      reason: useTranslations('VerdictReason'),
      hint: useTranslations('Hint'),
      verdict: useTranslations('Verdict'),
      common: tCommon,
    },
    locale,
    combo,
    gpu.kind,
    showReasoning,
  );

  if (lines.length === 0) return <span className="text-muted-foreground">{tCommon('none')}</span>;
  return (
    <ul className="flex min-w-48 flex-col gap-0.5 text-xs text-muted-foreground">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * 조합 1개의 판정~참고 셀 (GPU 허브·모델 허브 공용). 판정 배지는 기준 quant, 나머지 수치는
 * 표시 quant(기준이 F 면 추천) — 둘이 다르면 배지 아래에 표시 quant 의 판정을 덧붙인다.
 * showReasoning: 행마다 모델이 다른 GPU 허브에서만 리즈닝 표시 (모델 허브는 표 아래 한 번).
 * comboLink: 공개(index) 콤보 페이지로 가는 판정 링크 — 미공개 콤보는 링크하지 않는다 (D9·D12).
 * 링크 텍스트는 대상 조합 이름("RTX 4060에서 gpt-oss-20b 판정 보기" — `Table.comboLink`, 10-16 D95):
 * 텍스트만 읽어도 어디로 가는지 알 수 있게 하고, 행마다 같은 "상세" + aria-label 조합은 쓰지 않는다.
 */
export function ComboCells({
  combo,
  gpu,
  showReasoning = false,
  comboLink,
}: {
  combo: ComboAssessment;
  gpu: Gpu;
  showReasoning?: boolean;
  comboLink?: { href: string; text: string };
}) {
  const tMode = useTranslations('Mode');
  const tHint = useTranslations('Hint');
  const tVerdict = useTranslations('Verdict');
  const tCommon = useTranslations('Common');
  const q = combo.display;
  const shifted = q.quant !== combo.baseline.quant;
  return (
    <>
      <td>
        <div className="flex flex-col items-start gap-1">
          <VerdictBadge verdict={combo.baseline.result.verdict} />
          {shifted && (
            <span className="text-xs text-muted-foreground">
              {tHint(q.tier === 'desperate' ? 'recommendedDesperate' : 'recommended', {
                quant: q.quant,
                verdict: tVerdict(q.result.verdict),
              })}
            </span>
          )}
          {comboLink && (
            <a href={comboLink.href} data-combo-link className="text-xs">
              {comboLink.text}
            </a>
          )}
        </div>
      </td>
      <td>
        <SpeedCell q={q} />
      </td>
      <td className="whitespace-nowrap">{q.quant}</td>
      <td className="whitespace-nowrap tabular-nums">
        <MemoryText combo={combo} gpu={gpu} />
      </td>
      <td className="whitespace-nowrap">
        {q.fReason === 'no-fit' ? tCommon('none') : tMode(modeKey(q.result.mode, gpu.kind))}
      </td>
      <td className="whitespace-nowrap">
        {combo.maxCtx !== undefined
          ? tHint('maxCtx', { ctx: formatCtx(combo.maxCtx) })
          : tCommon('none')}
      </td>
      <td>
        <Notes combo={combo} gpu={gpu} showReasoning={showReasoning} />
      </td>
    </>
  );
}

/** ComboCells 와 짝을 이루는 머리글 (첫 열은 호출 측이 그린다) */
export function ComboHeaderCells() {
  const t = useTranslations('Table');
  return (
    <>
      <th scope="col">{t('verdict')}</th>
      <th scope="col">{t('speed')}</th>
      <th scope="col">{t('quant')}</th>
      <th scope="col">{t('memory')}</th>
      <th scope="col">{t('mode')}</th>
      <th scope="col">{t('context')}</th>
      <th scope="col">{t('notes')}</th>
    </>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 공개 실측 목록 — 첫 열은 GPU 허브면 모델, 모델 허브면 하드웨어 */
export function BenchTable({
  points,
  firstColumn,
  models,
  gpus,
  gpuLabel,
  caption,
}: {
  points: readonly BenchPoint[];
  firstColumn: 'model' | 'hardware';
  models: readonly Model[];
  gpus: readonly Gpu[];
  gpuLabel: (gpu: Gpu) => string;
  caption: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('Table');
  const tCommon = useTranslations('Common');
  return (
    <ScrollTable label={caption}>
      <table className={TABLE_CLASS}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{firstColumn === 'model' ? t('model') : t('hardware')}</th>
            <th scope="col">{t('quant')}</th>
            <th scope="col">{t('backend')}</th>
            <th scope="col">{t('context')}</th>
            <th scope="col">{t('pp')}</th>
            <th scope="col">{t('tg')}</th>
            <th scope="col">{t('flags')}</th>
            <th scope="col">{t('source')}</th>
            <th scope="col">{t('date')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((bp) => {
            let first: ReactNode;
            if (firstColumn === 'model') {
              const model = models.find((m) => m.id === bp.modelId);
              first = model ? (
                <a href={localeHref(locale, modelHref(model.id))}>{model.name}</a>
              ) : (
                bp.modelId
              );
            } else {
              const gpu = bp.gpuId ? gpus.find((g) => g.id === bp.gpuId) : undefined;
              first = gpu ? (
                <a href={localeHref(locale, gpuHref(gpu.id))}>{gpuLabel(gpu)}</a>
              ) : (
                (bp.hardwareDesc ?? bp.gpuId)
              );
            }
            return (
              <tr key={bp.id}>
                <th scope="row">{first}</th>
                <td className="whitespace-nowrap">{bp.quant}</td>
                <td className="whitespace-nowrap">{bp.backend}</td>
                <td className="tabular-nums">{formatCtx(bp.ctx)}</td>
                <td className="tabular-nums">
                  {bp.ppTokS !== undefined ? formatTokS(locale, bp.ppTokS) : tCommon('none')}
                </td>
                <td className="tabular-nums">{formatTokS(locale, bp.tgTokS)}</td>
                <td className="text-xs">{bp.flags ?? tCommon('none')}</td>
                <td>
                  <a href={bp.sourceUrl} rel="noopener">
                    {hostname(bp.sourceUrl)}
                  </a>
                </td>
                <td className="whitespace-nowrap tabular-nums">{bp.measuredAt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}
