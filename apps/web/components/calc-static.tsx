import { HUB_POLICY } from '@canrun/data';
import { useTranslations } from 'next-intl';
import { SpeedCell } from '@/components/estimate';
import { Pill } from '@/components/pill';
import { VerdictBadge, VerdictLegend } from '@/components/verdict';
import type { Locale } from '@/i18n/routing';
import { formatCtx, formatInt } from '@/lib/format';
import { calculatorHref, comboHref, gpuHref, localeHref, modelHref } from '@/lib/links';
import { gpuName, modeKey, quantText, type Translate } from '@/lib/phrases';
import type { SizeBucket } from '@/lib/calc/state';
import { startingPoints, type StartingPick, type StartingPoint } from '@/lib/starting-points';

/**
 * 계산기 페이지의 서버 렌더 내용 (10-14 PROGRESS §4 D73) — 클라이언트 JS 0. 결과 영역(아일랜드) 아래에 둔다: 결과가 그려지며 길어져도
 * 이 블록은 아래로 밀릴 뿐 위 내용을 움직이지 않는다(D65 의 폼 자리 예약과 같은 원칙).
 * 문구는 messages `CalculatorStatic`(계산기 아일랜드 props 에 실리지 않는 서버 전용 이름공간) + 카드와 같은 라벨(`Calculator.card*`·`size*`).
 */

const SIZE_KEY: Record<SizeBucket, string> = { s: 'sizeS', m: 'sizeM', l: 'sizeL', xl: 'sizeXl' };
const OS_KEY = { windows: 'osWindows', linux: 'osLinux', macos: 'osMacos' } as const;

/** 많이 쓰는 하드웨어 6종 × 크기 구간별 계산기 추천순 첫 모델 (lib/starting-points.ts) */
export function CalcStartingPoints({ locale }: { locale: Locale }) {
  const t = useTranslations('CalculatorStatic');
  const tCommon = useTranslations('Common');
  const points = startingPoints();
  const reasoning = points.some((p) => p.picks.some((pick) => pick.kind === 'pick' && pick.combo.reasoning));
  return (
    <section aria-labelledby="start-heading" data-starting-points className="flex flex-col gap-3">
      <h2 id="start-heading" className="text-xl font-semibold tracking-tight">
        {t('startTitle')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('startIntro')}</p>
      <p className="text-sm text-muted-foreground">
        {t('startAssume', { ram: formatInt(locale, HUB_POLICY.dgpuRamGB), ctx: formatCtx(HUB_POLICY.referenceCtx) })}
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {points.map((point) => (
          <PointCard key={point.gpu.id} locale={locale} point={point} />
        ))}
      </ul>
      {reasoning && <p className="text-xs text-muted-foreground">{tCommon('reasoningNote')}</p>}
    </section>
  );
}

