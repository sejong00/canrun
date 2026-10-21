/** fit 판정 — docs/02-engine-spec.md §2.4. */

import { CPU_MOE_GPU_LAYER_MARGIN, QUANT_BPW, QUANT_LADDER } from './constants';
import {
  computeBufferGB,
  expertGBFor,
  gpuCountOf,
  gpuOsReserveGB,
  gpuResidentGBFor,
  kvGB,
  usableGB,
  usableRamGB,
  weightsGB,
  weightsGBFromBpw,
  nonExpertGBFor,
  vramTotalGB,
  withoutPleGB,
} from './memory';
import type { Hardware, KvQuant, Mode, ModelQuant, QuantId, VramBreakdown } from './types';

export type FitResult = {
  /** 어떤 모드로든 탑재 가능한가 (false = F 후보) */
  fits: boolean;
  mode: Mode;
  vram: VramBreakdown;
  /** partial-offload 에서 GPU 상주 비율 (0~1) */
  gpuFrac?: number;
  /** cpu-moe: 전문가를 CPU 에 두는 층 수(`--n-cpu-moe`). `moeLayers` 없는 입력이면 생략 = 전문가 전부 RAM */
  cpuMoeLayers?: number;
  /** fits=false 일 때 더 낮은 quant 탐색 결과 (§2.4-5, IQ2_M 까지) */
  bestQuant?: QuantId;
};

export type FitOptions = { ctx?: number; kvQuant?: KvQuant };

const DEFAULT_CTX = 8192; // §5 판정 기준 컨텍스트

function isMoe(mq: ModelQuant): boolean {
  return mq.activeParamsB !== undefined && mq.nonExpertGB !== undefined;
}

function breakdown(
  residentWeights: number,
  kv: number,
  buffer: number,
  osReserve: number,
  limit: number,
): VramBreakdown {
  return {
    weights: residentWeights,
    kv,
    buffer,
    osReserve,
    total: residentWeights + kv + buffer + osReserve,
    limit,
  };
}

