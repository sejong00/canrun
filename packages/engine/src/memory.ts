/** 메모리 모델 — docs/02-engine-spec.md §2. */

import {
  COMPUTE_BUFFER_BASE_GB,
  COMPUTE_BUFFER_PER_32K_CTX_GB,
  CPU_OS_RESERVE_GB,
  KV_BYTES_PER_EL,
  NATIVE_QUANTS,
  OS_RESERVE_GB,
  QUANT_BPW,
  UNIFIED_USABLE_FRACTION,
} from './constants';
import type { GpuUnit, Hardware, KvQuant, ModelQuant, QuantId } from './types';

/**
 * 가중치 크기 GB — 1순위 fileGB(실제 GGUF), 2순위 paramsB × bpw / 8 (§2.1).
 * 네이티브 quant(MXFP4 등)는 bpw 환산 금지 — fileGB 없으면 명시적 실패 (외부 리뷰 반영).
 */
export function weightsGB(mq: Pick<ModelQuant, 'paramsB' | 'quant' | 'fileGB'>): number {
  if (mq.fileGB !== undefined) return mq.fileGB;
  return weightsGBFromBpw(mq.paramsB, mq.quant);
}

/** bpw 폴백만으로 가중치 GB (bestQuant 탐색 등 fileGB 가 없는 quant 용). 네이티브 quant 거부. */
export function weightsGBFromBpw(paramsB: number, quant: QuantId): number {
  if (NATIVE_QUANTS.includes(quant)) {
    throw new Error(
      `${quant} is a native quantization — bpw conversion is forbidden, actual fileGB is required (docs/02 §2.1)`,
    );
  }
  return (paramsB * QUANT_BPW[quant]) / 8;
}

/** GQA 기본식: 2 × layers × kvHeads × headDim × bytesPerEl (§2.2). 커스텀 입력 모드용. */
export function kvBytesPerToken(
  arch: { layers: number; kvHeads: number; headDim: number },
  kvQuant: KvQuant = 'f16',
): number {
  return 2 * arch.layers * arch.kvHeads * arch.headDim * KV_BYTES_PER_EL[kvQuant];
}

/** ctx 만큼의 KV 캐시 GB — f16 기준 사전 계산값에 KV quant 스케일 적용 (§2.2). */
export function kvGB(kvBytesPerTokenF16: number, ctx: number, kvQuant: KvQuant = 'f16'): number {
  const scale = KV_BYTES_PER_EL[kvQuant] / KV_BYTES_PER_EL.f16;
  return (kvBytesPerTokenF16 * scale * ctx) / 1e9;
}

/** llama.cpp 그래프·스크래치 근사 (§2.3). */
export function computeBufferGB(ctx: number): number {
  return COMPUTE_BUFFER_BASE_GB + COMPUTE_BUFFER_PER_32K_CTX_GB * (ctx / 32768);
}

/** OS 예약 GB (§2.3). macOS 는 unified 규칙(×0.70)에 흡수 → 0. */
export function osReserveGB(hw: Pick<Hardware, 'kind' | 'os' | 'isDisplayGpu'>): number {
  if (hw.kind !== 'dgpu' || !hw.isDisplayGpu) return OS_RESERVE_GB.headless;
  if (hw.os === 'windows') return OS_RESERVE_GB.windowsDisplay;
  if (hw.os === 'linux') return OS_RESERVE_GB.linuxDisplay;
  return OS_RESERVE_GB.headless;
}

/** 카드 목록(`Hardware.gpus`, 10-03 D67)이 있는 dGPU 인가 */
function hasGpuList(hw: Pick<Hardware, 'kind' | 'gpus'>): hw is Pick<Hardware, 'kind'> & { gpus: readonly GpuUnit[] } {
  return hw.kind === 'dgpu' && hw.gpus !== undefined && hw.gpus.length > 0;
}

