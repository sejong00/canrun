'use client';
import { classifyLicense, type QuantAssessment } from '@canrun/data/client';
import type { CalcTranslators } from '@/components/islands/calc-shared';
import { Pill, type PillTone } from '@/components/pill';
import { SpeedCellCore } from '@/components/speed-text';
import { VerdictChip } from '@/components/verdict-chip';
import { formatCompact, formatCtx, formatGB, formatInt, formatParams } from '@/lib/format';
import { comboDetailQuery, differsFromHubAssumption, type ResolvedHardware } from '@/lib/calc/hardware';
import type { ResultCard as Card } from '@/lib/calc/run';
import type { CalcState } from '@/lib/calc/state';
import { gpuName, memoryText, modeKey, noteLines, quantText, speedPhrase } from '@/lib/phrases';

/**
 * 카탈로그 밖 모델 카드의 출처 — 불러온 HF 모델(D57: HF 링크·배지·실행 명령), 직접 입력한 모델(D66: 링크·라이선스·명령 없음,
 * 파일 크기는 bpw 어림이라 "약 N GB")
 */
export type PinnedMeta = { kind: 'hf'; baseId: string; ggufRepo: string } | { kind: 'manual' };

const LICENSE_TONE: Record<ReturnType<typeof classifyLicense>, PillTone> = {
  permissive: 'neutral',
  custom: 'caution',
  nonCommercial: 'strong',
  unknown: 'caution',
};

/**
 * 결과 카드 1장 (docs/01 F1 카드 항목) — 판정(기준 quant)·표시 quant·속도 밴드+라벨·메모리·실행 방식·컨텍스트 여유·
 * 실측 배지·참고 줄·quant 표·링크. 마크업은 허브 표와 같은 코어 컴포넌트(VerdictChip·SpeedCellCore)를 쓴다.
 */
