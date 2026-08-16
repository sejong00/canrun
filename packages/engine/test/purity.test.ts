/**
 * 엔진 불변식 — CLAUDE.md 규칙 1·6 을 CI 로 강제.
 * smoke.test.ts(P0-1) 를 흡수·확장: 의존성 0 + 순수성 + 출처 주석 + 결정론.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index';
import { LLAMA31_8B_Q4, RTX_4060_8GB } from './fixtures';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(pkgDir, 'src');
const srcFiles = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

describe('zero dependencies (CLAUDE.md rule 6)', () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  it('package.json has no runtime/peer dependencies', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual([]);
  });

  it('src imports nothing outside the package', () => {
    for (const file of srcFiles) {
      const source = readFileSync(join(srcDir, file), 'utf8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\.?\//);
      }
    }
  });
});

describe('purity (§8 rule 4: no Date/random/IO)', () => {
  it.each(srcFiles)('%s has no impure calls', (file) => {
    const source = readFileSync(join(srcDir, file), 'utf8');
    for (const banned of ['Date.now', 'new Date', 'Math.random', 'process.', 'fetch(', 'require(']) {
      expect(source.includes(banned), `${file} must not use ${banned}`).toBe(false);
    }
  });
});

describe('source comments (CLAUDE.md rule 1)', () => {
  it('every export const block in constants.ts carries a `source:` comment', () => {
    const source = readFileSync(join(srcDir, 'constants.ts'), 'utf8');
    // 각 export const 선언 위 5줄 이내에 source: 주석이 있어야 한다
    const lines = source.split('\n');
    const exportLines = lines
      .map((line, i) => (line.startsWith('export const') ? i : -1))
      .filter((i) => i >= 0);
    expect(exportLines.length).toBeGreaterThan(0);
    for (const i of exportLines) {
      const windowAbove = lines.slice(Math.max(0, i - 5), i).join('\n');
      expect(windowAbove.includes('source:'), `constants.ts:${i + 1} "${lines[i]}" needs // source:`).toBe(true);
    }
  });
});

describe('determinism (§8 rule 4)', () => {
  it('same input → identical output', () => {
    const a = evaluate(RTX_4060_8GB, LLAMA31_8B_Q4, { ctx: 8192 });
    const b = evaluate(RTX_4060_8GB, LLAMA31_8B_Q4, { ctx: 8192 });
    expect(a).toEqual(b);
  });

  it('does not mutate its inputs', () => {
    const hw = structuredClone(RTX_4060_8GB);
    const mq = structuredClone(LLAMA31_8B_Q4);
    evaluate(hw, mq);
    expect(hw).toEqual(RTX_4060_8GB);
    expect(mq).toEqual(LLAMA31_8B_Q4);
  });
});