/** dGPU 장수 (§6) — 정수 1 이상, dGPU 가 아니면 1. 카드 목록이 있으면 그 길이 */
export function gpuCountOf(hw: Pick<Hardware, 'kind' | 'gpuCount' | 'gpus'>): number {
  if (hasGpuList(hw)) return hw.gpus.length;
  if (hw.kind !== 'dgpu' || hw.gpuCount === undefined) return 1;
  return Math.max(1, Math.floor(hw.gpuCount));
}

/**
 * dGPU 카드 목록 (§6, 10-03 D67) — `gpus` 가 있으면 그대로, 없으면 위 필드로 `gpuCount` 장을 만든다(화면 출력은 1번 카드만).
 * dGPU 가 아니면 빈 목록
 */
export function gpuUnitsOf(hw: Hardware): GpuUnit[] {
  if (hw.kind !== 'dgpu') return [];
  if (hasGpuList(hw)) return [...hw.gpus];
  return Array.from({ length: gpuCountOf(hw) }, (_, i) => ({
    vramGB: hw.vramGB ?? 0,
    memBandwidthGBs: hw.memBandwidthGBs,
    effClass: hw.effClass,
    ...(hw.effOverride !== undefined ? { effOverride: hw.effOverride } : {}),
    ...(i === 0 && hw.isDisplayGpu ? { isDisplayGpu: true } : {}),
  }));
}

/** 카드가 전부 같은가 (VRAM·대역폭·효율 — 화면 출력 여부는 보지 않는다). 같으면 같은 GPU N 장(D58)과 같은 식을 탄다 */
export function isUniformGpus(units: readonly GpuUnit[]): boolean {
  const [first] = units;
  return units.every(
    (u) =>
      u.vramGB === first!.vramGB &&
      u.memBandwidthGBs === first!.memBandwidthGBs &&
      u.effClass === first!.effClass &&
      u.effOverride === first!.effOverride,
  );
}

/** 카드 한 장의 OS 예약 GB — 화면 출력 카드만 (§2.3) */
function unitReserveGB(os: Hardware['os'], unit: GpuUnit): number {
  return osReserveGB({ kind: 'dgpu', os, isDisplayGpu: unit.isDisplayGpu });
}

/** 하드웨어 전체의 OS 예약 GB — 카드 목록이 있으면 화면 출력 카드의 예약 합, 아니면 `osReserveGB` (§2.3·§6) */
export function gpuOsReserveGB(hw: Hardware): number {
  if (!hasGpuList(hw)) return osReserveGB(hw);
  return hw.gpus.reduce((sum, u) => sum + unitReserveGB(hw.os, u), 0);
}

/** dGPU VRAM 합 GB (물리 한도, §2.4) — 같은 카드면 vram × N (D58 과 같은 연산), 서로 다른 카드면 카드별 합 */
export function vramTotalGB(hw: Hardware): number {
  if (!hasGpuList(hw)) return (hw.vramGB ?? 0) * gpuCountOf(hw);
  if (isUniformGpus(hw.gpus)) return hw.gpus[0]!.vramGB * hw.gpus.length;
  return hw.gpus.reduce((sum, u) => sum + u.vramGB, 0);
}

/**
 * 카드마다 층을 나눠 받는 몫 (§6, 10-03 D67) — llama.cpp 는 `-ts` 가 없으면 장치마다 남은 메모리 비율로 층을 나눈다.
 * 남은 메모리 = VRAM − 화면 출력 예약(음수는 0). 합이 0 이면 똑같이 나눈다. 합은 1
 */
export function gpuSharesOf(hw: Hardware): number[] {
  const units = gpuUnitsOf(hw);
  const caps = units.map((u) => Math.max(0, u.vramGB - unitReserveGB(hw.os, u)));
  const pool = caps.reduce((a, b) => a + b, 0);
  return caps.map((cap) => (pool > 0 ? cap / pool : 1 / units.length));
}

/**
 * 통합 메모리 기기 대수 (§6.2 클러스터, 10-23 D118) — 정수 1 이상, 통합 메모리가 아니면 1. dGPU 의 장수(`gpuCountOf`)와 따로 센다
 * (dGPU 여러 장은 한 기기 안의 카드, 이것은 네트워크로 이은 기기)
 */
