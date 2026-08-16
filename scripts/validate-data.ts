/**
 * `data/*.json` 전수 검증 — CI 게이트 (docs/05 §6, CLAUDE.md 규칙 2).
 *
 * 1) zod: schemaRegistry 에 등록된 스키마로 파일 단위 파싱 (출처 없는 레코드 = 실패).
 *    레지스트리에 없는 data/*.json 은 "스키마 미등록" 으로 실패 — 스키마 없는 데이터 유입 차단.
 * 2) validateAll: 파일 간 정합성 (FK, bpw ≡ 엔진 상수, nonExpertGB ≡ 유도식, KV 공식 대조).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBenchmarks,
  parseGpus,
  parseModelQuants,
  parseModels,
  parseQuantDefs,
  schemaRegistry,
  validateAll,
} from '../packages/data/src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');

const readJson = (file: string): unknown => JSON.parse(readFileSync(join(dataDir, file), 'utf8'));

/**
 * 필수 데이터셋 — 이 파일들이 없으면 빌드가 성립하지 않는다 (외부 리뷰 반영).
 * 레지스트리→파일 역검사와 함께 "파일이 조용히 사라지는" 회귀를 차단한다.
 */
const REQUIRED_DATASETS = [
  'gpus.json',
  'models.json',
  'model-quants.json',
  'quants.json',
  'benchmarks.json',
  'aliases.json',
] as const;

const files = readdirSync(dataDir).filter((name) => name.endsWith('.json'));
const failures: string[] = [];

// --- 0) 역검사: 레지스트리·필수 목록의 파일이 실제로 존재하는가 -----------------
for (const file of Object.keys(schemaRegistry)) {
  if (!files.includes(file)) {
    failures.push(`registry: data/${file} is registered but missing on disk`);
  }
}
for (const file of REQUIRED_DATASETS) {
  if (!files.includes(file)) {
    failures.push(`required: data/${file} is a required dataset but missing`);
  }
  if (!(file in schemaRegistry)) {
    failures.push(`required: data/${file} must have a schema in the registry`);
  }
}

// --- 1) 파일 단위 zod ---------------------------------------------------------
for (const file of files) {
  const schema = schemaRegistry[file];
  if (!schema) {
    failures.push(
      `data/${file}: no schema registered in @canrun/data — every data file must have a zod schema (CLAUDE.md rule 2)`,
    );
    continue;
  }
  const parsed = schema.safeParse(readJson(file));
  if (parsed.success) {
    const count = Array.isArray(parsed.data) ? ` (${parsed.data.length} records)` : '';
    console.log(`✓ data/${file}${count}`);
  } else {
    failures.push(`data/${file}: ${parsed.error.message}`);
  }
}

// --- 2) 파일 간 정합성 --------------------------------------------------------
if (failures.length === 0) {
  const problems = validateAll({
    gpus: parseGpus(readJson('gpus.json')),
    models: parseModels(readJson('models.json')),
    modelQuants: parseModelQuants(readJson('model-quants.json')),
    quantDefs: parseQuantDefs(readJson('quants.json')),
    benchmarks: parseBenchmarks(readJson('benchmarks.json')),
  });
  for (const problem of problems) failures.push(`cross-check: ${problem}`);
  if (problems.length === 0) console.log('✓ cross-file consistency');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} data validation failure(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`\nAll ${files.length} data file(s) valid.`);
