import type { ComboAssessment } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { VerdictBadge } from '@/components/verdict';
import { formatInt } from '@/lib/format';
import { speedPhrase } from '@/lib/phrases';

export type ConfigVerdictRow = {
  ramGB: number;
  combo: ComboAssessment;
  /** 이 페이지의 판정·제목·FAQ 가 쓰는 구성 */
  assumed?: boolean;
  /** RAM 힌트 페이지: 아래 메모리·ctx 표·명령이 계산된 구성 (10-03 D64) */
  commands?: boolean;
};

/**
 * 메모리 용량별 판정 목록 — 통합 메모리·CPU 는 메모리 옵션마다, dGPU 는 시스템 RAM 계단(16~128GB, 10-03 D64)마다.
 * 행 = 용량 · 기준 양자화 판정 배지 · (기준이 안 되면) 표시 양자화와 그 판정(desperate 는 "품질 손실 큼") · 속도(밴드+라벨, 규칙 3).
 * `data-ram-step` 은 콤보 아일랜드의 RAM 토글이 선택한 행에 aria-current 를 다는 훅, `data-quant`·`data-display-verdict`·`data-fits`
 * (표시 양자화)는 export·E2E 테스트가 읽는다. 클라이언트 JS 0.
 */
export function ConfigVerdictList({ rows }: { rows: ConfigVerdictRow[] }) {
  const locale = useLocale();
  const tGpuHub = useTranslations('GpuHub');
  const tCombo = useTranslations('Combo');
  const tHint = useTranslations('Hint');
  const tVerdict = useTranslations('Verdict');
  const tCommon = useTranslations('Common');
  const tConfidence = useTranslations('Confidence');
  return (
    <ul className="flex flex-wrap gap-3">
      {rows.map(({ ramGB, combo, assumed, commands }) => {
        const d = combo.display;
        return (
          <li
            key={ramGB}
            data-ram-step={ramGB}
            data-quant={d.quant}
            data-display-verdict={d.result.verdict}
            data-fits={String(d.fits)}
            {...(assumed ? { 'data-assumed': '' } : {})}
            {...(commands ? { 'data-commands': '' } : {})}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1 text-sm aria-[current=true]:border-foreground"
          >
            <span className="tabular-nums">{tGpuHub('ramOption', { ram: formatInt(locale, ramGB) })}</span>
            <VerdictBadge verdict={combo.baseline.result.verdict} />
            {d.quant !== combo.baseline.quant && (
              <span className="text-xs">
                {tHint(d.tier === 'desperate' ? 'recommendedDesperate' : 'recommended', {
                  quant: d.quant,
                  verdict: tVerdict(d.result.verdict),
                })}
              </span>
            )}
            {d.fReason !== 'no-fit' && (
              <span className="text-xs text-muted-foreground tabular-nums">{speedPhrase(tCommon, tConfidence, locale, d)}</span>
            )}
            {assumed && <span className="text-xs text-muted-foreground">({tCombo('ramStepAssumed')})</span>}
            {commands && <span className="text-xs text-muted-foreground">({tCombo('ramStepCommands')})</span>}
          </li>
        );
      })}
    </ul>
  );
}