export function nodeCountOf(hw: Pick<Hardware, 'kind' | 'nodes'>): number {
  if (hw.kind !== 'unified' || hw.nodes === undefined) return 1;
  return Math.max(1, Math.floor(hw.nodes));
}

/**
 * 통합 메모리 여러 대(§6.2, 10-23 D118)에서 첫 기기(llama-server 를 띄운 대 — 장치 목록 맨 뒤)가 받는 층 몫 — llama.cpp 기본 층 분할은 장치마다 남은 메모리
 * 비율로 나누고(같은 기기면 고르게), 출력층도 한 칸으로 세어 (층 + 1) 칸을 나눈다(https://github.com/ggml-org/llama.cpp/blob/184f6536024668e8908ab8c86033d56708e62b40/src/llama-model.cpp#L1641-L1699 —
 * 칸 il 의 장치 = upper_bound(splits, il / (층 + 1)), 출력층 = 칸 n_layer). 남은 메모리가 같으면 한 장치가 받는 칸은 많아야 올림((층 + 1) / 대수) 개이므로 그 수를
 * 층 수로 나눈 몫을 가중치·KV 에 쓴다. 첫 기기가 아닌 대의 몫은 `clusterRemoteShareOf`(남은 메모리가 조금만 달라도 한 칸 더 받을 수 있다 — 엔진 0.14.2).
 * 층마다 크기가 같다고 보는 **근사**다(상한이 아니다 — D118 리뷰): 카탈로그 큰 행(파일 40GB 이상 24행)의 GGUF 헤더로 llama.cpp 분할을 그대로 따라 해 보면
 * 대부분 실제보다 조금 크지만(출력층이 트렁크 층보다 작다), 층마다 양자화가 다른 파일은 작게 나온다(Kolibri-1 Q4_K_M — 블록 0.89~1.65GB — 최대 4대 −2.04GB).
 * KV 도 층마다 같다고 보므로 KV 층이 띄엄띄엄인 하이브리드는 KV 층이 몰린 대를 아주 긴 문맥에서 작게 본다(Solar Open2 Q2_K 1M f16 4대 약 3.1GB — docs/02 §6.2·§9).
 * 앞쪽 dense 층이 있는 MoE 의 전문가 몫은 `clusterNodeLoadGB` 가 층 위치로 센다. 층 수가 없는 입력은 1/대수, 대수 1 이면 1. [0, 1] 로 묶는다
 */
export function clusterShareOf(mq: Pick<ModelQuant, 'layers'>, nodes: number): number {
  if (nodes <= 1) return 1;
  const layers = mq.layers;
  if (layers === undefined || layers < 1) return 1 / nodes;
  return Math.min(1, Math.ceil((layers + 1) / nodes) / layers);
}

/**
 * 통합 메모리 여러 대(§6.2, D118 리뷰 2차 · 엔진 0.14.2)에서 첫 기기가 아닌 대(`--rpc` 로 붙인 RPC 서버 — 장치 목록 앞)가 받는 층 몫 = 내림((층 + 1) / 대수) + 1 칸 ÷ 층 수.
 * llama.cpp 는 남은 메모리 비율로 경계를 정하므로 첫 기기의 남은 메모리가 조금만 작아도(llama-server 프로세스·데스크톱 — 같은 설정이면 그러기 쉽다, 실측 확인은 없다) 경계가 앞 장치 쪽으로
 * 밀려, (층 + 1) 칸이 대수로 나누어떨어지는 구성에서는 원격 한 대가 올림보다 한 칸 더 받는다(DeepSeek V4 Flash 44칸: 2대 22 → 23, 4대 11 → 12). 원격 장치 k 가 받을 수
 * 있는 칸은 닫힌 구간 [k(층 + 1)/대수, (k + 1)(층 + 1)/대수] 의 정수이고 그 수의 최댓값이 이 값이다(첫 RPC 장치 — 칸 0 ~ 내림((층 + 1)/대수)). 나누어떨어지지 않으면
 * 올림과 같다(`clusterShareOf` 와 같은 값). 남은 메모리 차이가 커서 경계가 두 칸 이상 밀리면 더 받을 수 있다 — 근사의 한계(docs/02 §6.2).
 * 층 수가 없는 입력은 1/대수, 대수 1 이면 1. [0, 1] 로 묶는다
 */
