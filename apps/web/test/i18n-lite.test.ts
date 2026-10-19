/**
 * i18n-lite (P1-3 D27) — 아일랜드가 쓰는 모든 메시지 키에 대해 next-intl `createTranslator` 와 동치.
 * 지원 밖 ICU(select·number·이스케이프)가 메시지에 들어오면 여기서 먼저 깨진다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { CALC_MESSAGE_SPEC, GPU_PICKER_MESSAGE_SPEC, formatIcu, makeT, pickMessages } from '../lib/i18n-lite';

const root = resolve(__dirname, '..');
const messages = {
  en: JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8')) as Record<string, Record<string, string>>,
  ko: JSON.parse(readFileSync(join(root, 'messages/ko.json'), 'utf8')) as Record<string, Record<string, string>>,
  // 화면 문구만 기계번역(10-19 D109) — 아일랜드는 같은 사전을 받으므로 같은 동치 검사를 거친다
  zh: JSON.parse(readFileSync(join(root, 'messages/zh.json'), 'utf8')) as Record<string, Record<string, string>>,
};
const LOCALES = ['en', 'ko', 'zh'] as const;

/** 콤보 아일랜드·허브 정렬이 쓰는 개별 키 (완성 문자열은 서버에서 만들지만 라벨은 dict 로 넘긴다) */
const ISLAND_KEYS = ['CtxControls', 'Sort'] as const;

const SAMPLE_N = [0, 1, 2, 5, 21, 1200];

/** 메시지의 인자 이름 (plural 안 중첩 포함) */
function argNames(message: string): string[] {
  return [...new Set([...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]!))];
}

function pluralArgs(message: string): Set<string> {
  return new Set([...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*,\s*plural/g)].map((m) => m[1]!));
}

function specFor(locale: (typeof LOCALES)[number]) {
  const namespaces = [...(CALC_MESSAGE_SPEC.namespaces ?? []), ...ISLAND_KEYS.filter((ns) => ns in messages[locale])];
  return pickMessages(messages[locale], { namespaces, keys: CALC_MESSAGE_SPEC.keys });
}

describe('formatIcu equals next-intl for every island message', () => {
  for (const locale of LOCALES) {
    const dict = specFor(locale);
    const t = createTranslator({ locale, messages: messages[locale] });

    it(`${locale}: ${Object.keys(dict).length} keys`, () => {
      expect(Object.keys(dict).length).toBeGreaterThan(40);
      for (const [key, message] of Object.entries(dict)) {
        const plurals = pluralArgs(message);
        const names = argNames(message);
        const grids: Record<string, string | number>[] = [];
        if (names.length === 0) grids.push({});
        else {
          const numeric = names.filter((n) => plurals.has(n));
          const textual = names.filter((n) => !plurals.has(n));
          const base = Object.fromEntries(textual.map((n) => [n, `«${n}»`]));
          if (numeric.length === 0) grids.push(base);
          for (const n of SAMPLE_N) grids.push({ ...base, ...Object.fromEntries(numeric.map((k) => [k, n])) });
        }
        for (const values of grids) {
          const expected = t(key as never, values as never);
          expect(formatIcu(locale, message, values), `${key} with ${JSON.stringify(values)}`).toBe(expected);
        }
      }
    });
  }

  it('makeT binds a namespace and exposes has()', () => {
    const t = makeT(specFor('en'), 'en', 'Verdict');
    expect(t('S')).toBe('Runs great');
    expect(t.has('S')).toBe(true);
    expect(t.has('nope')).toBe(false);
    expect(() => t('nope')).toThrow(/missing message/);
  });

  it('throws on a missing argument instead of leaking the placeholder', () => {
    expect(() => formatIcu('en', 'est. {est} tok/s', {})).toThrow(/missing value/);
  });

  it('plural: exact match beats category, # is the locale number', () => {
    const msg = '{n, plural, =0 {none} one {# run} other {# runs}}';
    expect(formatIcu('en', msg, { n: 0 })).toBe('none');
    expect(formatIcu('en', msg, { n: 1 })).toBe('1 run');
    expect(formatIcu('en', msg, { n: 1200 })).toBe('1,200 runs');
    expect(formatIcu('ko', msg, { n: 1 })).toBe('1 runs');
  });
});

