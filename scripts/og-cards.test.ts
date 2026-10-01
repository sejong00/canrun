/** 허브별 공유 카드 (scripts/og-cards.ts, D60) — 글꼴 서브셋이 카드 글자를 다 담는지, 카드 개수가 허브와 같은지. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OG_FONT_CHARS_PATH, gpuCardText, loadCatalog, loadMessages, modelCardText, ogCardChars } from './og-cards';

const catalog = loadCatalog();

describe('og cards', () => {
  it('the committed font subset covers every character a card can show (else: pnpm exec tsx scripts/og-font.ts)', () => {
    const subset = new Set(readFileSync(OG_FONT_CHARS_PATH, 'utf8').replace(/\r?\n$/, ''));
    const missing = [...ogCardChars(catalog)].filter((ch) => !subset.has(ch));
    expect(missing).toEqual([]);
  });

  it('GPU cards count every catalog model; model cards count every GPU', () => {
    const m = loadMessages('ko');
    const gpu = catalog.gpus.find((g) => g.id === 'rtx-4060')!;
    const g = gpuCardText(catalog, gpu, m);
    expect(g.counts.S + g.counts.A + g.counts.B + g.counts.F).toBe(catalog.models.length);
    expect(g.detail).toBe('VRAM 8GB');
    const model = catalog.models.find((x) => x.id === 'gpt-oss-120b')!;
    const c = modelCardText(catalog, model, loadMessages('en'));
    expect(c.counts.S + c.counts.A + c.counts.B + c.counts.F).toBe(catalog.gpus.length);
    expect(c.detail).toContain('5.1B active');
  });
});