export function clusterRemoteShareOf(mq: Pick<ModelQuant, 'layers'>, nodes: number): number {
  if (nodes <= 1) return 1;
  const layers = mq.layers;
  if (layers === undefined || layers < 1) return 1 / nodes;
  return Math.min(1, (Math.floor((layers + 1) / nodes) + 1) / layers);
}

/**
 * 통합 메모리 여러 대(§6.2, D118 리뷰)에서 한 대가 맡는 전문가 층 수의 최댓값 — 같은 기기(남은 메모리가 같다)면 llama.cpp 의 칸 il 장치는
 * upper_bound(splits = (k + 1)/대수, il/(층 + 1)) = 내림(il × 대수 / (층 + 1))이다(정수 산식 — 경계 칸은 다음 대, 위 clusterShareOf 의 같은 코드).
 * 전문가 층 번호(`moeLayerIdx` — 데이터 arch.expertLayers)를 그 식으로 대에 나눠 가장 많은 대의 수를 센다. 범위 밖 번호는 양 끝 대로 묶는다
 */
export function clusterMaxMoeLayersOf(moeLayerIdx: readonly number[], layers: number, nodes: number): number {
  const counts = new Array<number>(nodes).fill(0);
  for (const il of moeLayerIdx) {
    const unit = Math.min(nodes - 1, Math.max(0, Math.floor((il * nodes) / (layers + 1))));
    counts[unit] = counts[unit]! + 1;
  }
  return Math.max(...counts);
}

/**
 * 통합 메모리 여러 대(§6.2, D118 리뷰 2차 · 엔진 0.14.2)에서 첫 기기가 아닌 대 하나가 맡을 수 있는 전문가 층 수의 최댓값 — 원격 장치 k(0 ~ 대수 − 2)가 받을 수 있는
 * 칸은 닫힌 구간 k(층 + 1) ≤ il × 대수 ≤ (k + 1)(층 + 1)(정수 산식 — 같은 기기면 아래 끝만, 첫 기기의 남은 메모리가 조금 작으면 위 끝 경계 칸도 이 대로 온다 —
 * `clusterRemoteShareOf` 와 같은 이유)이고, 그 안의 전문가 층 번호 수 가운데 가장 큰 값을 센다. 범위 밖 번호는 양 끝 대로 묶는다(첫 기기 쪽은 세지 않는다)
 */
export function clusterMaxRemoteMoeLayersOf(moeLayerIdx: readonly number[], layers: number, nodes: number): number {
  const cells = layers + 1;
  let max = 0;
  for (let k = 0; k < nodes - 1; k++) {
    let n = 0;
    for (const raw of moeLayerIdx) {
      const il = Math.min(layers, Math.max(0, raw));
      if (il * nodes >= k * cells && il * nodes <= (k + 1) * cells) n++;
    }
    max = Math.max(max, n);
  }
  return max;
}

