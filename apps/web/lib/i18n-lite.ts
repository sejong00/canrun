/**
 * 클라이언트 아일랜드용 번역 — next-intl 프로바이더 없이(결정 D6) 서버가 골라 넘긴 메시지 부분집합을
 * ICU 부분집합으로 포맷한다 (P1-3 결정 D27). 의존성 0, 브라우저·node 공용.
 *
 * 지원 문법: `{name}` · `{n, plural, =k {…} one {…} other {…}}` · plural 분기 안의 `#`(로케일 숫자) 와 중첩 `{name}`.
 * 그 밖의 ICU(select·number·date·이스케이프)는 지원하지 않는다 — `apps/web/test/i18n-lite.test.ts` 가
 * 아일랜드가 쓰는 모든 키를 next-intl `createTranslator` 와 대조해 동치를 강제한다.
 */
import type { Translate } from './phrases';

/** 'Namespace.key' → ICU 원문 */
export type Dict = Readonly<Record<string, string>>;
export type Values = Record<string, string | number>;

/** `open` 위치의 '{' 와 짝인 '}' 인덱스 (중첩 허용) */
function closeBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`i18n-lite: unbalanced braces in "${s}"`);
}

/** "=0 {} one {# run} other {# runs}" → Map(selector → body) */
function branches(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open < 0) break;
    const close = closeBrace(body, open);
    out.set(body.slice(i, open).trim(), body.slice(open + 1, close));
    i = close + 1;
  }
  return out;
}

function pluralCategory(locale: string, n: number): string {
  try {
    return new Intl.PluralRules(locale).select(n);
  } catch {
    return 'other';
  }
}

function formatNumber(locale: string, n: number): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}

export function formatIcu(locale: string, message: string, values: Values = {}, hash?: string): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const ch = message[i]!;
    if (ch === '#' && hash !== undefined) {
      out += hash;
      i += 1;
      continue;
    }
    if (ch !== '{') {
      out += ch;
      i += 1;
      continue;
    }
    const close = closeBrace(message, i);
    const body = message.slice(i + 1, close);
    const comma = body.indexOf(',');
    if (comma < 0) {
      const name = body.trim();
      if (!(name in values)) throw new Error(`i18n-lite: missing value "${name}" for "${message}"`);
      out += String(values[name]);
    } else {
      const name = body.slice(0, comma).trim();
      const rest = body.slice(comma + 1);
      const comma2 = rest.indexOf(',');
      if (comma2 < 0 || rest.slice(0, comma2).trim() !== 'plural') {
        throw new Error(`i18n-lite: unsupported ICU "${body}"`);
      }
      const raw = values[name];
      if (raw === undefined) throw new Error(`i18n-lite: missing value "${name}" for "${message}"`);
      const n = Number(raw);
      const br = branches(rest.slice(comma2 + 1));
      const chosen = br.get(`=${n}`) ?? br.get(pluralCategory(locale, n)) ?? br.get('other') ?? '';
      out += formatIcu(locale, chosen, values, formatNumber(locale, n));
    }
    i = close + 1;
  }
  return out;
}

export type TranslateWithHas = Translate & { has: (key: string) => boolean };

/** 네임스페이스 바인딩 — `lib/phrases.ts` 의 `Translate`(+ `gpuName` 이 요구하는 `has`) 와 호환 */
export function makeT(dict: Dict, locale: string, ns: string): TranslateWithHas {
  const t = (key: string, values?: Values) => {
    const msg = dict[`${ns}.${key}`];
    if (msg === undefined) throw new Error(`i18n-lite: missing message "${ns}.${key}"`);
    return formatIcu(locale, msg, values);
  };
  return Object.assign(t, { has: (key: string) => `${ns}.${key}` in dict });
}

export type MessageSpec = {
  /** 네임스페이스 전체 */
  namespaces?: readonly string[];
  /** 개별 키 ('Ns.key') */
  keys?: readonly string[];
};

/** next-intl 메시지 트리에서 부분집합을 평탄화 — 서버(`lib/client-messages.ts`)와 테스트 공용 */
export function pickMessages(all: Record<string, unknown>, spec: MessageSpec): Dict {
  const out: Record<string, string> = {};
  const namespaces = new Set(spec.namespaces ?? []);
  const keys = new Set(spec.keys ?? []);
  for (const [ns, tree] of Object.entries(all)) {
    if (!tree || typeof tree !== 'object') continue;
    for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const full = `${ns}.${key}`;
      if (namespaces.has(ns) || keys.has(full)) out[full] = value;
    }
  }
  return out;
}

/** 계산기 아일랜드 메시지 (D27) — 카드·폼·감지·공유가 쓰는 네임스페이스와 GpuHub 배지 키 */
export const CALC_MESSAGE_SPEC: MessageSpec = {
  namespaces: [
    'Calculator',
    'Detect',
    'Share',
    'LicenseShort',
    'Verdict',
    'Confidence',
    'Common',
    'Mode',
    'Memory',
    'VerdictReason',
    'Hint',
    'QuantTier',
    'Category',
    'GpuName',
  ],
  keys: ['GpuHub.badgeLaptop', 'GpuHub.badgeUnified', 'GpuHub.badgeFp16', 'GpuHub.badgeCpu', 'GpuHub.ramOption', 'Table.quant', 'Table.size'],
};

/** 홈·가이드 GPU 선택기 (`components/islands/gpu-picker.tsx`) — GPU 이름 + 목록 머리글·메모리 라벨만 (페이지마다 실리므로 최소한) */
export const GPU_PICKER_MESSAGE_SPEC: MessageSpec = {
  namespaces: ['GpuName'],
  keys: [
    'Calculator.groupNvidia',
    'Calculator.groupAmd',
    'Calculator.groupIntel',
    'Calculator.groupApple',
    'Calculator.groupApu',
    'Calculator.groupCpu',
    'Calculator.optionLaptop',
    'Calculator.optionMemoryVram',
    'Calculator.optionMemoryRange',
  ],
};
