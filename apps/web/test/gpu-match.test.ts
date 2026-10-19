/**
 * GPU 매처·감지 해석 (P1-3 D29·D30) — 렌더러 문자열 표 + 전 카탈로그 자기 해석 불변식.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GpuCore } from '@canrun/data/client';
import { describe, expect, it } from 'vitest';
import {
  GPU_GROUPS,
  gpuGroup,
  interpretDetection,
  laptopSibling,
  matchGpu,
  rankGpus,
  rendererCandidates,
  variantStem,
  type DetectInput,
} from '../lib/calc/gpu-match';
import { shortGpuName } from '../lib/phrases';

const repo = resolve(__dirname, '../../..');
const gpus = JSON.parse(readFileSync(join(repo, 'data/gpus.json'), 'utf8')) as GpuCore[];
const koNames = (JSON.parse(readFileSync(resolve(__dirname, '../messages/ko.json'), 'utf8')) as { GpuName: Record<string, string> }).GpuName;
const enNames = (JSON.parse(readFileSync(resolve(__dirname, '../messages/en.json'), 'utf8')) as { GpuName: Record<string, string> }).GpuName;

const ANGLE = (inner: string) => `ANGLE (${inner})`;

describe('interpretDetection — renderer strings', () => {
  const cases: Array<[string, DetectInput, unknown]> = [
    ['Windows Chrome RTX 4060', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rtx-4060' }],
    ['RTX 4060 Laptop GPU', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rtx-4060-laptop' }],
    ['RTX 4060 Ti → memory variants', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'ambiguous', candidates: ['rtx-4060-ti-16gb', 'rtx-4060-ti-8gb'] }],
    ['RTX 5060 Ti → memory variants', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 5060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'ambiguous', candidates: ['rtx-5060-ti-16gb', 'rtx-5060-ti-8gb'] }],
    ['RTX 3080 → 10/12GB', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'ambiguous', candidates: ['rtx-3080-10gb', 'rtx-3080-12gb'] }],
    // 카탈로그엔 12GB 만 있지만 실기기는 8GB 일 수 있다 — 확정 대신 그 항목을 후보로 (리뷰 지적)
    ['RTX 3060 (only 12GB tracked) → confirm, do not guess', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'ambiguous', candidates: ['rtx-3060-12gb'], text: 'rtx 3060' }],
    ['RX 9060 XT (only 16GB tracked) → confirm, do not guess', { renderer: ANGLE('AMD, AMD Radeon RX 9060 XT (0x00007590) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'ambiguous', candidates: ['rx-9060-xt-16gb'], text: 'rx 9060 xt' }],
    ['RTX 4070 Ti (only the Super is tracked) → none, never the Super', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'none', vendor: 'nvidia' }],
    ['RTX 2080 (only the Ti is tracked) → none', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 2080 (0x00001E87) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'none', vendor: 'nvidia' }],
    ['RTX 5070 Laptop (only the Ti Laptop is tracked) → none', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'none', vendor: 'nvidia' }],
    ['RTX 5090', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rtx-5090' }],
    ['RTX 4090 Laptop (not desktop 4090)', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU (0x00002757) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rtx-4090-laptop' }],
    ['RTX 4070 SUPER (case-insensitive, longest match)', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4070 SUPER (0x00002783) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rtx-4070-super' }],
    ['RTX 4070 Ti SUPER', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rtx-4070-ti-super' }],
    ['Linux raw string 3090 (not Ti)', { renderer: 'NVIDIA GeForce RTX 3090/PCIe/SSE2' }, { kind: 'exact', id: 'rtx-3090' }],
    ['GTX 1080 Ti', { renderer: ANGLE('NVIDIA, NVIDIA GeForce GTX 1080 Ti (0x00001B06) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'gtx-1080-ti' }],
    ['RX 7900 XTX', { renderer: ANGLE('AMD, AMD Radeon RX 7900 XTX (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rx-7900-xtx' }],
    ['RX 7900 XT (not XTX)', { renderer: ANGLE('AMD, AMD Radeon RX 7900 XT (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rx-7900-xt' }],
    ['Mesa RX 7800 XT with driver details', { renderer: 'AMD Radeon RX 7800 XT (radeonsi, navi32, LLVM 17.0.6, DRM 3.57, 6.8.0)' }, { kind: 'exact', id: 'rx-7800-xt' }],
    ['RX 9070 XT', { renderer: ANGLE('AMD, AMD Radeon RX 9070 XT Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rx-9070-xt' }],
    ['RX 9070', { renderer: ANGLE('AMD, AMD Radeon RX 9070 Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'rx-9070' }],
    ['Radeon 8060S (Strix Halo)', { renderer: ANGLE('AMD, AMD Radeon(TM) 8060S Graphics (0x00001586) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'amd-strix-halo' }],
    ['Intel Arc B580', { renderer: ANGLE('Intel, Intel(R) Arc(TM) B580 Graphics (0x0000E20B) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'exact', id: 'arc-b580' }],
    ['Apple M4 (Chrome macOS)', { renderer: ANGLE('Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version'), mac: true }, { kind: 'exact', id: 'apple-m4' }],
    ['Apple M4 Pro', { renderer: ANGLE('Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version'), mac: true }, { kind: 'exact', id: 'apple-m4-pro' }],
    ['Apple M4 Max → 32c/40c', { renderer: ANGLE('Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version'), mac: true }, { kind: 'ambiguous', candidates: ['apple-m4-max-32c', 'apple-m4-max-40c'] }],
    ['Safari macOS "Apple GPU" + WebGPU apple', { renderer: 'Apple GPU', vendor: 'apple', architecture: 'common-3', mac: true }, { kind: 'apple-unknown' }],
    ['Safari raw Apple M2 Ultra', { renderer: 'Apple M2 Ultra', mac: true }, { kind: 'exact', id: 'apple-m2-ultra' }],
    ['iOS Safari (touch) → none', { renderer: 'Apple GPU', vendor: 'apple', touch: true }, { kind: 'none', vendor: 'apple' }],
    ['Android Adreno → none', { renderer: ANGLE('Qualcomm, Adreno (TM) 750, OpenGL ES 3.2 V@0762.0') }, { kind: 'none', vendor: 'other' }],
    ['Android Mali → none', { renderer: 'Mali-G715-Immortalis MC11' }, { kind: 'none', vendor: 'other' }],
    ['Intel UHD 770 → none (no numeric false match)', { renderer: ANGLE('Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'none', vendor: 'intel' }],
    ['Intel Iris Xe → none', { renderer: ANGLE('Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'none', vendor: 'intel' }],
    ['Mesa generic Intel → none', { renderer: 'Mesa Intel(R) Graphics (RPL-S)' }, { kind: 'none', vendor: 'intel' }],
    ['SwiftShader (headless CI) → none', { renderer: ANGLE('Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver') }, { kind: 'none' }],
    ['Generic renderer → none', { renderer: 'WebKit WebGL' }, { kind: 'none' }],
    ['Empty → none', {}, { kind: 'none' }],
    ['Firefox without Laptop GPU suffix → desktop exact', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0') }, { kind: 'exact', id: 'rtx-4060' }],
    ['WebGPU architecture only → none (no SKU)', { vendor: 'nvidia', architecture: 'ada-lovelace', device: '', description: '' } as DetectInput, { kind: 'none', vendor: 'nvidia' }],
    ['WebGPU description', { vendor: 'nvidia', description: 'NVIDIA GeForce RTX 4080 SUPER' }, { kind: 'exact', id: 'rtx-4080-super' }],
    ['Optimus: WebGL Intel vs WebGPU NVIDIA → none', { renderer: ANGLE('Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11'), vendor: 'nvidia' }, { kind: 'none', vendor: 'nvidia' }],
    ['Unlisted variant RTX 4090 D → none', { renderer: ANGLE('NVIDIA, NVIDIA GeForce RTX 4090 D (0x00002685) Direct3D11 vs_5_0 ps_5_0, D3D11') }, { kind: 'none', vendor: 'nvidia' }],
    ['DGX Spark GB10', { renderer: 'NVIDIA GB10/PCIe/SSE2' }, { kind: 'exact', id: 'nvidia-dgx-spark' }],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(interpretDetection(input, gpus, enNames)).toMatchObject(expected as object);
    });
  }

  it('rendererCandidates unwraps ANGLE and prefers the segment with a series token', () => {
    expect(rendererCandidates(ANGLE('NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11'))[0]).toContain('RTX 4060');
    expect(rendererCandidates('NVIDIA GeForce RTX 3090/PCIe/SSE2')).toEqual(['NVIDIA GeForce RTX 3090']);
  });
});

describe('matchGpu — catalog self-resolution', () => {
  it('every id, name, alias, short name and locale override resolves to itself (or a group containing itself)', () => {
    const bad: string[] = [];
    for (const gpu of gpus) {
      const labels = [gpu.id, gpu.name, shortGpuName(gpu.name), ...gpu.aliases, enNames[gpu.id] ?? '', koNames[gpu.id] ?? ''].filter(Boolean);
      for (const label of labels) {
        const m = matchGpu(label, gpus, { names: label === koNames[gpu.id] ? koNames : enNames });
        const ok = (m.kind === 'exact' && m.id === gpu.id) || (m.kind === 'ambiguous' && m.candidates.includes(gpu.id));
        if (!ok) bad.push(`${gpu.id} ← "${label}" → ${JSON.stringify(m)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the picker display name (en/ko) resolves to exactly that GPU — a prefilled widget submits it before hydration (D107 review fix)', () => {
    const bad: string[] = [];
    for (const names of [enNames, koNames]) {
      for (const gpu of gpus) {
        const label = names[gpu.id] ?? gpu.name;
        const m = matchGpu(label, gpus, { names });
        if (!(m.kind === 'exact' && m.id === gpu.id)) bad.push(`${gpu.id} ← "${label}" → ${JSON.stringify(m)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('another GPU\'s full name never resolves to me alone', () => {
    const bad: string[] = [];
    for (const gpu of gpus) {
      const m = matchGpu(gpu.name, gpus);
      if (m.kind === 'exact' && m.id !== gpu.id) bad.push(`${gpu.name} → ${m.id}`);
    }
    expect(bad).toEqual([]);
  });

  it('user typing: aliases, spacing and case', () => {
    expect(matchGpu('RTX4060', gpus)).toEqual({ kind: 'exact', id: 'rtx-4060' });
    expect(matchGpu('4060 laptop', gpus)).toEqual({ kind: 'exact', id: 'rtx-4060-laptop' });
    expect(matchGpu('M4 Pro', gpus)).toEqual({ kind: 'exact', id: 'apple-m4-pro' });
    expect(matchGpu('m4 max 40', gpus)).toEqual({ kind: 'exact', id: 'apple-m4-max-40c' });
    expect(matchGpu('4060 ti 16gb', gpus)).toEqual({ kind: 'exact', id: 'rtx-4060-ti-16gb' });
    expect(matchGpu('cpu only', gpus)).toEqual({ kind: 'exact', id: 'cpu-ddr5-5600-2ch' });
    expect(matchGpu('7900xtx', gpus)).toEqual({ kind: 'exact', id: 'rx-7900-xtx' });
    expect(matchGpu('strix halo', gpus)).toEqual({ kind: 'exact', id: 'amd-strix-halo' });
    expect(matchGpu('DDR5-5600 듀얼채널 CPU', gpus, { names: koNames })).toEqual({ kind: 'exact', id: 'cpu-ddr5-5600-2ch' });
    expect(matchGpu('nope', gpus)).toEqual({ kind: 'none' });
    expect(matchGpu('', gpus)).toEqual({ kind: 'none' });
  });

  it('partial matches never resolve to a different SKU — Ti/Super/XT/Laptop/Pro must be typed (review fix)', () => {
    expect(matchGpu('4070 ti', gpus)).toEqual({ kind: 'none' }); // 카탈로그엔 4070 Ti Super 만
    expect(matchGpu('rtx 2080', gpus)).toEqual({ kind: 'none' }); // 2080 Ti 만
    expect(matchGpu('gtx 1080', gpus)).toEqual({ kind: 'none' }); // 1080 Ti 만
    expect(matchGpu('5070 laptop', gpus)).toEqual({ kind: 'none' }); // 5070 Ti Laptop 만
    expect(matchGpu('m5', gpus)).toEqual({ kind: 'exact', id: 'apple-m5' }); // Pro/Max 로 새지 않는다
    expect(matchGpu('9060 xt', gpus)).toEqual({ kind: 'exact', id: 'rx-9060-xt-16gb' }); // 메모리 용량만 남는 건 허용
    expect(matchGpu('7900', gpus)).toEqual({ kind: 'none' }); // XT/XTX 를 골라야 한다
    // 메모리 표기는 원래 라벨에서 먼저 뺀다 — 모델 번호가 용량으로 읽혀 VRAM 숫자만으로 확정되지 않는다 (재검증)
    for (const q of ['8', 'rtx 8', '10', 'rtx 10', 'xt 16', 'rx xt 16', '12', '16gb']) expect(matchGpu(q, gpus).kind, q).not.toBe('exact');
    expect(matchGpu('3050 8', gpus)).toEqual({ kind: 'exact', id: 'rtx-3050-8gb' });
    expect(matchGpu('3080 10', gpus)).toEqual({ kind: 'exact', id: 'rtx-3080-10gb' });
    expect(matchGpu('3060 12gb', gpus)).toEqual({ kind: 'exact', id: 'rtx-3060-12gb' });
    // 콤보박스 목록엔 여전히 뜬다 (확정만 금지)
    expect(rankGpus('4070 ti', gpus).map((g) => g.id)).toContain('rtx-4070-ti-super');
    expect(rankGpus('7900', gpus).map((g) => g.id)).toEqual(expect.arrayContaining(['rx-7900-xt', 'rx-7900-xtx']));
  });

  it('vendor-only queries browse that vendor instead of listing everything popular-first (re-verification)', () => {
    const vendorOfId = (id: string) => gpus.find((g) => g.id === id)!.vendor;
    const nvidia = rankGpus('nvidia', gpus).map((g) => g.id);
    expect(nvidia.length).toBeGreaterThan(20);
    expect(nvidia.every((id) => ['nvidia', 'nvidia-dgx'].includes(vendorOfId(id)))).toBe(true);
    const amd = rankGpus('AMD Radeon', gpus).map((g) => g.id);
    expect(amd).toEqual(expect.arrayContaining(['rx-7900-xtx', 'amd-strix-halo']));
    expect(amd.every((id) => ['amd', 'amd-apu'].includes(vendorOfId(id)))).toBe(true);
    expect(rankGpus('Intel', gpus).map((g) => g.id)).toEqual(['arc-b580']);
    expect(rankGpus('gpu', gpus)).toHaveLength(gpus.length); // 제조사 없는 잡음 = 전체 둘러보기
    for (const q of ['nvidia', 'AMD Radeon', 'Intel', 'gpu']) expect(matchGpu(q, gpus).kind, q).toBe('none');
  });

  it('rankGpus lists candidates for the combobox (empty query = popular first)', () => {
    expect(rankGpus('4060', gpus).map((g) => g.id).slice(0, 4)).toEqual(expect.arrayContaining(['rtx-4060', 'rtx-4060-laptop']));
    expect(rankGpus('', gpus)[0]!.popular).toBe(true);
    expect(rankGpus('zzz', gpus)).toEqual([]);
    // ko 힌트 "‘CPU’로 검색해 CPU 전용 항목을 고르세요" — 'CPU' 한 단어로 CPU 프로필 3종이 전부 떠야 한다 (양 로케일 표시명)
    for (const names of [enNames, koNames]) {
      const ids = rankGpus('CPU', gpus, names).map((g) => g.id);
      expect(ids).toEqual(expect.arrayContaining(['cpu-ddr5-5600-2ch', 'cpu-ddr5-6000-2ch', 'cpu-ddr4-3200-2ch']));
      expect(ids.every((id) => id.startsWith('cpu-'))).toBe(true);
    }
  });

  it('variantStem drops only the memory variant from display names', () => {
    expect(variantStem('GeForce RTX 4060 Ti 16GB')).toBe('GeForce RTX 4060 Ti');
    expect(variantStem('GeForce RTX 3060 12GB')).toBe('GeForce RTX 3060');
    expect(variantStem('Radeon RX 9060 XT 16GB')).toBe('Radeon RX 9060 XT');
    expect(variantStem('Apple M4 Max (32-core GPU)')).toBe('Apple M4 Max');
    expect(variantStem('GeForce RTX 4090')).toBe('GeForce RTX 4090');
    expect(variantStem('Ryzen AI Max+ 395 (Strix Halo)')).toBe('Ryzen AI Max+ 395 (Strix Halo)');
  });

  it('gpuGroup puts every catalog GPU in one of the six browse groups (D29), none empty', () => {
    const byGroup = new Map<string, string[]>();
    for (const gpu of gpus) byGroup.set(gpuGroup(gpu), [...(byGroup.get(gpuGroup(gpu)) ?? []), gpu.id]);
    expect([...byGroup.keys()].sort()).toEqual([...GPU_GROUPS].sort());
    expect(byGroup.get('cpu')).toEqual(expect.arrayContaining(['cpu-ddr5-5600-2ch', 'cpu-ddr4-3200-2ch']));
    expect(byGroup.get('apu')).toEqual(expect.arrayContaining(['amd-strix-halo', 'nvidia-dgx-spark']));
    expect(byGroup.get('apple')!.every((id) => id.startsWith('apple-'))).toBe(true);
    expect(byGroup.get('intel')).toEqual(['arc-b580']);
    expect(byGroup.get('nvidia')).toEqual(expect.arrayContaining(['rtx-4060', 'rtx-4060-laptop', 'gtx-1080-ti']));
  });

  it('laptopSibling finds the Laptop SKU of a desktop card', () => {
    expect(laptopSibling(gpus.find((g) => g.id === 'rtx-4060')!, gpus)?.id).toBe('rtx-4060-laptop');
    expect(laptopSibling(gpus.find((g) => g.id === 'rtx-3060-12gb')!, gpus)).toBeUndefined();
  });
});
