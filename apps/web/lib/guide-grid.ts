import { configKey, type ComboAssessment, type Gpu, type HwConfig, type Model } from '@canrun/data';
import { gridRows, parseGridRow } from '@/content/guides';
import { findGpu, findModel } from './catalog';
import { getCombo } from './combos';
import { findGuideGrid } from './guides';
import { getGpuHub } from './hubs';
import { isComboIndexable } from './publish';

/**
 * 가이드 그리드 조립 (D44 · 10-23 D119) — MDX `<ComboGrid>` 와 데이터 브리프(`scripts/guide-brief.ts`)가 같은 칸을 쓴다.
 * - `'<gpu id>'` 행: 콤보 페이지와 같은 대표 구성(`getCombo` — 통합 메모리는 칸에 그 메모리를 적는다), 공개 콤보만 링크
 * - `'<gpu id>@<구성 키>'` 행: GPU 허브 '메모리 구성별 판정' 표의 그 칸(1대 `configs` 또는 여러 대 `clusterConfigs` — `configKey` 로 찾는다).
 *   콤보 페이지는 대표 구성이라 칸과 다를 수 있어 링크하지 않는다. 여러 대 칸은 같은 메모리 1대에 이미 들어가는 모델이면 '1대로 충분'(`oneUnit` — 10-23 D121)
 * 모르는 id·구성은 throw (빌드 실패) — 오타가 조용히 빈 표가 되지 않게
 */
export type GuideGridCell = {
  model: Model;
  combo: ComboAssessment;
  /** 대표 구성 행의 통합 메모리·CPU 칸 — 그 판정을 낸 메모리(GB). 구성 행·그래픽카드는 없음 */
  atRam?: number;
  /** 공개 콤보 페이지로 링크하는가 (대표 구성 행만) */
  linkable: boolean;
  /** 여러 대 연결 구성 행만: 같은 메모리 1대에 이미 들어가 판정·속도 대신 '1대로 충분'을 보인다(10-23 D121 — 허브 `clusterOneUnit` 과 같은 값) */
  oneUnit?: boolean;
};

export type GuideGridRow = {
  /** 레지스트리 행 문자열 그대로 (React key) */
  key: string;
  gpu: Gpu;
  /** 구성 행이면 그 구성 — 행 머리에 메모리(·대수)를 적는다 */
  config?: HwConfig;
  cells: GuideGridCell[];
};

function needGpu(id: string, where: string): Gpu {
  const gpu = findGpu(id);
  if (!gpu) throw new Error(`guide grid ${where}: unknown gpu "${id}"`);
  return gpu;
}

function needModel(id: string, where: string): Model {
  const model = findModel(id);
  if (!model) throw new Error(`guide grid ${where}: unknown model "${id}"`);
  return model;
}

/** 허브 구성 하나와 그 구성의 모델별 판정 — 1대 구성이 먼저, 없으면 여러 대 연결 구성 */
function hubConfig(
  gpu: Gpu,
  key: string,
  where: string,
): { config: HwConfig; comboOf: (modelId: string) => ComboAssessment; oneUnitOf?: (modelId: string) => boolean } {
  if (gpu.kind !== 'unified') throw new Error(`guide grid ${where}: configuration rows are for unified-memory machines, not ${gpu.id}`);
  const hub = getGpuHub(gpu.id)!;
  const rowOf = (modelId: string) => {
    const row = hub.rows.find((r) => r.model.id === modelId);
    if (!row) throw new Error(`guide grid ${where}: ${modelId} is not on the ${gpu.id} hub`);
    return row;
  };
  const one = hub.configs.findIndex((c) => configKey(c) === key);
  if (one >= 0) return { config: hub.configs[one]!, comboOf: (modelId) => rowOf(modelId).combos[one]! };
  const linked = (hub.clusterConfigs ?? []).findIndex((c) => configKey(c) === key);
  if (linked >= 0) {
    return {
      config: hub.clusterConfigs![linked]!,
      comboOf: (modelId) => rowOf(modelId).clusterCombos![linked]!,
      oneUnitOf: (modelId) => rowOf(modelId).clusterOneUnit![linked]!,
    };
  }
  throw new Error(`guide grid ${where}: ${gpu.id} has no "${key}" configuration`);
}

export function resolveGuideGrid(key: string): { models: Model[]; rows: GuideGridRow[] } {
  const grid = findGuideGrid(key);
  const models = grid.models.map((id) => needModel(id, key));
  const rows = gridRows(grid).map((row): GuideGridRow => {
    const { gpuId, config: cfgKey } = parseGridRow(row);
    const gpu = needGpu(gpuId, key);
    if (cfgKey !== undefined) {
      const { config, comboOf, oneUnitOf } = hubConfig(gpu, cfgKey, key);
      return {
        key: row,
        gpu,
        config,
        cells: models.map((model) => ({
          model,
          combo: comboOf(model.id),
          linkable: false,
          ...(oneUnitOf ? { oneUnit: oneUnitOf(model.id) } : {}),
        })),
      };
    }
    return {
      key: row,
      gpu,
      cells: models.map((model) => {
        const page = getCombo(model.id, gpu.id);
        if (!page) throw new Error(`guide grid ${key}: unknown combo ${model.id} × ${gpu.id}`);
        return {
          model,
          combo: page.combo,
          ...(gpu.kind !== 'dgpu' ? { atRam: page.config.ramGB } : {}),
          linkable: isComboIndexable(gpu.id, model.id),
        };
      }),
    };
  });
  return { models, rows };
}