/** bestQuant 탐색을 제외한 §2.4 판정 본체. */
function fitOnce(hw: Hardware, mq: ModelQuant, weights: number, opts?: FitOptions): FitResult {
  const ctx = opts?.ctx ?? DEFAULT_CTX;
  const kv = kvGB(mq.kvBytesPerToken, ctx, opts?.kvQuant);
  // 연산 버퍼는 GPU 마다 따로 (§6 멀티 GPU — 장수 1 이면 그대로). OS 예약은 화면 출력 카드 몫(서로 다른 카드면 카드별 합, D67)
  const buffer = computeBufferGB(ctx) * gpuCountOf(hw);
  const osReserve = gpuOsReserveGB(hw);

  // cpu 단독 하드웨어는 곧바로 4번 경로
  if (hw.kind === 'cpu') {
    const usable = usableRamGB(hw);
    const fits = weights + kv <= usable;
    return {
      fits,
      mode: 'cpu-only',
      vram: breakdown(fits ? weights : 0, fits ? kv : 0, 0, 0, hw.ramGB),
    };
  }

  const pool = usableGB(hw); // dgpu: Σvram−osReserve, unified: ram×0.70
  const limit = hw.kind === 'dgpu' ? vramTotalGB(hw) : hw.ramGB;
  const usableRam = usableRamGB(hw);

  // 1. full-gpu (unified 포함 — 통합 풀에 전량 탑재). dGPU 는 llama.cpp 가 그래픽카드에 올리는 가중치만 센다(10-03 D62):
  //    입력 임베딩은 시스템 RAM, MTP 블록은 미적재. 통합 메모리는 파일 전체(Metal 은 mmap 범위째 GPU 버퍼로 감싼다).
  //    층별 임베딩 표가 있는 행(`pleGB` — 10-21 D112)은 dGPU 의 그래픽카드 밖 몫(표 + 헤더)이 시스템 RAM 에 들어가야 한다 — 표는
  //    파일의 37~55% 라 RAM 이 작으면 못 올린다. 다른 행의 GPU 밖 몫(입력 임베딩·기본 미적재 MTP 블록 — MTP 는 RAM 에도 올라가지 않는다)은
  //    전처럼 검사하지 않는다(기존 모델 판정이 구조상 그대로)
  const resident = hw.kind === 'dgpu' ? gpuResidentGBFor(mq, weights) : weights;
  const ramShare = mq.pleGB !== undefined ? weights - resident : 0;
  if (resident + kv + buffer <= pool && (ramShare === 0 || ramShare <= usableRam)) {
    return { fits: true, mode: 'full-gpu', vram: breakdown(resident, kv, buffer, osReserve, limit) };
  }

  // 2. cpu-moe (MoE 전용, dgpu): 비전문가+kv+buffer 를 GPU 에 두고, 남는 VRAM 만큼 전문가 층을 GPU 에 채운 뒤
  //    나머지 층(앞쪽 N 층 — `--n-cpu-moe N`)의 전문가만 RAM 에 둔다 (10-01 D56: llama.cpp --fit 기본 배치와 같은 방향).
  //    moeLayers 가 없는 입력은 층 단위 배치를 못 하므로 전문가 전부 RAM (09-30 가정).
  //    카드가 여럿이면(§6) 합산 풀에 채운다 — 넘치는 모드라 카드가 모두 차서 카드별 메모리 몫은 용량 비율에 가깝다(속도 배분은 근사, D67)
  if (hw.kind === 'dgpu' && isMoe(mq)) {
    const nonExpert = nonExpertGBFor(mq)!;
    const expert = expertGBFor(mq)!;
    // token_embd(llama.cpp 는 항상 CPU)·MTP 등 — 실측 행에서만 0 보다 크다
    const cpuSide = Math.max(0, weights - expert - nonExpert);
    const avail = pool - nonExpert - kv - buffer;
    if (avail >= 0) {
      const layers = mq.moeLayers;
      let cpuExpert = expert;
      let cpuMoeLayers: number | undefined;
      if (layers !== undefined && layers > 0 && expert > 0) {
        const perLayer = expert / layers;
        const gpuLayers = Math.min(
          layers - 1,
          Math.max(0, Math.floor(avail / perLayer) - CPU_MOE_GPU_LAYER_MARGIN),
        );
        cpuMoeLayers = layers - gpuLayers;
        cpuExpert = perLayer * cpuMoeLayers;
      }
      if (cpuExpert + cpuSide <= usableRam) {
        return {
          fits: true,
          mode: 'cpu-moe',
          vram: breakdown(nonExpert + (expert - cpuExpert), kv, buffer, osReserve, limit),
          ...(cpuMoeLayers !== undefined ? { cpuMoeLayers } : {}),
        };
      }
    }
  }

  // 3. partial-offload (dense, dgpu): kv+buffer 는 GPU 상주, 가중치만 분할.
  //    CPU측 가중치 = weights − max(0, usableVram − kv − buffer) — 외부 리뷰 반영(2026-08):
  //    기존 need 비례식은 kv/buffer 까지 오프로드된다고 가정해 CPU측 부담을 과소평가했다.
  //    GPU 몫 상한은 상주 가중치(그래픽카드 밖 몫은 처음부터 CPU) — VRAM 이 모자라 1 이 실패했으면 GPU 몫 < 상주 가중치라 그대로이고,
  //    시스템 RAM 이 모자라 1 이 실패한 경우(10-21 D112)에만 걸린다(그때 CPU측 ≥ 그래픽카드 밖 몫 > RAM 이라 여기서도 실패).
  //    gpuFrac 분모 = 파일 − 층별 임베딩 표(처음부터 CPU 이고 토큰마다 한 줄만 읽는다 — 속도식의 읽기 바이트와 같은 기준, 10-21 D112).
  //    표가 없는 모델은 파일 전체(입력 임베딩·MTP 포함 — 보수, §5 주의)
  if (hw.kind === 'dgpu' && !isMoe(mq) && pool > 0) {
    const gpuWeights = Math.max(0, Math.min(resident, pool - kv - buffer));
    const cpuWeights = weights - gpuWeights;
    if (gpuWeights > 0 && cpuWeights <= usableRam) {
      return {
        fits: true,
        mode: 'partial-offload',
        gpuFrac: Math.min(1, gpuWeights / withoutPleGB(mq, weights)),
        vram: breakdown(gpuWeights, kv, buffer, osReserve, limit),
      };
    }
  }

  // 4. cpu-only: 시스템 RAM 에 전량
  if (weights + kv <= usableRam) {
    return {
      fits: true,
      mode: 'cpu-only',
      vram: breakdown(0, 0, 0, osReserve, limit),
    };
  }

  // 5. 실패
  return { fits: false, mode: 'cpu-only', vram: breakdown(0, 0, 0, osReserve, limit) };
}

/** §2.4 순서: full-gpu → cpu-moe(MoE만) → partial-offload(dense) → cpu-only → 실패+bestQuant. */
export function fit(hw: Hardware, mq: ModelQuant, opts?: FitOptions): FitResult {
  const result = fitOnce(hw, mq, weightsGB(mq), opts);
  if (result.fits) return result;

  // §2.4-5: 더 낮은 quant 루프 (bpw 폴백 — 다른 quant 의 실제 파일 크기는 데이터 레이어 몫)
  const requestedBpw = QUANT_BPW[mq.quant];
  const candidates = [...QUANT_LADDER].filter((q) => QUANT_BPW[q] < requestedBpw).reverse(); // 높은 품질부터
  for (const quant of candidates) {
    const w = weightsGBFromBpw(mq.paramsB, quant);
    // MoE 는 nonExpert 도 quant 에 비례 축소된다고 근사 (실측 expertGB 는 그 파일 전용이라 버리고 유도 경로로)
    const scaled: ModelQuant = {
      ...mq,
      quant,
      fileGB: undefined,
      // 헤더 실측(그래픽카드에 안 올리는 몫·전문가 분할)은 그 파일 전용 — 다른 quant 에 옛 값이 남지 않게 비운다(상주 = 파일 전체, 보수)
      offGpuGB: undefined,
      expertGB: undefined,
      nonExpertGB:
        mq.nonExpertGB === undefined ? undefined : mq.nonExpertGB * (w / weightsGB(mq)),
      // 층별 임베딩 표(10-21 D112)는 구조라 어느 양자화에도 있다 — 크기만 같은 비율로 줄인다(gpuFrac 분모용, 상주량은 위처럼 파일 전체)
      pleGB: mq.pleGB === undefined ? undefined : mq.pleGB * (w / weightsGB(mq)),
    };
    if (fitOnce(hw, scaled, w, opts).fits) {
      return { ...result, bestQuant: quant };
    }
  }
  return result;
}
