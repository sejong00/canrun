import type { Gpu } from '@canrun/data';
import type { GuideSlug } from '@/content/guides';
import { isPublished } from './guides';

/**
 * GPU 허브 "관련 가이드" (10-16 D95) — 하드웨어 종류마다 그 기기 사용자가 다음에 읽을 가이드 2~3편.
 * 후보는 관련 깊은 순이고, **published 만** 남긴다(D40 — 초안은 링크하지 않는다). UI 정책(엔진 상수 아님).
 *
 * - 데스크톱 NVIDIA 카드: VRAM 등급 · 예산별 카드 · 그래픽카드 2장
 * - 데스크톱 AMD·Intel 카드: ROCm·Vulkan 가이드가 맨 앞
 * - 노트북 GPU: 노트북 가이드(이름이 같아도 VRAM 이 다르다) · VRAM 등급 · MoE 를 시스템 RAM 으로
 * - 맥: 맥 가이드 · 128GB 이상 구성이 있으면 128GB 통합 메모리 비교 · 양자화
 * - 맥이 아닌 통합 메모리(Strix Halo·DGX Spark): 128GB 통합 메모리 비교 · 양자화. DGX Spark 는 전용 가이드(`dgx-spark-llm`, 10-23 D119)가 맨 앞 —
 *   초안인 동안은 published 필터에 걸려 목록이 그대로이고, 게시(사용자 승인)하면 그때 붙는다
 * - CPU 프로필: CPU 전용 · 양자화 · 속도 읽는 법
 */
// source: docs/04 §2 (policy)
export const GPU_HUB_GUIDE_MAX = 3;

function candidates(gpu: Gpu): GuideSlug[] {
  if (gpu.kind === 'cpu') return ['cpu-only-llm', 'gguf-quantization', 'tokens-per-second'];
  if (gpu.kind === 'unified') {
    const big = (gpu.ramOptionsGB ?? []).some((ram) => ram >= 128);
    return gpu.vendor === 'apple'
      ? ['mac-local-llm', ...(big ? (['unified-memory-128gb'] as const) : []), 'gguf-quantization']
      : gpu.id === 'nvidia-dgx-spark'
        ? ['dgx-spark-llm', 'unified-memory-128gb', 'gguf-quantization']
        : ['unified-memory-128gb', 'gguf-quantization'];
  }
  if (gpu.form === 'laptop') return ['laptop-gpu-llm', 'vram-requirements', 'moe-cpu-offload'];
  if (gpu.vendor !== 'nvidia') return ['amd-intel-gpus', 'vram-requirements', 'gpu-by-budget'];
  return ['vram-requirements', 'gpu-by-budget', 'multi-gpu'];
}

export function gpuHubGuides(gpu: Gpu): GuideSlug[] {
  return candidates(gpu).filter(isPublished).slice(0, GPU_HUB_GUIDE_MAX);
}
