/**
 * 원화 참고 가격 (D61) — 만 원 단위 반올림, ko 만 원화를 붙이고 en 은 달러만, 안내 문구는 ko 에서만.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FX, formatPrice, krwMan, krwNote } from '../lib/price';
import type { Translate } from '../lib/phrases';

const messages = (locale: 'en' | 'ko') =>
  JSON.parse(readFileSync(resolve(__dirname, `../messages/${locale}.json`), 'utf8')) as { Common: Record<string, string> };

/** next-intl 대신 쓰는 최소 번역기 — {key} 치환만 */
const common = (locale: 'en' | 'ko'): Translate => {
  const m = messages(locale).Common;
  return (key, values = {}) => m[key]!.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));
};

describe('krwMan', () => {
  it('rounds to the nearest 10,000 KRW', () => {
    expect(krwMan(299, 1361.27)).toBe(41); // 407,019원
    expect(krwMan(1599, 1361.27)).toBe(218); // 2,176,671원
    expect(krwMan(2, 1361.27)).toBe(1); // 1만 원 미만은 1
  });
});

describe('formatPrice', () => {
  it('adds the KRW reference only on ko', () => {
    expect(formatPrice(common('en'), 'en', 299)).toBe('$299');
    expect(formatPrice(common('ko'), 'ko', 299)).toBe(`US$299(약 ${krwMan(299)}만 원)`);
  });
});

describe('krwNote', () => {
  it('shows the rate and its date on ko only', () => {
    expect(krwNote(common('en'), 'en')).toBeUndefined();
    const note = krwNote(common('ko'), 'ko')!;
    expect(note).toContain(FX.asOf);
    expect(note).toContain(`1달러 ${new Intl.NumberFormat('ko', { maximumFractionDigits: 0 }).format(FX.usdKrw)}원`);
  });
});
