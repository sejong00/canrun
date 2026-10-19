/**
 * 외부 도구 사실 (`lib/runtime-facts.ts` — 가이드 `<RuntimeFact>`, 10-19 레코드화) — 레코드마다 https 출처·확인일·도구·문장 키가 있고,
 * 문장과 도구별 출처 줄이 en/ko 양쪽에 있으며, MDX 스캔이 받는 id 목록(`RUNTIME_FACT_IDS`)과 레코드가 1:1 인지.
 * 분기 재확인(PROGRESS §3)은 `checked` 날짜로 다시 읽을 레코드를 찾는다 — 날짜 형식이 깨지면 그 루틴이 레코드를 놓친다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCalendarDate } from '@canrun/data';
import { describe, expect, it } from 'vitest';
import { RUNTIME_FACT_IDS } from '../lib/guide-components';
import { RUNTIME_FACTS, RUNTIME_FACT_SOURCE_KEYS, RUNTIME_FACT_TOOLS, isRuntimeFactId } from '../lib/runtime-facts';

const LOCALES = ['en', 'ko'] as const;
const guideData = Object.fromEntries(
  LOCALES.map((locale) => {
    const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
    return [locale, (JSON.parse(readFileSync(path, 'utf8')) as { GuideData: Record<string, string> }).GuideData];
  }),
) as Record<(typeof LOCALES)[number], Record<string, string>>;

/** 도구별 공식 문서 호스트 — 출처는 그 도구의 1차 문서여야 한다(AUTHORING §3) */
const TOOL_HOSTS: Record<(typeof RUNTIME_FACT_TOOLS)[number], string> = {
  ollama: 'docs.ollama.com',
  lmstudio: 'lmstudio.ai',
};

const records = Object.entries(RUNTIME_FACTS);

describe('runtime facts (guide <RuntimeFact>, 10-19)', () => {
  it('every id in RUNTIME_FACT_IDS has a record and every record is in RUNTIME_FACT_IDS', () => {
    expect([...RUNTIME_FACT_IDS].sort()).toEqual(Object.keys(RUNTIME_FACTS).sort());
    for (const id of RUNTIME_FACT_IDS) expect(isRuntimeFactId(id), id).toBe(true);
    expect(isRuntimeFactId('toString'), 'prototype keys are not ids').toBe(false);
    expect(isRuntimeFactId('ollama-unknown'), 'unknown id').toBe(false);
  });

  it('ids are kebab-case and start with their tool', () => {
    for (const [id, fact] of records) {
      expect(id, id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
      expect(id.startsWith(`${fact.tool}-`), `${id} tool ${fact.tool}`).toBe(true);
    }
  });

  it('every record cites an https page of its own tool’s docs', () => {
    for (const [id, fact] of records) {
      const url = new URL(fact.source);
      expect(url.protocol, `${id} source`).toBe('https:');
      expect(url.hostname, `${id} source host`).toBe(TOOL_HOSTS[fact.tool]);
    }
  });

  it('checked dates are real YYYY-MM-DD calendar dates, not in the future', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [id, fact] of records) {
      expect(fact.checked, `${id} checked`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(isCalendarDate(fact.checked), `${id} checked`).toBe(true);
      expect(fact.checked <= today, `${id} checked ${fact.checked} is after ${today}`).toBe(true);
    }
  });

  it('every tool has a source label with {date} in both locales', () => {
    expect(Object.keys(RUNTIME_FACT_SOURCE_KEYS).sort()).toEqual([...RUNTIME_FACT_TOOLS].sort());
    for (const tool of RUNTIME_FACT_TOOLS) {
      for (const locale of LOCALES) {
        const label = guideData[locale][RUNTIME_FACT_SOURCE_KEYS[tool]];
        expect(label, `${locale} GuideData.${RUNTIME_FACT_SOURCE_KEYS[tool]}`).toBeTypeOf('string');
        expect(label, `${locale} ${tool} label`).toContain('{date}');
      }
    }
  });

  it('every record’s sentence exists in both locales, without ICU arguments, and every GuideData.fact* sentence belongs to a record', () => {
    const used = new Set<string>(records.map(([, fact]) => fact.message));
    expect(used.size, 'one sentence key per record').toBe(records.length);
    for (const [id, fact] of records) {
      for (const locale of LOCALES) {
        const text = guideData[locale][fact.message];
        expect(text, `${locale} GuideData.${fact.message} (${id})`).toBeTypeOf('string');
        // 문장은 가이드 문장 안에 그대로 들어간다 — 끼워 넣을 값이 없다
        expect(text, `${locale} ${fact.message} has an ICU argument`).not.toMatch(/[{}]/);
      }
    }
    const sourceKeys = new Set<string>(Object.values(RUNTIME_FACT_SOURCE_KEYS));
    for (const locale of LOCALES) {
      const orphans = Object.keys(guideData[locale]).filter((k) => /^fact[A-Z]/.test(k) && !sourceKeys.has(k) && !used.has(k));
      expect(orphans, `${locale} GuideData.fact* without a record`).toEqual([]);
    }
  });
});
