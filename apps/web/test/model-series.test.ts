/**
 * 모델 계열 (`content/model-series.ts` — 모델 허브 "같은 계열의 다른 크기" 표, 10-19). 기대 구성원은 부분집합으로만 본다 —
 * 신모델이 매일 자동으로 들어와 계열이 커져도 깨지지 않게. 예외 표는 카탈로그(또는 자동 추가 id 표본)에 있는 id 만, 같은 계열은 같은 data `family`.
 * 자동 추가는 `--id` 없이 `slugFromHfId` 로 id 를 만든다 — 실제 HF id 를 그대로 바꿔 계열을 확인한다.
 * 렌더(표 안 링크·현재 모델 표시)는 export 테스트가 본다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slugFromHfId } from '@canrun/data/hf';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../../packages/data/test/seed';
import { SERIES_ALIASES, SERIES_NOTES, SERIES_OVERRIDES, SIZE_SUFFIX, modelSeries, seriesMembers, seriesNoteKey } from '../content/model-series';

const models = loadSeed().models;
const ids = new Set(models.map((m) => m.id));

/**
 * 자동 추가 id 표본 — 실제 HF id → 기대 계열(undefined = 계열 없음). 자동 추가(`scripts/auto-add-models.ts`)가 `slugFromHfId` 로 만드는 id 모양:
 * 유효 파라미터 `E2B`, 날짜 앞 `Instruct`·`Thinking`, R1 Distill 의 바탕 모델 이름(`Qwen`·`Llama`)
 */
const AUTO_IDS: Readonly<Record<string, string | undefined>> = {
  'google/gemma-4-E2B-it': 'gemma-4',
  'google/gemma-4-E4B-it': 'gemma-4',
  'google/gemma-3n-E4B-it': 'gemma-3n',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B': 'deepseek-r1',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B': 'deepseek-r1',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B': 'deepseek-r1',
  'Qwen/Qwen3-4B-Instruct-2507': 'qwen3',
  'Qwen/Qwen3-4B-Thinking-2507': 'qwen3',
  'Qwen/Qwen3-235B-A22B-Instruct-2507': 'qwen3',
  'meta-llama/Llama-3.1-70B-Instruct': 'llama-3.1',
  'Qwen/Qwen3-4B-Base': undefined,
  // K2-Horizon(10-21 D113) — 카탈로그 밖 크기도 같은 계열로(자동 추가가 넣을 수 있다)
  'IFM/K2-Horizon-3.7B': 'k2-horizon',
  'IFM/K2-Horizon-375B-A23B': 'k2-horizon',
};

/** 계열 → 적어도 이 모델들 (카탈로그 10-19 기준) */
const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  'gemma-4': ['gemma-4-12b', 'gemma-4-26b-a4b', 'gemma-4-31b'],
  'gemma-3': ['gemma-3-12b', 'gemma-3-27b'],
  qwen3: ['qwen3-8b', 'qwen3-14b', 'qwen3-32b', 'qwen3-30b-a3b-2507'],
  'qwen3.5': ['qwen3.5-9b', 'qwen3.5-27b', 'qwen3.5-35b-a3b', 'qwen3.5-122b-a10b'],
  'qwen3.6': ['qwen3.6-27b', 'qwen3.6-35b-a3b'],
  'gpt-oss': ['gpt-oss-20b', 'gpt-oss-120b'],
  'deepseek-r1': ['deepseek-r1-distill-8b', 'deepseek-r1-distill-14b', 'deepseek-r1-distill-32b', 'deepseek-r1-0528-qwen3-8b'],
  'llama-3.2': ['llama-3.2-1b', 'llama-3.2-3b'],
  'exaone-4.0': ['exaone-4.0-1.2b', 'exaone-4.0-32b'],
  'kanana-1.5': ['kanana-1.5-8b', 'kanana-1.5-15.7b-a3b'],
  minicpm5: ['minicpm5-1b', 'minicpm5-2b'],
  'ling-3.0': ['ling-3.0-tiny', 'ling-3.0-flash'],
  'k2-horizon': ['k2-horizon-7b', 'k2-horizon-mova-36b-a4b'],
};

/** 계열 → 구성원 (카탈로그 전체) */
const groups = new Map<string, string[]>();
for (const m of models) {
  const series = modelSeries(m.id);
  if (series !== undefined) groups.set(series, [...(groups.get(series) ?? []), m.id]);
}

