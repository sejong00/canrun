import {
  commandPlan,
  ggufPublisher,
  HUB_POLICY,
  isFp16Crippled,
  maxCtxAtVerdict,
  ppRange,
  type PpRange,
  type QuantAssessment,
} from '@canrun/data';
import { kvGB } from '@canrun/engine';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdjacentLinks } from '@/components/adjacent-links';
import { AlternativeCards } from '@/components/alternative-cards';
import { GgufSourceBadge, LicenseBadge, Pill } from '@/components/badges';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { CommandSnippet } from '@/components/command-snippet';
import { ConfigVerdictList } from '@/components/config-verdict-list';
import { CtxMatrixTable } from '@/components/ctx-matrix';
import { CtxKvControls, type CtxCellView, type CtxKvRam, type RamPlanView } from '@/components/islands/ctx-kv-controls';
import { llamaNotes, ollamaNotes, snippetFileText } from '@/lib/snippet-phrases';
import { SpeedCell } from '@/components/estimate';
import { Faq } from '@/components/faq';
import { BenchTable, ScrollTable, TABLE_CLASS } from '@/components/hub-table';
import { PageShell } from '@/components/page-shell';
import { VerdictBadge } from '@/components/verdict';
import { VramBar } from '@/components/vram-bar';
import type { Locale } from '@/i18n/routing';
import { catalog } from '@/lib/catalog';
import {
  comboDescription,
  comboFaq,
  comboMemoryLabel,
  ramStepSentence,
  titleVerdictText,
  usableGBFor,
  verdictSentence,
  type ComboTranslators,
} from '@/lib/combo-phrases';
import { getCombo } from '@/lib/combos';
import { formatCtx, formatGB, formatInt } from '@/lib/format';
import { calculatorHref, comboHref, localeHref, modelHref } from '@/lib/links';
import { comboOgImage } from '@/lib/og-images';
import { canLinkCombo } from '@/lib/publish';
import { gpuName, modeKey, ppPhrase, shortGpuName, speedPhrase, type Translate } from '@/lib/phrases';
import { buildPageMetadata } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: Locale; model: string; gpu: string }> };

/** docs/04 §2 `/can-i-run/{model}/on/{gpu}` — 카탈로그 전 조합 (결정 D9), 인덱싱은 publish.json 게이트 */
export function generateStaticParams() {
  return catalog.models.flatMap((model) => catalog.gpus.map((gpu) => ({ model: model.id, gpu: gpu.id })));
}

export const dynamicParams = false;

type Tr = Translate & { has?: (key: string) => boolean };

async function translators(locale: Locale): Promise<ComboTranslators> {
  const [combo, faq, common, confidence, verdict, names, hint, gpuHub] = await Promise.all([
    getTranslations({ locale, namespace: 'Combo' }),
    getTranslations({ locale, namespace: 'Faq' }),
    getTranslations({ locale, namespace: 'Common' }),
    getTranslations({ locale, namespace: 'Confidence' }),
    getTranslations({ locale, namespace: 'Verdict' }),
    getTranslations({ locale, namespace: 'GpuName' }),
    getTranslations({ locale, namespace: 'Hint' }),
    getTranslations({ locale, namespace: 'GpuHub' }),
  ]);
  return { combo, faq, common, confidence, verdict, names, hint, gpuHub } as unknown as Record<
    keyof ComboTranslators,
    Tr
  >;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, model: modelId, gpu: gpuId } = await params;
  const page = getCombo(modelId, gpuId);
  if (!page) return {};
  const t = await translators(locale);
  const name = gpuName(t.names, page.gpu);
  return buildPageMetadata({
    href: comboHref(modelId, gpuId),
    locale,
    absoluteTitle: true,
    noindex: !page.publish.indexable,
    // 공개 콤보만 페이지별 카드(10-16 D96 — postbuild 가 indexable 집합만 그린다), 미공개는 기본 카드
    ...(page.publish.indexable ? { ogImage: comboOgImage(modelId, gpuId, locale) } : {}),
    title: t.combo('metaTitle', {
      model: page.model.name,
      gpu: shortGpuName(name),
      verdict: titleVerdictText(t, page, locale),
    }),
    // 답부터: 판정 + 필요 메모리 + 속도 밴드·신뢰 라벨 (10-16 D95 — 배치 문장은 본문 헤더·FAQ 몫)
    description: comboDescription(t, page, locale),
  });
}

