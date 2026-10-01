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

  it('does not pull in the HF ingestion entry (calculator main bundle stays unchanged)', () => {
    expect(files.some((f) => /[\\/](hf|gguf)\.ts$/.test(f))).toBe(false);
  });
});

/** 모듈 최상위(들여쓰기 0)의 실행문 — 선언(import/export/const/let/function/class/type)이 아닌 호출·대입 */
const TOP_LEVEL_STATEMENT = /^(?!import\b|export\b|const\b|let\b|var\b|function\b|async\b|class\b|type\b|interface\b|declare\b|enum\b)[A-Za-z_$][\w$.]*\s*(?:\(|=[^=>])/m;
/** Node 전용 전역 — 브라우저 번들에서 ReferenceError */
const NODE_GLOBAL = /\b(?:process\.|Buffer\.|require\(|__dirname|__filename)/;

describe('@canrun/data/hf import graph (browser HF ingestion — dynamic import only)', () => {
  const reached = walk(resolve(dataSrc, 'hf.ts'));
  const files = [...reached].filter((f) => !f.startsWith('pkg:'));
  const packages = [...reached].filter((f) => f.startsWith('pkg:'));

  it('reaches only @canrun/engine as an external package (no zod, no node:*)', () => {
    expect(packages).toEqual([]);
  });

  it('never reaches schema.ts or index.ts through a value import', () => {
    expect(files.some((f) => /[\\/](schema|index)\.ts$/.test(f) && f.startsWith(dataSrc))).toBe(false);
  });

  it('reaches the GGUF header module and the MoE derivation', () => {
    for (const name of ['hf', 'gguf', 'derive']) {
      expect(files.some((f) => f.endsWith(`${name}.ts`)), name).toBe(true);
    }
  });

  it('has no top-level side effects and no Node-only globals in any reached data module', () => {
    for (const f of files.filter((x) => x.startsWith(dataSrc))) {
      const src = readFileSync(f, 'utf8');
      expect(TOP_LEVEL_STATEMENT.exec(src)?.[0], f).toBeUndefined();
      expect(NODE_GLOBAL.exec(src)?.[0], f).toBeUndefined();
    }
  });

  it('is exposed through the package exports map', () => {
    const pkg = JSON.parse(readFileSync(resolve(dataSrc, '../package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports['./hf']).toBe('./src/hf.ts');
  });
});