describe('modelSeries — size suffix rule', () => {
  it('strips total, effective, MoE-active, instruct/thinking and date-refresh size suffixes, and nothing else', () => {
    expect(modelSeries('foo-7b')).toBe('foo');
    expect(modelSeries('foo-2.5-1.5b')).toBe('foo-2.5');
    expect(modelSeries('foo-26b-a4b')).toBe('foo');
    expect(modelSeries('foo-15.7b-a3b')).toBe('foo');
    expect(modelSeries('foo-30b-a3b-2507')).toBe('foo');
    expect(modelSeries('foo-e2b')).toBe('foo');
    expect(modelSeries('foo-4b-instruct-2507')).toBe('foo');
    expect(modelSeries('foo-30b-a3b-thinking-2507')).toBe('foo');
    expect(modelSeries('foo-7b-instruct')).toBe('foo');
    expect(modelSeries('foo-4')).toBeUndefined();
    expect(modelSeries('foo-e4')).toBeUndefined();
    expect(modelSeries('foo-7b-base')).toBeUndefined();
    expect(modelSeries('foo-s-2.1')).toBeUndefined();
  });

  it('keeps different version numbers and name stems apart', () => {
    const distinct = (...xs: string[]) => expect(new Set(xs.map(modelSeries)).size, xs.join(' · ')).toBe(xs.length);
    distinct('llama-3.1-8b', 'llama-3.2-3b', 'llama-3.3-70b');
    distinct('qwen3-8b', 'qwen3.5-9b', 'qwen3.6-27b', 'qwen3.8-27b');
    distinct('exaone-4.0-32b', 'exaone-4.5-33b');
    distinct('solar-open-100b', 'solar-open2-250b');
    distinct('hyperclovax-seed-1.5b', 'hyperclovax-seed-think-14b');
    distinct('minicpm5-2b', 'minicpm-v-4.7-35b-a3b');
    distinct('gemma-3-12b', 'gemma-3n-e4b', 'gemma-4-e4b');
  });
});

describe('modelSeries — ids made by the daily auto-add (slugFromHfId, no --id)', () => {
  it('real HF ids land in the expected series', () => {
    for (const [hfId, series] of Object.entries(AUTO_IDS)) expect(modelSeries(slugFromHfId(hfId)), `${hfId} → ${slugFromHfId(hfId)}`).toBe(series);
  });

  it('had every catalog model come in through auto-add, the series tables would be the same', () => {
    // 같은 계열 ⇔ 같은 계열 (계열 없음은 저마다 따로) — 손으로 정한 id 와 자동 id 가 같은 표를 만든다
    const key = (id: string, series: string | undefined) => series ?? `none:${id}`;
    for (const a of models) {
      for (const b of models) {
        if (a.id >= b.id) continue;
        const byId = key(a.id, modelSeries(a.id)) === key(b.id, modelSeries(b.id));
        const bySlug = key(a.id, modelSeries(slugFromHfId(a.hfId))) === key(b.id, modelSeries(slugFromHfId(b.hfId)));
        expect(bySlug, `${a.id} (${slugFromHfId(a.hfId)}) · ${b.id} (${slugFromHfId(b.hfId)})`).toBe(byId);
      }
    }
  });
});

