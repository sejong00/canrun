import type { Confidence, Verdict } from '@canrun/engine';
import { ctxMatrix, type ComboAssessment } from '@canrun/data';
import { getCombo } from './combos';
import { EXPECT_CONFIDENCES, EXPECT_MODES } from './guide-components';

/**
 * 산문 주장 고정 `<Expect>` 의 판정 (D43·10-14 D74) — 렌더하지 않는 MDX 컴포넌트(`components/guide/guide-components.tsx`),
 * 빌드 없는 확인 도구(`scripts/check-expect.ts`), 유닛 테스트(`test/hub-intros.test.ts` — 이론 추정 라벨·조건 검사)가 같은 함수를 쓴다.
 * 카탈로그를 읽으므로 서버(빌드) 전용 — 클라이언트 컴포넌트에서 import 하지 않는다.
 *
 * 조건 prop(D74): `quant`(기준 대신 그 양자화 행) · `ram`(dGPU = 시스템 RAM 계단 `ramSteps`, 통합·CPU = 메모리 옵션 `configCombos`
 * — 없으면 페이지 구성) · `ctx`/`kv`(콤보 ctx 표의 칸) · `mode`(실행 방식) · `confidence`(신뢰 라벨 — "공개 벤치마크가 표에 있다"·"이론 추정이다").
 * ctx 표는 콤보 페이지의 `qConfig` 구성으로 계산된다 — 기준 구성(dGPU 시스템 RAM 32GB)에 안 들어가는 콤보면 RAM 힌트 구성(예: 64GB)이라
 * 페이지 RAM 과 다르다. 그래서 그런 콤보의 ctx 주장은 `ram` 으로 그 용량을 밝혀야 하고, `ram` 을 주면 ctx 표의 RAM 과 같아야 한다
 * (10-14 hub-intros 리뷰 — 같은 8k 칸을 두고 "안 올라간다"와 "올라간다"가 둘 다 통과하던 문제). 통합 메모리·CPU 는 메모리 옵션이 곧 구성이라, `ram` 이
 * ctx 표의 구성과 다르면 그 구성(`configCombos` 의 표시 양자화)으로 같은 ctx 표를 계산해 칸을 본다(10-23 D120 리뷰 — DGX Spark 대표 구성이 128GB 가 된 뒤
 * "64GB 구성은 32k 에 안 들어간다"를 고정할 수 없던 문제). 그래픽카드(시스템 RAM 계단)는 그대로 ctx 표의 RAM 만.
 * `nodes`(10-23 D118): 여러 대 연결 구성(DGX Spark 2대·4대 — 콤보의 `clusterCombos`)을 가리킨다. `ram` 과 함께만 쓰고(구성 키가 (RAM, 대수)), ctx 표는 1대
 * 구성으로 계산되므로 `ctx` 와 함께 쓸 수 없다.
 */
export type ExpectClaim = {
  model: string;
  gpu: string;
  verdict?: string;
  fits?: string;
  quant?: string;
  mode?: string;
  ram?: string;
  /** 여러 대 연결 대수 (10-23 D118) — `ram` 과 함께 */
  nodes?: string;
  ctx?: string;
  kv?: string;
  confidence?: string;
};

export type ExpectActual = { verdict: Verdict; fits: boolean; mode: string; confidence: Confidence };

function label({ model, gpu, quant, ram, nodes, ctx, kv }: ExpectClaim): string {
  return `${model} × ${gpu}${quant ? ` ${quant}` : ''}${ram ? ` @${ram}GB` : ''}${nodes ? ` ×${nodes}` : ''}${ctx ? ` ctx ${ctx}${kv ? `/${kv}` : ''}` : ''}`;
}

