/**
 * 브라우저 GPU 감지 (P1-3 D30) — 버튼 클릭 시에만 `import()` 로 불러 실행한다. 예외를 밖으로 내지 않는다.
 * WebGL `UNMASKED_RENDERER_WEBGL`(이름 문자열) + WebGPU `adapter.info`(vendor·architecture) 를 병행 수집하고,
 * 해석은 순수 함수 `interpretDetection`(gpu-match.ts) 이 맡는다. 어떤 값도 어디로도 보내지 않는다.
 */
import type { DetectInput } from './gpu-match';

const TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function readWebGl(): Pick<DetectInput, 'renderer' | 'glVendor'> {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return {};
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const glVendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return {
      ...(typeof renderer === 'string' ? { renderer } : {}),
      ...(typeof glVendor === 'string' ? { glVendor } : {}),
    };
  } catch {
    return {};
  }
}

async function readWebGpu(): Promise<Pick<DetectInput, 'vendor' | 'architecture' | 'description'>> {
  try {
    const gpu = navigator.gpu;
    if (!gpu) return {};
    const adapter = await gpu.requestAdapter();
    if (!adapter) return {};
    const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : undefined);
    if (!info) return {};
    return {
      ...(info.vendor ? { vendor: info.vendor } : {}),
      ...(info.architecture ? { architecture: info.architecture } : {}),
      ...(info.description ? { description: info.description } : {}),
    };
  } catch {
    return {};
  }
}

/** 감지 API 가 하나라도 있는가 (버튼 활성 조건) */
export function detectionAvailable(): boolean {
  return typeof navigator !== 'undefined' && (Boolean(navigator.gpu) || typeof WebGLRenderingContext !== 'undefined');
}

export async function detectGpu(): Promise<DetectInput> {
  const webgl = readWebGl();
  const webgpu = await withTimeout(readWebGpu(), {});
  return {
    ...webgl,
    ...webgpu,
    mac: /mac/i.test(navigator.platform ?? '') || /macintosh/i.test(navigator.userAgent),
    touch: (navigator.maxTouchPoints ?? 0) > 1,
  };
}
