/**
 * 브라우저 진입점 `@canrun/data/client` 의 import 그래프 (P1-3 결정 D26).
 * zod·스키마·인덱스가 값 import 로 도달하면 계산기 청크에 ~98KB gz 가 실린다 — 정적 그래프로 막는다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dataSrc = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const engineSrc = resolve(dataSrc, '../../engine/src');

/** 값 import/export 만 (`import type` · `export type` 은 런타임 그래프에 없다) */
const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/gm;

function resolveLocal(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('src')) return candidate;
  }
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

function walk(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(VALUE_IMPORT)) {
    const spec = m[1]!;
    if (spec === '@canrun/engine') walk(resolve(engineSrc, 'index.ts'), seen);
    else if (spec.startsWith('.')) walk(resolveLocal(file, spec), seen);
    else seen.add(`pkg:${spec}`);
  }
  return seen;
}

describe('@canrun/data/client import graph (D26)', () => {
  const reached = walk(resolve(dataSrc, 'client.ts'));
  const files = [...reached].filter((f) => !f.startsWith('pkg:'));
  const packages = [...reached].filter((f) => f.startsWith('pkg:'));

  it('reaches only @canrun/engine as an external package (no zod)', () => {
    expect(packages).toEqual([]);
  });

  it('never reaches schema.ts or index.ts through a value import', () => {
    expect(files.some((f) => /[\\/](schema|index)\.ts$/.test(f) && f.startsWith(dataSrc))).toBe(false);
  });

  it('reaches every assembly module the islands need', () => {
    for (const name of ['core', 'assess', 'combo', 'snippet', 'publish', 'license']) {
      expect(files.some((f) => f.endsWith(`${name}.ts`)), name).toBe(true);
    }
  });

  it('is exposed through the package exports map', () => {
    const pkg = JSON.parse(readFileSync(resolve(dataSrc, '../package.json'), 'utf8')) as {
      exports: Record<string, string>;
      sideEffects: boolean;
    };
    expect(pkg.exports['./client']).toBe('./src/client.ts');
    expect(pkg.sideEffects).toBe(false);
  });
});