/** 주장이 가리키는 칸의 실제 값 — 칸이 없거나 조건 조합이 맞지 않으면 throw */
export function resolveExpect(claim: ExpectClaim): ExpectActual {
  const { model, gpu, quant, ram, nodes, ctx, kv } = claim;
  const page = getCombo(model, gpu);
  if (!page) throw new Error(`guide Expect: unknown combo ${model} × ${gpu}`);
  const at = label(claim);
  if (nodes !== undefined) {
    if (ram === undefined) throw new Error(`guide Expect: ${at} — nodes needs ram (a configuration is (RAM, units))`);
    if (ctx !== undefined || kv !== undefined) throw new Error(`guide Expect: ${at} — the ctx table is computed on one unit, not ${nodes}`);
    const found = page.clusterCombos.find((c) => c.ramGB === Number(ram) && c.nodes === Number(nodes));
    if (!found) throw new Error(`guide Expect: ${at} — no ${ram} GB × ${nodes} configuration`);
    const q = quant === undefined ? found.baseline : found.perQuant.find((row) => row.quant === quant);
    if (!q) throw new Error(`guide Expect: ${at} — no such quant`);
    return { verdict: q.result.verdict, fits: q.fits, mode: q.result.mode, confidence: q.result.confidence };
  }
  if (ctx !== undefined) {
    const tableRam = page.qConfig.ramGB;
    if (ram !== undefined && Number(ram) !== tableRam) {
      // 통합·CPU: 그 메모리 구성의 ctx 표 (gpuHub.configs 와 configCombos 는 같은 순서 — getCombo)
      const index = page.gpu.kind === 'dgpu' ? -1 : page.configCombos.findIndex((c) => c.ramGB === Number(ram));
      if (index < 0) throw new Error(`guide Expect: ${at} — the ctx table is computed at ${tableRam} GB, not ${ram} GB`);
      const q = page.configCombos[index]!.display;
      if (quant !== undefined && quant !== q.quant) throw new Error(`guide Expect: ${at} — the ${ram} GB ctx table is for ${q.quant}`);
      const cell = ctxMatrix(page.gpu, page.gpuHub.configs[index]!, page.model, q)
        .rows.flat()
        .find((c) => c.ctx === Number(ctx) && c.kvQuant === (kv ?? 'f16'));
      if (!cell) throw new Error(`guide Expect: ${at} has no ctx table cell`);
      return { verdict: cell.verdict, fits: cell.fits, mode: cell.mode, confidence: cell.result.confidence };
    }
    if (ram === undefined && page.usesRamHint) {
      throw new Error(`guide Expect: ${at} — the ctx table is computed at ${tableRam} GB (RAM hint, not the page's ${page.config.ramGB} GB) — say so with ram="${tableRam}"`);
    }
    if (quant !== undefined && quant !== page.q.quant) throw new Error(`guide Expect: ${at} — the ctx table is for ${page.q.quant}`);
    const cell = page.matrix.rows.flat().find((c) => c.ctx === Number(ctx) && c.kvQuant === (kv ?? 'f16'));
    if (!cell) throw new Error(`guide Expect: ${at} has no ctx table cell`);
    return { verdict: cell.verdict, fits: cell.fits, mode: cell.mode, confidence: cell.result.confidence };
  }
  if (kv !== undefined) throw new Error(`guide Expect: ${at} — kv needs ctx`);
  let combo: ComboAssessment = page.combo;
  if (ram !== undefined) {
    const ramGB = Number(ram);
    const found = page.gpu.kind === 'dgpu' ? page.ramSteps.find((s) => s.ramGB === ramGB)?.combo : page.configCombos.find((c) => c.ramGB === ramGB);
    if (!found) throw new Error(`guide Expect: ${at} — no ${ram} GB configuration`);
    combo = found;
  }
  const q = quant === undefined ? combo.baseline : combo.perQuant.find((row) => row.quant === quant);
  if (!q) throw new Error(`guide Expect: ${at} — no such quant`);
  return { verdict: q.result.verdict, fits: q.fits, mode: q.result.mode, confidence: q.result.confidence };
}

/** 산문 주장과 데이터 대조 — 어긋나면 throw(빌드 실패). 맞으면 실제 값을 돌려준다 */
export function checkExpect(claim: ExpectClaim): ExpectActual {
  const { verdict, fits, mode, confidence } = claim;
  const at = label(claim);
  const actual = resolveExpect(claim);
  if (verdict !== undefined && verdict !== actual.verdict) {
    throw new Error(`guide Expect: ${at} verdict is ${actual.verdict}, prose expects ${verdict}`);
  }
  if (fits !== undefined && String(actual.fits) !== fits) {
    throw new Error(`guide Expect: ${at} fits=${actual.fits}, prose expects ${fits}`);
  }
  if (mode !== undefined) {
    if (!(EXPECT_MODES as readonly string[]).includes(mode)) throw new Error(`guide Expect: unknown mode "${mode}"`);
    // 미탑재(no-fit)는 실행 방식이 없다 — 모드 주장은 들어가는 구성에만
    if (!actual.fits || actual.mode !== mode) {
      throw new Error(`guide Expect: ${at} mode is ${actual.fits ? actual.mode : 'none (no fit)'}, prose expects ${mode}`);
    }
  }
  if (confidence !== undefined) {
    if (!(EXPECT_CONFIDENCES as readonly string[]).includes(confidence)) throw new Error(`guide Expect: unknown confidence "${confidence}"`);
    if (!actual.fits || actual.confidence !== confidence) {
      throw new Error(`guide Expect: ${at} confidence is ${actual.fits ? actual.confidence : 'none (no fit)'}, prose expects ${confidence}`);
    }
  }
  return actual;
}
