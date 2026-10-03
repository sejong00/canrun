/** 계산기 URL 코덱 (P1-3 D31) — 라운드트립·정규형·무효값. */
import { HUB_POLICY, toCatalogLite } from '@canrun/data/client';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../../packages/data/test/seed';
import { parseCalcQuery, serializeCalcQuery } from '../lib/calc/url';
import { BUDGET_OPTIONS_USD, HW_TYPES, defaultState, normalize, type CalcState, type HwType } from '../lib/calc/state';

const catalog = toCatalogLite(loadSeed());

const roundTrip = (state: CalcState) => parseCalcQuery(serializeCalcQuery(state, catalog), catalog);

describe('serializeCalcQuery / parseCalcQuery', () => {
  it('empty state serialises to "" and parses back to defaults', () => {
    expect(serializeCalcQuery(defaultState(), catalog)).toBe('');
    expect(parseCalcQuery('', catalog)).toEqual(defaultState());
    expect(parseCalcQuery('?', catalog)).toEqual(defaultState());
  });

  it('omits defaults: a dGPU with default RAM/OS/ctx/kv is just ?gpu=id', () => {
    const s: CalcState = { ...defaultState(), hardware: { kind: 'catalog', gpuId: 'rtx-4060' }, ramGB: 32, os: 'windows' };
    expect(serializeCalcQuery(s, catalog)).toBe('?gpu=rtx-4060');
    const m4: CalcState = { ...defaultState(), hardware: { kind: 'catalog', gpuId: 'apple-m4' }, ramGB: 32, os: 'macos' };
    expect(serializeCalcQuery(m4, catalog)).toBe('?gpu=apple-m4');
  });

  it('round-trips every catalog GPU × RAM option × os × kv × ctx (canonical form is a fixed point)', () => {
    let n = 0;
    for (const gpu of catalog.gpus) {
      const rams = gpu.kind === 'dgpu' ? [16, 32, 64] : (gpu.ramOptionsGB ?? []);
      for (const ramGB of rams) {
        for (const os of ['windows', 'linux', 'macos'] as const) {
          for (const kv of ['f16', 'q8_0', 'q4_0'] as const) {
            for (const ctx of HUB_POLICY.matrixCtx) {
              const state = normalize({ ...defaultState(), hardware: { kind: 'catalog', gpuId: gpu.id }, ramGB, os, kv, ctx }, catalog);
              const qs = serializeCalcQuery(state, catalog);
              expect(roundTrip(state), qs).toEqual(state);
              expect(serializeCalcQuery(parseCalcQuery(qs, catalog), catalog)).toBe(qs);
              n += 1;
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThan(3000);
  });

  it('keeps a fixed key order and never emits a combo href', () => {
    const state: CalcState = {
      ...defaultState(),
      hardware: { kind: 'catalog', gpuId: 'rtx-4060' },
      ramGB: 64,
      ddr: 'ddr4-3200',
      os: 'linux',
      display: false,
      ctx: 32768,
      kv: 'q8_0',
      cat: ['coding', 'chat'],
      min: 'A',
      size: ['m', 's'],
      sort: 'speed',
      focus: 'qwen3-14b',
    };
    const qs = serializeCalcQuery(state, catalog);
    expect(qs).toBe('?gpu=rtx-4060&ram=64&ddr=ddr4-3200&os=linux&display=0&ctx=32768&kv=q8_0&cat=chat%2Ccoding&min=A&size=s%2Cm&sort=speed&m=qwen3-14b');
    expect(qs).not.toContain('/can-i-run/');
    expect(roundTrip(state)).toEqual(normalize(state, catalog));
  });

  it('drops invalid values field by field, keeps the rest', () => {
    const s = parseCalcQuery('?gpu=rtx-4060&ram=abc&ctx=99999999&kv=q2&os=beos&min=Z&sort=nope&cat=chat,zzz&size=xl,huge&m=ghost', catalog);
    expect(s.hardware).toEqual({ kind: 'catalog', gpuId: 'rtx-4060' });
    expect(s.ramGB).toBeUndefined();
    expect(s.ctx).toBe(8192);
    expect(s.kv).toBe('f16');
    expect(s.os).toBeUndefined();
    expect(s.min).toBeUndefined();
    expect(s.sort).toBe('verdict');
    expect(s.cat).toEqual(['chat']);
    expect(s.size).toEqual(['xl']);
    expect(s.focus).toBeUndefined();
  });

  it('resolves names and aliases from the home form to the canonical id, unknown text stays unresolved', () => {
    expect(parseCalcQuery('?gpu=4060', catalog).hardware).toEqual({ kind: 'catalog', gpuId: 'rtx-4060' });
    expect(parseCalcQuery('?gpu=GeForce%20RTX%204060', catalog).hardware).toEqual({ kind: 'catalog', gpuId: 'rtx-4060' });
    expect(parseCalcQuery('?gpu=4060+laptop', catalog).hardware).toEqual({ kind: 'catalog', gpuId: 'rtx-4060-laptop' });
    expect(parseCalcQuery('?gpu=M4%20Pro', catalog).hardware).toEqual({ kind: 'catalog', gpuId: 'apple-m4-pro' });
    expect(parseCalcQuery('?gpu=nope&ram=64', catalog)).toMatchObject({ hardware: { kind: 'unresolved', text: 'nope' }, ramGB: 64 });
    // 모호한 텍스트(4060 ti)는 확정하지 않는다
    expect(parseCalcQuery('?gpu=4060%20ti', catalog).hardware).toEqual({ kind: 'unresolved', text: '4060 ti' });
    // 해석된 뒤 직렬화하면 캐노니컬 id
    expect(serializeCalcQuery(parseCalcQuery('?gpu=4060', catalog), catalog)).toBe('?gpu=rtx-4060');
  });

  it('unified/CPU RAM snaps to the catalog options and the CPU profile follows the DDR choice', () => {
    expect(parseCalcQuery('?gpu=apple-m4&ram=20', catalog).ramGB).toBe(24);
    expect(parseCalcQuery('?gpu=apple-m4&ram=999', catalog).ramGB).toBeUndefined(); // 최대 = 기본값
    expect(parseCalcQuery('?gpu=cpu-ddr4-3200-2ch', catalog).ddr).toBe('ddr4-3200');
    expect(parseCalcQuery('?gpu=apple-m4&os=windows', catalog).os).toBeUndefined(); // apple 은 macOS 고정
  });

  it('custom hardware: gpu=custom with kind/class/vram|mem/bw/fp16', () => {
    const s = parseCalcQuery('?gpu=custom&kind=dgpu&class=amd&vram=20&bw=800&fp16=61.4&ram=64', catalog);
    expect(s.hardware).toEqual({ kind: 'custom', custom: { kind: 'dgpu', effClass: 'amd', vramGB: 20, bandwidthGBs: 800, fp16Tflops: 61.4 } });
    expect(serializeCalcQuery(s, catalog)).toBe('?gpu=custom&kind=dgpu&class=amd&vram=20&bw=800&fp16=61.4&ram=64');
    const u = parseCalcQuery('?gpu=custom&kind=unified&class=apple&mem=48&bw=273', catalog);
    expect(u.hardware).toMatchObject({ kind: 'custom', custom: { kind: 'unified', effClass: 'apple', memGB: 48, bandwidthGBs: 273 } });
    expect(roundTrip(u)).toEqual(u);
    // 범위 밖은 버린다
    expect(parseCalcQuery('?gpu=custom&kind=dgpu&vram=9999&bw=5', catalog).hardware).toMatchObject({ custom: { vramGB: undefined, bandwidthGBs: undefined } });
  });

  it('OS is coerced to what the hardware kind allows — macOS only on Apple silicon (review fix)', () => {
    // dGPU 에 macOS 를 주면 OS 예약이 0 이 되어 숫자가 바뀌는데 폼은 Windows 를 보였다
    expect(parseCalcQuery('?gpu=rtx-4060&os=macos', catalog).os).toBeUndefined();
    expect(serializeCalcQuery(parseCalcQuery('?gpu=rtx-4060&os=macos', catalog), catalog)).toBe('?gpu=rtx-4060');
    expect(parseCalcQuery('?gpu=amd-strix-halo&os=macos', catalog).os).toBeUndefined();
    expect(parseCalcQuery('?gpu=amd-strix-halo&os=windows', catalog).os).toBe('windows');
    expect(parseCalcQuery('?gpu=cpu-ddr5-5600-2ch&os=macos', catalog).os).toBeUndefined();
    expect(parseCalcQuery('?gpu=custom&kind=unified&class=strix&mem=64&bw=256&os=macos', catalog).os).toBeUndefined();
    expect(parseCalcQuery('?gpu=custom&kind=unified&class=apple&mem=64&bw=256&os=windows', catalog).os).toBeUndefined();
  });

  it('a bare VRAM number or vendor word never resolves to a GPU (re-verification)', () => {
    for (const q of ['8', '10', 'xt%2016', 'nvidia', 'rtx%203060%20ti']) {
      expect(parseCalcQuery(`?gpu=${q}`, catalog).hardware.kind, q).toBe('unresolved');
    }
  });

  it('custom kind ↔ class coupling holds for URLs too (review fix)', () => {
    expect(parseCalcQuery('?gpu=custom&kind=unified&class=nvidia&mem=64&bw=500', catalog).hardware).toMatchObject({ custom: { kind: 'unified', effClass: 'apple' } });
    expect(parseCalcQuery('?gpu=custom&kind=dgpu&class=apple&vram=24&bw=800', catalog).hardware).toMatchObject({ custom: { kind: 'dgpu', effClass: 'nvidia' } });
    expect(parseCalcQuery('?gpu=custom&kind=unified&class=strix&mem=64&bw=256', catalog).hardware).toMatchObject({ custom: { kind: 'unified', effClass: 'strix' } });
    expect(parseCalcQuery('?gpu=custom&kind=dgpu&class=intel-arc&vram=16&bw=560', catalog).hardware).toMatchObject({ custom: { kind: 'dgpu', effClass: 'intel-arc' } });
  });
});

describe('hf= (카탈로그 밖 모델, D57)', () => {
  it('round-trips a valid HF repo id after every other key and drops malformed ids', () => {
    const s: CalcState = { ...defaultState(), hardware: { kind: 'catalog', gpuId: 'rtx-4060' }, focus: 'llama-3.1-8b', hf: 'Qwen/Qwen3-8B' };
    expect(serializeCalcQuery(s, catalog)).toBe('?gpu=rtx-4060&m=llama-3.1-8b&hf=Qwen%2FQwen3-8B');
    expect(roundTrip(s).hf).toBe('Qwen/Qwen3-8B');
    for (const bad of ['Qwen', 'a/b/c', '../etc', 'https://huggingface.co/Qwen/Qwen3-8B', '<script>/x']) {
      expect(parseCalcQuery(`?hf=${encodeURIComponent(bad)}`, catalog).hf, bad).toBeUndefined();
    }
    expect(normalize({ ...defaultState(), hf: 'x/y' }, catalog).hf).toBe('x/y');
  });
});

describe('gpus= (멀티 GPU, D58)', () => {
  it('round-trips 2–4 identical dGPUs right after the hardware keys; drops 1, out-of-range and non-dGPU', () => {
    const s: CalcState = { ...defaultState(), hardware: { kind: 'catalog', gpuId: 'rtx-3090' }, gpus: 2, ramGB: 64 };
    expect(serializeCalcQuery(s, catalog)).toBe('?gpu=rtx-3090&gpus=2&ram=64');
    expect(roundTrip(s).gpus).toBe(2);
    expect(parseCalcQuery('?gpu=rtx-3090&gpus=1', catalog).gpus).toBeUndefined();
    expect(parseCalcQuery('?gpu=rtx-3090&gpus=7', catalog).gpus).toBeUndefined();
    expect(parseCalcQuery('?gpu=apple-m4&gpus=2', catalog).gpus).toBeUndefined();
    expect(parseCalcQuery('?gpu=custom&kind=dgpu&vram=24&bw=936&gpus=3', catalog).gpus).toBe(3);
  });
});

describe('model mode keys (10-03 D65): mode m hf type budget gsort', () => {
  it('the hardware-mode default is omitted; model mode keeps the hardware keys and appends its own in a fixed order', () => {
    expect(serializeCalcQuery({ ...defaultState(), mode: 'model', focus: 'qwen3-14b' }, catalog)).toBe('?mode=model&m=qwen3-14b');
    const s: CalcState = {
      ...defaultState(),
      mode: 'model',
      hardware: { kind: 'catalog', gpuId: 'rtx-4060' },
      ramGB: 16,
      ctx: 32768,
      kv: 'q8_0',
      min: 'A',
      focus: 'gpt-oss-20b',
      type: ['unified', 'desktop', 'desktop'],
      budget: 700,
      gsort: 'price',
    };
    const qs = serializeCalcQuery(s, catalog);
    expect(qs).toBe('?gpu=rtx-4060&ram=16&ctx=32768&kv=q8_0&min=A&mode=model&m=gpt-oss-20b&type=desktop%2Cunified&budget=700&gsort=price');
    expect(roundTrip(s)).toEqual(normalize(s, catalog));
    expect(serializeCalcQuery(parseCalcQuery(qs, catalog), catalog)).toBe(qs);
    // 불러온 모델이 대상인 링크
    expect(serializeCalcQuery({ ...defaultState(), mode: 'model', hf: 'Qwen/Qwen3-4B' }, catalog)).toBe('?mode=model&hf=Qwen%2FQwen3-4B');
  });

  it('round-trips every model × gsort × budget step × a few type sets (canonical form is a fixed point)', () => {
    let n = 0;
    for (const model of catalog.models) {
      for (const gsort of ['verdict', 'speed', 'price'] as const) {
        for (const budget of [undefined, ...BUDGET_OPTIONS_USD]) {
          for (const type of [[], ['laptop'], ['cpu', 'desktop'], [...HW_TYPES]] as HwType[][]) {
            const state = normalize({ ...defaultState(), mode: 'model', focus: model.id, gsort, budget, type }, catalog);
            const qs = serializeCalcQuery(state, catalog);
            expect(roundTrip(state), qs).toEqual(state);
            expect(serializeCalcQuery(parseCalcQuery(qs, catalog), catalog)).toBe(qs);
            n += 1;
          }
        }
      }
    }
    expect(n).toBe(catalog.models.length * 3 * (BUDGET_OPTIONS_USD.length + 1) * 4);
  });

  it('drops invalid mode / type / budget / gsort values and keeps the rest', () => {
    const s = parseCalcQuery('?mode=gpu&m=qwen3-14b&type=desktop,phone,cpu,desktop&budget=650&gsort=cheap', catalog);
    expect(s.mode).toBe('hardware');
    expect(s.focus).toBe('qwen3-14b');
    expect(s.type).toEqual(['desktop', 'cpu']);
    expect(s.budget).toBeUndefined();
    expect(s.gsort).toBe('verdict');
    expect(parseCalcQuery('?mode=model&budget=-1', catalog).budget).toBeUndefined();
    expect(parseCalcQuery('?mode=model&budget=3000', catalog)).toMatchObject({ mode: 'model', budget: 3000 });
  });

  it('the model hub link (`?mode=model&m=<id>`) is already canonical for every model — no replaceState rewrite on load', () => {
    for (const model of catalog.models) {
      const qs = `?mode=model&m=${model.id}`;
      expect(serializeCalcQuery(parseCalcQuery(qs, catalog), catalog), model.id).toBe(qs);
    }
  });
});
