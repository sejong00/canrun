import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIDENCE_BAND, ENGINE_SPEC_VERSION } from '../src/index';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

describe('engine package invariants', () => {
  // CLAUDE.md 규칙 6 / docs/05 §2: 엔진은 의존성 0을 유지한다.
  it('has zero runtime dependencies', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual([]);
  });

  it('exposes a spec version and confidence bands', () => {
    expect(ENGINE_SPEC_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    // docs/01 §3: calibrated ±15%, theoretical ±30%
    expect(CONFIDENCE_BAND.calibrated).toBe(0.15);
    expect(CONFIDENCE_BAND.theoretical).toBe(0.3);
  });
});
