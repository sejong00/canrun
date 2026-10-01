/**
 * CanRun 데이터 계층 — `data/*.json` 의 zod 스키마·파서·파일 간 정합성 검증.
 *
 * 브라우저 안전: 이 패키지는 fs 를 사용하지 않는다 — JSON 을 읽는 쪽(scripts/웹 빌드)이
 * 파싱된 값을 넘기면 여기서 검증한다.
 *
 * 불변식 (CLAUDE.md 규칙 2): sources[] 필수 · priceAsOf 없는 실거래가 금지 · rumor 하드웨어 금지.
 */

import { QUANT_BPW, kvBytesPerToken } from '@canrun/engine';
import type { ZodType } from 'zod';
import { deriveNonExpertGB, type MoeArch } from './derive';
import {
  AliasSchema,
  BenchPointSchema,
  GpuSchema,
  MetaSchema,
  FxSchema,
  ModelQuantSchema,
  ModelSchema,
  PublishSchema,
  QuantDefSchema,
  type BenchPoint,
  type DataMeta,
  type FxRate,
  type Gpu,
  type Model,
  type ModelQuantRecord,
  type PublishPlan,
  type QuantDef,
} from './schema';
import { z } from 'zod';

export * from './schema';
export * from './core';
export * from './derive';
export * from './assess';
export * from './license';
export * from './publish';
export * from './snippet';
export * from './combo';

/**
 * `data/<파일명>` → 파일 전체 스키마. `scripts/validate-data.ts` 가 순회하며,
 * 등록되지 않은 data/*.json 은 CI 실패 처리된다 (P0-1 배선).
 */
export const schemaRegistry: Readonly<Record<string, ZodType>> = Object.freeze({
  'gpus.json': z.array(GpuSchema),
  'models.json': z.array(ModelSchema),
  'model-quants.json': z.array(ModelQuantSchema),
  'quants.json': z.array(QuantDefSchema),
  'benchmarks.json': z.array(BenchPointSchema),
  'aliases.json': z.array(AliasSchema),
  'publish.json': PublishSchema,
  'meta.json': MetaSchema,
  'fx.json': FxSchema,
});

/** 레지스트리에 등록된 데이터 파일명 목록. */
export function registeredDataFiles(): readonly string[] {
  return Object.keys(schemaRegistry);
}

export const parseGpus = (json: unknown): Gpu[] => z.array(GpuSchema).parse(json);
export const parseModels = (json: unknown): Model[] => z.array(ModelSchema).parse(json);
export const parseModelQuants = (json: unknown): ModelQuantRecord[] =>
  z.array(ModelQuantSchema).parse(json);
export const parseQuantDefs = (json: unknown): QuantDef[] => z.array(QuantDefSchema).parse(json);
export const parseBenchmarks = (json: unknown): BenchPoint[] =>
  z.array(BenchPointSchema).parse(json);
export const parsePublish = (json: unknown): PublishPlan => PublishSchema.parse(json);
export const parseMeta = (json: unknown): DataMeta => MetaSchema.parse(json);
export const parseFx = (json: unknown): FxRate => FxSchema.parse(json);

/**
 * MoE nonExpertGB 유도 근거 — models.json 시드 값과의 일치를 validateAll 이 강제.
 * 전문가 수/topK 출처: research/models.md §1D·1E + HF 모델 카드. models.json arch.experts/topK 와 일치 강제(10-01).
 * 행 단위 GGUF 헤더 실측(model-quants expertGB/nonExpertGB)이 있으면 이 유도값보다 정확하다.
 */
export const MOE_ARCH: Readonly<Record<string, MoeArch>> = Object.freeze({
  'gpt-oss-20b': { totalParamsB: 20.9, activeParamsB: 3.6, experts: 32, topK: 4 },
  'gpt-oss-120b': { totalParamsB: 116.8, activeParamsB: 5.1, experts: 128, topK: 4 },
  'qwen3-30b-a3b-2507': { totalParamsB: 30.5, activeParamsB: 3.3, experts: 128, topK: 8 },
  'qwen3.5-35b-a3b': { totalParamsB: 35.95, activeParamsB: 3, experts: 256, topK: 8 },
  // Qwen/Qwen3.6-35B-A3B config: num_experts 256, num_experts_per_tok 8 (09-30 확인) — qwen3.5-35b-a3b 와 같은 arch
  'qwen3.6-35b-a3b': { totalParamsB: 35.95, activeParamsB: 3, experts: 256, topK: 8 },
  'kanana-1.5-15.7b-a3b': { totalParamsB: 15.7, activeParamsB: 3, experts: 64, topK: 8 },
  'solar-open-100b': { totalParamsB: 102.65, activeParamsB: 12, experts: 128, topK: 8 },
});

export type SeedFiles = {
  gpus: Gpu[];
  models: Model[];
  modelQuants: ModelQuantRecord[];
  quantDefs: QuantDef[];
  benchmarks: BenchPoint[];
  /** 인덱싱 배치 계획 (P1-2) — 페이지 생성엔 무관, index 여부·허브 링크만 좌우 */
  publish: PublishPlan;
};

/**
 * 파일 간 정합성 검증 — zod(파일 단위) 통과 후 실행.
 * 위반 목록을 반환한다 (빈 배열 = 통과).
 */
