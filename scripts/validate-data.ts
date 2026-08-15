/**
 * `data/*.json` 전수 검증 — CI 게이트 (docs/05 §6, CLAUDE.md 규칙 2).
 *
 * `@canrun/data` 의 schemaRegistry 에 등록된 파일은 zod 로 파싱해 실패 시 CI 를 깨뜨린다.
 * 레지스트리에 없는 data/*.json 은 "스키마 미등록" 으로 실패시킨다 — 스키마 없는
 * 데이터가 조용히 쌓이는 것을 막는 배선 (P0-3 에서 스키마가 등록되면 즉시 게이트로 동작).
 *
 * 예외: aliases.json 은 P0-1 스텁이 자체 구조 검증을 가지므로 여기서 그 검증을 재사용한다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaRegistry } from '../packages/data/src/index';
import { loadAliases } from './build-redirects';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');

const files = readdirSync(dataDir).filter((name) => name.endsWith('.json'));
const failures: string[] = [];

for (const file of files) {
  // P0-1 스텁: aliases.json 은 build-redirects 의 구조 검증을 통과해야 한다.
  // P0-3 에서 zod 스키마로 승격되면 이 분기는 제거된다.
  if (file === 'aliases.json' && !(file in schemaRegistry)) {
    try {
      loadAliases(repoRoot);
      console.log(`✓ data/${file} (stub validation)`);
    } catch (error) {
      failures.push(`data/${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    continue;
  }

  const schema = schemaRegistry[file];
  if (!schema) {
    failures.push(
      `data/${file}: no schema registered in @canrun/data — every data file must have a zod schema (CLAUDE.md rule 2)`,
    );
    continue;
  }

  const parsed = schema.safeParse(JSON.parse(readFileSync(join(dataDir, file), 'utf8')));
  if (parsed.success) {
    console.log(`✓ data/${file}`);
  } else {
    failures.push(`data/${file}: ${parsed.error.message}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} data validation failure(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`\nAll ${files.length} data file(s) valid.`);
