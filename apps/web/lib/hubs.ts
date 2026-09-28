/**
 * 허브 요약 메모 — generateMetadata 와 페이지 본문이 같은 요약을 두 번 계산하지 않도록.
 * 빌드 워커 프로세스 단위 캐시 (정적 export 전용 — 요청 간 상태가 아니다).
 */
import {
  summarizeGpu,
  summarizeModel,
  type GpuHubData,
  type ModelHubData,
} from '@canrun/data';
import { catalog, findGpu, findModel } from './catalog';

const gpuHubs = new Map<string, GpuHubData>();
const modelHubs = new Map<string, ModelHubData>();

export function getGpuHub(id: string): GpuHubData | undefined {
  const cached = gpuHubs.get(id);
  if (cached) return cached;
  const gpu = findGpu(id);
  if (!gpu) return undefined;
  const hub = summarizeGpu(catalog, gpu);
  gpuHubs.set(id, hub);
  return hub;
}

export function getModelHub(id: string): ModelHubData | undefined {
  const cached = modelHubs.get(id);
  if (cached) return cached;
  const model = findModel(id);
  if (!model) return undefined;
  const hub = summarizeModel(catalog, model);
  modelHubs.set(id, hub);
  return hub;
}
