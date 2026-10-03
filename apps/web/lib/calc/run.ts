/**
 * 계산기 결과 조립 (P1-3) — 전 카탈로그 모델을 사용자 구성으로 평가하고 정렬·필터한다. 순수 함수(DOM 없음).
 * 문장·포맷은 컴포넌트 몫(규칙 6); 여기서는 `ComboAssessment` 와 카드 메타만 만든다.
 */
import {
  assessCombo,
  commandPlan,
  compareCombos,
  estimateAt,
  hardwareConfigs,
  HUB_POLICY,
  pickConfigCombo,
  verdictRank,
  type CatalogLite,
  type ComboAssessment,
  type GpuCore,
  type HwConfig,
  type ModelCore,
  type ModelQuantCore,
} from '@canrun/data/client';
import type { Os, Result, Verdict } from '@canrun/engine';
import { resolveHardware, type ResolvedHardware } from './hardware';
import { normalize, sizeBucket, type CalcState, type SizeBucket } from './state';

export type ResultCard = {
  model: ModelCore;
  combo: ComboAssessment;
  /** 평가 ctx — 모델 최대보다 큰 선택은 최대로 클램프 */
  ctx: number;
  clamped: boolean;
  /**
   * 표시 quant 가 기준 조건(8k·f16, 같은 하드웨어)에서 실제로 조인되는 실측 점 수 — 허브·콤보 "상세"에 보이는 수와 같다.
   * 현재 조건이 기준이면 표시 quant 의 조인 그대로, 아니면 "8k·f16 조건 실측 N건" 부기용 (미탑재·cpu-moe·부분 오프로드면 0)
   */
  measuredCount: number;
  bucket: SizeBucket;
  /**
   * 통합·CPU 카탈로그 하드웨어: 콤보 페이지가 실제로 쓰는 구성 (허브·콤보는 RAM 옵션별 평가 중 최선 판정 구성을 고른다 —
   * `pickConfigCombo`). 사용자 구성과 다르면 "상세" 링크에 부기한다. dGPU 는 `differsFromHubAssumption`(D2) 이 맡는다
   */
  hubConfig?: { ramGB: number; os: Os };
  /**
   * 표시 quant 의 llama.cpp 명령 — 콤보 페이지 스니펫과 같은 조립. 불러온 모델(콤보 페이지가 없다)과 GPU 여러 장 구성(콤보 페이지 명령은
   * 1장 기준이다 — 10-03 D67)에만
   */
  command?: string;
  /** 명령이 `-ngl`·`--n-cpu-moe` 없이 llama.cpp `--fit` 에 배치를 맡긴다 (GPU 여러 장의 cpu-moe — D67) */
  commandFitAuto?: boolean;
  /**
   * 서로 다른 카드 구성(D67)에서 표시 quant 가 카드 한 장에 다 들어가고 그 카드만 쓰면 더 빠를 때 — 가장 빠른 카드와 그때의 추정.
   * 판정·표시 속도는 llama.cpp 기본(모든 카드에 나눠 올리기) 그대로이고 이건 참고 줄이다
   */
  singleGpu?: { gpu: GpuCore; result: Result };
};

export type VerdictCounts = Record<Verdict, number> & { otherQuant: number };

/**
 * 카탈로그 밖 모델 — 엔진 입력 레코드 그대로. `hf` = Hugging Face 에서 불러옴(계산기 P2 D57, 실제 파일·llama.cpp 명령),
 * `manual` = 방문자가 직접 넣은 모델 값(D66, 파일 크기는 bpw 어림·파일 이름이 없어 명령 없음)
 */
export type ExtraModel = { model: ModelCore; rows: readonly ModelQuantCore[]; origin: 'hf' | 'manual' };

export type RunResult = {
  hardware: ResolvedHardware;
  /** 불러온·직접 입력한 모델 카드 — 목록 맨 위에 따로 보이고 카운트·필터·정렬에는 들어가지 않는다. 항상 이론 추정 */
  pinned?: ResultCard;
  /** 필터 전 전체 (정렬됨) */
  all: ResultCard[];
  /** 필터 후 */
  cards: ResultCard[];
  counts: VerdictCounts;
};

