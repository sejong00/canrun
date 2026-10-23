import { computeBufferGB, kvGB, usableGB } from '@canrun/engine';
import { configKey, type Gpu, type HwConfig, type Model } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { GgufSourceBadge, LicenseBadge } from '@/components/badges';
import { CtxMatrixTable } from '@/components/ctx-matrix';
import { SpeedCell } from '@/components/estimate';
import { ScrollTable, TABLE_CLASS } from '@/components/hub-table';
import { VerdictBadge, VerdictLegend } from '@/components/verdict';
import { VramBar } from '@/components/vram-bar';
import { isContentLocale } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';
import { catalog, findGpu, findModel } from '@/lib/catalog';
import { getCombo } from '@/lib/combos';
import { formatCtx, formatGB, formatInt, formatParams, formatUSD } from '@/lib/format';
import { checkExpect, type ExpectClaim } from '@/lib/expect-claim';
import {
  GUIDE_COMPONENTS,
  MEMORY_KINDS,
  NUM_KINDS,
  splitList,
  type MemoryKind,
  type NumKind,
} from '@/lib/guide-components';
import { resolveGuideGrid } from '@/lib/guide-grid';
import { guideEntry, isGuideSlug, isPublished } from '@/lib/guides';
import { getGpuHub, getModelHub } from '@/lib/hubs';
import { comboHref, gpuHref, guideHref, localeHref, modelHref } from '@/lib/links';
import { gpuName, memoryText, type Translate } from '@/lib/phrases';
import { isComboIndexable } from '@/lib/publish';
import { isRuntimeFactId, RUNTIME_FACT_SOURCE_KEYS, RUNTIME_FACTS } from '@/lib/runtime-facts';

/**
 * 가이드 MDX 컴포넌트 (P1-4 D42~D44) — 전부 서버 컴포넌트(훅은 next-intl 뿐, 클라이언트 JS 0).
 * 수치는 허브·콤보와 같은 조립 결과(`getCombo`·`getGpuHub`·`getModelHub`)에서만 온다 — 가이드와 해당 페이지의 숫자가 항상 같다.
 * 모르는 id·그리드는 throw (빌드 실패) — 오타가 조용히 빈 표가 되지 않게. 명세는 `lib/guide-components.ts`.
 */

type NamesT = Translate & { has?: (key: string) => boolean };

function useNames(): NamesT {
  return useTranslations('GpuName') as unknown as NamesT;
}

function needGpu(id: string | undefined, where: string): Gpu {
  const gpu = id ? findGpu(id) : undefined;
  if (!gpu) throw new Error(`guide ${where}: unknown gpu "${id}"`);
  return gpu;
}

function needModel(id: string | undefined, where: string): Model {
  const model = id ? findModel(id) : undefined;
  if (!model) throw new Error(`guide ${where}: unknown model "${id}"`);
  return model;
}

function needCombo(modelId: string, gpuId: string, where: string) {
  const page = getCombo(modelId, gpuId);
  if (!page) throw new Error(`guide ${where}: unknown combo ${modelId} × ${gpuId}`);
  return page;
}

/** 자체 데이터 블록 — AC "자체 데이터 1개 이상 인용"의 마커 (D42) */
function DataBlock({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <div data-guide-data={kind} className="flex flex-col gap-2">
      {children}
    </div>
  );
}

function Theoretical({ show }: { show: boolean }) {
  const t = useTranslations('GuideData');
  return show ? <p className="text-xs text-muted-foreground">{t('theoreticalNote')}</p> : null;
}

function memLabel(gpu: Gpu, locale: Locale, tGb: Translate): string {
  if (gpu.kind === 'dgpu') return tGb('gb', { value: formatInt(locale, gpu.vramGB ?? 0) });
  const opts = gpu.ramOptionsGB ?? [];
  return tGb('gb', { value: opts.map((v) => formatInt(locale, v)).join('/') });
}

/** 로캘 경로 — 서버 컴포넌트에서 next-intl 로캘을 읽는다 */
function useHub(): { locale: Locale; hub: (href: string) => string } {
  const locale = useLocale() as Locale;
  return { locale, hub: (href: string) => localeHref(locale, href) };
}


/**
 * GPU × 모델 판정 그리드 — 레지스트리 그리드(D44). 셀 = 콤보 페이지 헤드라인과 같은 조립, 공개 콤보만 링크.
 * 링크 텍스트는 허브 표와 같은 `Table.comboLink`("RTX 4060에서 gpt-oss-20b 판정 보기" — 10-16 D95).
 * 구성 행(`'<gpu>@<구성 키>'`, 10-23 D119)은 GPU 허브 '메모리 구성별 판정' 표의 칸 — 행 머리에 메모리(·대수)를 적고, 여러 대 행이 있으면 허브와 같은 안내 문장을 붙인다
 */