export default async function ComboPage({ params }: Props) {
  const { locale, model: modelId, gpu: gpuId } = await params;
  setRequestLocale(locale);
  const page = getCombo(modelId, gpuId);
  if (!page) notFound();

  const t = await translators(locale);
  const tTable = await getTranslations({ locale, namespace: 'Table' });
  const tBreadcrumb = await getTranslations({ locale, namespace: 'Breadcrumb' });
  const tMode = await getTranslations({ locale, namespace: 'Mode' });
  const tAlt = await getTranslations({ locale, namespace: 'Alternatives' });
  const tSnippet = await getTranslations({ locale, namespace: 'Snippet' });
  const tAdjacent = await getTranslations({ locale, namespace: 'Adjacent' });
  const tReason = await getTranslations({ locale, namespace: 'VerdictReason' });
  const tCommonNs = await getTranslations({ locale, namespace: 'Common' });
  const tMemory = await getTranslations({ locale, namespace: 'Memory' });
  const tCtx = await getTranslations({ locale, namespace: 'CtxControls' });

  const { gpu, model, combo, q } = page;
  const name = gpuName(t.names, gpu);
  const href = comboHref(model.id, gpu.id);
  const sentence = verdictSentence(t, page, locale);
  const faq = comboFaq(t, page, locale, sentence);
  const gb = (v: number) => formatGB(locale, v);
  const speed = (x: QuantAssessment) => speedPhrase(t.common, t.confidence, locale, x);
  const indexable = page.publish.indexable;
  const linkOk = (g: string, m: string) => canLinkCombo(indexable, g, m);
  const publisher = ggufPublisher(model, page.qRow);
  const kvQ8 = kvGB(model.arch.kvBytesPerTokenF16, 8192, 'q8_0');
  const configLabel = comboMemoryLabel(t, page, locale);

  // ctx×KV 셀 뷰 — 아일랜드(D28)가 쓸 완성 문장·명령. 헤드라인 셀(8k·f16)이 실측이면 그 문장을 그대로 쓴다
  const cells: CtxCellView[] = page.matrix.rows.flat().map((cell) => {
    // 정적 표(CtxMatrixTable)와 같은 판정 — 헤드라인 실측 result 를 그대로 쓴 셀만 헤드라인 문장 (D46)
    const speedQ = cell.result === q.result ? q : { result: cell.result, estimate: cell.result };
    const summary = cell.fits
      ? tCtx('summary', {
          ctx: formatCtx(cell.ctx),
          kv: cell.kvQuant,
          quant: q.quant,
          need: gb(cell.needGB),
          verdict: t.verdict(cell.verdict),
          speed: speedPhrase(t.common, t.confidence, locale, speedQ),
        })
      : gpu.kind === 'dgpu'
        ? // dGPU 는 부분 오프로드로 VRAM + RAM 까지 쓴다 — VRAM 만 한도로 쓰면 옆 셀(더 큰 필요량인데 들어감)과 모순 (재검증)
          tCtx('summaryNoFitDgpu', {
            ctx: formatCtx(cell.ctx),
            kv: cell.kvQuant,
            quant: q.quant,
            need: gb(cell.needGB),
            usable: gb(q.memory.gpuUsableGB),
            ram: gb(q.memory.ramUsableGB),
          })
        : tCtx('summaryNoFit', {
            ctx: formatCtx(cell.ctx),
            kv: cell.kvQuant,
            quant: q.quant,
            need: gb(cell.needGB),
            usable: gb(usableGBFor(page, q)),
          });
    const plan = cell.plan;
    return {
      ctx: cell.ctx,
      kv: cell.kvQuant,
      need: gb(cell.needGB),
      fits: cell.fits,
      verdict: cell.verdict,
      summary,
      ...(plan?.llamaCpp ? { command: plan.llamaCpp.command } : {}),
      ...(plan?.ollama
        ? {
            ollama: {
              code: `${plan.ollama.serve}\n${plan.ollama.run}`,
              replSet: plan.ollama.replSet,
              notes: ollamaNotes(tSnippet, plan),
              serveHint: plan.os === 'windows' ? tSnippet('serveWindows') : tSnippet('serveUnix'),
            },
          }
        : plan?.llamaCpp
          ? { ollamaOmitted: tSnippet('ollamaSharded') }
          : {}),
      notes: plan ? llamaNotes(tSnippet, locale, plan, kvGB(model.arch.kvBytesPerTokenF16, cell.ctx, 'q8_0')) : [],
    };
  });
  // 시스템 RAM 토글 (10-03 D64) — 맨 위 판정이 RAM 계단에서 바뀌는 dGPU 페이지만. 엔진을 싣지 않고 서버가 RAM 마다 완성한
  // 판정 문장(ramStepSentence — 헤더와 같은 문장 규칙, 안 들어가면 시스템 RAM 몫으로)과, 들어가는 양자화마다 실행 계획 1개
  // (명령은 RAM 과 무관 — 양자화로 중복 제거)를 넘긴다. 안내 문장·코드 영역 이름은 RAM 을 밝혀야 해서 단계마다 따로 만든다.
  // 정적 기준 RAM(qConfig — 보통 32GB, RAM 힌트 페이지는 힌트 RAM)은 정적 블록이 그 자체라 문장·계획을 싣지 않는다
  let ramToggle: CtxKvRam | undefined;
  if (page.ramSensitive) {
    const initialRam = page.qConfig.ramGB;
    const plans: RamPlanView[] = [];
    const planOf = new Map<string, { index: number; tag: string }>();
    const options = page.ramSteps.map((step) => {
      const d = step.combo.display;
      const isInitial = step.ramGB === initialRam;
      const ram = formatInt(locale, step.ramGB);
      if (!isInitial && d.fits && !planOf.has(d.quant)) {
        const row = catalog.modelQuants.find((r) => r.modelId === model.id && r.quant === d.quant)!;
        const cp = commandPlan(gpu, step.config, model, row, d);
        if (cp.llamaCpp) {
          planOf.set(d.quant, { index: plans.length, tag: cp.file.tag });
          plans.push({
            file: snippetFileText(tSnippet, locale, cp),
            command: cp.llamaCpp.command,
            notes: llamaNotes(tSnippet, locale, cp, kvQ8).map((n) => n.text),
            ...(cp.ollama
              ? {
                  ollama: {
                    code: `${cp.ollama.serve}\n${cp.ollama.run}`,
                    replSet: cp.ollama.replSet,
                    notes: ollamaNotes(tSnippet, cp),
                    serveHint: cp.os === 'windows' ? tSnippet('serveWindows') : tSnippet('serveUnix'),
                  },
                }
              : { ollamaOmitted: tSnippet('ollamaSharded') }),
          });
        }
      }
      const planned = !isInitial && d.fits ? planOf.get(d.quant) : undefined;
      return {
        ram: step.ramGB,
        label: t.gpuHub('ramOption', { ram }),
        summary: isInitial ? '' : ramStepSentence(t, page, step, locale),
        plan: planned?.index ?? -1,
        ...(planned
          ? {
              view: {
                intro: tCtx('ramIntro', { ram, quant: planned.tag }),
                llamaCpp: tCtx('ramRegion', { ram, tool: tSnippet('llamaCpp') }),
                ollama: tCtx('ramRegion', { ram, tool: tSnippet('ollama') }),
              },
            }
          : {}),
      };
    });
    ramToggle = {
      options,
      plans,
      initial: initialRam,
      calcHref: localeHref(locale, calculatorHref(`?gpu=${gpu.id}&m=${model.id}`)),
      labels: {
        legend: tCtx('ram'),
        locked: tCtx('ramLocked', { ram: formatInt(locale, initialRam) }),
        calcLink: tCtx('calcLink'),
        llamaCpp: tSnippet('llamaCpp'),
        ollama: tSnippet('ollama'),
      },
    };
  }
  // RAM 토글이 있는 섹션의 제목 — "실행 방법"이 다른 RAM 의 명령을 고르는 곳으로 이 이름을 가리킨다
  const ramSection = t.combo('ctxTitleRam');
  // 메모리 열의 분모 — dGPU 는 VRAM 전체, 통합은 GPU 사용 가능량 (허브 표와 동일)
  const memTotal = gpu.kind === 'dgpu' ? (gpu.vramGB ?? 0) : q.memory.gpuUsableGB;

  // fp16Tflops 가 없는 칩은 FP16 구절을 뺀다(10-16 D85 — 지금 카탈로그엔 이런 칩이 없다. M5 Ultra 는 D87 에서 위키백과 표 값을 넣었다)
  const fp16 = gpu.fp16Tflops;
  const spec =
    gpu.kind === 'dgpu'
      ? fp16 !== undefined
        ? t.combo('specDgpu', { vram: formatInt(locale, gpu.vramGB ?? 0), bandwidth: gb(gpu.memBandwidthGBs), fp16: gb(fp16) })
        : t.combo('specDgpuNoFp16', { vram: formatInt(locale, gpu.vramGB ?? 0), bandwidth: gb(gpu.memBandwidthGBs) })
      : gpu.kind === 'unified'
        ? fp16 !== undefined
          ? t.combo('specUnified', { ram: formatInt(locale, page.config.ramGB), bandwidth: gb(gpu.memBandwidthGBs), fp16: gb(fp16) })
          : t.combo('specUnifiedNoFp16', { ram: formatInt(locale, page.config.ramGB), bandwidth: gb(gpu.memBandwidthGBs) })
        : t.combo('specCpu', { ram: formatInt(locale, page.config.ramGB), bandwidth: gb(gpu.memBandwidthGBs) });
  const ramFloor = HUB_POLICY.comboRamGB[0]!;
  const ramCeil = HUB_POLICY.comboRamGB.at(-1)!;
  const assumption =
    gpu.kind === 'dgpu'
      ? t.gpuHub('assumeDgpu', { ram: formatInt(locale, page.config.ramGB) })
      : gpu.kind === 'unified'
        ? t.gpuHub('assumeUnified')
        : t.gpuHub('assumeCpu');
  // dGPU: RAM 계단 전체에서 맨 위 판정이 같으면 그 사실만 한 구절로 (10-03 D64) — 바뀌면 "시스템 RAM 용량별 판정" 목록
  const ramSame =
    gpu.kind === 'dgpu' && !page.ramSensitive
      ? t.combo('ramSame', { min: formatInt(locale, ramFloor), max: formatInt(locale, ramCeil) })
      : undefined;

  // pp 는 항상 범위 + rough 라벨 (규칙 3, D13) — 문장은 GPU 비교(10-19 D103)와 같은 `ppPhrase`
  const ppText = (r: PpRange) => ppPhrase(t.combo, t.confidence, locale, r);

  // 쌍둥이 GPU 형제 문장 (D22) — 메모리 구성 동일이라 속도 *추정* 이 같고, FP16(pp)만 다름
  const twin = page.twins[0];
  let twinText: string | undefined;
  if (twin) {
    const twinName = gpuName(t.names, twin);
    twinText = t.combo('twin', { twin: twinName, memory: configLabel, bandwidth: gb(gpu.memBandwidthGBs) });
    const ppTwinRow = page.modelHub.gpuRows.find((r) => r.gpu.id === twin.id);
    const ppTwin = ppTwinRow ? ppRange(ppTwinRow.combo.display) : undefined;
    if (page.pp && ppTwin) {
      twinText += t.combo('twinPp', { pp: ppText(page.pp), ppTwin: ppText(ppTwin), twin: twinName });
    }
  }

  // F 페이지가 RAM 힌트 구성으로 표·속도를 만들 때, 그 수치가 어느 구성인지 문장마다 밝힌다
  const hintPrefix = page.usesRamHint ? t.combo('hintPrefix', { ram: formatInt(locale, page.qConfig.ramGB) }) : '';
  // fits 면 판정을 유지하는 최대 ctx; too-slow(F 지만 fits)는 "들어가는" 최대 ctx (combo-phrases 의 FAQ Q2 와 같은 규칙)
  const ctxF16 = q.fits ? maxCtxAtVerdict(page.matrix, 'f16', q.result.verdict) : undefined;
  const ctxQ8 = q.fits ? maxCtxAtVerdict(page.matrix, 'q8_0', q.result.verdict) : undefined;
  const firstCell = page.matrix.rows[0]![0]!;

  const reasonText = (x: QuantAssessment): string | undefined => {
    if (x.fReason === 'too-slow') return tReason('tooSlow');
    if (x.fReason === 'no-fit') return undefined;
    switch (x.verdictReason) {
      case 'cap-full-gpu-only':
        return tReason('capFullGpuOnly');
      case 'cap-partial':
        return tReason('capPartial');
      case 'cap-cpu-moe':
        return tReason('capCpuMoe', { min: formatInt(locale, x.capMinTokS ?? 0) });
      case 'cap-cpu-only':
        return tReason('capCpuOnly');
      default:
        return undefined;
    }
  };

  return (
    <PageShell locale={locale} href={href}>
      <article className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <Breadcrumbs
            crumbs={[
              { name: tBreadcrumb('home'), href: localeHref(locale, '/'), url: absoluteUrl(localeHref(locale, '/')) },
              {
                name: model.name,
                href: localeHref(locale, modelHref(model.id)),
                url: absoluteUrl(localeHref(locale, modelHref(model.id))),
              },
              { name, href: localeHref(locale, href), url: absoluteUrl(localeHref(locale, href)) },
            ]}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t.combo('h1', { model: model.name, gpu: name })}
          </h1>
          <p data-verdict-sentence className="flex flex-wrap items-start gap-2 text-lg">
            <VerdictBadge verdict={combo.baseline.result.verdict} />
            <span>{sentence}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {gpu.form === 'laptop' && <Pill tone="caution">{t.gpuHub('badgeLaptop')}</Pill>}
            {gpu.kind === 'unified' && <Pill tone="info">{t.gpuHub('badgeUnified')}</Pill>}
            {gpu.kind === 'cpu' && <Pill tone="info">{t.gpuHub('badgeCpu')}</Pill>}
            {isFp16Crippled(gpu) && <Pill tone="caution">{t.gpuHub('badgeFp16')}</Pill>}
            <LicenseBadge license={model.license} hfId={model.hfId} />
            <GgufSourceBadge publisher={publisher} />
            {combo.reasoning && <Pill>{t.common('reasoningMark')}</Pill>}
          </div>
          <p className="text-sm text-muted-foreground">
            {spec} {assumption}
            {ramSame && <span data-ram-same>{ramSame}</span>}
            {twinText && <span data-twin> {twinText}</span>}
          </p>
        </header>

        {page.configCombos.length > 1 && (
          <section aria-labelledby="config-heading" className="flex flex-col gap-2">
            <h2 id="config-heading" className="text-xl font-semibold tracking-tight">
              {t.combo('configTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t.combo('configCaption', { ram: formatInt(locale, page.config.ramGB) })}
            </p>
            <ConfigVerdictList
              rows={page.configCombos.map((c, i) => ({ ramGB: c.ramGB, combo: c, assumed: i === page.configIndex }))}
            />
          </section>
        )}

        {page.ramSensitive && (
          <section aria-labelledby="ram-heading" className="flex flex-col gap-2">
            <h2 id="ram-heading" className="text-xl font-semibold tracking-tight">
              {t.combo('ramStepsTitle')}
            </h2>
            <p data-ram-caption={page.ramVerdictChanges ? 'verdict' : 'file'} className="text-sm text-muted-foreground">
              {t.combo(page.ramVerdictChanges ? 'ramStepsCaption' : 'ramStepsCaptionFile', {
                ram: formatInt(locale, page.config.ramGB),
              })}
            </p>
            <ConfigVerdictList
              rows={page.ramSteps.map((step) => ({
                ramGB: step.ramGB,
                combo: step.combo,
                assumed: step.ramGB === page.config.ramGB,
                commands: page.usesRamHint && step.ramGB === page.qConfig.ramGB,
              }))}
            />
          </section>
        )}

        <section aria-labelledby="quants-heading" className="flex flex-col gap-3">
          <h2 id="quants-heading" className="text-xl font-semibold tracking-tight">
            {t.combo('quantTitle', { model: model.name, gpu: name })}
          </h2>
          <ScrollTable label={t.combo('quantTitle', { model: model.name, gpu: name })}>
            <table className={TABLE_CLASS}>
              <caption>
                {gpu.kind === 'dgpu'
                  ? t.combo('quantCaptionRam', { count: combo.perQuant.length, ram: formatInt(locale, page.config.ramGB) })
                  : t.combo('quantCaption', { count: combo.perQuant.length })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{tTable('quant')}</th>
                  <th scope="col">{tTable('size')}</th>
                  <th scope="col">{tTable('verdict')}</th>
                  <th scope="col">{tTable('speed')}</th>
                  <th scope="col">{tTable('memory')}</th>
                  <th scope="col">{tTable('mode')}</th>
                  <th scope="col">{tTable('notes')}</th>
                </tr>
              </thead>
              <tbody>
                {combo.perQuant.map((x) => {
                  const reason = reasonText(x);
                  return (
                    <tr key={x.quant} id={`quant-${x.quant}`}>
                      <th scope="row" className="whitespace-nowrap">
                        {x.quant}
                        {x.quant === combo.baseline.quant && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{t.gpuHub('baselineMarkCombo')}</span>
                        )}
                      </th>
                      <td className="tabular-nums whitespace-nowrap">{t.common('gb', { value: formatGB(locale, x.fileGB, 2) })}</td>
                      <td>
                        <VerdictBadge verdict={x.result.verdict} />
                      </td>
                      <td>
                        <SpeedCell q={x} />
                      </td>
                      <td className="tabular-nums whitespace-nowrap">
                        {x.fReason === 'no-fit'
                          ? tReason(gpu.kind === 'dgpu' ? 'noFitDgpu' : gpu.kind === 'unified' ? 'noFitUnified' : 'noFitCpu', {
                              need: gb(x.memory.needGB),
                              gpu: gb(x.memory.gpuUsableGB),
                              ram: gb(x.memory.ramUsableGB),
                            })
                          : x.result.mode === 'cpu-only'
                            ? tMemory('ram', { ram: gb(x.memory.ramGB) })
                            : x.result.mode === 'full-gpu'
                              ? tMemory('gpu', { used: gb(x.memory.gpuGB), total: gb(memTotal) })
                              : tMemory('gpuPlusRam', {
                                  used: gb(x.memory.gpuGB),
                                  total: gb(memTotal),
                                  ram: gb(x.memory.ramGB),
                                })}
                      </td>
                      <td className="whitespace-nowrap">
                        {x.fReason === 'no-fit' ? t.common('none') : tMode(modeKey(x.result.mode, gpu.kind))}
                      </td>
                      <td className="text-xs text-muted-foreground">{reason ?? t.common('none')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
          {combo.reasoning && <p className="text-xs text-muted-foreground">{t.common('reasoningNote')}</p>}
        </section>

        <section aria-labelledby="memory-heading" className="flex flex-col gap-3">
          <h2 id="memory-heading" className="text-xl font-semibold tracking-tight">
            {t.combo('memoryTitle', { quant: q.quant })}
          </h2>
          {page.usesRamHint && (
            <p className="text-sm text-muted-foreground">
              {t.combo('hintConfig', { ram: formatInt(locale, page.qConfig.ramGB), pageRam: formatInt(locale, page.config.ramGB) })}
            </p>
          )}
          {q.fits ? (
            <VramBar breakdown={page.breakdown} gpu={gpu} mode={q.result.mode} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.combo('memoryNone', { quant: q.quant, need: gb(q.memory.needGB), usable: gb(usableGBFor(page, q)) })}
            </p>
          )}
        </section>

        <section aria-labelledby="ctx-heading" className="flex flex-col gap-3">
          <h2 id="ctx-heading" className="text-xl font-semibold tracking-tight">
            {ramToggle ? ramSection : t.combo('ctxTitle')}
          </h2>
          <CtxKvControls
            cells={cells}
            ctxs={page.matrix.ctxs}
            ctxLabels={page.matrix.ctxs.map(formatCtx)}
            kvQuants={page.matrix.kvQuants}
            initial={{ ctx: 8192, kv: 'f16' }}
            labels={{
              title: tCtx(ramToggle ? 'titleWithRam' : 'title'),
              ctx: tCtx('ctx'),
              kv: tCtx('kv'),
              reset: tCtx(ramToggle ? 'resetAll' : 'reset'),
              commandNone: tCtx('commandNone'),
              commandFollows: tCtx('commandFollows'),
            }}
            {...(ramToggle ? { ram: ramToggle } : {})}
          />
          <CtxMatrixTable matrix={page.matrix} caption={t.combo('ctxCaption', { quant: q.quant })} headline={q} />
          <p className="text-sm text-muted-foreground">
            {hintPrefix}
            {ctxF16 !== undefined
              ? t.combo(q.result.verdict === 'F' ? 'ctxSummaryTooSlow' : 'ctxSummary', {
                  quant: q.quant,
                  verdict: t.verdict(q.result.verdict),
                  ctx: formatCtx(ctxF16),
                  ctxQ8: formatCtx(ctxQ8 ?? ctxF16),
                })
              : t.combo('ctxSummaryNone', { quant: q.quant, need: gb(firstCell.needGB), usable: gb(usableGBFor(page, q)) })}
          </p>
        </section>

        <section aria-labelledby="speed-heading" className="flex flex-col gap-3">
          <h2 id="speed-heading" className="text-xl font-semibold tracking-tight">
            {t.combo('speedTitle')}
          </h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t.combo('tg')}</dt>
            <dd>
              {q.fReason === 'no-fit' ? t.common('none') : `${hintPrefix}${speed(q)}`}
            </dd>
            <dt className="text-muted-foreground">{t.combo('pp')}</dt>
            <dd>
              {page.pp
                ? ppText(page.pp)
                : fp16 === undefined && q.fits && q.result.mode === 'full-gpu'
                  ? t.combo('ppNoFp16')
                  : t.combo('ppNone')}
            </dd>
          </dl>
          {reasonText(q) && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t.combo('reason')}: </span>
              {reasonText(q)}
            </p>
          )}
          <h3 className="text-base font-medium">{t.combo('benchTitle')}</h3>
          {page.benchmarks.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">{tTable('benchIntro')}</p>
              <BenchTable
                points={page.benchmarks}
                firstColumn="hardware"
                models={catalog.models}
                gpus={catalog.gpus}
                gpuLabel={(g) => gpuName(t.names, g)}
                caption={t.combo('benchTitle')}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.combo('benchEmpty')}</p>
          )}
        </section>

        {page.alternatives.length > 0 && (
          <section aria-labelledby="alt-heading" className="flex flex-col gap-3">
            <h2 id="alt-heading" className="text-xl font-semibold tracking-tight">
              {tAlt('title')}
            </h2>
            <AlternativeCards items={page.alternatives} gpu={gpu} model={model} canLinkCombo={linkOk} />
          </section>
        )}

        <section id="snippet" aria-labelledby="snippet-heading" className="flex flex-col gap-3">
          <h2 id="snippet-heading" className="text-xl font-semibold tracking-tight">
            {tSnippet('title')}
          </h2>
          {page.plan.llamaCpp ? (
            <CommandSnippet
              plan={page.plan}
              kvGB={kvQ8}
              hintRamGB={page.usesRamHint ? page.qConfig.ramGB : undefined}
              {...(ramToggle ? { ramBasis: { ramGB: page.qConfig.ramGB, section: ramSection } } : {})}
            />
          ) : (
            <p data-no-run className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              {tSnippet(gpu.kind === 'cpu' ? 'noFitCpu' : gpu.kind === 'unified' ? 'noFitUnified' : 'noFit', {
                usable: gb(usableGBFor(page, q)),
                ram: gb(q.memory.ramUsableGB),
              })}
              {ramToggle && ` ${tSnippet('ramOther', { section: ramSection })}`}
            </p>
          )}
        </section>

        <section aria-labelledby="adjacent-heading" className="flex flex-col gap-3">
          <h2 id="adjacent-heading" className="text-xl font-semibold tracking-tight">
            {tAdjacent('title')}
          </h2>
          <AdjacentLinks adjacent={page.adjacent} gpu={gpu} model={model} />
        </section>

        <Faq items={faq} />

        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{tCommonNs('estimateNotice')}</p>
      </article>
    </PageShell>
  );
}
