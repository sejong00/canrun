/**
 * 목록 페이지 (10-19 `/models`·`/gpus`) — 순서·묶음·data 속성(`lib/browse.ts`), 아일랜드 정렬·거르기 규칙(`lib/list-order.ts`),
 * 개발 조직 이름(`content/model-makers.ts`). 렌더 결과(전 행·링크·브레드크럼·ItemList)는 test/export-invariants.spec.ts, 브라우저 동작은 e2e/browse.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGpus, parseModels } from '@canrun/data';
import { MODEL_MAKERS, hfOrgOf, modelMaker } from '@/content/model-makers';
import {
  GPU_LIST_GROUPS,
  contextShort,
  downloadsAsOf,
  gpuListGroup,
  gpuListGroups,
  gpuMemoryGB,
  gpuRowData,
  modelListOrder,
  modelRowData,
} from '@/lib/browse';
import { isFiltered, orderRows, rowMatches } from '@/lib/list-order';

const dataDir = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..', 'data');
const seed = (file: string): unknown => JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
const models = parseModels(seed('models.json'));
const gpus = parseGpus(seed('gpus.json'));

describe('model list order and row data', () => {
  const m = (name: string, popularity: number, hfDownloads30d?: number) => ({ name, popularity, ...(hfDownloads30d !== undefined ? { hfDownloads30d } : {}) });

  it('popularity first, then 30-day downloads (missing last), then name', () => {
    const order = modelListOrder([m('B', 4, 10), m('A', 5, 1), m('C', 5, 9), m('D', 5), m('E', 5, 9)]).map((x) => x.name);
    expect(order).toEqual(['C', 'E', 'A', 'D', 'B']);
  });

  it('keeps every catalog model exactly once', () => {
    const ids = modelListOrder(models).map((x) => x.id);
    expect([...ids].sort()).toEqual(models.map((x) => x.id).sort());
  });

  it('row data carries the sort keys and only the flags a model has', () => {
    const qwen = models.find((x) => x.id === 'qwen3-30b-a3b-2507')!;
    expect(modelRowData(qwen)).toEqual({
      'data-released': qwen.releasedAt.replaceAll('-', ''),
      'data-downloads': String(qwen.hfDownloads30d),
      'data-params': String(qwen.paramsB),
      'data-size': 'l',
      'data-moe': '1',
    });
    const exaone = models.find((x) => x.id === 'exaone-4.0-32b')!;
    expect(modelRowData(exaone)).toMatchObject({ 'data-thinking': '1', 'data-korean': '1', 'data-size': 'l' });
    expect(modelRowData(exaone)).not.toHaveProperty('data-moe');
    // 크기 구간은 MoE 도 총 파라미터 (계산기 크기 필터와 같다)
    const gptOss = models.find((x) => x.id === 'gpt-oss-120b')!;
    expect(modelRowData(gptOss)['data-size']).toBe('xl');
  });

  it('short context labels: 1024-token k, whole multiples of 2^20 as M', () => {
    expect([16384, 32768, 65536, 131072, 262144, 1048576, 2097152].map(contextShort)).toEqual(['16k', '32k', '64k', '128k', '256k', '1M', '2M']);
    expect(contextShort(40960)).toBe('40k');
  });

  it('download dates: the range of as-of dates in the catalog', () => {
    expect(downloadsAsOf([{ hfDownloadsAsOf: '2026-10-16' }, {}, { hfDownloadsAsOf: '2026-10-14' }])).toEqual({ from: '2026-10-14', to: '2026-10-16' });
    expect(downloadsAsOf([{}])).toBeUndefined();
    expect(downloadsAsOf(models)).toBeDefined();
  });
});

describe('model makers (Hugging Face organization names)', () => {
  it('reads the organization from hfId and falls back to the organization id', () => {
    expect(hfOrgOf('meta-llama/Llama-3.1-8B-Instruct')).toBe('meta-llama');
    expect(modelMaker('Qwen/Qwen3-8B')).toBe('Qwen');
    expect(modelMaker('LGAI-EXAONE/EXAONE-4.0-32B')).toBe('LG AI Research');
    expect(modelMaker('someone-new/Model-7B')).toBe('someone-new');
  });

  it('registry names are non-empty and every entry belongs to a catalog organization', () => {
    const orgs = new Set(models.map((x) => hfOrgOf(x.hfId)));
    for (const [org, name] of Object.entries(MODEL_MAKERS)) {
      expect(name.trim(), org).not.toBe('');
      expect(orgs.has(org), `${org} is not used by any catalog model`).toBe(true);
    }
  });
});

describe('GPU list groups', () => {
  it('puts every catalog GPU in exactly one group, in the fixed group order, keeping data order inside', () => {
    const groups = gpuListGroups(gpus);
    expect(groups.map((g) => g.group)).toEqual(GPU_LIST_GROUPS.filter((g) => groups.some((x) => x.group === g)));
    expect(groups.flatMap((g) => g.gpus.map((x) => x.id)).sort()).toEqual(gpus.map((x) => x.id).sort());
    for (const { gpus: inGroup } of groups) {
      const positions = inGroup.map((x) => gpus.indexOf(x));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  it('laptops get their own group; Apple, other unified memory and CPU profiles are separate', () => {
    const groupOf = (id: string) => gpuListGroup(gpus.find((x) => x.id === id)!);
    expect(groupOf('rtx-4090')).toBe('nvidia');
    expect(groupOf('rtx-4090-laptop')).toBe('laptop');
    expect(groupOf('rx-9070-xt')).toBe('amd');
    expect(groupOf('arc-b580')).toBe('intel');
    expect(groupOf('apple-m4-pro')).toBe('apple');
    expect(groupOf('amd-strix-halo')).toBe('apu');
    expect(groupOf('nvidia-dgx-spark')).toBe('apu');
    expect(groupOf('cpu-ddr5-5600-2ch')).toBe('cpu');
    for (const gpu of gpus.filter((x) => x.form === 'laptop')) expect(gpuListGroup(gpu), gpu.id).toBe('laptop');
  });

  it('row data: memory = VRAM or the largest option; price only for a dGPU street price with its date', () => {
    const card = gpus.find((x) => x.id === 'rtx-5060-ti-16gb')!;
    expect(gpuMemoryGB(card)).toBe(16);
    expect(gpuRowData(card, 12)).toEqual({
      'data-memory': '16',
      'data-bandwidth': String(card.memBandwidthGBs),
      'data-price': String(card.streetUSD),
      'data-good': '12',
    });
    const msrpOnly = gpus.find((x) => x.kind === 'dgpu' && x.streetUSD === undefined)!;
    expect(gpuRowData(msrpOnly, 0)).not.toHaveProperty('data-price');
    const mac = gpus.find((x) => x.id === 'apple-m4-max-40c')!;
    expect(gpuMemoryGB(mac)).toBe(mac.ramOptionsGB!.at(-1));
    expect(gpuRowData(gpus.find((x) => x.id === 'amd-strix-halo')!, 3)).not.toHaveProperty('data-price');
  });
});

describe('list controls order and filter rules (lib/list-order.ts)', () => {
  const row = (index: number, data: Record<string, string | undefined>) => ({ index, data });
  const rows = [row(0, { v: '3', tag: '1' }), row(1, { v: '10' }), row(2, {}), row(3, { v: '3', size: 's' }), row(4, { v: 'x', size: 'l' })];

  it('no key = server order; asc/desc by number, ties by server order, missing or non-numeric values last', () => {
    expect(orderRows([...rows].reverse(), {}).map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(orderRows(rows, { key: 'v' }).map((r) => r.index)).toEqual([0, 3, 1, 2, 4]);
    expect(orderRows(rows, { key: 'v', desc: true }).map((r) => r.index)).toEqual([1, 0, 3, 2, 4]);
  });

  it('does not change the input array', () => {
    const copy = rows.map((r) => r.index);
    orderRows(rows, { key: 'v', desc: true });
    expect(rows.map((r) => r.index)).toEqual(copy);
  });

  it('selects match the attribute value (empty = all); toggles need the attribute', () => {
    expect(rows.filter((r) => rowMatches(r, { selects: { size: 's' }, toggles: [] })).map((r) => r.index)).toEqual([3]);
    expect(rows.filter((r) => rowMatches(r, { selects: { size: '' }, toggles: [] }))).toHaveLength(rows.length);
    expect(rows.filter((r) => rowMatches(r, { selects: {}, toggles: ['tag'] })).map((r) => r.index)).toEqual([0]);
    expect(rows.filter((r) => rowMatches(r, { selects: { size: 's' }, toggles: ['tag'] }))).toHaveLength(0);
  });

  it('isFiltered is true only when a select has a value or a toggle is on', () => {
    expect(isFiltered({ selects: {}, toggles: [] })).toBe(false);
    expect(isFiltered({ selects: { size: '' }, toggles: [] })).toBe(false);
    expect(isFiltered({ selects: { size: 'm' }, toggles: [] })).toBe(true);
    expect(isFiltered({ selects: {}, toggles: ['korean'] })).toBe(true);
  });
});