function countVerdicts(cards: readonly ResultCard[]): VerdictCounts {
  const counts: VerdictCounts = { S: 0, A: 0, B: 0, F: 0, otherQuant: 0 };
  for (const { combo } of cards) {
    counts[combo.baseline.result.verdict] += 1;
    if (combo.baseline.result.verdict === 'F' && combo.recommended) counts.otherQuant += 1;
  }
  return counts;
}

/**
 * 서로 다른 카드 구성(D67): 표시 quant 를 카드 한 장씩으로 다시 평가해 전량 탑재되고 지금 추정보다 빠른 카드 중 가장 빠른 것.
 * 1번 카드만 화면 출력 예약을 진다(사용자 설정 그대로). 같은 카드 묶음은 한 번만 본다
 */
function fastestSingleGpu(
  catalog: CatalogLite,
  hardware: ResolvedHardware,
  model: ModelCore,
  combo: ComboAssessment,
  ctx: number,
  kvQuant: CalcState['kv'],
): ResultCard['singleGpu'] {
  const q = combo.display;
  if (hardware.extras.length === 0 || !q.fits || q.result.mode !== 'full-gpu') return undefined;
  const { config } = hardware;
  const cards = [hardware.gpu, ...hardware.extras].filter((g, i, all) => all.findIndex((x) => x.id === g.id) === i);
  let best: ResultCard['singleGpu'];
  for (const card of cards) {
    const single: HwConfig = hardwareConfigs(card, catalog.gpus, {
      ramGB: config.ramGB,
      os: config.hw.os,
      isDisplayGpu: card.id === hardware.gpu.id && config.hw.isDisplayGpu === true,
      ramBandwidthGBs: config.hw.ramBandwidthGBs,
    })[0]!;
    const { fit, result } = estimateAt(card, single, model, q, { ctx, kvQuant, theoretical: true });
    if (fit.mode !== 'full-gpu' || result.tgTokS.est <= q.result.tgTokS.est) continue;
    if (!best || result.tgTokS.est > best.result.tgTokS.est) best = { gpu: card, result };
  }
  return best;
}

