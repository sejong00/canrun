/**
 * 가이드 데이터 브리프 (P1-4 5단계, 개발 도구) — 가이드 작성·사실 확인용으로 컴포넌트가 렌더할 수치를 JSON 으로 뽑는다.
 * 가이드 컴포넌트와 같은 조립(`getCombo`·`getGpuHub`·`getModelHub`)을 쓰므로 여기 값 = 페이지에 찍히는 값.
 *
 *   cd apps/web && npx tsx scripts/guide-brief.ts guide <slug>        # 레지스트리 + 그리드 셀 전부
 *   cd apps/web && npx tsx scripts/guide-brief.ts combo <model> <gpu>  # 콤보 1개 (quant 전부·ctx 표·명령)
 *   cd apps/web && npx tsx scripts/guide-brief.ts gpu <id> | model <id> | kv
 */
import { computeBufferGB, kvGB, usableGB } from '@canrun/engine';
import type { QuantAssessment } from '@canrun/data';
import { GUIDES, type GuideSlug } from '@/content/guides';
import { catalog, findGpu, findModel } from '@/lib/catalog';
import { getCombo } from '@/lib/combos';
import { getGpuHub, getModelHub } from '@/lib/hubs';
import { isComboIndexable } from '@/lib/publish';

const r1 = (v: number) => Math.round(v * 10) / 10;

function speed(q: QuantAssessment) {
  if (q.fReason === 'no-fit') return { fits: false };
  const s = q.result.tgTokS;
  const e = q.estimate.tgTokS;
  return {
    fits: true,
    verdict: q.result.verdict,
    mode: q.result.mode,
    confidence: q.result.confidence,
    tgTokS: { est: r1(s.est), low: r1(s.low), high: r1(s.high) },
    ...(q.result.confidence === 'measured' ? { estimate8k: { est: r1(e.est), low: r1(e.low), high: r1(e.high), confidence: q.estimate.confidence } } : {}),
    needGB: r1(q.memory.needGB),
    gpuGB: r1(q.memory.gpuGB),
    gpuUsableGB: r1(q.memory.gpuUsableGB),
    ramGB: r1(q.memory.ramGB),
  };
}

function combo(modelId: string, gpuId: string, detail = false) {
  const page = getCombo(modelId, gpuId);
  if (!page) throw new Error(`unknown combo ${modelId} × ${gpuId}`);
  const c = page.combo;
  return {
    model: modelId,
    gpu: gpuId,
    ramGB: page.config.ramGB,
    baseline: { quant: c.baseline.quant, verdict: c.baseline.result.verdict, reason: c.baseline.verdictReason },
    display: { quant: c.display.quant, tier: c.display.tier, ...speed(c.display) },
    ...(c.recommended && c.recommended.quant !== c.baseline.quant ? { recommended: c.recommended.quant } : {}),
    ...(c.ramHint ? { ramHint: { ramGB: c.ramHint.ramGB, verdict: c.ramHint.verdict, mode: c.ramHint.mode } } : {}),
    maxCtx: c.maxCtx,
    publicComboPage: isComboIndexable(gpuId, modelId),
    ...(detail
      ? {
          perQuant: c.perQuant.map((q) => ({ quant: q.quant, tier: q.tier, fileGB: q.fileGB, ...speed(q) })),
          ctxTable: page.matrix.rows.flat().map((cell) => ({
            ctx: cell.ctx,
            kv: cell.kvQuant,
            needGB: r1(cell.needGB),
            fits: cell.fits,
            verdict: cell.verdict,
          })),
          llamaCpp: page.plan.llamaCpp?.command,
          ollama: page.plan.ollama ? { serve: page.plan.ollama.serve, run: page.plan.ollama.run } : { omitted: page.plan.ollamaOmitted },
        }
      : {}),
  };
}

function gpu(id: string) {
  const g = findGpu(id);
  if (!g) throw new Error(`unknown gpu ${id}`);
  const hub = getGpuHub(id)!;
  return {
    id,
    name: g.name,
    kind: g.kind,
    vramGB: g.vramGB,
    ramOptionsGB: g.ramOptionsGB,
    bandwidthGBs: g.memBandwidthGBs,
    fp16Tflops: g.fp16Tflops,
    streetUSD: g.streetUSD,
    priceAsOf: g.priceAsOf,
    msrpUSD: g.msrpUSD,
    configs: hub.configs.map((cfg, i) => ({ ramGB: cfg.ramGB, os: cfg.hw.os, usableGB: r1(usableGB(cfg.hw)), counts: hub.counts[i] })),
    largestFullGpu: hub.faq.largestFullGpu ? { model: hub.faq.largestFullGpu.combo.modelId, quant: hub.faq.largestFullGpu.q.quant } : undefined,
    largestRunnable: hub.faq.largestRunnable ? { model: hub.faq.largestRunnable.combo.modelId, quant: hub.faq.largestRunnable.q.quant } : undefined,
    benchmarks: hub.benchmarks.map((b) => ({ model: b.modelId, quant: b.quant, tgTokS: b.tgTokS, ctx: b.ctx, source: b.sourceUrl })),
  };
}

function model(id: string) {
  const m = findModel(id);
  if (!m) throw new Error(`unknown model ${id}`);
  const hub = getModelHub(id)!;
  return {
    id,
    name: m.name,
    paramsB: m.paramsB,
    activeParamsB: m.activeParamsB,
    moe: m.moe,
    layers: m.arch.layers,
    attnType: m.arch.attnType,
    kvBytesPerTokenF16: m.arch.kvBytesPerTokenF16,
    maxContext: m.maxContext,
    license: m.license,
    korean: m.korean ?? false,
    category: m.category,
    baselineQuant: hub.baselineQuant,
    quants: hub.quants.map((q) => ({ quant: q.row.quant, fileGB: q.row.fileGB, tier: q.tier, publisher: q.publisher.kind, repo: q.row.ggufRepo })),
    memoryAt: [8192, 32768, 131072]
      .filter((c) => c <= m.maxContext)
      .map((c) => {
        const file = hub.quants.find((q) => q.row.quant === hub.baselineQuant)!.row.fileGB;
        const kv = kvGB(m.arch.kvBytesPerTokenF16, c);
        return { ctx: c, fileGB: file, kvGB: r1(kv), totalGB: r1(file + kv + computeBufferGB(c)) };
      }),
    cheapest: hub.cheapest,
  };
}

const [cmd, a, b] = process.argv.slice(2);
let out: unknown;
switch (cmd) {
  case 'guide': {
    const entry = GUIDES[a as GuideSlug];
    if (!entry) throw new Error(`unknown guide ${a}`);
    out = {
      slug: a,
      entry,
      grids: Object.fromEntries(
        Object.entries(entry.grids).map(([key, g]) => [key, g.gpus.flatMap((gid) => g.models.map((mid) => combo(mid, gid)))]),
      ),
    };
    break;
  }
  case 'combo':
    out = combo(a!, b!, true);
    break;
  case 'gpu':
    out = gpu(a!);
    break;
  case 'model':
    out = model(a!);
    break;
  case 'kv':
    out = catalog.models
      .map((m) => ({ id: m.id, attnType: m.arch.attnType, kvKiBPerToken: r1(m.arch.kvBytesPerTokenF16 / 1024), maxContext: m.maxContext }))
      .sort((x, y) => y.kvKiBPerToken - x.kvKiBPerToken);
    break;
  default:
    throw new Error('usage: guide <slug> | combo <model> <gpu> | gpu <id> | model <id> | kv');
}
console.log(JSON.stringify(out, null, 1));
