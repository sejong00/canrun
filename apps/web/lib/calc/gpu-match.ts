/**
 * GPU 텍스트 매칭 (P1-3 결정 D29·D30) — 콤보박스 검색·홈 datalist 값 해석·자동 감지 문자열 해석이 같은 규칙을 쓴다.
 * 순수 함수(브라우저·node 공용). 카탈로그 이름·별칭·로케일 표시명(GpuName 오버라이드)을 토큰 집합으로 비교한다.
 *
 * 점수: 정규화 문자열 == 이름 100 > == 별칭/표시명 90 > 토큰 집합 동일 80 > 질의 토큰 ⊂ GPU 토큰 60.
 * 동점이면 토큰 수가 많은 쪽(최장 일치). 메모리 용량 분기 형제(4060 Ti 8/16GB, 3080 10/12GB, M4 Max 32c/40c)는
 * 질의에 용량을 가르는 숫자가 없으면 고르지 않고 `ambiguous` 로 돌려준다 — 감지가 VRAM 을 추측하지 않는다.
 */
import type { GpuCore } from '@canrun/data/client';

export type GpuMatch =
  | { kind: 'exact'; id: string }
  | { kind: 'ambiguous'; candidates: string[]; text: string }
  | { kind: 'none' };

/** 렌더러 문자열·이름에서 뜻이 없는 토큰 (vendor 단어 포함) */
const NOISE = new Set([
  'nvidia', 'geforce', 'amd', 'radeon', 'intel', 'apple', 'ati',
  'graphics', 'gpu', 'tm', 'r', 'direct3d11', 'direct3d', 'd3d11', 'd3d12', 'opengl', 'es',
  'metal', 'renderer', 'unspecified', 'version', 'pcie', 'sse2', 'profile', 'compatibility', 'angle', 'vulkan', 'inc',
  'google', 'the', 'with', 'series', 'edition', 'oc', 'dual', 'channel',
]);

/** 부분 일치에서 질의에 없어도 되는 시리즈 접두 — "4060" 이 "RTX 4060" 을 가리킨다. Ti·Super·XT·Laptop·Max 등은 다른 SKU 라 안 된다 */
const SERIES_PREFIX = new Set(['rtx', 'gtx', 'rx', 'arc']);

/** 소프트웨어 렌더러 — 실제 GPU 가 아니다 (헤드리스 CI 의 SwiftShader 포함) */
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|basic render|software adapter|virtualbox|vmware svga/i;

/** 렌더러 문자열의 벤더 (vendor 일치 검증용) */
export type VendorHint = 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';

export function vendorOf(text: string | undefined): VendorHint | undefined {
  if (!text) return undefined;
  const s = text.toLowerCase();
  if (/\bnvidia\b|\bgeforce\b|\brtx\b|\bgtx\b/.test(s)) return 'nvidia';
  if (/\bamd\b|\bradeon\b|\bati\b|\bryzen\b/.test(s)) return 'amd';
  if (/\bintel\b|\barc\b/.test(s)) return 'intel';
  if (/\bapple\b/.test(s)) return 'apple';
  if (/\badreno\b|\bmali\b|\bqualcomm\b|\bpowervr\b|\barm\b|\bimagination\b/.test(s)) return 'other';
  return undefined;
}

function catalogVendor(gpu: Pick<GpuCore, 'vendor'>): VendorHint {
  switch (gpu.vendor) {
    case 'nvidia':
    case 'nvidia-dgx':
      return 'nvidia';
    case 'amd':
    case 'amd-apu':
      return 'amd';
    case 'intel':
      return 'intel';
    case 'apple':
      return 'apple';
    default:
      return 'other';
  }
}

/** 소문자·hex id·셰이더 버전·구분자 정리 (괄호 안 내용은 남긴다 — 이름 "(32-core GPU)" 등) */
export function normalizeGpuText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(0x[0-9a-f]+\)/g, ' ')
    .replace(/\b[vp]s_\d+_\d+\b/g, ' ')
    .replace(/\((?:tm|r)\)/g, ' ')
    .replace(/[()[\],:/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 토큰 집합 — 접두 시리즈(rtx4060 → rtx 4060)·접미(4060ti → 4060 ti, 16gb → 16 gb, 8060s → 8060 s) 분리, 잡음 제거 */
export function gpuTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeGpuText(text).split(/[\s\-_+]+/)) {
    if (!raw) continue;
    let tokens = [raw];
    let m = /^(rtx|gtx|rx|arc|ddr\d)(\d+)$/.exec(raw);
    if (m) tokens = [m[1]!, m[2]!];
    m = /^(\d+)(ti|gb|super|xt|xtx|s|c|k|core)$/.exec(raw);
    if (m) tokens = [m[1]!, m[2]!];
    for (const tok of tokens) {
      if (NOISE.has(tok)) continue;
      out.push(tok === 'mobile' || tok === 'maxq' ? 'laptop' : tok);
    }
  }
  return [...new Set(out)];
}

