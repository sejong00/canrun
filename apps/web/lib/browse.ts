/**
 * 목록 페이지 (10-19 `/models`·`/gpus`) — 서버 전용 순수 규칙. 페이지는 카탈로그를 넘기고, 유닛 테스트(`test/browse.test.ts`)는
 * 같은 함수로 순서·묶음을 고정한다. 정렬·거르기 아일랜드가 읽는 data 속성 값도 여기서 만든다(`lib/list-order.ts` 가 그 규칙).
 */
import { rankableStreet, type Gpu, type Model } from '@canrun/data';
import { sizeBucket } from './calc/state';

// ---------------------------------------------------------------------------
// 모델 목록
// ---------------------------------------------------------------------------

/**
 * 기본 순서(인기순): CanRun 인기도(1~5) → 원본 저장소 30일 다운로드(없으면 뒤) → 이름. 홈 "인기 모델"·계산기 인기순과 같은 인기도를 쓴다
 */
export function modelListOrder<M extends Pick<Model, 'popularity' | 'hfDownloads30d' | 'name'>>(models: readonly M[]): M[] {
  return [...models].sort(
    (a, b) =>
      b.popularity - a.popularity || (b.hfDownloads30d ?? -1) - (a.hfDownloads30d ?? -1) || a.name.localeCompare(b.name, 'en'),
  );
}

/** 화면의 GB 표기(소수 1자리)와 같은 반올림 — 거르기 경계가 보이는 숫자와 어긋나지 않게 */
export const roundGB = (gb: number): number => Math.round(gb * 10) / 10;

/**
 * 표 행의 정렬·거르기 data 속성 (`data-<이름>`) — 값이 없는 속성은 넣지 않는다.
 * `needGB` = 기준 양자화·8k 필요 메모리(`lib/model-need.ts` — 허브와 같은 값), 화면 표기와 같게 소수 1자리로 반올림해 넣는다
 */
export function modelRowData(
  model: Pick<Model, 'releasedAt' | 'hfDownloads30d' | 'paramsB' | 'thinking' | 'korean' | 'moe'>,
  needGB: number,
) {
  return {
    'data-released': model.releasedAt.replaceAll('-', ''),
    ...(model.hfDownloads30d !== undefined ? { 'data-downloads': String(model.hfDownloads30d) } : {}),
    'data-params': String(model.paramsB),
    'data-size': sizeBucket(model.paramsB),
    'data-need': String(roundGB(needGB)),
    ...(model.thinking ? { 'data-thinking': '1' } : {}),
    ...(model.korean ? { 'data-korean': '1' } : {}),
    ...(model.moe ? { 'data-moe': '1' } : {}),
  };
}

/**
 * 메모리 거르기 단계(GB) — 모델 목록은 "필요 메모리 N GB 이하", GPU 목록은 "메모리 N GB 이상".
 * 카탈로그 그래픽카드에 흔한 VRAM 크기를 고른 화면 정책 값(PROGRESS §4 D101)
 */
export const MEMORY_STEPS_GB: readonly number[] = [8, 12, 16, 24, 32];

/**
 * 최대 컨텍스트 짧은 표기 — 2^20 의 배수는 "1M", 나머지는 1024 단위 "128k" (허브 행렬 열의 `formatCtx` 와 같은 k 단위).
 * 허브 사실 칸은 전체 토큰 수를 쓴다 — 목록은 열이 좁아 짧게
 */
export function contextShort(ctx: number): string {
  const mebi = 1024 * 1024;
  if (ctx >= mebi && ctx % mebi === 0) return `${ctx / mebi}M`;
  return ctx >= 1024 ? `${Math.round(ctx / 1024)}k` : String(ctx);
}

/** 다운로드 수 기준일 범위 — 모델마다 마지막으로 읽은 날이 다를 수 있다(새 모델은 추가한 날) */
export function downloadsAsOf(models: ReadonlyArray<Pick<Model, 'hfDownloadsAsOf'>>): { from: string; to: string } | undefined {
  const dates = models.map((m) => m.hfDownloadsAsOf).filter((d): d is string => d !== undefined).sort();
  return dates.length > 0 ? { from: dates[0]!, to: dates.at(-1)! } : undefined;
}

// ---------------------------------------------------------------------------
// GPU 목록
// ---------------------------------------------------------------------------

/**
 * 묶음 — 데스크톱 NVIDIA · 데스크톱 AMD · Intel · 노트북 GPU · Apple · 그 밖의 통합 메모리 PC · CPU 전용.
 * 계산기 GPU 목록 묶음(`lib/calc/gpu-match.ts` GPU_GROUPS)에 노트북을 따로 뺀 것 — 노트북 GPU 는 같은 이름의 데스크톱 카드와 다른 칩이다
 */
