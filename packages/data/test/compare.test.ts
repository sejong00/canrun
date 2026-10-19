/** GPU 대 GPU 비교 (packages/data/src/compare.ts, 10-19 D103) — 행 조인·정렬·속도 비율(순수 추정 중앙값)·기준 모델·밴드 겹침 */
import { describe, expect, it } from 'vitest';
import {
  bandsOverlap,
  compareGpus,
  ppRange,
  rankableStreet,
  summarizeGpu,
  verdictRank,
  type ComboAssessment,
  type GpuHubData,
} from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();
const hubs = new Map<string, GpuHubData>();
const hub = (id: string): GpuHubData => {
  let h = hubs.get(id);
  if (!h) {
    h = summarizeGpu(seed, seed.gpus.find((g) => g.id === id)!);
    hubs.set(id, h);
  }
  return h;
};

const PAIRS: ReadonlyArray<[string, string]> = [
  ['rtx-5060-ti-16gb', 'rtx-5070'],
  ['rtx-4090', 'rtx-5090'],
  ['rtx-5060-ti-8gb', 'rtx-5060-ti-16gb'],
  ['amd-strix-halo', 'nvidia-dgx-spark'],
  ['apple-m4-pro', 'rtx-5060-ti-16gb'],
];

const eligible = (c: ComboAssessment) => c.baseline.fits && c.baseline.estimate.mode === 'full-gpu' && c.baseline.estimate.verdict !== 'F';

