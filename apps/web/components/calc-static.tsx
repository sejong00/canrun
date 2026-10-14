import type { QuantAssessment } from '@canrun/data';
import { HUB_POLICY } from '@canrun/data';
import { UNIFIED_USABLE_FRACTION } from '@canrun/engine';
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
 * 문구는 messages `CalculatorStatic`(계산기 아일랜드 props 에 실리지 않는 서버 전용 이름공간) + 카드와 같은 라벨(`Calculator.card*`·`size*`·`Mode.*`).
 */

const SIZE_KEY: Record<SizeBucket, string> = { s: 'sizeS', m: 'sizeM', l: 'sizeL', xl: 'sizeXl' };
const OS_KEY = { windows: 'osWindows', linux: 'osLinux', macos: 'osMacos' } as const;
/** "결과 읽는 법"의 실행 방식 목록 — 카드에 찍히는 `Mode.*` 라벨마다 뜻 한 줄 */
const MODE_ROWS = [
  ['fullGpu', 'readModeFullGpu'],
  ['fullUnified', 'readModeFullUnified'],
  ['partialOffload', 'readModePartialOffload'],
  ['cpuMoe', 'readModeCpuMoe'],
  ['cpuOnly', 'readModeCpuOnly'],
] as const;

type GpuKind = StartingPoint['gpu']['kind'];

/** 많이 쓰는 하드웨어 6종 × 크기 구간별 계산기 추천순 첫 모델 + GPU 에 전부 올라가는 가장 큰 모델 (lib/starting-points.ts) */
export function CalcStartingPoints({ locale }: { locale: Locale }) {
  const t = useTranslations('CalculatorStatic');
  const tCalc = useTranslations('Calculator');
  const tCommon = useTranslations('Common');
  const points = startingPoints();
  const reasoning = points.some(
    (p) => p.largest?.reasoning || p.picks.some((pick) => pick.kind === 'pick' && pick.combo.reasoning),
  );
  return (
    <section aria-labelledby="start-heading" data-starting-points className="flex flex-col gap-3">
      <h2 id="start-heading" className="text-xl font-semibold tracking-tight">
        {t('startTitle')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('startIntro')}</p>
      <p className="text-sm text-muted-foreground">
        {t('startAssume', {
          ram: formatInt(locale, HUB_POLICY.dgpuRamGB),
          os: tCalc(OS_KEY[HUB_POLICY.dgpuOs]),
          ctx: formatCtx(HUB_POLICY.referenceCtx),
        })}
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
  const { gpu, largest } = point;
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
      {/* 하드웨어마다 달라지는 줄 (D73 리뷰 반영) — GPU 허브 FAQ 의 "GPU 에 전부 올라가는 가장 큰 모델"과 같은 값 */}
      {largest && (
        <div data-start-largest={largest.model.id} className="flex min-w-0 flex-col gap-1 border-t border-border pt-3 text-sm">
          <p className="text-xs text-muted-foreground">{t('startLargest')}</p>
          <ModelLine
            locale={locale}
            gpuId={gpu.id}
            gpuKind={gpu.kind}
            model={largest.model}
            q={largest.q}
            reasoning={largest.reasoning}
            comboIndexable={largest.comboIndexable}
          />
        </div>
      )}
      <p className="mt-auto text-sm">
        <a href={localeHref(locale, calculatorHref(`?gpu=${gpu.id}`))} data-start-calc>
          {t('startOpen', { total: point.total, gpu: name })}
        </a>
      </p>
    </li>
  );
}

/** 모델 한 줄 — 이름(공개 콤보면 콤보 페이지, 아니면 모델 허브) · 그 양자화의 판정 · 생각 모드 · 속도 밴드+라벨 · 양자화 · 실행 방식 */
function ModelLine({
  locale,
  gpuId,
  gpuKind,
  model,
  q,
  reasoning,
  comboIndexable,
}: {
  locale: Locale;
  gpuId: string;
  gpuKind: GpuKind;
  model: { id: string; name: string };
  q: QuantAssessment;
  reasoning: boolean;
  comboIndexable: boolean;
}) {
  const tCommon = useTranslations('Common');
  const tMode = useTranslations('Mode');
  const tHint = useTranslations('Hint');
  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        {/* 공개(index) 콤보만 콤보 페이지로, 나머지는 모델 허브로 — 공개 페이지는 공개 콤보로만 링크한다(docs/04 §3) */}
        <a
          href={localeHref(locale, comboIndexable ? comboHref(model.id, gpuId) : modelHref(model.id))}
          data-start-pick={comboIndexable ? 'combo' : 'model'}
          className="font-medium"
        >
          {model.name}
        </a>
        <VerdictBadge verdict={q.result.verdict} />
        {reasoning && <Pill>{tCommon('reasoningMark')}</Pill>}
      </span>
      {/* 표·카드와 같은 속도 셀(밴드 + 신뢰 라벨)을 한 줄로 눕혀 카드 높이를 줄인다 */}
      <div className="[&_[data-speed]]:flex-row [&_[data-speed]]:flex-wrap [&_[data-speed]]:items-center [&_[data-speed]]:gap-x-2">
        <SpeedCell q={q} />
      </div>
      <span className="text-xs text-muted-foreground">
        {quantText(tHint, q)} · {tMode(modeKey(q.result.mode, gpuKind))}
      </span>
    </>
  );
}

