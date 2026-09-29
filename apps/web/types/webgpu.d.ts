/**
 * WebGPU 최소 앰비언트 선언 — GPU 감지(`lib/calc/detect-gpu.ts`)가 읽는 필드만 (P1-3 D30).
 * TypeScript 의 lib.dom.d.ts 에는 WebGPU 가 없고 `@webgpu/types` 는 의존성·락파일 변경이라 두지 않는다.
 */
interface CanRunGpuAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

interface CanRunGpuAdapter {
  readonly info?: CanRunGpuAdapterInfo;
  /** 구형 Chrome (adapter.info 이전) */
  requestAdapterInfo?(): Promise<CanRunGpuAdapterInfo>;
}

interface CanRunGpu {
  requestAdapter(): Promise<CanRunGpuAdapter | null>;
}

interface Navigator {
  readonly gpu?: CanRunGpu;
}
