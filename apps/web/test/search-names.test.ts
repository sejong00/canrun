/**
 * 검색에 쓰이는 다른 이름 (10-16 D94) — 한글 모델 계열 이름(`content/ko-names.ts`)과 GPU 허브 "다른 표기"(`lib/search-names.ts`).
 * 페이지에 실제로 한 번씩 나오는지는 export 테스트(`test/export-invariants.spec.ts` "Korean model names")가 본다.
 */
import { describe, expect, it } from 'vitest';
import { KO_FAMILY_NAMES, koFamilyName } from '../content/ko-names';
import { catalog } from '../lib/catalog';
import { aliasLabel, gpuAliasLabels, searchModelName } from '../lib/search-names';

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
  ] as const)('%s → %s', (alias, expected) => {
    expect(aliasLabel(alias)).toBe(expected);
  });

  it('keeps the data order, drops duplicates, and lists nothing for CPU profiles (their aliases are calculator search words)', () => {
    const gpu = (id: string) => catalog.gpus.find((g) => g.id === id)!;
    expect(gpuAliasLabels(gpu('rtx-5090'))).toEqual(['5090', 'RTX5090']);
    expect(gpuAliasLabels({ kind: 'dgpu', aliases: ['5070ti', '5070Ti'] })).toEqual(['5070Ti']);
    for (const g of catalog.gpus.filter((x) => x.kind === 'cpu')) expect(gpuAliasLabels(g), g.id).toEqual([]);
  });
});
