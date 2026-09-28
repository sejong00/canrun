/**
 * messages/{en,ko}.json 대칭 — CLAUDE.md 규칙 4 (사용자 노출 문자열은 전부 messages, en/ko 동시).
 * 키 집합·ICU 인자명이 같고 빈 문자열이 없어야 한다. 한쪽에만 키가 있으면 다른 로케일 페이지가
 * 런타임에 키 이름을 그대로 노출한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../messages/', import.meta.url));
const load = (locale: string) =>
  JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8')) as Record<string, unknown>;

function flatten(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of flatten(value as Record<string, unknown>, path)) out.set(k, v);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

/** ICU 최상위 인자명 ({name}, {count, plural, …}) — 중첩 분기 안의 # 는 제외 */
function icuArgs(message: string): string[] {
  const args = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*(?:,|\})/g)) {
    args.add(match[1]!);
  }
  return [...args].sort();
}

const en = flatten(load('en'));
const ko = flatten(load('ko'));

describe('messages en/ko parity (CLAUDE.md rule 4)', () => {
  it('have identical key sets', () => {
    expect([...ko.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it('use the same ICU arguments per key', () => {
    for (const [key, enMessage] of en) {
      const koMessage = ko.get(key);
      if (koMessage === undefined) continue;
      expect(icuArgs(koMessage), key).toEqual(icuArgs(enMessage));
    }
  });

  it('have no empty strings', () => {
    for (const [key, value] of [...en, ...ko]) {
      expect(value.trim(), key).not.toBe('');
    }
  });
});
