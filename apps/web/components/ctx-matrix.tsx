import type { CtxMatrix } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { SpeedCell } from '@/components/estimate';
import { ScrollTable, TABLE_CLASS } from '@/components/hub-table';
import { VerdictBadge } from '@/components/verdict';
import { formatCtx, formatGB } from '@/lib/format';

const VERDICTS = ['S', 'A', 'B', 'F'] as const;

/**
 * ctx × KV quant 정적 표 (docs/04 §4 ③, 결정 D11) — 셀 = 필요 메모리 + compact 판정 배지 + 속도(밴드·신뢰 라벨, 규칙 3).
 * 배지의 전체 라벨은 sr-only(VerdictBadge compact)이고, 글자 뜻은 표 아래 한 줄 범례가 알려 준다.
 */
export function CtxMatrixTable({ matrix, caption }: { matrix: CtxMatrix; caption: string }) {
  const locale = useLocale();
  const t = useTranslations('Combo');
  const tCommon = useTranslations('Common');
  const tVerdict = useTranslations('Verdict');
  const legend = VERDICTS.map((v) => `${v} = ${tVerdict(v)}`).join(' · ');
  return (
    <>
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('ctxColumn')}</th>
              {matrix.kvQuants.map((kv) => (
                <th key={kv} scope="col">
                  {t('kvColumn', { kv })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row[0]!.ctx}>
                <th scope="row" className="tabular-nums whitespace-nowrap">
                  {formatCtx(row[0]!.ctx)}
                </th>
                {row.map((cell) => (
                  <td key={cell.kvQuant} className="align-top">
                    <div className="flex flex-col gap-1 tabular-nums">
                      <span className="whitespace-nowrap">{tCommon('gb', { value: formatGB(locale, cell.needGB) })}</span>
                      {cell.fits ? (
                        <>
                          <VerdictBadge verdict={cell.verdict} compact />
                          <SpeedCell q={{ result: cell.result, estimate: cell.result }} />
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('ctxCellNoFit')}</span>
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <p className="text-xs text-muted-foreground">{legend}</p>
    </>
  );
}