describe('island source files only use keys that exist in every locale', () => {
  const dirs = ['components/islands', 'lib/calc'].map((d) => join(root, d));
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  dirs.forEach(walk);

  it('every t.<ns>(\'key\') literal resolves in both locales (namespace map from bindTranslators)', () => {
    // 아일랜드는 `bindTranslators` 의 객체(`calc: makeT(dict, locale, 'Calculator')`)를 `t.calc('key')` 로 쓴다 —
    // 그 매핑을 소스에서 읽어 호출 리터럴을 전수 대조한다. 검사 건수 하한으로 스캔이 헛돌지 않음을 보장(리뷰 지적).
    const shared = readFileSync(join(root, 'components/islands/calc-shared.ts'), 'utf8');
    const nsOf = new Map<string, string>();
    for (const m of shared.matchAll(/(\w+):\s*makeT\([^,]+,\s*[^,]+,\s*'([^']+)'\)/g)) nsOf.set(m[1]!, m[2]!);
    expect(nsOf.size, 'bindTranslators namespaces').toBeGreaterThanOrEqual(10);

    // 전체 메시지가 아니라 계산기 페이지가 실제로 넘기는 사전(CALC_MESSAGE_SPEC 로 고른 것)과 대조한다 — 네임스페이스·개별 키를
    // spec 에 빠뜨리면 런타임 `missing message` 로 깨지는 것을 여기서 잡는다 (리뷰 반영)
    const picked = {
      en: pickMessages(messages.en, CALC_MESSAGE_SPEC),
      ko: pickMessages(messages.ko, CALC_MESSAGE_SPEC),
      zh: pickMessages(messages.zh, CALC_MESSAGE_SPEC),
    };
    const missing: string[] = [];
    let checked = 0;
    const check = (file: string, ns: string, key: string) => {
      checked += 1;
      for (const locale of LOCALES) {
        if (typeof picked[locale][`${ns}.${key}`] !== 'string') missing.push(`${file}: ${ns}.${key} (${locale}, not in the picked dict)`);
      }
    };
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\.(\w+)\(\s*'([^']+)'/g)) {
        const ns = nsOf.get(m[1]!);
        if (!ns) missing.push(`${file}: unknown translator t.${m[1]!}`);
        else check(file, ns, m[2]!);
      }
      // `const tX = makeT(dict, locale, 'Ns')` … `tX('key')` 형태도 지원
      const bindings = new Map<string, string>();
      for (const m of src.matchAll(/const\s+(\w+)\s*=\s*makeT\([^,]+,\s*[^,]+,\s*'([^']+)'\)/g)) bindings.set(m[1]!, m[2]!);
      for (const [name, ns] of bindings) {
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) check(file, ns, m[1]!);
      }
    }
    expect(checked, 'static scan must not be vacuous').toBeGreaterThan(80);
    expect(missing).toEqual([]);
  });
});

describe('GPU picker dictionary (home·guide widget)', () => {
  it('every t.calc/t.names literal in the picker and the shared listbox resolves in the picked dict, every locale', () => {
    const files = ['components/islands/gpu-picker.tsx', 'components/islands/gpu-listbox.tsx'];
    const nsOf: Record<string, string> = { calc: 'Calculator', names: 'GpuName' };
    const missing: string[] = [];
    let checked = 0;
    for (const locale of LOCALES) {
      const dict = pickMessages(messages[locale], GPU_PICKER_MESSAGE_SPEC);
      for (const file of files) {
        const src = readFileSync(join(root, file), 'utf8');
        for (const m of src.matchAll(/\bt\.(\w+)\(\s*'([^']+)'/g)) {
          const ns = nsOf[m[1]!];
          checked += 1;
          if (!ns) missing.push(`${file}: unknown translator t.${m[1]!}`);
          else if (typeof dict[`${ns}.${m[2]!}`] !== 'string') missing.push(`${file}: ${ns}.${m[2]!} (${locale})`);
        }
      }
      expect(Object.keys(dict).some((k) => k.startsWith('GpuName.')), `${locale} GpuName`).toBe(true);
    }
    expect(checked, 'scan must not be vacuous').toBeGreaterThanOrEqual(18);
    expect(missing).toEqual([]);
  });
});
