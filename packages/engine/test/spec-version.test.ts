/**
 * 엔진 스펙 버전과 그 날짜 (10-16 D93) — 사이트맵 lastmod 가 엔진 개정을 따라가려면 버전을 올릴 때 `ENGINE_SPEC_DATE` 도 함께 바뀌어야 한다.
 * 버전 줄 주석은 늘 `// MM-DD 바뀐 내용 — 이전 버전 MM-DD …` 로 써 왔다(0.3.0 부터) — 그 맨 앞 MM-DD 와 날짜 상수를 맞춰 본다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_SPEC_DATE, ENGINE_SPEC_VERSION } from '../src/index';

const source = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'src', 'index.ts'), 'utf8');

describe('ENGINE_SPEC_DATE (D93 — sitemap lastmod follows engine changes)', () => {
  it('is a YYYY-MM-DD date string', () => {
    expect(ENGINE_SPEC_DATE).toMatch(/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/);
  });

  it('matches the MM-DD that opens the comment on the ENGINE_SPEC_VERSION line', () => {
    const line = source.split('\n').find((l) => l.startsWith('export const ENGINE_SPEC_VERSION'));
    expect(line, 'ENGINE_SPEC_VERSION line').toBeDefined();
    expect(line, 'version literal').toContain(`'${ENGINE_SPEC_VERSION}'`);
    const commentDate = /;\s*\/\/\s*(\d{2}-\d{2})\s/.exec(line!)?.[1];
    expect(
      commentDate,
      `the ENGINE_SPEC_VERSION comment should start with "MM-DD" — bumped the version? set ENGINE_SPEC_DATE to that day too`,
    ).toBe(ENGINE_SPEC_DATE.slice(5));
  });
});