export function ComboGrid({ grid }: { grid: string }) {
  const { locale, hub } = useHub();
  const t = useTranslations('GuideData');
  const tCommon = useTranslations('Common');
  const tHint = useTranslations('Hint');
  const tVerdict = useTranslations('Verdict');
  const tTable = useTranslations('Table');
  const tHub = useTranslations('GpuHub');
  const names = useNames();
  const { models, rows } = resolveGuideGrid(grid);
  const anyTheoretical = rows.some((r) => r.cells.some((c) => c.combo.display.result.confidence === 'theoretical' && c.combo.display.fReason !== 'no-fit'));
  const anyConfig = rows.some((r) => r.config !== undefined);
  const anyCluster = rows.some((r) => (r.config?.nodes ?? 1) > 1);
  const caption = t(anyConfig ? 'gridCaptionRows' : 'gridCaption');
  const rowLabel = (gpu: Gpu, config: HwConfig | undefined) =>
    config === undefined
      ? memLabel(gpu, locale, tCommon)
      : (config.nodes ?? 1) > 1
        ? tHub('clusterOption', { ram: formatInt(locale, config.ramGB), nodes: formatInt(locale, config.nodes!) })
        : tCommon('gb', { value: formatInt(locale, config.ramGB) });
  return (
    <DataBlock kind="combo-grid">
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colHardware')}</th>
              {models.map((m) => (
                <th key={m.id} scope="col">
                  <a href={hub(modelHref(m.id))}>{m.name}</a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, gpu, config, cells }) => (
              <tr key={key} {...(config !== undefined ? { 'data-grid-config': configKey(config) } : {})}>
                <th scope="row">
                  <a href={hub(gpuHref(gpu.id))}>{gpuName(names, gpu)}</a>
                  <span className="block text-xs font-normal text-muted-foreground">{rowLabel(gpu, config)}</span>
                </th>
                {cells.map(({ model, combo, atRam, linkable }) => {
                  const q = combo.display;
                  return (
                    <td key={model.id}>
                      <div className="flex min-w-36 flex-col items-start gap-1">
                        <VerdictBadge verdict={combo.baseline.result.verdict} />
                        {q.quant !== combo.baseline.quant && (
                          <span className="text-xs text-muted-foreground">
                            {tHint(q.tier === 'desperate' ? 'recommendedDesperate' : 'recommended', {
                              quant: q.quant,
                              verdict: tVerdict(q.result.verdict),
                            })}
                          </span>
                        )}
                        {q.fReason === 'no-fit' && combo.ramHint ? (
                          <span className="text-xs text-muted-foreground">
                            {tHint('ramHint', { ram: formatInt(locale, combo.ramHint.ramGB), verdict: tVerdict(combo.ramHint.verdict) })}
                          </span>
                        ) : (
                          <SpeedCell q={q} />
                        )}
                        {atRam !== undefined && <span className="text-xs text-muted-foreground">{t('atRam', { ram: formatInt(locale, atRam) })}</span>}
                        {linkable && (
                          <a href={hub(comboHref(model.id, gpu.id))} data-combo-link className="text-xs">
                            {tTable('comboLink', { model: model.name, gpu: gpuName(names, gpu) })}
                          </a>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <Theoretical show={anyTheoretical} />
      {anyCluster && (
        <p data-guide-cluster-note className="text-xs text-muted-foreground">
          {tHub('clusterNote')}
        </p>
      )}
    </DataBlock>
  );
}

/** 카드별 판정 분포 — 허브 요약(전 카탈로그 모델, 대표 구성) */
export function GpuTierSummary({ gpus }: { gpus: string }) {
  const { locale, hub } = useHub();
  const t = useTranslations('GuideData');
  const tCommon = useTranslations('Common');
  const tVerdict = useTranslations('Verdict');
  const names = useNames();
  const list = splitList(gpus).map((id) => needGpu(id, 'GpuTierSummary'));
  return (
    <DataBlock kind="gpu-tier-summary">
      <ScrollTable label={t('tierCaption', { total: catalog.models.length })}>
        <table className={TABLE_CLASS}>
          <caption>{t('tierCaption', { total: catalog.models.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colHardware')}</th>
              <th scope="col">{t('colMemory')}</th>
              {(['S', 'A', 'B', 'F'] as const).map((v) => (
                <th key={v} scope="col">
                  {tVerdict(v)}
                </th>
              ))}
              <th scope="col">{t('colLargestFullGpu')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((gpu) => {
              const data = getGpuHub(gpu.id)!;
              const counts = data.counts[data.primaryIndex]!;
              const largest = data.faq.largestFullGpu;
              const largestModel = largest ? findModel(largest.combo.modelId) : undefined;
              return (
                <tr key={gpu.id}>
                  <th scope="row">
                    <a href={hub(gpuHref(gpu.id))}>{gpuName(names, gpu)}</a>
                  </th>
                  <td className="tabular-nums whitespace-nowrap">
                    {gpu.kind === 'dgpu'
                      ? tCommon('gb', { value: formatInt(locale, gpu.vramGB ?? 0) })
                      : tCommon('gb', { value: formatInt(locale, data.configs[data.primaryIndex]!.ramGB) })}
                  </td>
                  {(['S', 'A', 'B', 'F'] as const).map((v) => (
                    <td key={v} className="tabular-nums">
                      {counts[v]}
                    </td>
                  ))}
                  <td>
                    {largestModel && largest ? (
                      <>
                        <a href={hub(modelHref(largestModel.id))}>{largestModel.name}</a> <span className="text-xs text-muted-foreground">{largest.q.quant}</span>
                      </>
                    ) : (
                      tCommon('none')
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
    </DataBlock>
  );
}

/**
 * 모델별 필요 메모리 (기준 quant 가중치 + KV + 연산 버퍼) — 엔진 식 그대로.
 * memory="dgpu"(기본): 가중치 = 그래픽카드에 올라가는 몫(입력 임베딩·MTP 블록 제외, 10-03 D62), "unified"(맥): 파일 전체.
 */
export function ModelMemoryTable({ models, ctx = '8192', memory = 'dgpu' }: { models: string; ctx?: string; memory?: string }) {
  const { locale, hub } = useHub();
  const t = useTranslations('GuideData');
  const tCommon = useTranslations('Common');
  const c = Number(ctx);
  if (!Number.isFinite(c) || c <= 0) throw new Error(`guide ModelMemoryTable: bad ctx "${ctx}"`);
  if (!(MEMORY_KINDS as readonly string[]).includes(memory)) throw new Error(`guide ModelMemoryTable: bad memory "${memory}"`);
  const gpuRule = (memory as MemoryKind) === 'dgpu';
  const list = splitList(models).map((id) => needModel(id, 'ModelMemoryTable'));
  const caption = t(gpuRule ? 'memoryCaptionGpu' : 'memoryCaption', { ctx: formatCtx(c) });
  return (
    <DataBlock kind="model-memory">
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colModel')}</th>
              <th scope="col">{t('colParams')}</th>
              <th scope="col">{t(gpuRule ? 'colBaselineGpu' : 'colBaselineFile')}</th>
              <th scope="col">{t('colKv', { ctx: formatCtx(c) })}</th>
              <th scope="col">{t('colTotal', { ctx: formatCtx(c) })}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((model) => {
              const data = getModelHub(model.id)!;
              const row = data.matrix.rows.find((r) => r.quant === data.baselineQuant)!;
              const weights = gpuRule ? row.gpuWeightsGB : row.fileGB;
              const kv = kvGB(model.arch.kvBytesPerTokenF16, Math.min(c, model.maxContext));
              const total = weights + kv + computeBufferGB(Math.min(c, model.maxContext));
              return (
                <tr key={model.id}>
                  <th scope="row">
                    <a href={hub(modelHref(model.id))}>{model.name}</a>
                  </th>
                  <td className="tabular-nums whitespace-nowrap">
                    {model.moe && model.activeParamsB !== undefined
                      ? t('paramsMoe', { total: formatParams(locale, model.paramsB), active: formatParams(locale, model.activeParamsB) })
                      : t('paramsDense', { total: formatParams(locale, model.paramsB) })}
                  </td>
                  <td className="tabular-nums whitespace-nowrap">
                    {row.quant} · {tCommon('gb', { value: formatGB(locale, weights) })}
                  </td>
                  <td className="tabular-nums whitespace-nowrap">{tCommon('gb', { value: formatGB(locale, kv) })}</td>
                  <td className="tabular-nums whitespace-nowrap">{tCommon('gb', { value: formatGB(locale, total) })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
      <p className="text-xs text-muted-foreground">{t(gpuRule ? 'memoryNoteGpu' : 'memoryNote')}</p>
    </DataBlock>
  );
}

/** 모델별 KV 캐시 — 토큰당 바이트(config 유래)와 컨텍스트별 f16 KV 크기 */
export function KvPerTokenTable({ models, ctxs = '8192,32768,131072' }: { models?: string; ctxs?: string }) {
  const { locale, hub } = useHub();
  const t = useTranslations('GuideData');
  const tCommon = useTranslations('Common');
  const list = models ? splitList(models).map((id) => needModel(id, 'KvPerTokenTable')) : [...catalog.models];
  const ctxList = splitList(ctxs).map(Number);
  if (ctxList.some((c) => !Number.isFinite(c) || c <= 0)) throw new Error(`guide KvPerTokenTable: bad ctxs "${ctxs}"`);
  list.sort((a, b) => b.arch.kvBytesPerTokenF16 - a.arch.kvBytesPerTokenF16 || a.name.localeCompare(b.name));
  const caption = t('kvCaption');
  return (
    <DataBlock kind="kv-per-token">
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colModel')}</th>
              <th scope="col">{t('colKvPerToken')}</th>
              {ctxList.map((c) => (
                <th key={c} scope="col">
                  {t('colKvAt', { ctx: formatCtx(c) })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((model) => (
              <tr key={model.id}>
                <th scope="row">
                  <a href={hub(modelHref(model.id))}>{model.name}</a>
                </th>
                <td className="tabular-nums whitespace-nowrap">
                  {t('kib', { value: formatInt(locale, model.arch.kvBytesPerTokenF16 / 1024) })}
                </td>
                {ctxList.map((c) => (
                  <td key={c} className="tabular-nums whitespace-nowrap">
                    {c > model.maxContext ? tCommon('none') : tCommon('gb', { value: formatGB(locale, kvGB(model.arch.kvBytesPerTokenF16, c)) })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <p className="text-xs text-muted-foreground">{t('kvNote')}</p>
    </DataBlock>
  );
}

/** 한 모델의 quant 별 파일 크기·품질 그룹 (catalog model-quants + quants.json) */
export function QuantSizeTable({ model: modelId }: { model: string }) {
  const { locale } = useHub();
  const t = useTranslations('GuideData');
  const tCommon = useTranslations('Common');
  const tTier = useTranslations('QuantTier');
  const model = needModel(modelId, 'QuantSizeTable');
  const data = getModelHub(model.id)!;
  const caption = t('quantCaption', { model: model.name });
  return (
    <DataBlock kind="quant-sizes">
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colQuant')}</th>
              <th scope="col">{t('colBpw')}</th>
              <th scope="col">{t('colFile')}</th>
              <th scope="col">{t('colTier')}</th>
              <th scope="col">{t('colSource')}</th>
            </tr>
          </thead>
          <tbody>
            {data.quants.map(({ row, tier, publisher }) => {
              const def = catalog.quantDefs.find((d) => d.id === row.quant);
              return (
                <tr key={row.quant}>
                  <th scope="row">{row.quant}</th>
                  <td className="tabular-nums">{def?.bpw !== undefined ? formatGB(locale, def.bpw, 2) : tCommon('none')}</td>
                  <td className="tabular-nums whitespace-nowrap">{tCommon('gb', { value: formatGB(locale, row.fileGB, 2) })}</td>
                  <td>{tTier(tier)}</td>
                  <td>
                    <GgufSourceBadge publisher={publisher} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
    </DataBlock>
  );
}

/** 한 GPU 에서 quant 를 낮출 때 판정이 어떻게 바뀌는가 — 콤보 페이지의 quant 표와 같은 조립 */
export function QuantLadder({ model: modelId, gpu: gpuId }: { model: string; gpu: string }) {
  const { locale } = useHub();
  const t = useTranslations('GuideData');
  const tTier = useTranslations('QuantTier');
  const tMemory = useTranslations('Memory');
  const names = useNames();
  const page = needCombo(modelId, gpuId, 'QuantLadder');
  const caption = t('ladderCaption', { model: page.model.name, gpu: gpuName(names, page.gpu) });
  const quants = [...page.combo.perQuant].sort((a, b) => b.fileGB - a.fileGB);
  return (
    <DataBlock kind="quant-ladder">
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colQuant')}</th>
              <th scope="col">{t('colTier')}</th>
              <th scope="col">{t('colVerdict')}</th>
              <th scope="col">{t('colSpeed')}</th>
              <th scope="col">{t('colMemory')}</th>
            </tr>
          </thead>
          <tbody>
            {quants.map((q) => (
              <tr key={q.quant}>
                <th scope="row">{q.quant}</th>
                <td>{tTier(q.tier)}</td>
                <td>
                  <VerdictBadge verdict={q.result.verdict} />
                </td>
                <td>
                  <SpeedCell q={q} />
                </td>
                <td className="tabular-nums whitespace-nowrap">{memoryText(tMemory, locale, q, page.gpu)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <Theoretical show={quants.some((q) => q.result.confidence === 'theoretical' && q.fReason !== 'no-fit')} />
    </DataBlock>
  );
}

/** ctx × KV 표 — 콤보 페이지와 같은 표 (D46: headline 필수) */
export function CtxTable({ model: modelId, gpu: gpuId }: { model: string; gpu: string }) {
  const t = useTranslations('GuideData');
  const names = useNames();
  const page = needCombo(modelId, gpuId, 'CtxTable');
  return (
    <DataBlock kind="ctx-table">
      <CtxMatrixTable
        matrix={page.matrix}
        caption={t('ctxCaption', { model: page.model.name, gpu: gpuName(names, page.gpu), quant: page.q.quant })}
        headline={page.q}
      />
    </DataBlock>
  );
}

/**
 * 같은 VRAM 용량의 그래픽카드 전부 (10-19 D105) — 카탈로그 dGPU(데스크톱·노트북)를 메모리 대역폭이 높은 순으로, 카드마다 판정 분포.
 * CanRun 계산에서 들어가는지는 쓸 수 있는 메모리만 보므로 같은 용량끼리 판정이 갈리는 것은 속도 때문이다. 목록은 카탈로그에서 나온다(카드가 들어오면 늘어난다)
 */
export function VramPeers({ vram }: { vram: string }) {
  const { locale, hub } = useHub();
  const t = useTranslations('GuideData');
  const tVerdict = useTranslations('Verdict');
  const names = useNames();
  const gb = Number(vram);
  const list = catalog.gpus
    .filter((g) => g.kind === 'dgpu' && g.vramGB === gb)
    .sort((a, b) => b.memBandwidthGBs - a.memBandwidthGBs || a.id.localeCompare(b.id));
  if (list.length === 0) throw new Error(`guide VramPeers: no ${vram}GB graphics card in the catalog`);
  const caption = t('vramPeersCaption', { vram: formatInt(locale, gb), count: list.length, total: catalog.models.length });
  return (
    <DataBlock kind="vram-peers">
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colHardware')}</th>
              <th scope="col">{t('colBandwidth')}</th>
              {(['S', 'A', 'B', 'F'] as const).map((v) => (
                <th key={v} scope="col">
                  {tVerdict(v)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((gpu) => {
              const data = getGpuHub(gpu.id)!;
              const counts = data.counts[data.primaryIndex]!;
              return (
                <tr key={gpu.id}>
                  <th scope="row">
                    <a href={hub(gpuHref(gpu.id))}>{gpuName(names, gpu)}</a>
                  </th>
                  <td className="tabular-nums whitespace-nowrap">{t('gbps', { value: formatInt(locale, gpu.memBandwidthGBs) })}</td>
                  {(['S', 'A', 'B', 'F'] as const).map((v) => (
                    <td key={v} className="tabular-nums">
                      {counts[v]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
    </DataBlock>
  );
}

/** 통합 메모리 기기 × RAM 구성별 판정 분포 — GPU 허브의 구성별 카운트 */
export function UnifiedTierTable({ gpus }: { gpus: string }) {
  const { locale, hub } = useHub();
  const t = useTranslations('GuideData');
  const tCommon = useTranslations('Common');
  const tVerdict = useTranslations('Verdict');
  const names = useNames();
  const list = splitList(gpus).map((id) => needGpu(id, 'UnifiedTierTable'));
  for (const gpu of list) if (gpu.kind !== 'unified') throw new Error(`guide UnifiedTierTable: ${gpu.id} is not unified memory`);
  const caption = t('unifiedCaption', { total: catalog.models.length });
  return (
    <DataBlock kind="unified-tiers">
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colHardware')}</th>
              <th scope="col">{t('colMemory')}</th>
              <th scope="col">{t('colBandwidth')}</th>
              <th scope="col">{t('colUsable')}</th>
              {(['S', 'A', 'B', 'F'] as const).map((v) => (
                <th key={v} scope="col">
                  {tVerdict(v)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.flatMap((gpu) => {
              const data = getGpuHub(gpu.id)!;
              return data.configs.map((config, i) => {
                const counts = data.counts[i]!;
                return (
                  <tr key={`${gpu.id}-${configKey(config)}`}>
                    <th scope="row">
                      <a href={hub(gpuHref(gpu.id))}>{gpuName(names, gpu)}</a>
                    </th>
                    <td className="tabular-nums">{tCommon('gb', { value: formatInt(locale, config.ramGB) })}</td>
                    <td className="tabular-nums whitespace-nowrap">{t('gbps', { value: formatInt(locale, config.hw.memBandwidthGBs) })}</td>
                    <td className="tabular-nums">{tCommon('gb', { value: formatGB(locale, usableGB(config.hw)) })}</td>
                    {(['S', 'A', 'B', 'F'] as const).map((v) => (
                      <td key={v} className="tabular-nums">
                        {counts[v]}
                      </td>
                    ))}
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </ScrollTable>
    </DataBlock>
  );
}

/** 모델 사양 요약 — 파라미터·최대 컨텍스트·라이선스·GGUF 출처 (한국 모델 가이드 등) */
export function ModelFacts({ models }: { models: string }) {
  const { locale, hub } = useHub();
  const t = useTranslations('GuideData');
  const list = splitList(models).map((id) => needModel(id, 'ModelFacts'));
  const caption = t('factsCaption');
  return (
    <DataBlock kind="model-facts">
      <ScrollTable label={caption}>
        <table className={TABLE_CLASS}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('colModel')}</th>
              <th scope="col">{t('colParams')}</th>
              <th scope="col">{t('colContext')}</th>
              <th scope="col">{t('colLicense')}</th>
              <th scope="col">{t('colSource')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((model) => {
              const data = getModelHub(model.id)!;
              const baseline = data.quants.find((q) => q.row.quant === data.baselineQuant)!;
              return (
                <tr key={model.id}>
                  <th scope="row">
                    <a href={hub(modelHref(model.id))}>{model.name}</a>
                  </th>
                  <td className="tabular-nums whitespace-nowrap">
                    {model.moe && model.activeParamsB !== undefined
                      ? t('paramsMoe', { total: formatParams(locale, model.paramsB), active: formatParams(locale, model.activeParamsB) })
                      : t('paramsDense', { total: formatParams(locale, model.paramsB) })}
                  </td>
                  <td className="tabular-nums">{formatCtx(model.maxContext)}</td>
                  <td>
                    <LicenseBadge license={model.license} hfId={model.hfId} />
                  </td>
                  <td>
                    <GgufSourceBadge publisher={baseline.publisher} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
    </DataBlock>
  );
}

/** 필요 메모리 분해 바 — 콤보 페이지와 같은 VramBar */
export function MemoryBreakdown({ model: modelId, gpu: gpuId }: { model: string; gpu: string }) {
  const t = useTranslations('GuideData');
  const names = useNames();
  const page = needCombo(modelId, gpuId, 'MemoryBreakdown');
  return (
    <DataBlock kind="memory-breakdown">
      <p className="text-sm font-medium">{t('breakdownCaption', { model: page.model.name, gpu: gpuName(names, page.gpu), quant: page.q.quant })}</p>
      <VramBar breakdown={page.breakdown} gpu={page.gpu} mode={page.q.result.mode} />
    </DataBlock>
  );
}

/** 공개 실측 1점 — 조인된 실측만(아니면 빌드 실패). 문장은 speedPhrase(실측 + 8k 추정 밴드), 출처 링크 동반 (D42) */
export function Measured({ model: modelId, gpu: gpuId }: { model: string; gpu: string }) {
  const t = useTranslations('GuideData');
  const names = useNames();
  const page = needCombo(modelId, gpuId, 'Measured');
  const q = page.q;
  if (q.result.confidence !== 'measured' || !q.measured) {
    throw new Error(`guide Measured: ${modelId} × ${gpuId} has no joined measurement`);
  }
  // 출처 URL 은 코어 타입에 없다 — 같은 (GPU, 모델, quant) 의 전체 벤치 레코드에서
  const sources = [
    ...new Set(
      catalog.benchmarks
        .filter((b) => b.gpuId === gpuId && b.modelId === modelId && b.quant === q.quant)
        .map((b) => b.sourceUrl),
    ),
  ];
  return (
    <DataBlock kind="measured">
      <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
        <span className="font-medium">
          {t('measuredTitle', { model: page.model.name, gpu: gpuName(names, page.gpu), quant: q.quant })}
        </span>
        <SpeedCell q={q} />
        <span className="text-xs text-muted-foreground">
          {t('measuredSources')}{' '}
          {sources.map((url, i) => (
            <span key={url}>
              {i > 0 && ', '}
              <a href={url}>{new URL(url).hostname.replace(/^www\./, '')}</a>
            </span>
          ))}
        </span>
      </div>
    </DataBlock>
  );
}

/** 판정 기준 범례 — 임계값 문장이라 규칙 3 밴드 검사에서 빠진다(`data-threshold`) */
export function Threshold() {
  return (
    <div data-threshold>
      <VerdictLegend />
    </div>
  );
}

/** 인라인 수치 한 개 — 데이터에서 계산 (산문에 숫자를 쓰지 않는다, D43) */
export function Num({
  kind,
  model,
  gpu,
  quant,
  ctx,
  kv,
  ram,
}: {
  kind: string;
  model?: string;
  gpu?: string;
  quant?: string;
  ctx?: string;
  kv?: string;
  ram?: string;
}) {
  const { locale } = useHub();
  const t = useTranslations('GuideData');
  const tCommon = useTranslations('Common');
  if (!(NUM_KINDS as readonly string[]).includes(kind)) throw new Error(`guide Num: unknown kind "${kind}"`);
  const k = kind as NumKind;
  const c = ctx ? Number(ctx) : 8192;
  const kvq = kv === 'q8_0' || kv === 'q4_0' ? kv : 'f16';
  /** 행렬 행 — fileGB(파일)·gpuWeightsGB(그래픽카드에 올라가는 가중치, 10-03 D62) */
  const rowOf = (m: Model) => {
    const data = getModelHub(m.id)!;
    const want = quant ?? data.baselineQuant;
    const row = data.matrix.rows.find((r) => r.quant === want);
    if (!row) throw new Error(`guide Num: ${m.id} has no ${want}`);
    return row;
  };
  const fileOf = (m: Model) => rowOf(m).fileGB;
  let text: string;
  switch (k) {
    case 'fileGB':
      text = tCommon('gb', { value: formatGB(locale, fileOf(needModel(model, 'Num'))) });
      break;
    case 'gpuWeightsGB':
      text = tCommon('gb', { value: formatGB(locale, rowOf(needModel(model, 'Num')).gpuWeightsGB) });
      break;
    case 'kvGB': {
      const m = needModel(model, 'Num');
      text = tCommon('gb', { value: formatGB(locale, kvGB(m.arch.kvBytesPerTokenF16, c, kvq)) });
      break;
    }
    case 'needGB': {
      // 판정과 같은 규칙: 그래픽카드는 올라가는 가중치만, 통합 메모리 칩(gpu 지정)은 파일 전체 (10-03 D62)
      const m = needModel(model, 'Num');
      const unified = gpu !== undefined && needGpu(gpu, 'Num').kind === 'unified';
      const weights = unified ? fileOf(m) : rowOf(m).gpuWeightsGB;
      text = tCommon('gb', { value: formatGB(locale, weights + kvGB(m.arch.kvBytesPerTokenF16, c, kvq) + computeBufferGB(c)) });
      break;
    }
    case 'vramGB': {
      const g = needGpu(gpu, 'Num');
      if (g.kind !== 'dgpu') throw new Error(`guide Num vramGB: ${g.id} is not a dGPU`);
      text = tCommon('gb', { value: formatInt(locale, g.vramGB ?? 0) });
      break;
    }
    case 'bandwidth':
      text = t('gbps', { value: formatInt(locale, needGpu(gpu, 'Num').memBandwidthGBs) });
      break;
    case 'usableGB': {
      // 허브 요약 구성(통합 메모리 칩 = 가장 큰 메모리), `ram` 을 주면 그 메모리 구성(10-23 D117 — DGX Spark 64GB)
      const g = needGpu(gpu, 'Num');
      const data = getGpuHub(g.id)!;
      const config = ram === undefined ? data.configs[data.primaryIndex] : data.configs.find((c) => c.ramGB === Number(ram));
      if (!config) throw new Error(`guide Num usableGB: ${g.id} has no ${ram} GB configuration`);
      text = tCommon('gb', { value: formatGB(locale, usableGB(config.hw)) });
      break;
    }
    case 'params': {
      const m = needModel(model, 'Num');
      text = t('paramsDense', { total: formatParams(locale, m.paramsB) });
      break;
    }
    case 'layers':
      text = formatInt(locale, needModel(model, 'Num').arch.layers);
      break;
    case 'maxContext':
      text = formatCtx(needModel(model, 'Num').maxContext);
      break;
  }
  return (
    <span data-guide-data="num" className="tabular-nums">
      {text}
    </span>
  );
}

/**
 * 가격 — 실거래가는 기준일 동반(규칙 2), 없으면 출시가, 둘 다 없으면 빌드 실패.
 * 본문 속 짧은 값이라 원화 참고값(D61)은 붙이지 않는다 — 원화는 환산 안내를 함께 달 수 있는 허브·콤보 화면에서만.
 */
export function Price({ gpu: gpuId }: { gpu: string }) {
  const { locale } = useHub();
  const tSpec = useTranslations('GpuHub');
  const gpu = needGpu(gpuId, 'Price');
  const text =
    gpu.streetUSD !== undefined && gpu.priceAsOf
      ? tSpec('priceStreet', { price: formatUSD(locale, gpu.streetUSD), date: gpu.priceAsOf })
      : gpu.msrpUSD !== undefined
        ? tSpec('priceMsrp', { price: formatUSD(locale, gpu.msrpUSD) })
        : undefined;
  if (!text) throw new Error(`guide Price: ${gpu.id} has no price`);
  return <span data-guide-data="price">{text}</span>;
}

/** 외부 도구 동작 사실 — 출처·확인일 동반. 문장·출처 줄 이름은 레코드가 정한다(`lib/runtime-facts.ts`, 10-19) */
export function RuntimeFact({ id }: { id: string }) {
  const t = useTranslations('GuideData');
  if (!isRuntimeFactId(id)) throw new Error(`guide RuntimeFact: unknown id "${id}"`);
  const fact = RUNTIME_FACTS[id];
  return (
    <span data-runtime-fact={id}>
      {t(fact.message)} (
      <a href={fact.source}>{t(RUNTIME_FACT_SOURCE_KEYS[fact.tool], { date: fact.checked })}</a>)
    </span>
  );
}

export function HubLink({ gpu, model, children }: { gpu?: string; model?: string; children?: ReactNode }) {
  const { hub } = useHub();
  const names = useNames();
  if (gpu) {
    const g = needGpu(gpu, 'HubLink');
    return <a href={hub(gpuHref(g.id))}>{children ?? gpuName(names, g)}</a>;
  }
  const m = needModel(model, 'HubLink');
  return <a href={hub(modelHref(m.id))}>{children ?? m.name}</a>;
}

/** 다른 가이드 — published 만 링크(D40), 초안은 제목 텍스트만 */
export function GuideLink({ slug: target, children }: { slug: string; children?: ReactNode }) {
  const { locale, hub } = useHub();
  if (!isGuideSlug(target)) throw new Error(`guide GuideLink: unknown slug "${target}"`);
  // MDX 장문은 장문 로캘(en·ko)에서만 그려진다(D109) — zh 에서 불리면 빌드 실패
  if (!isContentLocale(locale)) throw new Error(`guide GuideLink: rendered on locale "${locale}" without long-form content`);
  const title = guideEntry(target).locales[locale].title;
  if (!isPublished(target)) return <span data-guide-link-draft={target}>{children ?? title}</span>;
  return <a href={hub(guideHref(target))}>{children ?? title}</a>;
}

/** 콤보 — 공개(index) 콤보만 링크(D9·D44), 아니면 문장 텍스트만 */
export function ComboLink({ model: modelId, gpu: gpuId, children }: { model: string; gpu: string; children?: ReactNode }) {
  const { hub } = useHub();
  const t = useTranslations('GuideData');
  const names = useNames();
  const model = needModel(modelId, 'ComboLink');
  const gpu = needGpu(gpuId, 'ComboLink');
  const label = children ?? t('comboOn', { model: model.name, gpu: gpuName(names, gpu) });
  if (!isComboIndexable(gpu.id, model.id)) return <span>{label}</span>;
  return (
    <a href={hub(comboHref(model.id, gpu.id))} data-combo-link>
      {label}
    </a>
  );
}

/**
 * 산문 주장 고정 (D43) — 렌더하지 않는다. 콤보 판정·fit·실행 방식이 산문과 어긋나면 빌드 실패:
 * 주간 data-sync·매일 신모델 추가로 데이터가 바뀌면 PR 이 빨개지고 문장을 고친다.
 * 조건 prop(`quant`·`ram`·`ctx`/`kv`·`mode`, 10-14 D74)과 대조 규칙은 `lib/expect-claim.ts` — 빌드 없는 도구·유닛 테스트와 같은 함수다.
 */
export function Expect(props: ExpectClaim) {
  checkExpect(props);
  return null;
}

export const GUIDE_MDX_COMPONENTS = {
  ComboGrid,
  GpuTierSummary,
  ModelMemoryTable,
  KvPerTokenTable,
  QuantSizeTable,
  QuantLadder,
  CtxTable,
  UnifiedTierTable,
  VramPeers,
  ModelFacts,
  MemoryBreakdown,
  Measured,
  Threshold,
  Num,
  Price,
  RuntimeFact,
  HubLink,
  GuideLink,
  ComboLink,
  Expect,
};

// 명세(lib/guide-components.ts)와 맵이 어긋나면 모듈 로드(빌드)에서 실패 — MDX 스캔 테스트가 같은 명세를 본다
{
  const missing = Object.keys(GUIDE_COMPONENTS).filter((name) => !(name in GUIDE_MDX_COMPONENTS));
  const extra = Object.keys(GUIDE_MDX_COMPONENTS).filter((name) => !(name in GUIDE_COMPONENTS));
  if (missing.length || extra.length) throw new Error(`guide components drift: missing ${missing.join(",")} extra ${extra.join(",")}`);
}
