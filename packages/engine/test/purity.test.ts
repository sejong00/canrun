/**
 * 엔진 불변식 — CLAUDE.md 규칙 1·6 을 CI 로 강제.
 *
 * 순수성(외부 import·Date·crypto·performance·동적 import 금지)은 문자열 스캔이 아니라
 * **ESLint AST 게이트**(루트 eslint.config.mjs 의 packages/engine/src 블록)가 담당한다
 * — 외부 리뷰 반영(따옴표 변형·우회 표기에 취약한 regex 제거).
 * 여기서는 의존성 0, 출처 주석 형식, 결정론만 검증한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index';
import { LLAMA31_8B_Q4, RTX_4060_8GB } from './fixtures';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(pkgDir, 'src');

describe('zero dependencies (CLAUDE.md rule 6)', () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  it('package.json has no runtime/peer dependencies', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual([]);
  });
});

describe('source comments (CLAUDE.md rule 1)', () => {
  it('every export const block in constants.ts cites an https URL or the policy form', () => {
    const source = readFileSync(join(srcDir, 'constants.ts'), 'utf8');
    const lines = source.split('\n');
    const exportLines = lines
      .map((line, i) => (line.startsWith('export const') ? i : -1))
      .filter((i) => i >= 0);
    expect(exportLines.length).toBeGreaterThan(0);

    // 실측 상수 = https URL 필수. 정책 임계값만 `// source: docs/02 §N (policy)` 예외 (CLAUDE.md 규칙 1).
    const valid = /source: (https:\/\/\S+|docs\/02 §[\d.~·]+ \(policy\))/;
    for (const i of exportLines) {
      const windowAbove = lines.slice(Math.max(0, i - 6), i).join('\n');
      expect(
        valid.test(windowAbove),
        `constants.ts:${i + 1} "${lines[i]}" needs "// source: https://…" or "// source: docs/02 §N (policy)"`,
      ).toBe(true);
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
