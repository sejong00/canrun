/**
 * 빌드 타임 카탈로그 — `data/*.json` 을 zod 로 파싱하고 파일 간 정합성까지 검증한다.
 *
 * 서버 전용: 서버 컴포넌트·generateStaticParams·generateMetadata 에서만 import 한다.
 * 클라이언트 컴포넌트가 import 하면 카탈로그 JSON 전체가 브라우저 번들에 실린다.
 * (Turbopack 루트 = 저장소 루트라 apps/web 밖의 data/ 를 정적 import 할 수 있다.)
 */
import {
  parseBenchmarks,
  parseGpus,
  parseModelQuants,
  parseModels,
  parsePublish,
  parseQuantDefs,
  validateAll,
  type Gpu,
  type Model,
  type SeedFiles,
} from '@canrun/data';
import benchmarksJson from '../../../data/benchmarks.json';
import gpusJson from '../../../data/gpus.json';
import modelQuantsJson from '../../../data/model-quants.json';
import modelsJson from '../../../data/models.json';
import publishJson from '../../../data/publish.json';
import quantsJson from '../../../data/quants.json';

function load(): SeedFiles {
  const files = {
    gpus: parseGpus(gpusJson),
    models: parseModels(modelsJson),
    modelQuants: parseModelQuants(modelQuantsJson),
    quantDefs: parseQuantDefs(quantsJson),
    benchmarks: parseBenchmarks(benchmarksJson),
    publish: parsePublish(publishJson),
  };
  const problems = validateAll(files);
  if (problems.length > 0) {
    throw new Error(`data/*.json consistency check failed:\n${problems.join('\n')}`);
  }
  return files;
}

export const catalog: SeedFiles = load();

export function findGpu(id: string): Gpu | undefined {
  return catalog.gpus.find((gpu) => gpu.id === id);
}

export function findModel(id: string): Model | undefined {
  return catalog.models.find((model) => model.id === id);
}
