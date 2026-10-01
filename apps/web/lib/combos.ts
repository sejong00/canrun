/**
 * 콤보 페이지 데이터 — generateMetadata 와 본문이 같은 조립 결과를 쓰도록 (gpu, model) 키로 메모.
 * 빌드 워커 프로세스 단위 캐시(정적 export 전용). 허브 메모(lib/hubs.ts) 위에 얹는다.
 */
import {
  adjacentCombos,
  alternatives,
  commandPlan,
  comboPublishState,
  ctxMatrix,
  pickConfigCombo,
  ppRange,
  twinGpus,
  vramBreakdown,
  type AdjacentCombos,
  type Alternative,
  type ComboAssessment,
  type CommandPlan,
  type ComboPublishState,
  type CtxMatrix,
  type Gpu,
  type GpuHubData,
  type HwConfig,
  type Model,
  type ModelHubData,
  type ModelQuantRecord,
  type PpRange,
  type QuantAssessment,
  type VramBreakdown,
} from '@canrun/data';
import { catalog, findGpu, findModel } from './catalog';
import { getGpuHub, getModelHub } from './hubs';

export type ComboPage = {
  gpu: Gpu;
  model: Model;
  gpuHub: GpuHubData;
  modelHub: ModelHubData;
  /** 통합·CPU: 모델 허브 행과 같은 대표 구성 (최고 판정의 최소 RAM) */
  configIndex: number;
  config: HwConfig;
  combo: ComboAssessment;
  /** 이 구성의 전 RAM 옵션 조합 (통합·CPU 의 "메모리 용량별 판정") */
  configCombos: ComboAssessment[];
  /** 스니펫·대안·행렬이 기준으로 삼는 quant — display, F 면 RAM 힌트 구성의 quant */
  q: QuantAssessment;
  qConfig: HwConfig;
  qRow: ModelQuantRecord;
  usesRamHint: boolean;
  matrix: CtxMatrix;
  breakdown: VramBreakdown;
  pp?: PpRange;
  plan: CommandPlan;
  alternatives: Alternative[];
  adjacent: AdjacentCombos;
  twins: Gpu[];
  publish: ComboPublishState;
  benchmarks: typeof catalog.benchmarks;
};

const cache = new Map<string, ComboPage>();

export function getCombo(modelId: string, gpuId: string): ComboPage | undefined {
  const key = `${gpuId}/${modelId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const gpu = findGpu(gpuId);
  const model = findModel(modelId);
  if (!gpu || !model) return undefined;

  const gpuHub = getGpuHub(gpuId)!;
  const modelHub = getModelHub(modelId)!;
  const row = gpuHub.rows.find((r) => r.model.id === modelId)!;
  const configCombos = row.combos;
  const combo = pickConfigCombo(configCombos);
  const configIndex = configCombos.indexOf(combo);
  const config = gpuHub.configs[configIndex]!;

  const usesRamHint = !combo.display.fits && combo.ramHint !== undefined;
  const q = usesRamHint ? combo.ramHint!.q : combo.display;
  const qConfig = usesRamHint ? combo.ramHint!.config : config;
  const qRow = catalog.modelQuants.find((r) => r.modelId === modelId && r.quant === q.quant)!;

  const plan = commandPlan(gpu, qConfig, model, qRow, q);

  const page: ComboPage = {
    gpu,
    model,
    gpuHub,
    modelHub,
    configIndex,
    config,
    combo,
    configCombos,
    q,
    qConfig,
    qRow,
    usesRamHint,
    // 셀마다 실행 계획도 붙인다 — 콤보 아일랜드가 선택 셀의 명령으로 스니펫을 바꾼다 (P1-3 D28)
    matrix: ctxMatrix(gpu, qConfig, model, q, { planRow: qRow }),
    breakdown: vramBreakdown(q),
    ...(ppRange(q) ? { pp: ppRange(q) } : {}),
    plan,
    alternatives: alternatives({
      catalog,
      gpu,
      gpuHub,
      configIndex,
      modelHub,
      model,
      combo,
    }),
    adjacent: adjacentCombos(catalog, catalog.publish, gpu, model),
    twins: twinGpus(gpu, catalog.gpus),
    publish: comboPublishState(catalog.publish, gpuId, modelId),
    benchmarks: catalog.benchmarks.filter((bp) => bp.gpuId === gpuId && bp.modelId === modelId),
  };
  cache.set(key, page);
  return page;
}
