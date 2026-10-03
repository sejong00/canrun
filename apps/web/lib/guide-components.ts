/**
 * 가이드 MDX 컴포넌트 명세 (P1-4 D42·D43) — 순수 데이터. 컴포넌트 맵(`components/guide/guide-components.tsx`)과
 * MDX 스캔 유닛 테스트(`test/guides.test.ts`)가 같은 표를 본다: 허용 컴포넌트·prop 종류·블록 여부.
 *
 * MDX 에서 prop 은 **문자열 리터럴만**(`{…}` 식 금지 — 빌드 시 임의 JS·D21 위반 방지). 목록은 쉼표 구분 문자열.
 * id 형 prop 은 테스트가 카탈로그로 검증한다.
 */
export type PropKind =
  | 'gpu'
  | 'model'
  | 'gpuList'
  | 'modelList'
  | 'grid'
  | 'slug'
  | 'quant'
  | 'ctx'
  | 'ctxList'
  | 'kv'
  | 'verdict'
  | 'bool'
  | 'numKind'
  | 'fact'
  | 'memoryKind';

export type ComponentSpec = {
  /** 표·블록 요소 — MDX 에서 자기 줄에만 (문단 안에 넣으면 `<p><div>` 하이드레이션 불일치) */
  block: boolean;
  /** 자체 데이터 인용으로 세는가 (AC — `[data-guide-data]` 마커) */
  data: boolean;
  props: Readonly<Record<string, { kind: PropKind; required: boolean }>>;
};

const req = (kind: PropKind) => ({ kind, required: true });
const opt = (kind: PropKind) => ({ kind, required: false });

/**
 * Num 종류. needGB = 판정이 비교하는 필요량(가중치 + KV + 버퍼) — 기본은 그래픽카드 규칙(가중치 = gpuWeightsGB, 10-03 D62),
 * `gpu` 가 통합 메모리 칩이면 파일 전체. gpuWeightsGB = 파일 중 그래픽카드에 올라가는 가중치(입력 임베딩·MTP 블록 제외).
 */
export const NUM_KINDS = ['fileGB', 'gpuWeightsGB', 'kvGB', 'needGB', 'vramGB', 'bandwidth', 'usableGB', 'params', 'layers', 'maxContext'] as const;
export type NumKind = (typeof NUM_KINDS)[number];

/** ModelMemoryTable 의 메모리 종류 — dgpu(기본: 그래픽카드에 올라가는 가중치) · unified(맥: 파일 전체) */
export const MEMORY_KINDS = ['dgpu', 'unified'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const RUNTIME_FACT_IDS = ['ollama-default-ctx', 'ollama-kv-cache-type'] as const;
export type RuntimeFactId = (typeof RUNTIME_FACT_IDS)[number];

export const GUIDE_COMPONENTS: Readonly<Record<string, ComponentSpec>> = {
  // 블록 데이터 (자체 데이터 인용)
  ComboGrid: { block: true, data: true, props: { grid: req('grid') } },
  GpuTierSummary: { block: true, data: true, props: { gpus: req('gpuList') } },
  ModelMemoryTable: { block: true, data: true, props: { models: req('modelList'), ctx: opt('ctx'), memory: opt('memoryKind') } },
  KvPerTokenTable: { block: true, data: true, props: { models: opt('modelList'), ctxs: opt('ctxList') } },
  QuantSizeTable: { block: true, data: true, props: { model: req('model') } },
  QuantLadder: { block: true, data: true, props: { model: req('model'), gpu: req('gpu') } },
  CtxTable: { block: true, data: true, props: { model: req('model'), gpu: req('gpu') } },
  UnifiedTierTable: { block: true, data: true, props: { gpus: req('gpuList') } },
  ModelFacts: { block: true, data: true, props: { models: req('modelList') } },
  MemoryBreakdown: { block: true, data: true, props: { model: req('model'), gpu: req('gpu') } },
  Measured: { block: true, data: true, props: { model: req('model'), gpu: req('gpu') } },
  Threshold: { block: true, data: false, props: {} },
  // 인라인
  Num: {
    block: false,
    data: true,
    props: {
      kind: req('numKind'),
      model: opt('model'),
      gpu: opt('gpu'),
      quant: opt('quant'),
      ctx: opt('ctx'),
      kv: opt('kv'),
    },
  },
  Price: { block: false, data: true, props: { gpu: req('gpu') } },
  RuntimeFact: { block: false, data: false, props: { id: req('fact') } },
  HubLink: { block: false, data: false, props: { gpu: opt('gpu'), model: opt('model') } },
  GuideLink: { block: false, data: false, props: { slug: req('slug') } },
  ComboLink: { block: false, data: false, props: { model: req('model'), gpu: req('gpu') } },
  Expect: {
    block: false,
    data: false,
    props: { model: req('model'), gpu: req('gpu'), verdict: opt('verdict'), fits: opt('bool') },
  },
};

export const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
