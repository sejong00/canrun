/** 테스트 공용: 시드 JSON 로드 (fs 는 테스트/스크립트 전용 — 패키지 본체는 브라우저 안전). */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBenchmarks,
  parseGpus,
  parseModelQuants,
  parseModels,
  parsePublish,
  parseQuantDefs,
  type SeedFiles,
} from '../src/index';

const dataDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../data');

export const readSeedJson = (file: string): unknown =>
  JSON.parse(readFileSync(join(dataDir, file), 'utf8'));

export function loadSeed(): SeedFiles {
  return {
    gpus: parseGpus(readSeedJson('gpus.json')),
    models: parseModels(readSeedJson('models.json')),
    modelQuants: parseModelQuants(readSeedJson('model-quants.json')),
    quantDefs: parseQuantDefs(readSeedJson('quants.json')),
    benchmarks: parseBenchmarks(readSeedJson('benchmarks.json')),
    publish: parsePublish(readSeedJson('publish.json')),
  };
}
