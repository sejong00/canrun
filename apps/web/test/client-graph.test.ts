/**
 * 클라이언트 청크의 전이적 import 그래프 (P1-3 결정 D26·D36) — 아일랜드에서 시작해 값 import 를 따라가며
 * next-intl·zod·tailwind-merge·서버 전용 lib·node 내장이 도달하지 않음을 강제한다. ESLint 의
 * no-restricted-imports 는 직접 import 만 보므로, 공용 컴포넌트를 거쳐 새는 경로는 여기서 잡는다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = resolve(__dirname, '..');
const repo = resolve(web, '../..');

const ROOTS = [
  'components/islands',
  'lib/calc',
  'lib/i18n-lite.ts',
  'lib/hydration.ts',
  'components/verdict-chip.tsx',
  'components/pill.tsx',
  'components/speed-text.tsx',
  'components/ui/button-variants.ts',
];

const FORBIDDEN_PACKAGES = ['next-intl', 'next-intl/server', 'zod', 'tailwind-merge', '@canrun/data', 'next/link', 'next/navigation', 'next/dynamic'];
const ALLOWED_PACKAGES = new Set(['react', 'react/jsx-runtime', 'react-dom', 'clsx', 'class-variance-authority', '@canrun/engine', '@canrun/data/client']);
const FORBIDDEN_FILES = [/[\\/]lib[\\/](catalog|hubs|combos|publish|utils|client-messages)\.ts$/, /[\\/]components[\\/](badges|verdict|estimate|hub-table)\.tsx$/, /[\\/]i18n[\\/]navigation\.ts$/];

const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function listFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function resolveSpec(from: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith('@/')) base = join(web, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else if (spec === '@canrun/data/client') base = join(repo, 'packages/data/src/client');
  else if (spec === '@canrun/engine') base = join(repo, 'packages/engine/src/index');
  else return undefined;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

function walk(file: string, seen: Set<string>, packages: Set<string>) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(VALUE_IMPORT), ...src.matchAll(DYNAMIC_IMPORT)].map((m) => m[1]!);
  for (const spec of specs) {
    const target = resolveSpec(file, spec);
    if (target === undefined) packages.add(spec);
    else walk(target, seen, packages);
  }
}

describe('client import graph', () => {
  const roots = ROOTS.map((r) => join(web, r))
    .filter(existsSync)
    .flatMap((p) => (statSync(p).isDirectory() ? listFiles(p) : [p]));
  const seen = new Set<string>();
  const packages = new Set<string>();
  for (const root of roots) walk(root, seen, packages);

  it('has roots to check', () => {
    expect(roots.length).toBeGreaterThan(3);
  });

  it('reaches no forbidden package', () => {
    const bad = [...packages].filter((p) => FORBIDDEN_PACKAGES.includes(p) || p.startsWith('node:'));
    expect(bad).toEqual([]);
  });

  it('reaches only allow-listed packages', () => {
    const unknown = [...packages].filter((p) => !ALLOWED_PACKAGES.has(p));
    expect(unknown).toEqual([]);
  });

  it('reaches no server-only module', () => {
    const bad = [...seen].filter((f) => FORBIDDEN_FILES.some((re) => re.test(f)));
    expect(bad).toEqual([]);
  });

  it('reaches no zod through the data package', () => {
    expect([...seen].some((f) => /packages[\\/]data[\\/]src[\\/](schema|index)\.ts$/.test(f))).toBe(false);
  });
});