function PointCard({ locale, point }: { locale: Locale; point: StartingPoint }) {
  const t = useTranslations('CalculatorStatic');
  const tCalc = useTranslations('Calculator');
  const tNames = useTranslations('GpuName') as unknown as Translate & { has?: (key: string) => boolean };
  const { gpu } = point;
  const name = gpuName(tNames, gpu);
  const memory =
    gpu.kind === 'dgpu'
      ? t('memDgpu', { vram: formatInt(locale, gpu.vramGB ?? 0), ram: formatInt(locale, point.ramGB) })
      : t('memUnified', { mem: formatInt(locale, point.ramGB), os: tCalc(OS_KEY[point.os]) });
  return (
    <li data-start-gpu={gpu.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold">
          <a href={localeHref(locale, gpuHref(gpu.id))}>{name}</a>
        </h3>
        <p className="text-xs text-muted-foreground">{memory}</p>
      </div>
      <p className="text-sm">{t('startGood', { good: point.good, total: point.total })}</p>
      <dl className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
        {point.picks.map((pick) => (
          <PickRow key={pick.bucket} locale={locale} gpuId={gpu.id} gpuKind={gpu.kind} pick={pick} />
        ))}
      </dl>
      <p className="mt-auto text-sm">
        <a href={localeHref(locale, calculatorHref(`?gpu=${gpu.id}`))} data-start-calc>
          {t('startOpen', { total: point.total, gpu: name })}
        </a>
      </p>
    </li>
  );
}

function PickRow({
  locale,
  gpuId,
  gpuKind,
  pick,
}: {
  locale: Locale;
  gpuId: string;
  gpuKind: StartingPoint['gpu']['kind'];
  pick: StartingPick;
}) {
  const t = useTranslations('CalculatorStatic');
  const tCalc = useTranslations('Calculator');
  const tCommon = useTranslations('Common');
  const tMode = useTranslations('Mode');
  const tHint = useTranslations('Hint');
  return (
    <div data-start-bucket={pick.bucket} className="contents">
      <dt className="text-muted-foreground">{tCalc(SIZE_KEY[pick.bucket])}</dt>
      {pick.kind === 'pick' ? (
        <dd className="flex min-w-0 flex-col gap-1" data-start-model={pick.model.id}>
          <span className="flex flex-wrap items-center gap-2">
            {/* 공개(index) 콤보만 콤보 페이지로, 나머지는 모델 허브로 — 공개 페이지는 공개 콤보로만 링크한다(docs/04 §3) */}
            <a
              href={localeHref(locale, pick.comboIndexable ? comboHref(pick.model.id, gpuId) : modelHref(pick.model.id))}
              data-start-pick={pick.comboIndexable ? 'combo' : 'model'}
              className="font-medium"
            >
              {pick.model.name}
            </a>
            <VerdictBadge verdict={pick.combo.baseline.result.verdict} />
            {pick.combo.reasoning && <Pill>{tCommon('reasoningMark')}</Pill>}
          </span>
          {/* 표·카드와 같은 속도 셀(밴드 + 신뢰 라벨)을 한 줄로 눕혀 카드 높이를 줄인다 */}
          <div className="[&_[data-speed]]:flex-row [&_[data-speed]]:flex-wrap [&_[data-speed]]:items-center [&_[data-speed]]:gap-x-2">
            <SpeedCell q={pick.combo.display} />
          </div>
          <span className="text-xs text-muted-foreground">
            {quantText(tHint, pick.combo.display)} · {tMode(modeKey(pick.combo.display.result.mode, gpuKind))}
          </span>
        </dd>
      ) : (
        <dd className="flex min-w-0 flex-col gap-1" data-start-none>
          <span className="flex flex-wrap items-center gap-2">
            <VerdictBadge verdict="F" />
            <span>{t('startNone', { models: pick.models })}</span>
          </span>
          {pick.lowerQuant > 0 && <span className="text-xs text-muted-foreground">{t('startLowerQuant', { count: pick.lowerQuant })}</span>}
        </dd>
      )}
    </div>
  );
}

/** 결과 카드 읽는 법 — 카드와 같은 라벨(dt)에 뜻을 붙이고, 판정 기준표(VerdictLegend)를 이어 붙인다 */
export function CalcReadingGuide() {
  const t = useTranslations('CalculatorStatic');
  const tCalc = useTranslations('Calculator');
  const rows = [
    ['filterVerdict', 'readVerdict'],
    ['cardQuant', 'readQuant'],
    ['cardSpeed', 'readSpeed'],
    ['cardMemory', 'readMemory'],
    ['cardMode', 'readMode'],
    ['cardMaxCtx', 'readMaxCtx'],
    ['cardDetails', 'readDetails'],
  ] as const;
  return (
    <section aria-labelledby="read-heading" data-calc-guide className="flex flex-col gap-3">
      <h2 id="read-heading" className="text-xl font-semibold tracking-tight">
        {t('readTitle')}
      </h2>
      <p className="text-sm">{t('readIntro')}</p>
      <dl data-read-fields className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
        {rows.map(([label, text]) => (
          <div key={label} className="contents">
            <dt className="font-medium">{tCalc(label)}</dt>
            <dd className="mb-2 text-muted-foreground sm:mb-0">{t(text)}</dd>
          </div>
        ))}
      </dl>
      <VerdictLegend />
      <p className="text-sm">{t('readDefaults')}</p>
      <p className="text-sm">{t('readModelMode', { mode: tCalc('modeModel') })}</p>
    </section>
  );
}