export type GpuListGroup = 'nvidia' | 'amd' | 'intel' | 'laptop' | 'apple' | 'apu' | 'cpu';
export const GPU_LIST_GROUPS: readonly GpuListGroup[] = ['nvidia', 'amd', 'intel', 'laptop', 'apple', 'apu', 'cpu'];

export function gpuListGroup(gpu: Pick<Gpu, 'kind' | 'vendor' | 'form'>): GpuListGroup {
  if (gpu.kind === 'cpu') return 'cpu';
  if (gpu.vendor === 'apple') return 'apple';
  if (gpu.kind === 'unified') return 'apu';
  if (gpu.form === 'laptop') return 'laptop';
  if (gpu.vendor === 'amd') return 'amd';
  if (gpu.vendor === 'intel') return 'intel';
  return 'nvidia';
}

/** 묶음별 GPU — 묶음 안 순서는 `data/gpus.json` 순서(세대·등급 순으로 적혀 있다). 빈 묶음은 뺀다 */
export function gpuListGroups<G extends Pick<Gpu, 'kind' | 'vendor' | 'form'>>(gpus: readonly G[]): Array<{ group: GpuListGroup; gpus: G[] }> {
  return GPU_LIST_GROUPS.map((group) => ({ group, gpus: gpus.filter((gpu) => gpuListGroup(gpu) === group) })).filter(
    (g) => g.gpus.length > 0,
  );
}

/** 메모리 정렬 값 — 그래픽카드는 VRAM, 통합 메모리·CPU 는 가장 큰 구성 */
export function gpuMemoryGB(gpu: Pick<Gpu, 'kind' | 'vramGB' | 'ramOptionsGB'>): number {
  return gpu.kind === 'dgpu' ? (gpu.vramGB ?? 0) : (gpu.ramOptionsGB?.at(-1) ?? 0);
}

/** GPU 허브 "판정 요약"의 요약 구성 판정 수 중 목록이 쓰는 것 */
export type GoodCounts = { S: number; A: number; B: number };

/**
 * 표 행의 정렬 data 속성 — 가격은 순위에 쓰는 실거래가만(dGPU + priceAsOf, 모델 허브 가격 정렬과 같은 조건).
 * 판정 수: great = 쾌적, good = 쾌적+원활, runs = 겨우 가능까지(CPU 전용은 판정이 겨우 가능까지라 이 값만 차이가 난다)
 */
export function gpuRowData(
  gpu: Pick<Gpu, 'kind' | 'vramGB' | 'ramOptionsGB' | 'memBandwidthGBs' | 'streetUSD' | 'priceAsOf'>,
  counts: GoodCounts,
) {
  const price = rankableStreet(gpu)?.usd;
  return {
    'data-memory': String(gpuMemoryGB(gpu)),
    'data-bandwidth': String(gpu.memBandwidthGBs),
    ...(price !== undefined ? { 'data-price': String(price) } : {}),
    'data-great': String(counts.S),
    'data-good': String(counts.S + counts.A),
    'data-runs': String(counts.S + counts.A + counts.B),
  };
}

/** 데스크톱 그래픽카드(노트북 GPU 제외 — 노트북째로 팔아 가격이 없다) */
const isDesktopCard = (gpu: Pick<Gpu, 'kind' | 'form'>) => gpu.kind === 'dgpu' && gpu.form !== 'laptop';

/** 출시가만 있는 데스크톱 그래픽카드 수 — 가격 정렬에서 묶음 맨 뒤로 가는 카드(안내 문장에 개수를 밝힌다) */
export function msrpOnlyCount(gpus: ReadonlyArray<Pick<Gpu, 'kind' | 'form' | 'streetUSD' | 'priceAsOf'>>): number {
  return gpus.filter((gpu) => isDesktopCard(gpu) && rankableStreet(gpu) === undefined).length;
}

/**
 * 메모리 용량별 가장 싼 데스크톱 그래픽카드 — VRAM 크기마다 실거래가(`rankableStreet`, 규칙 2)가 가장 낮은 카드 하나.
 * 실거래가가 있는 카드가 없는 크기는 뺀다. 같은 값이면 데이터 순서. 크기 오름차순
 */
export function cheapestByMemory<G extends Pick<Gpu, 'id' | 'kind' | 'form' | 'vramGB' | 'streetUSD' | 'priceAsOf'>>(
  gpus: readonly G[],
): Array<{ vramGB: number; gpu: G; usd: number; asOf: string }> {
  const best = new Map<number, { vramGB: number; gpu: G; usd: number; asOf: string }>();
  for (const gpu of gpus) {
    const price = rankableStreet(gpu);
    if (!isDesktopCard(gpu) || price === undefined || gpu.vramGB === undefined) continue;
    const current = best.get(gpu.vramGB);
    if (!current || price.usd < current.usd) best.set(gpu.vramGB, { vramGB: gpu.vramGB, gpu, usd: price.usd, asOf: price.asOf });
  }
  return [...best.values()].sort((a, b) => a.vramGB - b.vramGB);
}