export function assembleResults(catalog: CatalogLite, rawState: CalcState, extra?: ExtraModel): RunResult | undefined {
  // 하드웨어 종류에 맞지 않는 필드(CPU 프로필의 DDR, Apple 의 OS 등)를 먼저 정리한다
  const state = normalize(rawState, catalog);
  const hardware = resolveHardware(state, catalog);
  if (!hardware) return undefined;
  const { gpu, config, theoretical } = hardware;
  const multi = hardware.gpuCount > 1 && gpu.id !== 'custom';
  // 통합·CPU 의 콤보 페이지 구성 후보 (기본 인자 = 허브 경로와 동일). 옵션이 하나면 평가 없이 그 구성
  const hubConfigs = gpu.kind !== 'dgpu' && !theoretical ? hardwareConfigs(gpu, catalog.gpus) : [];

  const all: ResultCard[] = catalog.models.map((model) => {
    const ctx = Math.min(state.ctx, model.maxContext);
    const combo = assessCombo(catalog, gpu, config, model, {
      ctx,
      kvQuant: state.kv,
      ...(theoretical ? { theoretical: true } : {}),
      ramHint: gpu.kind === 'dgpu',
    });
    // 실측 배지 수: 기준 조건에서의 조인(D4 규칙 그대로)만 센다 — 조건 무관 원시 점 수를 쓰면 기준 조건에서도 조인되지 않는
    // 조합(미탑재·cpu-moe)에 "8k·f16 조건 실측 N건 — 상세에서 확인" 이 붙어 상세 페이지와 어긋난다 (리뷰 반영)
    const atReference = ctx === HUB_POLICY.referenceCtx && state.kv === 'f16';
    const refCombo = atReference ? combo : assessCombo(catalog, gpu, config, model, theoretical ? { theoretical: true } : {});
    const measuredCount = refCombo.perQuant.find((x) => x.quant === combo.display.quant)?.measured?.points.length ?? 0;
    let hubConfig: ResultCard['hubConfig'];
    if (hubConfigs.length === 1) hubConfig = { ramGB: hubConfigs[0]!.ramGB, os: hubConfigs[0]!.hw.os };
    else if (hubConfigs.length > 1) {
      const combos = hubConfigs.map((c) => assessCombo(catalog, gpu, c, model));
      const picked = hubConfigs[combos.indexOf(pickConfigCombo(combos))]!;
      hubConfig = { ramGB: picked.ramGB, os: picked.hw.os };
    }
    // GPU 여러 장: 콤보 페이지 명령은 1장 기준이라 이 구성의 명령을 카드에 직접 단다(D67 — cpu-moe 는 --fit 자동 배치)
    const row = multi ? catalog.modelQuants.find((r) => r.modelId === model.id && r.quant === combo.display.quant) : undefined;
    const llama = row && combo.display.fits ? commandPlan(gpu, config, model, row, combo.display, { ctx, kvQuant: state.kv }).llamaCpp : undefined;
    const singleGpu = fastestSingleGpu(catalog, hardware, model, combo, ctx, state.kv);
    return {
      model,
      combo,
      ctx,
      clamped: ctx < state.ctx,
      measuredCount,
      bucket: sizeBucket(model.paramsB),
      ...(hubConfig ? { hubConfig } : {}),
      ...(llama ? { command: llama.command, ...(llama.ngl === 'auto' ? { commandFitAuto: true } : {}) } : {}),
      ...(singleGpu ? { singleGpu } : {}),
    };
  });

  const bySort = (a: ResultCard, b: ResultCard): number => {
    switch (state.sort) {
      case 'speed': {
        const tg = (c: ResultCard) => (c.combo.display.fReason === 'no-fit' ? -1 : c.combo.display.result.tgTokS.est);
        return tg(b) - tg(a) || a.model.id.localeCompare(b.model.id);
      }
      case 'size':
        return b.model.paramsB - a.model.paramsB || a.model.id.localeCompare(b.model.id);
      default:
        return compareCombos(a.combo, b.combo);
    }
  };
  all.sort(bySort);

  const minRank = state.min ? verdictRank(state.min) : 0;
  const cards = all.filter(
    (c) =>
      (state.cat.length === 0 || state.cat.some((cat) => c.model.category.includes(cat))) &&
      (state.size.length === 0 || state.size.includes(c.bucket)) &&
      verdictRank(c.combo.baseline.result.verdict) >= minRank,
  );

  let pinned: ResultCard | undefined;
  if (extra) {
    // 같은 조립 함수에 행만 덧붙인 카탈로그로 평가 — 실측 조인은 없고(벤치 0), 라벨은 이론 추정으로 고정
    const withExtra = { ...catalog, modelQuants: [...catalog.modelQuants, ...extra.rows] };
    const ctx = Math.min(state.ctx, extra.model.maxContext);
    const combo = assessCombo(withExtra, gpu, config, extra.model, {
      ctx,
      kvQuant: state.kv,
      theoretical: true,
      ramHint: gpu.kind === 'dgpu',
    });
    // 명령은 실제 파일(저장소·파일 이름)이 있는 불러온 모델만 — 직접 입력 모델은 받을 파일이 없다
    const row = extra.origin === 'hf' ? extra.rows.find((r) => r.quant === combo.display.quant) : undefined;
    const llama = row && combo.display.fits ? commandPlan(gpu, config, extra.model, row, combo.display, { ctx, kvQuant: state.kv }).llamaCpp : undefined;
    const singleGpu = fastestSingleGpu(withExtra, hardware, extra.model, combo, ctx, state.kv);
    pinned = {
      model: extra.model,
      combo,
      ctx,
      clamped: ctx < state.ctx,
      measuredCount: 0,
      bucket: sizeBucket(extra.model.paramsB),
      ...(llama ? { command: llama.command, ...(llama.ngl === 'auto' ? { commandFitAuto: true } : {}) } : {}),
      ...(singleGpu ? { singleGpu } : {}),
    };
  }

  return { hardware, all, cards, counts: countVerdicts(all), ...(pinned ? { pinned } : {}) };
}