/**
 * 통합 메모리 여러 대(§6.2, 10-23 D118)에서 가장 많이 맡는 대의 가중치·KV GB — 첫 기기와 첫 기기가 아닌 대 가운데 (가중치 + KV)가 큰 쪽.
 * 첫 기기: 장치에 올라가는 가중치(층·출력층 — `gpuResidentGBFor`)와 KV 는 `clusterShareOf` 몫, 장치 밖 몫(입력 임베딩 — llama.cpp 는 늘 첫 기기의 CPU 에 둔다,
 * 같은 통합 메모리 · 기본 미적재 MTP 블록도 보수로 센다)은 첫 기기에 더한다 — 첫 기기의 칸 수가 다른 대보다 적을 수 있어도 가장 많은 칸 + 장치 밖 몫으로 묶는다
 * (https://github.com/ggml-org/llama.cpp/blob/184f6536024668e8908ab8c86033d56708e62b40/src/llama.cpp#L275-L276 — RPC 장치가 목록 앞, 첫 기기의 GPU 가 맨 뒤라 마지막 층들과
 * 출력층을 맡는다 · 입력층은 CPU, 같은 커밋 src/llama-model.cpp#L1688-L1690).
 * 첫 기기가 아닌 대(D118 리뷰 2차 · 엔진 0.14.2): 상주 가중치·KV 를 `clusterRemoteShareOf` 몫으로(장치 밖 몫 없음) — 첫 기기의 남은 메모리가 조금 작으면 원격 한 대가
 * 한 칸 더 받는다. 칸 수가 대수로 나누어떨어지지 않으면 이쪽이 첫 기기보다 크지 않아 0.14.1 과 같은 값이다.
 * 일부 층에만 전문가가 있는 MoE(`moeLayerIdx` — 앞쪽 dense 층, GLM-5.3-Flash·Ling·K2-Horizon·Nemotron · 헤더 실측 분할 행, D118 리뷰)는 전문가 텐서(`expertGB`)를
 * 전문가 층에만 나눠 첫 기기는 `clusterMaxMoeLayersOf`, 첫 기기가 아닌 대는 `clusterMaxRemoteMoeLayersOf` 대의 몫으로, 나머지 상주 몫(비전문가)만 칸 몫으로 센다
 * — 층마다 같다고 보면 dense 층이 작은 만큼 전문가 층 대를 작게 본다(GLM-5.3-Flash Q4_K_M 4대: 헤더 시뮬레이션 51.16GB 를 48.86 으로 보던 것이 이 식으로 52.13).
 * 반복 층 모델(`loops` — 10-22 D114)은 물리 가중치가 첫 반복을 맡은 앞쪽 대에 몰리므로 가중치 몫을 나누지 않는다(보수). 한 대면 { weights, kv } 그대로
 */
export function clusterNodeLoadGB(
  hw: Pick<Hardware, 'kind' | 'nodes'>,
  mq: ModelQuant,
  weights: number,
  kv: number,
): { weights: number; kv: number } {
  const nodes = nodeCountOf(hw);
  if (nodes <= 1) return { weights, kv };
  const share = clusterShareOf(mq, nodes);
  const remoteShare = clusterRemoteShareOf(mq, nodes);
  const resident = gpuResidentGBFor(mq, weights);
  const idx = mq.moeLayerIdx;
  let onFirst: number;
  let onRemote: number;
  if (mq.loops !== undefined && mq.loops > 1) {
    onFirst = resident;
    onRemote = resident;
  } else if (idx !== undefined && idx.length > 0 && mq.layers !== undefined && mq.layers >= 1 && mq.expertGB !== undefined) {
    const expert = Math.min(resident, Math.max(0, mq.expertGB));
    onFirst = (expert * clusterMaxMoeLayersOf(idx, mq.layers, nodes)) / idx.length + (resident - expert) * share;
    onRemote = (expert * clusterMaxRemoteMoeLayersOf(idx, mq.layers, nodes)) / idx.length + (resident - expert) * remoteShare;
  } else {
    onFirst = resident * share;
    onRemote = resident * remoteShare;
  }
  const first = { weights: Math.min(weights, onFirst + (weights - resident)), kv: kv * share };
  const remote = { weights: Math.min(weights, onRemote), kv: kv * remoteShare };
  return remote.weights + remote.kv > first.weights + first.kv ? remote : first;
}

/** 모드별 사용 가능 메모리 GB (§2.3). 통합 메모리 여러 대(§6.2)도 **한 대** 값 — 판정은 가장 많이 맡는 대가 이 값에 들어가는지로 한다 */
export function usableGB(hw: Hardware): number {
  switch (hw.kind) {
    case 'dgpu':
      // 카드 목록이 없으면 vram × N − 예약 1장분(D58 식 그대로), 있으면 Σ VRAM − Σ 화면 출력 예약 (D67)
      return vramTotalGB(hw) - gpuOsReserveGB(hw);
    case 'unified':
      // 기기 근거 값(DGX Spark — 10-23 D117)이 있으면 그 값, 없으면 macOS 기본 GPU 한도 비율(맥·Strix Halo 는 그대로)
      return hw.unifiedUsableGB ?? hw.ramGB * UNIFIED_USABLE_FRACTION;
    case 'cpu':
      return usableRamGB(hw);
  }
}

