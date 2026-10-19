/**
 * 가이드 MDX 컴포넌트 명세 (P1-4 D42·D43) — 순수 데이터. 컴포넌트 맵(`components/guide/guide-components.tsx`)과
 * MDX 스캔 유닛 테스트(`test/guides.test.ts`)가 같은 표를 본다: 허용 컴포넌트·prop 종류·블록 여부.
 *
 * MDX 에서 prop 은 **문자열 리터럴만**(`{…}` 식 금지 — 빌드 시 임의 JS·D21 위반 방지). 목록은 쉼표 구분 문자열.
 * id 형 prop 은 테스트가 카탈로그로 검증한다.
 */
import { RUNTIME_FACTS, type RuntimeFactId } from './runtime-facts';

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
  | 'memoryKind'
  | 'mode'
  | 'ram'
  | 'confidence';

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

/** Expect mode — 엔진 실행 방식(`@canrun/engine` Mode). 산문이 "전문가를 RAM 에"·"GPU 에 전부" 같은 배치를 말할 때 고정한다 (10-14 D74) */
export const EXPECT_MODES = ['full-gpu', 'cpu-moe', 'partial-offload', 'cpu-only'] as const;
export type ExpectMode = (typeof EXPECT_MODES)[number];

/** Expect confidence — 엔진 신뢰 라벨. "공개 벤치마크가 표에 있다", "이론 추정이다"처럼 라벨을 말하는 문장을 고정한다 (10-14 D74 리뷰) */
export const EXPECT_CONFIDENCES = ['measured', 'calibrated', 'theoretical'] as const;

/** 외부 도구 사실 id — 레코드(`lib/runtime-facts.ts`)의 키에서 나온다 (10-19 — 사실을 더할 때 이 목록은 손대지 않는다) */
export const RUNTIME_FACT_IDS = Object.keys(RUNTIME_FACTS) as readonly RuntimeFactId[];
export type { RuntimeFactId };

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
  // quant = 기준 대신 그 양자화 행, ram = 메모리 용량(dGPU 는 시스템 RAM 계단, 통합·CPU 는 메모리 옵션), mode = 실행 방식,
  // ctx·kv = 콤보 ctx 표(표시 양자화)의 그 칸 (10-14 D74)
  Expect: {
    block: false,
    data: false,
    props: {
      model: req('model'),
      gpu: req('gpu'),
      verdict: opt('verdict'),
      fits: opt('bool'),
      quant: opt('quant'),
      mode: opt('mode'),
      ram: opt('ram'),
      ctx: opt('ctx'),
      kv: opt('kv'),
      confidence: opt('confidence'),
    },
  },
};

export const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
