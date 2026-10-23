/**
 * 검색에 쓰이는 다른 이름 (10-16 D94) — 한글 모델 계열 이름(`content/ko-names.ts`)과 GPU 허브 "다른 표기"(`lib/search-names.ts`),
 * Apple 칩 허브의 맥 제품 이름(D97).
 * 페이지에 실제로 나오는지는 export 테스트(`test/export-invariants.spec.ts` "Korean model names"·"Mac product names")가 본다.
 */
import { readFileSync } from 'node:fs';
import { MAC_LINES } from '@canrun/data';
import { describe, expect, it } from 'vitest';
import { KO_FAMILY_NAMES, koFamilyName } from '../content/ko-names';
import { catalog } from '../lib/catalog';
import type { Translate } from '../lib/phrases';
import { aliasLabel, gpuAliasLabels, gpuSearchName, macLineMemory, macLines, searchModelName } from '../lib/search-names';

describe('Korean model family names (content/ko-names.ts)', () => {
  it('every registry family exists in the catalog, and Qwen has no Hangul name (큐웬·큐원 collide with other brands on Naver)', () => {
    const families = new Set(catalog.models.map((m) => m.family));
    for (const family of Object.keys(KO_FAMILY_NAMES)) expect(families.has(family), family).toBe(true);
    expect(KO_FAMILY_NAMES.qwen).toBeUndefined();
    expect(JSON.stringify(KO_FAMILY_NAMES)).not.toMatch(/큐웬|큐원/);
  });

  it.each([
    ['Gemma 4 26B-A4B', 'gemma', '젬마 4'],
    ['Gemma 3 12B', 'gemma', '젬마 3'],
    ['EXAONE 4.0 1.2B', 'exaone', '엑사원 4.0'],
    ['DeepSeek R1 Distill Qwen 32B', 'deepseek', '딥시크 R1'],
    ['Llama 3.1 8B', 'llama', '라마 3.1'],
    ['HyperCLOVA X SEED Think 14B', 'hyperclova', '하이퍼클로바X'],
    ['Kanana 1.5 15.7B-A3B', 'kanana', '카나나 1.5'],
    ['Solar Open 2 250B', 'solar', '솔라'],
    ['Mistral Small 3.2 24B', 'mistral', '미스트랄'],
  ] as const)('%s → %s', (name, family, expected) => {
    expect(koFamilyName({ name, family })).toBe(expected);
  });

  it('skips Qwen, names that do not start with the family word, and Llama without a version ("라마 3.x" only)', () => {
    expect(koFamilyName({ name: 'Qwen3 14B', family: 'qwen' })).toBeUndefined();
    expect(koFamilyName({ name: 'Magistral Small', family: 'mistral' })).toBeUndefined();
    expect(koFamilyName({ name: 'Llama Guard 8B', family: 'llama' })).toBeUndefined();
  });

  it('Korean pages get "Name(한글)", English pages the plain name — Korean model hub titles stay unique', () => {
    const gemma = catalog.models.find((m) => m.id === 'gemma-4-26b-a4b')!;
    expect(searchModelName('ko', gemma)).toBe('Gemma 4 26B-A4B(젬마 4)');
    expect(searchModelName('en', gemma)).toBe('Gemma 4 26B-A4B');
    // 한글 계열 이름은 한국어 페이지만 — zh(10-19 D109)는 원래 이름
    expect(searchModelName('zh', gemma)).toBe('Gemma 4 26B-A4B');
    const qwen = catalog.models.find((m) => m.family === 'qwen')!;
    expect(searchModelName('ko', qwen)).toBe(qwen.name);
    const ko = catalog.models.map((m) => searchModelName('ko', m));
    expect(new Set(ko).size).toBe(ko.length);
  });
});