/**
 * cpu-moe/오프로드에서 CPU 쪽 사용 가능 RAM GB (§2.3 usable(cpu)). 통합 메모리 기기 근거 값(`unifiedUsableGB` — 10-23 D117)이 있으면
 * 그 값을 넘지 않는다 — OS·데스크톱 몫을 이미 뺀 같은 메모리라, CPU 로 돌린다고 더 많이 쓸 수 없다
 */
export function usableRamGB(hw: Pick<Hardware, 'ramGB'> & Partial<Pick<Hardware, 'kind' | 'unifiedUsableGB'>>): number {
  const ram = hw.ramGB - CPU_OS_RESERVE_GB;
  return hw.kind === 'unified' && hw.unifiedUsableGB !== undefined ? Math.min(ram, hw.unifiedUsableGB) : ram;
}

/**
 * 이 양자화의 비전문가(어텐션·공유 텐서) 크기 GB (09-30). `nonExpertGB` 는 기준 양자화(Q4_K_M·MXFP4) 파일에서
 * 균등 bpw 로 유도한 값이라(packages/data/src/derive.ts), **더 큰** 양자화(Q8_0 등)는 bpw 비율로 키운다.
 * 더 작은 양자화는 줄이지 않는다 — Q2_K·UD 파일은 어텐션·공유 텐서를 평균보다 높은 정밀도로 두는 경우가 많아
 * 줄이면 VRAM 을 과소 계산한다(--n-cpu-moe 명령이 OOM — PROGRESS §4 D23 과 같은 방향). 기준 양자화는 원값 그대로.
 */
export function nonExpertGBFor(
  mq: Pick<ModelQuant, 'quant' | 'nonExpertGB' | 'expertGB'>,
): number | undefined {
  if (mq.nonExpertGB === undefined) return undefined;
  // GGUF 헤더 실측 행(expertGB 동반)은 그 파일의 값 그대로 (10-01, PROGRESS §4 D56)
  if (mq.expertGB !== undefined) return mq.nonExpertGB;
  if (mq.quant === 'Q4_K_M' || mq.quant === 'MXFP4') return mq.nonExpertGB;
  return mq.nonExpertGB * Math.max(1, QUANT_BPW[mq.quant] / QUANT_BPW.Q4_K_M);
}

/**
 * dGPU 에 전량 올릴 때 그래픽카드에 상주하는 가중치 GB (§2.4-1, 10-03 D62) — llama.cpp 는 입력 임베딩을 시스템 RAM 에 두고
 * MTP 블록은 켜지 않으면 불러오지 않는다. 우선순위: `offGpuGB`(dense 헤더 실측) → MoE 실측 분할(expertGB + nonExpertGB)
 * → 파일 전체. 결과는 [0, weights] 로 묶는다(나쁜 데이터가 필요량을 파일보다 키우거나 음수로 만들지 않게).
 * 통합 메모리·CPU 는 쓰지 않는다 — Metal 은 mmap 범위째 GPU 버퍼로 감싸 이 바이트가 그 안에 들어갈 수 있다.
 */
export function gpuResidentGBFor(
  mq: Pick<ModelQuant, 'paramsB' | 'quant' | 'fileGB' | 'offGpuGB' | 'expertGB' | 'nonExpertGB'>,
  weights: number = weightsGB(mq),
): number {
  let resident = weights;
  if (mq.offGpuGB !== undefined) resident = weights - mq.offGpuGB;
  else if (mq.expertGB !== undefined && mq.nonExpertGB !== undefined) resident = mq.expertGB + mq.nonExpertGB;
  return Math.min(weights, Math.max(0, resident));
}