describe('model series in the catalog', () => {
  it('the expected groups contain at least their known members', () => {
    for (const [series, members] of Object.entries(EXPECTED)) {
      for (const id of members) {
        expect(ids.has(id), `${id} is in the catalog`).toBe(true);
        expect(modelSeries(id), id).toBe(series);
      }
      expect(seriesMembers(models, members[0]!).map((m) => m.id), series).toEqual(expect.arrayContaining([...members]));
    }
  });

  it('overrides and aliases point at catalog models and are not redundant', () => {
    for (const [id, series] of Object.entries(SERIES_OVERRIDES)) {
      expect(ids.has(id), `override ${id} is in the catalog`).toBe(true);
      // 크기 꼬리 규칙만으로 같은 계열이 나오면 예외가 필요 없다
      const stem = id.replace(SIZE_SUFFIX, '');
      expect(stem !== id && (SERIES_ALIASES[stem] ?? stem) === series, `override ${id} is redundant`).toBe(false);
      expect(groups.get(series)!.length, `override ${id} joins a series with another model`).toBeGreaterThanOrEqual(2);
    }
    // 별칭은 카탈로그 id 나 그 자동 id(`slugFromHfId(hfId)`), 또는 자동 추가 id 표본 중 하나에 걸려야 한다 — 죽은 별칭 금지
    const reachable = [...models.flatMap((m) => [m.id, slugFromHfId(m.hfId)]), ...Object.keys(AUTO_IDS).map(slugFromHfId)];
    for (const [stem, series] of Object.entries(SERIES_ALIASES)) {
      expect(stem, 'alias maps to a different name').not.toBe(series);
      expect(reachable.some((id) => id !== id.replace(SIZE_SUFFIX, '') && id.replace(SIZE_SUFFIX, '') === stem), `alias ${stem} matches a catalog or auto-add id`).toBe(true);
    }
  });

  it('members of one series share the data family', () => {
    for (const [series, members] of groups) {
      const families = new Set(members.map((id) => models.find((m) => m.id === id)!.family));
      expect([...families], `${series}: ${members.join(', ')}`).toHaveLength(1);
    }
  });

  it('seriesMembers lists every member smallest first, and nothing for a model alone in its series or without one', () => {
    for (const m of models) {
      const members = seriesMembers(models, m.id);
      const series = modelSeries(m.id);
      const size = series === undefined ? 0 : groups.get(series)!.length;
      if (size < 2) {
        expect(members, `${m.id} renders no series table`).toEqual([]);
        continue;
      }
      expect(members.map((x) => x.id).sort(), m.id).toEqual([...groups.get(series!)!].sort());
      expect(members.some((x) => x.id === m.id), `${m.id} is in its own series`).toBe(true);
      for (let i = 1; i < members.length; i++) {
        expect(members[i - 1]!.paramsB <= members[i]!.paramsB, `${series} sorted by paramsB`).toBe(true);
      }
    }
    expect(modelSeries('phi-4'), 'no size suffix → no series').toBeUndefined();
    expect(seriesMembers(models, 'phi-4')).toEqual([]);
  });
});

describe('series notes (the line under a series table)', () => {
  const modelHub = (locale: 'en' | 'ko' | 'zh') =>
    (JSON.parse(readFileSync(fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url)), 'utf8')) as { ModelHub: Record<string, string> }).ModelHub;

  it('every note belongs to a series that renders a table, and its sentence exists in every locale (zh — D109)', () => {
    for (const [series, note] of Object.entries(SERIES_NOTES)) {
      expect(groups.get(series)?.length ?? 0, `${series} has a table`).toBeGreaterThanOrEqual(2);
      for (const locale of ['en', 'ko', 'zh'] as const) expect(modelHub(locale)[note.message], `${locale} ModelHub.${note.message}`).toBeTypeOf('string');
    }
  });

  it('a note disappears once a model it names joins the catalog', () => {
    for (const [series, note] of Object.entries(SERIES_NOTES)) {
      const member = groups.get(series)![0]!;
      const named = models.filter((m) => note.untilHfIds.some((h) => h.toLowerCase() === m.hfId.toLowerCase()));
      expect(seriesNoteKey(models, member), series).toBe(named.length === 0 ? note.message : undefined);
      expect(seriesNoteKey([...models, { hfId: note.untilHfIds[0]!.toUpperCase() }], member), `${series} after a named model joins`).toBeUndefined();
    }
    expect(seriesNoteKey(models, 'qwen3-8b'), 'series without a note').toBeUndefined();
    expect(seriesNoteKey(models, 'phi-4'), 'model without a series').toBeUndefined();
  });

  it('a model a note names joins that series table when the daily auto-add brings it in (the note never vanishes from a table still missing it)', () => {
    for (const [series, note] of Object.entries(SERIES_NOTES)) {
      const member = groups.get(series)![0]!;
      for (const hfId of note.untilHfIds) {
        const id = slugFromHfId(hfId);
        expect(modelSeries(id), `${hfId} → ${id}`).toBe(series);
        const joined = [...models, { id, hfId, paramsB: 1 }];
        expect(seriesMembers(joined, member).map((m) => m.id), `${series} table after ${hfId} joins`).toContain(id);
        expect(seriesNoteKey(joined, member), `${series} note after ${hfId} joins`).toBeUndefined();
      }
    }
  });
});