function PickRow({ locale, gpuId, gpuKind, pick }: { locale: Locale; gpuId: string; gpuKind: GpuKind; pick: StartingPick }) {
  const t = useTranslations('CalculatorStatic');
  const tCalc = useTranslations('Calculator');
  return (
    <div data-start-bucket={pick.bucket} className="contents">
      <dt className="text-muted-foreground">{tCalc(SIZE_KEY[pick.bucket])}</dt>
      {pick.kind === 'pick' ? (
        // 추천순 첫 모델은 기준 판정이 불가가 아니라 표시 양자화 = 기준 양자화다(배지 = 계산기 카드의 기준 판정)
        <dd className="flex min-w-0 flex-col gap-1" data-start-model={pick.model.id}>
          <ModelLine
            locale={locale}
            gpuId={gpuId}
            gpuKind={gpuKind}
            model={pick.model}
            q={pick.combo.display}
            reasoning={pick.combo.reasoning}
            comboIndexable={pick.comboIndexable}
          />
        </dd>
      ) : (
        <dd className="flex min-w-0 flex-col gap-1" data-start-none>
          <span className="flex flex-wrap items-center gap-2">
            <VerdictBadge verdict="F" />
            <span>{t('startNone', { models: pick.models })}</span>
          </span>
          {pick.lowerQuant > 0 && <span className="text-xs text-muted-foreground">{t('startLowerQuant', { count: pick.lowerQuant })}</span>}
          {/* 계산기 카드의 "RAM N GB라면: 판정"과 같은 값 — 구간 안에서 RAM 을 가장 적게 늘려도 나아지는 모델 하나 */}
          {pick.ramHint && (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-start-ram-hint={pick.ramHint.model.id}>
              <span>{t('startRamHint', { ram: formatInt(locale, pick.ramHint.ramGB), model: pick.ramHint.model.name })}</span>
              <VerdictBadge verdict={pick.ramHint.verdict} />
            </span>
          )}
        </dd>
      )}
    </div>
  );
}

/** 결과 카드 읽는 법 — 카드와 같은 라벨(dt)에 뜻을 붙이고, 판정 기준표(VerdictLegend)를 이어 붙인다 */
export function CalcReadingGuide() {
  const t = useTranslations('CalculatorStatic');
  const tCalc = useTranslations('Calculator');
  const tMode = useTranslations('Mode');
  // 판정 기준 양자화(`baselineOrder` — 없으면 다음 순위)와 통합 메모리의 GPU 몫은 정책·엔진 상수에서 받는다(문장에 숫자를 적지 않는다)
  const [baseQuant, altQuant] = HUB_POLICY.baselineOrder;
  const rows: ReadonlyArray<readonly [string, string | null]> = [
    ['filterVerdict', t('readVerdict', { quant: baseQuant!, alt: altQuant! })],
    ['cardQuant', t('readQuant')],
    ['cardSpeed', t('readSpeed')],
    ['cardMemory', t('readMemory', { pct: Math.round(UNIFIED_USABLE_FRACTION * 100) })],
    ['cardMode', null],
    ['cardMaxCtx', t('readMaxCtx')],
    ['cardDetails', t('readDetails')],
  ];
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
            {text !== null ? (
              <dd className="mb-2 text-muted-foreground sm:mb-0">{text}</dd>
            ) : (
              // 실행 방식은 카드에 찍히는 라벨(`Mode.*`)을 그대로 쓰고 라벨마다 뜻을 붙인다 — 설명과 카드 라벨이 어긋나지 않게
              <dd className="mb-2 flex flex-col gap-1 text-muted-foreground sm:mb-0">
                <span>{t('readMode')}</span>
                <ul data-read-modes className="flex flex-col gap-1">
                  {MODE_ROWS.map(([mode, desc]) => (
                    <li key={mode}>
                      <span className="font-medium text-foreground">{tMode(mode)}</span>: {t(desc)}
                    </li>
                  ))}
                </ul>
              </dd>
            )}
          </div>
        ))}
      </dl>
      <VerdictLegend />
      <p className="text-sm">{t('readDefaults')}</p>
      <p className="text-sm">{t('readModelMode', { mode: tCalc('modeModel') })}</p>
    </section>
  );
}
