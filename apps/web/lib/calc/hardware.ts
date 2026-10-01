/**
 * 계산기 상태 → 엔진 하드웨어 구성 (P1-3 D32·D33). 순수 함수.
 * 카탈로그 GPU 는 `hardwareConfigs` 에 사용자 선택(RAM·DDR·OS·화면 출력)을 넘기고, 커스텀 하드웨어는 합성 GpuCore 로
 * 같은 경로를 태운 뒤 결과를 theoretical 로 고정한다.
 */
import { hardwareConfigs, HUB_POLICY, type CatalogLite, type GpuCore, type HwConfig } from '@canrun/data/client';
import {
  DDR_PROFILE,
  cpuProfileFor,
  defaultOs,
  defaultRam,
  findGpu,
  osLocked,
  ramOptions,
  snapRam,
  type CalcState,
  type CustomHardware,
} from './state';

export type ResolvedHardware = {
  gpu: GpuCore;
  config: HwConfig;
  /** 커스텀 하드웨어·멀티 GPU — 추정은 전부 이론(±30%) */
  theoretical: boolean;
  /** 같은 dGPU 장수 (1 이상) */
  gpuCount: number;
  /** 실제 평가에 쓰인 값 (기본값 채움) */
  ramGB: number;
  os: HwConfig['hw']['os'];
};

export const CUSTOM_GPU_ID = 'custom';

/** 커스텀 입력이 계산 가능한가 (필수값·범위) */
export function customComplete(c: CustomHardware): boolean {
  const mem = c.kind === 'dgpu' ? c.vramGB : c.memGB;
  return mem !== undefined && mem > 0 && c.bandwidthGBs !== undefined && c.bandwidthGBs > 0;
}

function customGpu(c: CustomHardware, ramGB: number): GpuCore {
  const vendor: GpuCore['vendor'] =
    c.effClass === 'nvidia' || c.effClass === 'dgx-spark'
      ? c.effClass === 'dgx-spark' ? 'nvidia-dgx' : 'nvidia'
      : c.effClass === 'amd'
        ? 'amd'
        : c.effClass === 'intel-arc'
          ? 'intel'
          : c.effClass === 'apple' || c.effClass === 'apple-ultra'
            ? 'apple'
            : c.effClass === 'strix'
              ? 'amd-apu'
              : 'generic';
  return {
    id: CUSTOM_GPU_ID,
    name: 'Custom',
    aliases: [],
    vendor,
    kind: c.kind,
    form: 'desktop',
    ...(c.kind === 'dgpu' ? { vramGB: c.vramGB } : { ramOptionsGB: [ramGB] }),
    memBandwidthGBs: c.bandwidthGBs ?? 0,
    ...(c.fp16Tflops !== undefined ? { fp16Tflops: c.fp16Tflops } : {}),
    effClass: c.effClass,
    popular: false,
  };
}

function ddrBandwidth(catalog: CatalogLite, ddr: CalcState['ddr']): number {
  const profile = findGpu(catalog, DDR_PROFILE[ddr]);
  return profile?.memBandwidthGBs ?? findGpu(catalog, HUB_POLICY.dgpuRamProfileId)?.memBandwidthGBs ?? 0;
}

/** 상태가 계산 가능한 하드웨어를 가리키면 구성을 만든다 — 아니면 undefined (폼만 보이는 상태) */
export function resolveHardware(state: CalcState, catalog: CatalogLite): ResolvedHardware | undefined {
  const hw = state.hardware;
  if (hw.kind === 'none' || hw.kind === 'unresolved') return undefined;

  if (hw.kind === 'custom') {
    if (!customComplete(hw.custom)) return undefined;
    const ramGB = hw.custom.kind === 'unified' ? hw.custom.memGB! : (state.ramGB ?? HUB_POLICY.dgpuRamGB);
    const gpu = customGpu(hw.custom, ramGB);
    const os = osLocked(hw, catalog) ?? state.os ?? defaultOs(hw, catalog);
    const gpuCount = hw.custom.kind === 'dgpu' ? (state.gpus ?? 1) : 1;
    const [config] = hardwareConfigs(gpu, catalog.gpus, {
      ramGB,
      os,
      isDisplayGpu: state.display,
      ramBandwidthGBs: ddrBandwidth(catalog, state.ddr),
      ...(gpuCount > 1 ? { gpuCount } : {}),
    });
    return config ? { gpu, config, theoretical: true, ramGB, os, gpuCount } : undefined;
  }

  let gpu = findGpu(catalog, hw.gpuId);
  if (!gpu) return undefined;
  // CPU 프로필은 DDR 선택이 곧 프로필
  if (gpu.kind === 'cpu') gpu = findGpu(catalog, cpuProfileFor(state.ddr)) ?? gpu;
  const os = osLocked(hw, catalog) ?? state.os ?? defaultOs(hw, catalog);
  const ramGB =
    gpu.kind === 'dgpu'
      ? (state.ramGB ?? defaultRam(hw, catalog))
      : snapRam(state.ramGB ?? defaultRam(hw, catalog), ramOptions(hw, catalog));
  // 멀티 GPU(D58)는 보정 표본 밖 — 이론 추정으로 고정
  const gpuCount = gpu.kind === 'dgpu' ? (state.gpus ?? 1) : 1;
  const [config] = hardwareConfigs(gpu, catalog.gpus, {
    ramGB,
    os,
    isDisplayGpu: state.display,
    ramBandwidthGBs: ddrBandwidth(catalog, state.ddr),
    ...(gpuCount > 1 ? { gpuCount } : {}),
  });
  return config ? { gpu, config, theoretical: gpuCount > 1, ramGB, os, gpuCount } : undefined;
}

/** 허브 가정(D2)과 다른 항목 — "상세 (허브 가정 기준)" 라벨 조건 (D33) */
export function differsFromHubAssumption(state: CalcState, resolved: ResolvedHardware): boolean {
  if (resolved.gpu.kind !== 'dgpu') return false;
  return (
    resolved.gpuCount > 1 ||
    resolved.ramGB !== HUB_POLICY.dgpuRamGB ||
    resolved.os !== HUB_POLICY.dgpuOs ||
    !state.display ||
    state.ddr !== 'ddr5-5600'
  );
}