describe('compareGpus', () => {
  it('joins every catalog model once, on each hub’s summary configuration, with the same baseline quant', () => {
    for (const [a, b] of PAIRS) {
      const cmp = compareGpus(hub(a), hub(b));
      expect(cmp.rows.map((r) => r.model.id).sort(), `${a} vs ${b}`).toEqual(seed.models.map((m) => m.id).sort());
      for (const row of cmp.rows) {
        expect(row.a, `${a} ${row.model.id}`).toBe(hub(a).rows.find((r) => r.model.id === row.model.id)!.combos[hub(a).primaryIndex]);
        expect(row.b, `${b} ${row.model.id}`).toBe(hub(b).rows.find((r) => r.model.id === row.model.id)!.combos[hub(b).primaryIndex]);
        expect(row.a.baseline.quant).toBe(row.b.baseline.quant);
        expect(row.verdictDiffers).toBe(row.a.baseline.result.verdict !== row.b.baseline.result.verdict);
      }
      expect(cmp.differing).toBe(cmp.rows.filter((r) => r.verdictDiffers).length);
    }
  });

  it('sorts by the better verdict of the two, then larger models first, then id', () => {
    for (const [a, b] of PAIRS) {
      const rows = compareGpus(hub(a), hub(b)).rows;
      const best = (i: number) => Math.max(verdictRank(rows[i]!.a.baseline.result.verdict), verdictRank(rows[i]!.b.baseline.result.verdict));
      for (let i = 1; i < rows.length; i += 1) {
        const order = best(i - 1) - best(i) || rows[i - 1]!.model.paramsB - rows[i]!.model.paramsB || rows[i]!.model.id.localeCompare(rows[i - 1]!.model.id);
        expect(order, `${a} vs ${b} at ${rows[i]!.model.id}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('speed ratio = median of b ÷ a pure estimates over rows where both fit fully on the GPU; reference = largest such model', () => {
    for (const [a, b] of PAIRS) {
      const cmp = compareGpus(hub(a), hub(b));
      const rows = cmp.rows.filter((r) => eligible(r.a) && eligible(r.b));
      expect(rows.length, `${a} vs ${b}`).toBeGreaterThan(0);
      const ratios = rows.map((r) => r.b.baseline.estimate.tgTokS.est / r.a.baseline.estimate.tgTokS.est).sort((x, y) => x - y);
      const mid = Math.floor(ratios.length / 2);
      const median = ratios.length % 2 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
      const speed = cmp.speed!;
      expect(speed.ratio, `${a} vs ${b}`).toBeCloseTo(median, 10);
      expect(speed.models).toBe(rows.length);
      const largest = Math.max(...rows.map((r) => r.model.paramsB));
      expect(speed.reference.model.paramsB).toBe(largest);
      expect(rows).toContain(speed.reference);
      expect(speed.overlap).toBe(bandsOverlap(speed.reference.a.baseline.estimate.tgTokS, speed.reference.b.baseline.estimate.tgTokS));
      expect(speed.pp.a).toEqual(ppRange({ fits: true, result: speed.reference.a.baseline.estimate }));
      expect(speed.pp.b).toEqual(ppRange({ fits: true, result: speed.reference.b.baseline.estimate }));
    }
  });

  it('uses pure estimates even where a public measurement joins (measured values never enter the ratio)', () => {
    // RTX 4090·5090 은 공개 실측이 조인되는 조합이 있다 — 그래도 비율은 estimate 로만
    const cmp = compareGpus(hub('rtx-4090'), hub('rtx-5090'));
    const measured = cmp.rows.filter((r) => r.a.baseline.measured || r.b.baseline.measured);
    expect(measured.length).toBeGreaterThan(0);
    expect(cmp.speed!.ratio).toBeGreaterThan(1.3);
    expect(cmp.speed!.ratio).toBeLessThan(2);
  });

  it('reads the direction from a to b: the reverse comparison inverts the ratio and swaps the sides', () => {
    const ab = compareGpus(hub('rtx-5060-ti-16gb'), hub('rtx-5070'));
    const ba = compareGpus(hub('rtx-5070'), hub('rtx-5060-ti-16gb'));
    expect(ab.speed!.ratio).toBeGreaterThan(1); // 5070 대역폭 672 > 448 GB/s
    expect(ab.speed!.ratio * ba.speed!.ratio).toBeCloseTo(1, 10);
    expect(ab.a.gpu.id).toBe(ba.b.gpu.id);
    expect(ab.differing).toBe(ba.differing);
    expect(ab.specRatio.bandwidth).toBeCloseTo(672 / 448, 10);
  });

  it('sides carry the hub summary: counts, largest full-GPU model, street price only with priceAsOf, benchmark rows, memory of unified devices', () => {
    for (const [a, b] of PAIRS) {
      const cmp = compareGpus(hub(a), hub(b));
      for (const [s, h] of [
        [cmp.a, hub(a)],
        [cmp.b, hub(b)],
      ] as const) {
        expect(s.counts).toBe(h.counts[h.primaryIndex]);
        expect(s.config).toBe(h.configs[h.primaryIndex]);
        expect(s.largestFullGpu).toBe(h.faq.largestFullGpu);
        expect(s.street).toEqual(rankableStreet(h.gpu));
        expect(s.benchmarks).toBe(h.benchmarks.length);
        expect(s.memoryGB).toBe(h.gpu.kind === 'dgpu' ? undefined : Math.max(...(h.gpu.ramOptionsGB ?? [])));
      }
    }
    // M4 Pro 는 가격 없음, Strix Halo 는 출시가만 — 실거래가로 세지 않는다
    expect(compareGpus(hub('apple-m4-pro'), hub('rtx-5060-ti-16gb')).a.street).toBeUndefined();
    expect(compareGpus(hub('amd-strix-halo'), hub('nvidia-dgx-spark')).a.street).toBeUndefined();
  });

  it('refuses to compare a GPU with itself', () => {
    expect(() => compareGpus(hub('rtx-5070'), hub('rtx-5070'))).toThrow(/itself/);
  });
});

describe('bandsOverlap', () => {
  it('touching ends count as overlapping', () => {
    expect(bandsOverlap({ est: 10, low: 8, high: 12 }, { est: 14, low: 12, high: 16 })).toBe(true);
    expect(bandsOverlap({ est: 10, low: 8, high: 12 }, { est: 15, low: 12.1, high: 18 })).toBe(false);
    expect(bandsOverlap({ est: 15, low: 12.1, high: 18 }, { est: 10, low: 8, high: 12 })).toBe(false);
  });
});