export function ResultCard({
  locale,
  t,
  card,
  state,
  hardware,
  prefix,
  focused,
  external,
  onSeeGpus,
}: {
  locale: string;
  t: CalcTranslators;
  card: Card;
  state: CalcState;
  hardware: ResolvedHardware;
  prefix: string;
  focused: boolean;
  /** 카탈로그 밖 모델 — 허브·콤보 페이지 대신 HF 링크와 실행 명령(D57), 직접 입력이면 링크 없이(D66) */
  external?: PinnedMeta;
  /** 이 모델이 돌아가는 GPU 목록으로 (모델 모드, 10-03 D65) */
  onSeeGpus?: () => void;
}) {
  const { model, combo } = card;
  const q = combo.display;
  const baseline = combo.baseline.result.verdict;
  const notes = noteLines({ reason: t.reason, hint: t.hint, verdict: t.verdict, common: t.common }, locale, combo, hardware.gpu.kind, false);
  const licenseClass = classifyLicense(model.license);
  const manual = external?.kind === 'manual';
  // 직접 입력 모델의 파일 크기는 bpw 어림 — 실제 파일처럼 소수 둘째 자리로 쓰지 않는다(규칙 3)
  const sizeText = (gb: number) => (manual ? t.calc('approxGB', { value: formatGB(locale, gb, 1) }) : t.common('gb', { value: formatGB(locale, gb, 2) }));
  const custom = hardware.gpu.id === 'custom';
  const detailQuery = comboDetailQuery(state, hardware, card.ctx);
  // `?ram=N` 이면 콤보 페이지가 사용자 RAM 으로 열린다 — 라벨의 허브 가정에서 RAM 을 뺀다 (10-03 D64 리뷰 반영)
  const ramShown = detailQuery.startsWith('?ram=');
  const comboHref = custom || external ? undefined : `${prefix}/can-i-run/${model.id}/on/${hardware.gpu.id}${detailQuery}`;
  // 컨텍스트 여유는 돌아가는 카드에만 — F(미탑재·너무 느림)엔 `maxCtx` 가 없고 현재 ctx 를 여유로 보이면 거짓
  const maxCtx = q.result.verdict === 'F' ? undefined : (combo.maxCtx ?? card.ctx);
  const maxCtxText =
    maxCtx === undefined ? undefined : maxCtx >= model.maxContext ? t.calc('ctxClamped', { ctx: formatCtx(model.maxContext) }) : formatCtx(maxCtx);
  // 실측 배지: 조인됐으면 "실측 N건", 기준 조건(8k·f16)에서만 조인되면 "8k·f16 조건 실측 N건". 수는 기준 조건의 실제 조인 수(run.ts)
  const measuredText =
    card.measuredCount === 0
      ? undefined
      : q.result.confidence === 'measured'
        ? t.calc('measuredBadge', { n: card.measuredCount })
        : t.calc('measuredElsewhere', { n: card.measuredCount });
  // "상세" 라벨 — 콤보 페이지의 평가 구성이 사용자 구성과 다르면 부기: dGPU 는 허브 가정(D2), 통합·CPU 는 콤보 페이지가 고른 RAM·OS
  const hubOther = hardware.gpu.kind !== 'dgpu' ? card.hubConfig : undefined;
  const osLabel = (os: ResolvedHardware['os']) => t.calc(os === 'windows' ? 'osWindows' : os === 'linux' ? 'osLinux' : 'osMacos');
  const detailsLabel =
    hardware.gpu.kind === 'dgpu'
      ? differsFromHubAssumption(state, hardware, ramShown)
        ? t.calc(ramShown ? 'cardDetailsHubNoRam' : 'cardDetailsHub')
        : t.calc('cardDetails')
      : hubOther && (hubOther.ramGB !== hardware.ramGB || hubOther.os !== hardware.os)
        ? t.calc('cardDetailsHubOther', { ram: formatInt(locale, hubOther.ramGB), os: osLabel(hubOther.os) })
        : t.calc('cardDetails');

  return (
    <li
      data-result-card
      data-model-id={model.id}
      aria-current={focused ? 'true' : undefined}
      className={`flex min-w-0 flex-col gap-2 rounded-lg border p-4 ${focused ? 'border-foreground' : 'border-border'}`}
    >
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {external?.kind === 'hf' ? (
          <a href={`https://huggingface.co/${external.baseId}`} rel="noopener noreferrer nofollow" target="_blank">
            {model.name}
          </a>
        ) : manual ? (
          <span>{model.name}</span>
        ) : (
          <a href={`${prefix}/model/${model.id}`}>{model.name}</a>
        )}
        <span className="text-xs font-normal text-muted-foreground">
          {model.moe && model.activeParamsB !== undefined
            ? t.calc('paramsMoe', { total: formatParams(locale, model.paramsB), active: formatParams(locale, model.activeParamsB) })
            : t.calc('paramsDense', { total: formatParams(locale, model.paramsB) })}
        </span>
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip verdict={baseline} label={t.verdict(baseline)} />
        {combo.reasoning && <Pill>{t.common('reasoningMark')}</Pill>}
        {external?.kind === 'hf' && <Pill tone="info">{t.calc('hfBadge')}</Pill>}
        {manual && <Pill tone="info">{t.calc('manualBadge')}</Pill>}
        {model.korean && <Pill tone="info">{t.calc('badgeKorean')}</Pill>}
        {!manual && <Pill tone={LICENSE_TONE[licenseClass]}>{t.license(licenseClass)}</Pill>}
        {measuredText && <Pill tone="info">{measuredText}</Pill>}
      </div>
      {/* 다운로드 많은 순(10-06 D68)일 때만 — 정렬 기준 수치. 출처·기준일은 목록 위 안내 한 줄 */}
      {state.sort === 'downloads' && !external && model.hfDownloads30d !== undefined && (
        <p data-downloads={model.hfDownloads30d} className="text-xs text-muted-foreground">
          {t.calc('cardDownloads', { count: formatCompact(locale, model.hfDownloads30d) })}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t.calc('cardQuant')}</dt>
        <dd>
          {quantText(t.hint, q)} · {t.tier(q.tier)} · {sizeText(q.fileGB)}
        </dd>
        {q.fReason !== 'no-fit' && (
          <>
            <dt className="text-muted-foreground">{t.calc('cardSpeed')}</dt>
            <dd data-speed-text>
              <SpeedCellCore locale={locale} q={q} tCommon={t.common} tConfidence={t.confidence} />
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t.calc('cardMemory')}</dt>
        <dd className="tabular-nums">{memoryText(t.memory, locale, q, hardware.gpu)}</dd>
        {q.fReason !== 'no-fit' && (
          <>
            <dt className="text-muted-foreground">{t.calc('cardMode')}</dt>
            <dd>{t.mode(modeKey(q.result.mode, hardware.gpu.kind))}</dd>
          </>
        )}
        {maxCtxText && (
          <>
            <dt className="text-muted-foreground">{t.calc('cardMaxCtx')}</dt>
            <dd>{maxCtxText}</dd>
          </>
        )}
      </dl>
      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {notes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {/* 서로 다른 카드(D67): 판정은 llama.cpp 기본(모든 카드에 나눠 올리기) 그대로 — 한 장에 다 들어가면 그 카드만 쓸 때의 결과(단독과 같은 값·라벨)를 참고로 */}
      {card.singleGpu && (
        <p data-single-gpu className="text-xs text-muted-foreground">
          {t.calc('singleGpuHint', {
            gpu: gpuName(t.names, card.singleGpu.gpu),
            speed: speedPhrase(t.common, t.confidence, locale, card.singleGpu.q),
          })}
        </p>
      )}
      {combo.perQuant.length > 1 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t.calc('cardAllQuants', { count: combo.perQuant.length })}</summary>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-2">
                  {t.table('quant')}
                </th>
                <th scope="col" className="py-1 pr-2">
                  {t.table('size')}
                </th>
                <th scope="col" className="py-1 pr-2">
                  {t.calc('filterVerdict')}
                </th>
                <th scope="col" className="py-1">
                  {t.calc('cardSpeed')}
                </th>
              </tr>
            </thead>
            <tbody>
              {combo.perQuant.map((x: QuantAssessment) => (
                <tr key={x.quant} className="border-t border-border align-top">
                  <th scope="row" className="py-1 pr-2 font-medium">
                    {x.quant}
                  </th>
                  <td className="py-1 pr-2 tabular-nums">{sizeText(x.fileGB)}</td>
                  <td className="py-1 pr-2">
                    <VerdictChip verdict={x.result.verdict} label={t.verdict(x.result.verdict)} compact />
                  </td>
                  <td className="py-1">{x.fReason === 'no-fit' ? t.common('none') : speedPhrase(t.common, t.confidence, locale, x)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {card.command && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">{t.calc('hfCommand')}</p>
          {/* 불러온 모델(D57)과 GPU 여러 장 구성(D67 — 콤보 페이지 명령은 1장 기준)의 명령 */}
          <code
            {...(external ? { 'data-hf-command': '' } : { 'data-run-command': '' })}
            className="block overflow-x-auto whitespace-pre rounded-md bg-muted p-2 text-xs"
          >
            {card.command}
          </code>
          {card.commandFitAuto && <p className="text-xs text-muted-foreground">{t.calc('fitAutoNote')}</p>}
        </div>
      )}
      <p className="flex flex-wrap gap-3 text-sm">
        {external?.kind === 'hf' ? (
          <a href={`https://huggingface.co/${external.ggufRepo}`} rel="noopener noreferrer nofollow" target="_blank">
            {t.calc('hfViewOnHf')}
          </a>
        ) : manual ? null : comboHref ? (
          <>
            <a href={comboHref} data-combo-link>
              {detailsLabel}
            </a>
            <a href={`${comboHref}#snippet`}>{t.calc(hardware.gpuCount > 1 ? 'cardHowToRunOneGpu' : 'cardHowToRun')}</a>
          </>
        ) : (
          <a href={`${prefix}/model/${model.id}`}>{t.calc('cardModelHub')}</a>
        )}
        {onSeeGpus && (
          <button type="button" data-see-gpus onClick={onSeeGpus} className="text-left underline underline-offset-4">
            {t.calc('seeGpusForModel')}
          </button>
        )}
      </p>
    </li>
  );
}
