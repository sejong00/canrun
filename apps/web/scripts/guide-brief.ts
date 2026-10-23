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
import { resolveGuideGrid } from '@/lib/guide-grid';
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
        // 페이지와 같은 규칙(10-03 D62): totalGB = 그래픽카드에 올라가는 가중치 + KV + 버퍼(Num needGB·ModelMemoryTable 기본값),
        // macTotalGB = 파일 전체 + KV + 버퍼(맥 — memory="unified")
        const row = hub.matrix.rows.find((r) => r.quant === hub.baselineQuant)!;
        const kv = kvGB(m.arch.kvBytesPerTokenF16, c);
        const buffer = computeBufferGB(c);
        return {
          ctx: c,
          fileGB: row.fileGB,
          gpuWeightsGB: row.gpuWeightsGB,
          kvGB: r1(kv),
          totalGB: r1(row.gpuWeightsGB + kv + buffer),
          macTotalGB: r1(row.fileGB + kv + buffer),
        };
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
      // 행마다(10-23 D119 — 구성 행 'gpu@128x2' 는 GPU 허브 그 구성의 칸, 대표 구성 행은 콤보 페이지와 같은 칸)
      grids: Object.fromEntries(
        Object.keys(entry.grids).map((key) => [
          key,
          resolveGuideGrid(key).rows.map((row) => ({
            row: row.key,
            cells: row.cells.map((cell) =>
              row.config === undefined
                ? combo(cell.model.id, row.gpu.id)
                : {
                    model: cell.model.id,
                    gpu: row.gpu.id,
                    ramGB: row.config.ramGB,
                    ...(row.config.nodes !== undefined ? { nodes: row.config.nodes } : {}),
                    // 여러 대 칸이 '1대로 충분'을 보이는가(10-23 D121 — 그 칸에는 판정·속도가 보이지 않는다)
                    ...(cell.oneUnit !== undefined ? { oneUnit: cell.oneUnit } : {}),
                    baseline: { quant: cell.combo.baseline.quant, verdict: cell.combo.baseline.result.verdict, reason: cell.combo.baseline.verdictReason },
                    display: { quant: cell.combo.display.quant, tier: cell.combo.display.tier, ...speed(cell.combo.display) },
                  },
            ),
          })),
        ]),
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