describe('GPU aliases ("다른 표기" on GPU hubs)', () => {
  it.each([
    ['rtx5090', 'RTX5090'],
    ['5090', '5090'],
    ['5070ti', '5070Ti'],
    ['4070tis', '4070TiS'],
    ['5060 ti 16gb', '5060 Ti 16GB'],
    ['4080 super', '4080 Super'],
    ['9070xt', '9070XT'],
    ['7900 xtx', '7900 XTX'],
    ['arc b580', 'Arc B580'],
    ['5090 laptop', '5090 Laptop'],
    ['m4 max 40', 'M4 Max 40'],
    ['ryzen ai max 395', 'Ryzen AI Max 395'],
    ['radeon 8060s', 'Radeon 8060S'],
    ['dgx spark', 'DGX Spark'],
    // DGX Spark OEM 판 (10-23 D117)
    ['asus ascent gx10', 'ASUS Ascent GX10'],
    ['dell pro max with gb10', 'Dell Pro Max with GB10'],
    ['hp zgx nano g1n', 'HP ZGX Nano G1n'],
    ['lenovo thinkstation pgx', 'Lenovo ThinkStation PGX'],
    ['msi edgexpert', 'MSI EdgeXpert'],
    ['acer veriton gn100', 'Acer Veriton GN100'],
    ['gigabyte ai top atom', 'GIGABYTE AI TOP ATOM'],
    // NVIDIA RTX PRO 6000 Blackwell (10-23 D120) — RTX 뒤의 PRO 는 전부 대문자, Max-Q 는 그 표기
    ['rtx pro 6000', 'RTX PRO 6000'],
    ['rtx pro 6000 max-q', 'RTX PRO 6000 Max-Q'],
    ['rtx pro 6000 blackwell max-q workstation edition', 'RTX PRO 6000 Blackwell Max-Q Workstation Edition'],
    ['m5 pro', 'M5 Pro'],
  ] as const)('%s → %s', (alias, expected) => {
    expect(aliasLabel(alias)).toBe(expected);
  });

  it('keeps the data order, drops duplicates, and lists nothing for CPU profiles (their aliases are calculator search words)', () => {
    const gpu = (id: string) => catalog.gpus.find((g) => g.id === id)!;
    expect(gpuAliasLabels(gpu('rtx-5090'))).toEqual(['5090', 'RTX5090']);
    // DGX Spark — 같은 GB10 칩의 OEM 판 7종이 "다른 표기"로 (10-23 D117 — 레코드는 하나)
    expect(gpuAliasLabels(gpu('nvidia-dgx-spark'))).toEqual([
      'DGX Spark',
      'GB10',
      'ASUS Ascent GX10',
      'Dell Pro Max with GB10',
      'HP ZGX Nano G1n',
      'Lenovo ThinkStation PGX',
      'MSI EdgeXpert',
      'Acer Veriton GN100',
      'GIGABYTE AI TOP ATOM',
    ]);
    expect(gpuAliasLabels(gpu('rtx-pro-6000-blackwell'))).toEqual([
      'RTX PRO 6000',
      'RTX PRO 6000 Max-Q',
      'RTX PRO 6000 Blackwell Workstation Edition',
      'RTX PRO 6000 Blackwell Max-Q Workstation Edition',
    ]);
    expect(gpuAliasLabels({ kind: 'dgpu', aliases: ['5070ti', '5070Ti'] })).toEqual(['5070Ti']);
    for (const g of catalog.gpus.filter((x) => x.kind === 'cpu')) expect(gpuAliasLabels(g), g.id).toEqual([]);
  });
});

describe('Mac product names on Apple chip hubs (10-16 D97 — data/gpus.json products)', () => {
  const gpu = (id: string) => catalog.gpus.find((g) => g.id === id)!;
  /** messages `MacProduct` 로 바인딩한 최소 translator — 인자는 {name} 치환만 */
  const macMessages = (locale: 'en' | 'ko' | 'zh') =>
    (JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')) as { MacProduct: Record<string, string> }).MacProduct;
  const tMac = (locale: 'en' | 'ko' | 'zh'): Translate => {
    const ns = macMessages(locale);
    return (key, values) => ns[key]!.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name]));
  };

  it('lists each line once in a fixed order; with a memory size only the lines sold with it', () => {
    expect(macLines(gpu('apple-m4'))).toEqual(['mac-mini', 'macbook-air', 'macbook-pro', 'imac']);
    expect(macLines(gpu('apple-m4-pro'))).toEqual(['mac-mini', 'macbook-pro']);
    // M4 Pro 64GB 는 맥 미니뿐 — 맥북 프로 14·16형은 48GB 까지(애플 사양 121553·121554)
    expect(macLines(gpu('apple-m4-pro'), 64)).toEqual(['mac-mini']);
    expect(macLines(gpu('apple-m2-ultra'))).toEqual(['mac-studio', 'mac-pro']);
    // M6 는 맥 미니뿐(애플 사양 128108 — 10-20)
    expect(macLines(gpu('apple-m6'))).toEqual(['mac-mini']);
    expect(macLines(gpu('rtx-5090'))).toEqual([]);
  });

  it('merges the memory options of models in the same line (iMac two-port 16·24 + four-port 16·24·32)', () => {
    expect(macLineMemory(gpu('apple-m4')).find((l) => l.line === 'imac')?.memoryGB).toEqual([16, 24, 32]);
    expect(macLineMemory(gpu('apple-m4-pro'))).toEqual([
      { line: 'mac-mini', memoryGB: [24, 48, 64] },
      { line: 'macbook-pro', memoryGB: [24, 48] },
    ]);
  });

  it('names the hub "Apple M4(맥 미니·…)" in Korean and "Apple M4 (Mac mini, …)" in English; a name already in parentheses keeps one pair', () => {
    expect(gpuSearchName(tMac('ko'), 'Apple M4', gpu('apple-m4'))).toBe('Apple M4(맥 미니·맥북 에어·맥북 프로·아이맥)');
    expect(gpuSearchName(tMac('en'), 'Apple M4', gpu('apple-m4'))).toBe('Apple M4 (Mac mini, MacBook Air, MacBook Pro, iMac)');
    const max = gpu('apple-m4-max-40c');
    expect(gpuSearchName(tMac('ko'), max.name, max)).toBe('Apple M4 Max (40-core GPU, 맥북 프로·맥 스튜디오)');
    expect(gpuSearchName(tMac('en'), max.name, max)).toBe('Apple M4 Max (40-core GPU; MacBook Pro, Mac Studio)');
    expect(gpuSearchName(tMac('ko'), 'GeForce RTX 5090', gpu('rtx-5090'))).toBe('GeForce RTX 5090');
  });

  it('every line has a name in every locale (zh — D109), and Apple hub names stay unique', () => {
    for (const locale of ['en', 'ko', 'zh'] as const) {
      for (const line of MAC_LINES) expect(macMessages(locale)[line], `${locale} ${line}`).toBeTruthy();
      const names = catalog.gpus.filter((g) => g.vendor === 'apple').map((g) => gpuSearchName(tMac(locale), g.name, g));
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