export type GpuNames = Readonly<Record<string, string>>;

type Candidate = { gpu: GpuCore; score: number; tokens: number };

function tokenSetEq(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t));
}

/** GPU 1개의 점수 (0 = 무관) */
function scoreGpu(query: string, qTokens: string[], gpu: GpuCore, names: GpuNames): Candidate | undefined {
  const override = names[gpu.id];
  const q = normalizeGpuText(query);
  let best = 0;
  let bestTokens = 0;
  const consider = (label: string, exactScore: number) => {
    const tokens = gpuTokens(label);
    let s = 0;
    if (normalizeGpuText(label) === q) s = exactScore;
    else if (tokens.length > 0 && tokenSetEq(tokens, qTokens)) s = 80;
    else if (qTokens.length > 0 && qTokens.every((t) => tokens.includes(t))) {
      // 질의 ⊂ 라벨: 라벨의 나머지가 시리즈 접두·메모리 용량·DDR 구성뿐이면 60(확정 가능), Ti/Super/XT/Laptop/Max 같은 SKU 토큰이
      // 남으면 50(목록엔 뜨지만 확정 금지 — "RTX 4070 Ti" 를 4070 Ti Super 로, "GTX 1080" 을 1080 Ti 로 오매칭하던 문제).
      // 메모리 표기는 **원래 라벨**에서 먼저 뺀다 — 질의 토큰을 먼저 빼면 "3050 8 gb" 에서 8 이 빠진 뒤 "3050 gb" 가 용량으로
      // 읽혀 "8" 이 RTX 3050 8GB 로 확정되던 문제(재검증)
      const extra = configStripped(tokens).filter((t) => !qTokens.includes(t) && !SERIES_PREFIX.has(t));
      s = extra.length === 0 ? 60 : 50;
    }
    if (s > best || (s === best && tokens.length > bestTokens)) {
      best = s;
      bestTokens = tokens.length;
    }
  };
  consider(gpu.name, 100);
  if (override) consider(override, 90);
  for (const alias of gpu.aliases) consider(alias, 90);
  if (best === 0) return undefined;
  // laptop 플래그와 form 이 어긋나면 탈락 (질의에 laptop 이 있으면 노트북 SKU 만)
  if (qTokens.includes('laptop') && gpu.form !== 'laptop') return undefined;
  return { gpu, score: best, tokens: bestTokens };
}

/** 검색 후보 순위 (콤보박스 팝업) — 점수 내림차순·이름 오름차순. 빈 질의는 전체(인기 먼저) */
export function rankGpus(query: string, gpus: readonly GpuCore[], names: GpuNames = {}): GpuCore[] {
  const qTokens = gpuTokens(query);
  if (qTokens.length === 0) {
    // 뜻 있는 토큰이 없다(빈 질의·"nvidia"·"AMD Radeon" 같은 제조사 단어만) — 둘러보기. 제조사 단어면 그 제조사만
    const vendor = vendorOf(query);
    const pool = vendor ? gpus.filter((g) => catalogVendor(g) === vendor) : gpus;
    return [...pool].sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name));
  }
  const scored = gpus
    .map((gpu) => scoreGpu(query, qTokens, gpu, names))
    .filter((c): c is Candidate => c !== undefined)
    .sort((a, b) => b.score - a.score || b.tokens - a.tokens || a.gpu.name.localeCompare(b.gpu.name));
  if (scored.length > 0) return scored.map((c) => c.gpu);
  // 부분 일치가 아예 없으면 토큰 하나라도 겹치는 GPU (오타·부분 입력)
  return gpus.filter((g) => {
    const tokens = gpuTokens([g.name, names[g.id] ?? '', ...g.aliases].join(' '));
    return qTokens.some((t) => tokens.includes(t));
  });
}

const MEMORY_UNITS = new Set(['gb', 'c', 'core']);

