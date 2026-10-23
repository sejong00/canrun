/**
 * GPU 허브 "관련 가이드" (10-16 D95) — 카탈로그 전 GPU 가 published 가이드 2~3편을 링크한다(초안 금지 — D40),
 * 하드웨어 종류에 맞는 가이드가 맨 앞이다. 렌더 결과의 초안 링크 0 은 export 테스트가 본다.
 */
import { describe, expect, it } from 'vitest';
import { GUIDE_SLUGS } from '../content/guides';
import { catalog } from '../lib/catalog';
import { GPU_HUB_GUIDE_MAX, gpuHubGuides } from '../lib/gpu-hub-guides';
import { isPublished } from '../lib/guides';

describe('GPU hub related guides (D95)', () => {
  it('every GPU links 2–3 distinct published guides', () => {
    for (const gpu of catalog.gpus) {
      const slugs = gpuHubGuides(gpu);
      expect(slugs.length, gpu.id).toBeGreaterThanOrEqual(2);
      expect(slugs.length, gpu.id).toBeLessThanOrEqual(GPU_HUB_GUIDE_MAX);
      expect(new Set(slugs).size, gpu.id).toBe(slugs.length);
      for (const slug of slugs) {
        expect((GUIDE_SLUGS as readonly string[]).includes(slug), `${gpu.id} → ${slug}`).toBe(true);
        expect(isPublished(slug), `${gpu.id} → draft ${slug}`).toBe(true);
      }
    }
  });

  it('leads with the guide for the kind of hardware', () => {
    const first = (id: string) => gpuHubGuides(catalog.gpus.find((g) => g.id === id)!)[0];
    expect(first('rtx-4060')).toBe('vram-requirements');
    expect(first('rx-9070-xt')).toBe('amd-intel-gpus');
    expect(first('rtx-4060-laptop')).toBe('laptop-gpu-llm');
    expect(first('apple-m4')).toBe('mac-local-llm');
    expect(first('amd-strix-halo')).toBe('unified-memory-128gb');
    // DGX Spark 전용 가이드(10-23 D119)는 게시된 뒤에만 맨 앞 — 초안인 동안은 128GB 통합 메모리 비교가 그대로 맨 앞
    expect(first('nvidia-dgx-spark')).toBe(isPublished('dgx-spark-llm') ? 'dgx-spark-llm' : 'unified-memory-128gb');
    expect(first('cpu-ddr5-5600-2ch')).toBe('cpu-only-llm');
    // 128GB 이상 구성이 있는 맥만 128GB 통합 메모리 비교를 붙인다
    expect(gpuHubGuides(catalog.gpus.find((g) => g.id === 'apple-m4-max-40c')!)).toContain('unified-memory-128gb');
    expect(gpuHubGuides(catalog.gpus.find((g) => g.id === 'apple-m4')!)).not.toContain('unified-memory-128gb');
  });
});