/**
 * 파일 중 층별 임베딩 표(PLE, `pleGB` — 10-21 D112)를 뺀 GB — dense 의 토큰당 가중치 읽기(§3.1)와 부분 오프로드 gpuFrac 의 분모(§2.4-3).
 * llama.cpp 는 이 표를 입력층으로 늘 시스템 RAM 에 두고 토큰마다 한 줄만 읽는다. `pleGB` 가 없으면 weights 그대로(기존 모델은 바뀌지 않는다).
 * [0, weights] 로 묶는다(나쁜 데이터가 음수를 만들지 않게).
 */
export function withoutPleGB(mq: Pick<ModelQuant, 'pleGB'>, weights: number): number {
  return Math.min(weights, Math.max(0, weights - (mq.pleGB ?? 0)));
}

/**
 * 반복 층(looped — `loops` ≥ 2, Nanbeige4.2 — 10-22 D114) dense 모델이 토큰마다 더 읽는 GB = (loops − 1) × 반복 블록 — dense 읽기 바이트(§3.1)에
 * 더한다. llama.cpp 는 물리 층 텐서를 논리 층 loops 배가 함께 가리키게 하고(`layers[i + j*n_phys] = layers[i]`) 그래프가 논리 층을 차례로 돈다 —
 * 반복 블록은 토큰마다 loops 번(사이에 다른 층이 있어 캐시로 다시 쓰지 못한다), 입력 임베딩(get_rows 한 줄)·출력층은 한 번.
 * 반복 블록 = 행의 헤더 실측 `loopGB`(트렁크 blk.N.* 합), 없으면 dense 읽기 바이트 전체(보수 — 실측 1점 기준 −16%, 낮게 본다).
 * loops 가 없거나 1 이하면 0(기존 모델은 바뀌지 않는다). 블록은 [0, 파일 − 층별 임베딩 표] 로 묶는다(나쁜 데이터가 읽기를 키우거나 음수로 만들지 않게)
 */
export function loopExtraGB(mq: Pick<ModelQuant, 'loops' | 'loopGB' | 'pleGB'>, weights: number): number {
  if (mq.loops === undefined || mq.loops <= 1) return 0;
  const read = withoutPleGB(mq, weights);
  const block = Math.min(read, Math.max(0, mq.loopGB ?? read));
  return (mq.loops - 1) * block;
}

/**
 * 값 전문가(MoVA, `valueExpertGB` — 10-21 D113) 중 토큰마다 읽지 않는 GB = valueExpertGB × (1 − valueExpertFrac).
 * 값 전문가는 비전문가 안에 있어(그래픽카드 상주) 배치·VRAM 은 그대로 두고 MoE 읽기 바이트(§3.1)에서만 뺀다 — llama.cpp 는 토큰마다
 * 값 전문가 valueTopK 개를 골라(ggml_argsort_top_k) 그것만 곱한다(build_lora_mm_id → ggml_mul_mat_id — 라우팅 FFN 전문가와 같은 연산).
 * 둘 중 하나라도 없으면 0(값 전문가가 없는 모델은 바뀌지 않는다). [0, nonExpert] 로 묶는다(나쁜 데이터가 비전문가 읽기를 음수로 만들지 않게).
 */
export function unreadValueExpertGB(mq: Pick<ModelQuant, 'valueExpertGB' | 'valueExpertFrac'>, nonExpert: number): number {
  if (mq.valueExpertGB === undefined || mq.valueExpertFrac === undefined) return 0;
  const frac = Math.min(1, Math.max(0, mq.valueExpertFrac));
  return Math.min(nonExpert, Math.max(0, mq.valueExpertGB * (1 - frac)));
}

/**
 * 라우팅 전문가 텐서 GB — 실측 행은 `expertGB`, 아니면 파일 − 비전문가(유도 경로: token_embd·MTP 가 전문가 쪽에 섞여
 * 층당 전문가 크기를 약간 크게 본다 = `--n-cpu-moe` 가 보수적).
 */
export function expertGBFor(mq: ModelQuant): number | undefined {
  if (mq.expertGB !== undefined) return mq.expertGB;
  const nonExpert = nonExpertGBFor(mq);
  return nonExpert === undefined ? undefined : Math.max(0, weightsGB(mq) - nonExpert);
}