/** 메모리 용량 토큰(`8 gb`·`32 core`)을 뺀 토큰 집합 — 형제 판별 */
function memoryStripped(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (/^\d+$/.test(t) && MEMORY_UNITS.has(tokens[i + 1] ?? '')) {
      i += 1;
      continue;
    }
    if (MEMORY_UNITS.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** 메모리 용량에 더해 CPU 프로필의 RAM 구성(`ddr5 5600`)도 뺀 토큰 — "CPU" 한 단어가 프로필 3종의 모호 후보가 되게 */
function configStripped(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (/^ddr\d$/.test(t)) {
      if (/^\d+$/.test(tokens[i + 1] ?? '')) i += 1;
      continue;
    }
    out.push(t);
  }
  return memoryStripped(out);
}

/** 질의가 형제를 가를 숫자를 담고 있는가 (`16gb`, `m4 max 40`) */
function disambiguates(qTokens: readonly string[], stem: readonly string[]): boolean {
  return qTokens.some((t) => /^\d+$/.test(t) && !stem.includes(t));
}

/**
 * 질의 → 카탈로그 GPU 해석. `vendor` 가 주어지면 벤더가 다른 후보는 버린다.
 */
export function matchGpu(
  query: string,
  gpus: readonly GpuCore[],
  opts: { names?: GpuNames; vendor?: VendorHint } = {},
): GpuMatch {
  const names = opts.names ?? {};
  const q = normalizeGpuText(query);
  if (!q) return { kind: 'none' };
  const byId = gpus.find((g) => g.id === q);
  if (byId) return { kind: 'exact', id: byId.id };

  const qTokens = gpuTokens(query);
  if (qTokens.length === 0) return { kind: 'none' };
  const pool = opts.vendor ? gpus.filter((g) => catalogVendor(g) === opts.vendor) : gpus;
  const scored = pool
    .map((gpu) => scoreGpu(query, qTokens, gpu, names))
    .filter((c): c is Candidate => c !== undefined)
    .sort((a, b) => b.score - a.score || b.tokens - a.tokens || a.gpu.id.localeCompare(b.gpu.id));
  const top = scored[0];
  if (!top || top.score < 60) return { kind: 'none' };

  const stem = memoryStripped(gpuTokens(top.gpu.name));
  // 최고점 동률 (예: "M4 Max" 이름 부분 일치가 32c/40c 둘 다) → 모호
  const ties = scored.filter((c) => c.score === top.score && c.tokens === top.tokens);
  // 최고점이 유일해도 메모리 용량만 다른 형제가 있고 질의에 가르는 숫자가 없으면 모호
  const siblings = pool.filter(
    (g) => g.kind === top.gpu.kind && g.form === top.gpu.form && tokenSetEq(memoryStripped(gpuTokens(g.name)), stem),
  );
  const candidates =
    ties.length > 1 ? ties.map((c) => c.gpu) : siblings.length > 1 && !disambiguates(qTokens, stem) ? siblings : [];
  if (candidates.length > 1) {
    return { kind: 'ambiguous', candidates: candidates.map((g) => g.id).sort(), text: stem.join(' ') };
  }
  return { kind: 'exact', id: top.gpu.id };
}

/** 메모리 변형을 뺀 표시명 — "GeForce RTX 4060 Ti 16GB" → "GeForce RTX 4060 Ti", "Apple M4 Max (32-core GPU)" → "Apple M4 Max" (감지 후보 안내) */
export function variantStem(name: string): string {
  return name
    .replace(/\s*\(\d+-core GPU\)/i, '')
    .replace(/\s+\d+\s?GB\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 콤보박스 둘러보기(빈 질의) 그룹 (D29) — NVIDIA · AMD · Intel · Apple · 통합 메모리 PC · CPU만 */
export type GpuGroup = 'nvidia' | 'amd' | 'intel' | 'apple' | 'apu' | 'cpu';
export const GPU_GROUPS: readonly GpuGroup[] = ['nvidia', 'amd', 'intel', 'apple', 'apu', 'cpu'];

export function gpuGroup(gpu: Pick<GpuCore, 'kind' | 'vendor'>): GpuGroup {
  if (gpu.kind === 'cpu') return 'cpu';
  if (gpu.vendor === 'apple') return 'apple';
  if (gpu.kind === 'unified') return 'apu';
  if (gpu.vendor === 'amd') return 'amd';
  if (gpu.vendor === 'intel') return 'intel';
  return 'nvidia';
}

/** 데스크톱 dGPU 의 노트북 형제 (같은 번호의 Laptop SKU) — 감지가 "Laptop GPU" 를 잃었을 때의 안내용 */
export function laptopSibling(gpu: GpuCore, gpus: readonly GpuCore[]): GpuCore | undefined {
  if (gpu.kind !== 'dgpu' || gpu.form !== 'desktop') return undefined;
  const stem = gpuTokens(gpu.name);
  return gpus.find((g) => g.form === 'laptop' && tokenSetEq(gpuTokens(g.name).filter((t) => t !== 'laptop'), stem));
}

// ---------------------------------------------------------------------------
// 자동 감지 해석 (D30) — 브라우저 API 호출은 detect-gpu.ts, 해석은 여기(순수·테스트 가능)
// ---------------------------------------------------------------------------

export type DetectInput = {
  /** WebGL UNMASKED_RENDERER_WEBGL (또는 RENDERER) */
  renderer?: string;
  /** WebGL UNMASKED_VENDOR_WEBGL */
  glVendor?: string;
  /** WebGPU adapter.info */
  vendor?: string;
  architecture?: string;
  description?: string;
  /** Mac 플랫폼 (Safari 는 "Apple GPU" 만 준다) */
  mac?: boolean;
  /** 터치 기기 (iPhone·iPad 는 카탈로그 밖) */
  touch?: boolean;
};

export type DetectResult =
  | { kind: 'exact'; id: string }
  | { kind: 'ambiguous'; candidates: string[]; text: string }
  | { kind: 'apple-unknown' }
  | { kind: 'none'; vendor?: VendorHint };

/** 렌더러 문자열에서 시도할 조각들 — ANGLE 래퍼를 벗기고 콤마로 나눠 시리즈 토큰이 있는 조각부터 */
export function rendererCandidates(renderer: string): string[] {
  let text = renderer.trim();
  const angle = /^angle\s*\((.*)\)\s*$/i.exec(text);
  if (angle) text = angle[1]!;
  // hex id·중첩 괄호(드라이버 상세 "(radeonsi, navi32, LLVM …)")는 버린다
  text = text.replace(/\(0x[0-9a-f]+\)/gi, ' ').replace(/\([^()]*\)/g, ' ');
  const parts = text
    .split(',')
    .map((p) => p.replace(/\/.*$/, '').trim())
    .filter((p) => p.length > 0);
  const series = /\b(rtx|gtx|rx|arc|m\d|gb10|8060s|radeon|ryzen|dgx)\b/i;
  return [...parts.filter((p) => series.test(p)), ...parts.filter((p) => !series.test(p))];
}

export function interpretDetection(input: DetectInput, gpus: readonly GpuCore[], names: GpuNames = {}): DetectResult {
  const renderer = input.renderer?.trim() ?? '';
  if (renderer && SOFTWARE_RE.test(renderer)) return { kind: 'none' };
  const glVendor = vendorOf(renderer) ?? vendorOf(input.glVendor);
  const gpuVendor = vendorOf(input.vendor);
  // WebGL 과 WebGPU 가 다른 GPU 를 가리키면(Optimus) 추측하지 않는다
  if (glVendor && gpuVendor && glVendor !== gpuVendor) return { kind: 'none', vendor: gpuVendor };
  const vendor = gpuVendor ?? glVendor;

  const texts = [...(input.description ? [input.description] : []), ...(renderer ? rendererCandidates(renderer) : [])];
  for (const text of texts) {
    const m = matchGpu(text, gpus, { names, ...(vendor ? { vendor } : {}) });
    if (m.kind === 'exact') {
      // 이름에 메모리 용량이 박힌 SKU(RTX 3060 12GB·RX 9060 XT 16GB)인데 렌더러 문자열엔 용량이 없다 — 실기기가 카탈로그에
      // 없는 다른 용량 변형(3060 8GB·9060 XT 8GB)일 수 있으니 확정하지 않고 그 항목을 후보로 제시한다 (리뷰 지적)
      const gpu = gpus.find((g) => g.id === m.id)!;
      const nameMem = /\b(\d+)\s?gb\b/i.exec(gpu.name);
      if (nameMem && !new RegExp(`\\b${nameMem[1]}\\s?gb\\b`, 'i').test(text)) {
        return { kind: 'ambiguous', candidates: [gpu.id], text: memoryStripped(gpuTokens(gpu.name)).join(' ') };
      }
      return m;
    }
    if (m.kind !== 'none') return m;
  }
  if (vendor === 'apple' && !input.touch && (input.mac || /apple/i.test(renderer))) return { kind: 'apple-unknown' };
  return vendor ? { kind: 'none', vendor } : { kind: 'none' };
}
