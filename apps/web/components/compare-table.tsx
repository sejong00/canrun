import type { ComboAssessment, CompareRow, Gpu } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { SpeedCell } from '@/components/estimate';
import { ScrollTable, TABLE_CLASS } from '@/components/hub-table';
import { VerdictBadge } from '@/components/verdict';
import type { Locale } from '@/i18n/routing';
import { comboHref, localeHref, modelHref } from '@/lib/links';
import { isComboIndexable } from '@/lib/publish';

type Side = { gpu: Gpu; name: string };

/**
 * 한 기기의 판정 칸 — 배지는 기준 양자화, 기준이 불가라 다른 양자화로 수치를 보이면 GPU 허브 표(`ComboCells`)처럼 그 양자화의 판정을 덧붙인다.
 * 판정 링크는 공개 콤보로만(D9·D12 — `data-combo-link`)
 */
function VerdictCell({ combo, side, modelId, modelName }: { combo: ComboAssessment; side: Side; modelId: string; modelName: string }) {
  const locale = useLocale() as Locale;
  const tHint = useTranslations('Hint');
  const tVerdict = useTranslations('Verdict');
  const tTable = useTranslations('Table');
  const q = combo.display;
  return (
    <td>
      <div className="flex flex-col items-start gap-1">
        <VerdictBadge verdict={combo.baseline.result.verdict} />
        {q.quant !== combo.baseline.quant && (
          <span className="text-xs text-muted-foreground">
            {tHint(q.tier === 'desperate' ? 'recommendedDesperate' : 'recommended', { quant: q.quant, verdict: tVerdict(q.result.verdict) })}
          </span>
        )}
        {isComboIndexable(side.gpu.id, modelId) && (
          <a href={localeHref(locale, comboHref(modelId, side.gpu.id))} data-combo-link className="text-xs">
            {tTable('comboLink', { model: modelName, gpu: side.name })}
          </a>
        )}
      </div>
    </td>
  );
}

/**
 * GPU 비교 표 (10-19 D103) — 모델마다 두 기기의 판정·예상 속도를 나란히. 서버 컴포넌트, 클라이언트 JS 0.
 * 속도 칸은 허브 표와 같은 `SpeedCell`(밴드 + 신뢰 라벨, 실측이면 8k 추정 병기 — 규칙 3). 행 순서는 `compareGpus` 그대로
 */
export function CompareTable({ rows, a, b, caption }: { rows: readonly CompareRow[]; a: Side; b: Side; caption: string }) {
  const locale = useLocale() as Locale;
  const t = useTranslations('Compare');
  const tTable = useTranslations('Table');
  return (
    <ScrollTable label={caption}>
      <table className={TABLE_CLASS}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{tTable('model')}</th>
            <th scope="col">{t('colVerdict', { gpu: a.name })}</th>
            <th scope="col">{t('colSpeed', { gpu: a.name })}</th>
            <th scope="col">{t('colVerdict', { gpu: b.name })}</th>
            <th scope="col">{t('colSpeed', { gpu: b.name })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.model.id} {...(row.verdictDiffers ? { 'data-verdict-differs': '' } : {})}>
              <th scope="row">
                <a href={localeHref(locale, modelHref(row.model.id))}>{row.model.name}</a>
                <span className="block text-xs font-normal text-muted-foreground">{row.a.baseline.quant}</span>
              </th>
              <VerdictCell combo={row.a} side={a} modelId={row.model.id} modelName={row.model.name} />
              <td>
                <SpeedCell q={row.a.display} />
              </td>
              <VerdictCell combo={row.b} side={b} modelId={row.model.id} modelName={row.model.name} />
              <td>
                <SpeedCell q={row.b.display} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
