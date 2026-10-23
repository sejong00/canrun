/**
 * 계산기 상태 → 엔진 하드웨어 구성 (P1-3 D32·D33). 순수 함수.
 * 카탈로그 GPU 는 `hardwareConfigs` 에 사용자 선택(RAM·DDR·OS·화면 출력)을 넘기고, 커스텀 하드웨어는 합성 GpuCore 로
 * 같은 경로를 태운 뒤 결과를 theoretical 로 고정한다.
 */
import { canMixWith, hardwareConfigs, HUB_POLICY, type CatalogLite, type GpuCore, type HwConfig } from '@canrun/data/client';
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
  /** dGPU 전체 장수 (1 이상) — 1번 GPU 장수 + 함께 꽂은 카드 수 */
  gpuCount: number;
  /** 함께 꽂은 다른 카드 (10-03 D67, 넣은 순서) — 없으면 빈 배열. 1번 GPU 장수 = gpuCount − extras.length */
  extras: GpuCore[];
  /** 여러 대 연결 대수 (10-23 D118 — DGX Spark, 1 이상). 1 이 아니면 이론 추정이고 결과 카드에 RPC 명령이 붙는다 */
  nodes: number;
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
    return config ? { gpu, config, theoretical: true, ramGB, os, gpuCount, extras: [], nodes: 1 } : undefined;
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
  // 멀티 GPU(같은 카드 D58·서로 다른 카드 D67)는 보정 표본 밖 — 이론 추정으로 고정
  const primaryCount = gpu.kind === 'dgpu' ? (state.gpus ?? 1) : 1;
  const extras =
    gpu.kind === 'dgpu'
      ? (state.plus ?? []).map((id) => findGpu(catalog, id)).filter((g): g is GpuCore => g !== undefined && canMixWith(gpu, g))
      : [];
  const gpuCount = primaryCount + extras.length;
  // 여러 대 연결(10-23 D118) — `cluster` 가 있는 통합 메모리 기기만(정리는 normalize, 범위 밖이면 hardwareConfigs 도 1대로 둔다)
  const requestedNodes = gpu.kind === 'unified' && gpu.cluster ? (state.nodes ?? 1) : 1;
  const [config] = hardwareConfigs(gpu, catalog.gpus, {
    ramGB,
    os,
    isDisplayGpu: state.display,
    ramBandwidthGBs: ddrBandwidth(catalog, state.ddr),
    ...(primaryCount > 1 ? { gpuCount: primaryCount } : {}),
    ...(extras.length > 0 ? { extraGpus: extras } : {}),
    ...(requestedNodes > 1 ? { nodes: requestedNodes } : {}),
  });
  if (!config) return undefined;
  const nodes = config.nodes ?? 1;
  // 멀티 GPU·여러 대 연결은 보정 표본 밖 — 이론 추정
  return { gpu, config, theoretical: gpuCount > 1 || nodes > 1, ramGB, os, gpuCount, extras, nodes };
}

/**
 * 허브 가정(D2)과 다른 항목 — "상세 (허브 가정 기준)" 라벨 조건 (D33). `ramShown`: "상세" 링크가 `?ram=N` 으로 사용자 RAM 을
 * 넘겨 콤보 페이지가 그 RAM 으로 열린다(10-03 D64) — RAM 차이는 라벨에 적지 않는다(리뷰 반영: "RAM 32GB 기준" 라벨과 엇갈림)
 */
export function differsFromHubAssumption(state: CalcState, resolved: ResolvedHardware, ramShown = false): boolean {
  if (resolved.gpu.kind !== 'dgpu') return false;
  return (
    resolved.gpuCount > 1 ||
    (!ramShown && resolved.ramGB !== HUB_POLICY.dgpuRamGB) ||
    resolved.os !== HUB_POLICY.dgpuOs ||
    !state.display ||
    state.ddr !== 'ddr5-5600'
  );
}

/**
 * 결과 카드 "상세" 링크(콤보 페이지)의 쿼리 — 콤보 아일랜드가 처음 열 때만 읽는다(D28·D64).
 * ctx·KV 가 기본(8k·f16)이 아니면 그 셀(`ctx`·`kv`), 기본이면 1장 dGPU 의 시스템 RAM 이 콤보 RAM 계단 안일 때 `ram`
 * (32GB 도 붙인다 — RAM 힌트 페이지는 정적 기준이 64·96GB 라 32GB 사용자가 그 RAM 으로 열리지 않게). 콤보 페이지는 RAM 이
 * 판정을 바꾸지 않는 페이지면 `ram` 을 무시한다.
 */
export function comboDetailQuery(
  state: Pick<CalcState, 'ctx' | 'kv'>,
  resolved: Pick<ResolvedHardware, 'gpu' | 'gpuCount' | 'ramGB'>,
  cardCtx: number,
): string {
  if (state.ctx !== HUB_POLICY.referenceCtx || state.kv !== 'f16') return `?ctx=${cardCtx}&kv=${state.kv}`;
  if (resolved.gpu.kind === 'dgpu' && resolved.gpuCount === 1 && HUB_POLICY.comboRamGB.includes(resolved.ramGB)) {
    return `?ram=${resolved.ramGB}`;
  }
  return '';
}