export function validateAll(files: SeedFiles): string[] {
  const problems: string[] = [];
  const modelIds = new Set(files.models.map((model) => model.id));
  const moeModelIds = new Set(
    files.models.filter((model) => model.activeParamsB !== undefined).map((model) => model.id),
  );
  const gpuIds = new Set(files.gpus.map((gpu) => gpu.id));

  // model-quants.modelId 는 카탈로그 FK · fileName 은 전 행 필수 (sync-models 가 기록, P1-2)
  for (const mq of files.modelQuants) {
    if (!modelIds.has(mq.modelId)) {
      problems.push(`model-quants: unknown modelId '${mq.modelId}'`);
    }
    if (mq.fileName === undefined) {
      problems.push(`model-quants/${mq.modelId}/${mq.quant}: fileName missing — run sync-models`);
    }
    // MoE 헤더 실측 분할(10-01): MoE 모델 행만 · 둘 다 함께 · 전문가+비전문가 ≤ 파일 크기(+반올림 0.02)
    if (mq.expertGB !== undefined || mq.nonExpertGB !== undefined) {
      const id = `model-quants/${mq.modelId}/${mq.quant}`;
      if (!moeModelIds.has(mq.modelId)) {
        problems.push(`${id}: expertGB/nonExpertGB only for MoE models (activeParamsB)`);
      }
      if (mq.expertGB === undefined || mq.nonExpertGB === undefined) {
        problems.push(`${id}: expertGB and nonExpertGB must be set together`);
      } else if (mq.expertGB + mq.nonExpertGB > mq.fileGB + 0.02) {
        problems.push(
          `${id}: expertGB ${mq.expertGB} + nonExpertGB ${mq.nonExpertGB} > fileGB ${mq.fileGB}`,
        );
      }
    }
  }

  // publish.json 의 배치 목록은 카탈로그 FK
  files.publish.batches.forEach((entry, i) => {
    for (const gpuId of entry.gpuIds) {
      if (!gpuIds.has(gpuId)) problems.push(`publish/batches[${i}]: unknown gpuId '${gpuId}'`);
    }
    for (const modelId of entry.modelIds) {
      if (!modelIds.has(modelId)) {
        problems.push(`publish/batches[${i}]: unknown modelId '${modelId}'`);
      }
    }
  });

  // benchmarks.gpuId 는 존재하면 FK (modelId 는 캘리브레이션 전용 id 허용)
  for (const bp of files.benchmarks) {
    if (bp.gpuId !== undefined && !gpuIds.has(bp.gpuId)) {
      problems.push(`benchmarks/${bp.id}: unknown gpuId '${bp.gpuId}'`);
    }
  }

  // quants.json bpw ≡ engine QUANT_BPW (단일 출처 유지 — CLAUDE.md 규칙 1)
  for (const quantDef of files.quantDefs) {
    const engineBpw = QUANT_BPW[quantDef.id];
    if (engineBpw !== quantDef.bpw) {
      problems.push(
        `quants/${quantDef.id}: bpw ${quantDef.bpw} != engine QUANT_BPW ${engineBpw}`,
      );
    }
  }

  for (const model of files.models) {
    // MoE nonExpertGB ≡ 유도식 (모델 Q4_K_M/네이티브 파일 크기 기준, 허용 오차 0.02GB)
    const arch = MOE_ARCH[model.id];
    if (arch && model.nonExpertGB !== undefined) {
      const baseQuant = files.modelQuants.find(
        (mq) => mq.modelId === model.id && (mq.quant === 'Q4_K_M' || mq.quant === 'MXFP4'),
      );
      if (baseQuant) {
        const derived = deriveNonExpertGB(arch, baseQuant.fileGB);
        if (Math.abs(derived - model.nonExpertGB) > 0.02) {
          problems.push(
            `models/${model.id}: nonExpertGB ${model.nonExpertGB} != derived ${derived.toFixed(3)}`,
          );
        }
      }
    }
    if (MOE_ARCH[model.id] && model.nonExpertGB === undefined) {
      problems.push(`models/${model.id}: MOE_ARCH exists but nonExpertGB missing`);
    }

    // MoE 구조(arch.experts/topK): MoE 모델 필수 · topK < experts · MOE_ARCH 와 일치 · dense 모델엔 없음
    const { experts, topK } = model.arch;
    if (model.activeParamsB !== undefined) {
      if (experts === undefined || topK === undefined) {
        problems.push(`models/${model.id}: MoE model requires arch.experts and arch.topK`);
      } else if (topK >= experts) {
        problems.push(`models/${model.id}: arch.topK ${topK} must be < arch.experts ${experts}`);
      }
    } else if (experts !== undefined || topK !== undefined) {
      problems.push(`models/${model.id}: arch.experts/topK only for MoE models (activeParamsB)`);
    }
    if (arch && experts !== undefined && experts !== arch.experts) {
      problems.push(`models/${model.id}: arch.experts ${experts} != MOE_ARCH ${arch.experts}`);
    }
    if (arch && topK !== undefined && topK !== arch.topK) {
      problems.push(`models/${model.id}: arch.topK ${topK} != MOE_ARCH ${arch.topK}`);
    }

    // full attention 모델은 kvBytesPerTokenF16 이 GQA 공식과 일치해야 한다 (docs/02 §2.2)
    if (model.arch.attnType === 'full') {
      const formula = kvBytesPerToken({
        layers: model.arch.layers,
        kvHeads: model.arch.kvHeads,
        headDim: model.arch.headDim,
      });
      if (formula !== model.arch.kvBytesPerTokenF16) {
        problems.push(
          `models/${model.id}: kvBytesPerTokenF16 ${model.arch.kvBytesPerTokenF16} != formula ${formula}`,
        );
      }
    }
  }

  return problems;
}
