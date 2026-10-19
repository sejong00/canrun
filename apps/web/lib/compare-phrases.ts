/**
 * GPU 비교 문장 조립 (10-19 D106) — 제목·설명·요약·FAQ(JSON-LD 와 같은 문자열)·목차 카드·공유 카드가 **같은 문자열**을 쓰도록 한 곳에서.
 * 순수 함수(번역 함수를 받는다) — 페이지는 next-intl, 공유 카드 스크립트(scripts/og-cards.ts)·유닛 테스트는 다른 번역 함수로 같은 문장을 만든다.
 * **상대 import 만**(`@/` 금지 — 루트 tsconfig 의 스크립트가 읽는다). 속도 문장은 늘 밴드 + 신뢰 라벨(규칙 3 — `speedPhrase`·`ppPhrase`).
 */
import type { ComboPick, CompareSide, GpuComparison } from '@canrun/data';
import { formatGB, formatInt, formatRatio } from './format';
import type { QA } from './jsonld';
import { gpuName, ppPhrase, shortGpuName, speedPhrase, type Translate } from './phrases';

type NamesT = Translate & { has?: (key: string) => boolean };

export type CompareTranslators = {
  /** Compare 네임스페이스 */
  compare: Translate;
  /** GpuHub — 메모리 표기 */
  hub: Translate;
  common: Translate;
  confidence: Translate;
  /** Combo — ppValue */
  combo: Translate;
  names: NamesT;
};

/**
 * 기기 이름 — 콤보 제목과 같은 짧은 이름(`shortGpuName`): 그래픽카드 "RTX 5060 Ti 16GB", 통합 메모리·CPU 는 짧은 이름 + 비교 구성 메모리
 * ("M4 Pro 64GB" · "Ryzen AI Max+ 395 128GB" · "DGX Spark 128GB" — 수치가 그 구성 하나의 것이다. 제품 이름처럼 붙여 쓴다).
 * 10-19 D107: 사람들은 "ai max 395 vs dgx spark" 처럼 짧게 찾는다 — 전체 이름("… (Strix Halo) 128GB")은 제목을 늘리기만 했다
 */
export function compareName(
  t: Pick<CompareTranslators, 'compare' | 'names'>,
  locale: string,
  side: Pick<CompareSide, 'gpu' | 'memoryGB'>,
): string {
  const name = shortGpuName(gpuName(t.names, side.gpu));
  if (side.memoryGB === undefined) return name;
  return t.compare('nameMemory', { name, ram: formatInt(locale, side.memoryGB) });
}

/**
 * 메모리를 함께 밝힌 이름 — 설명·목차 카드용. 그래픽카드는 이름에 VRAM 이 없을 때만 붙인다("RTX 5070 (12 GB VRAM)" — "RTX 5060 Ti 16GB" 는 그대로),
 * 통합 메모리·CPU 는 이름에 이미 메모리가 있다
 */
export function compareNameWithMemory(
  t: Pick<CompareTranslators, 'compare' | 'names'>,
  locale: string,
  side: Pick<CompareSide, 'gpu' | 'memoryGB'>,
): string {
  const name = compareName(t, locale, side);
  const vram = side.gpu.vramGB;
  if (side.memoryGB !== undefined || vram === undefined || new RegExp(`\\b${vram}GB\\b`).test(name)) return name;
  return t.compare('nameVram', { name, vram: formatInt(locale, vram) });
}

/** 한쪽이라도 그래픽카드가 아니면 제목이 "VRAM" 대신 "메모리"를 쓴다 */
export const isUnifiedPair = (cmp: Pick<GpuComparison, 'a' | 'b'>) => cmp.a.gpu.kind !== 'dgpu' || cmp.b.gpu.kind !== 'dgpu';

/** 이 비율 안이면 "거의 같은 속도" — 표시 정책(엔진 상수 아님, 10-19 D106). 추정 밴드(±12% 이상)보다 훨씬 좁다 */
export const SAME_SPEED = { min: 0.95, max: 1.05 } as const;

export type SpeedVerdict = { kind: 'same' } | { kind: 'faster'; faster: 'a' | 'b'; factor: number };

/** 속도 비율(b ÷ a) → 어느 쪽이 몇 배 빠른가 */
export function speedVerdict(ratio: number): SpeedVerdict {
  if (ratio >= SAME_SPEED.min && ratio <= SAME_SPEED.max) return { kind: 'same' };
  return ratio > 1 ? { kind: 'faster', faster: 'b', factor: ratio } : { kind: 'faster', faster: 'a', factor: 1 / ratio };
}

/** 배율 표기 — 속도는 추정이라 소수 1자리 */
export const speedFactorText = (locale: string, factor: number) => formatRatio(locale, factor, 1);

export type CompareNames = { a: string; b: string };

export function compareNames(t: Pick<CompareTranslators, 'compare' | 'names'>, locale: string, cmp: Pick<GpuComparison, 'a' | 'b'>): CompareNames {
  return { a: compareName(t, locale, cmp.a), b: compareName(t, locale, cmp.b) };
}

/** 빠른 쪽·느린 쪽 이름과 배율 (같은 속도면 undefined) */
function fasterSlower(locale: string, names: CompareNames, ratio: number) {
  const v = speedVerdict(ratio);
  if (v.kind === 'same') return undefined;
  return v.faster === 'b'
    ? { faster: names.b, slower: names.a, ratio: speedFactorText(locale, v.factor) }
    : { faster: names.a, slower: names.b, ratio: speedFactorText(locale, v.factor) };
}

/** 요약·FAQ 의 속도 문장 — 배율(추정 중앙값) 또는 "거의 같다", 공통 모델이 없으면 비교하지 않는다고 */
export function speedSentence(t: Pick<CompareTranslators, 'compare'>, locale: string, cmp: GpuComparison, names: CompareNames): string {
  if (!cmp.speed) return t.compare('speedNone');
  const fs = fasterSlower(locale, names, cmp.speed.ratio);
  const models = cmp.speed.models;
  return fs ? t.compare('speedFaster', { ...fs, models }) : t.compare('speedSame', { a: names.a, b: names.b, models });
}

/** 밴드가 겹쳐 실제 차이가 작을 수 있다는 문장 — 배율을 말할 때만 */
export function overlapSentence(t: Pick<CompareTranslators, 'compare'>, cmp: GpuComparison): string | undefined {
  const speed = cmp.speed;
  if (!speed || !speed.overlap || speedVerdict(speed.ratio).kind === 'same') return undefined;
  return t.compare('overlap', { model: speed.reference.model.name });
}

export function compareTitle(t: Pick<CompareTranslators, 'compare'>, cmp: GpuComparison, names: CompareNames): string {
  return t.compare(isUnifiedPair(cmp) ? 'metaTitleUnified' : 'metaTitle', names);
}

const good = (side: CompareSide) => side.counts.S + side.counts.A;

/** 메타 설명 — 답(속도 배율)이 먼저, 그다음 판정 수·판정이 갈리는 모델 수. 메모리는 이름에 붙여 밝힌다 */
export function compareDescription(t: Pick<CompareTranslators, 'compare' | 'names'>, locale: string, cmp: GpuComparison, names: CompareNames): string {
  let speed: string;
  if (!cmp.speed) speed = t.compare('metaSpeedNone');
  else {
    const fs = fasterSlower(locale, names, cmp.speed.ratio);
    speed = fs ? t.compare('metaSpeedFaster', fs) : t.compare('metaSpeedSame', names);
  }
  return (
    speed +
    t.compare('metaCounts', {
      total: cmp.rows.length,
      a: compareNameWithMemory(t, locale, cmp.a),
      b: compareNameWithMemory(t, locale, cmp.b),
      goodA: good(cmp.a),
      goodB: good(cmp.b),
      differ: cmp.differing,
    })
  );
}

/** 목차 카드의 속도 줄 */
export function cardSpeedText(t: Pick<CompareTranslators, 'compare'>, locale: string, cmp: GpuComparison, names: CompareNames): string | undefined {
  if (!cmp.speed) return undefined;
  const fs = fasterSlower(locale, names, cmp.speed.ratio);
  return fs ? t.compare('cardFaster', { faster: fs.faster, ratio: fs.ratio }) : t.compare('cardSame');
}

/** 그 구성의 메모리 표기 — GPU 허브 요약과 같은 규칙("16 GB" / "64 GB of unified memory" / "96 GB of RAM") */
export function sideMemoryLabel(t: Pick<CompareTranslators, 'hub'>, locale: string, side: CompareSide): string {
  if (side.gpu.kind === 'dgpu') return t.hub('memoryVram', { vram: formatInt(locale, side.gpu.vramGB ?? 0) });
  const max = formatInt(locale, side.config.ramGB);
  return side.gpu.kind === 'cpu' ? t.hub('memoryRamOne', { max }) : t.hub('memoryUnifiedOne', { max });
}

/** "가장 큰 모델"의 정의 — GPU 허브와 같다(그래픽카드·통합 메모리 = 전부 올라가는 가장 큰 모델, CPU = 돌아가는 가장 큰 모델) */
export function largestPick(side: CompareSide): ComboPick | undefined {
  return side.gpu.kind === 'cpu' ? side.largestRunnable : side.largestFullGpu;
}

/** 기준 모델 pp — 두 기기 모두 대략 ±40% 범위로, 추정이 없는 쪽은 그 이유 */
export function ppSummary(t: CompareTranslators, locale: string, cmp: GpuComparison, names: CompareNames): string | undefined {
  const speed = cmp.speed;
  if (!speed || (!speed.pp.a && !speed.pp.b)) return undefined;
  const sideText = (gpu: string, r: typeof speed.pp.a) =>
    r ? t.compare('ppSide', { gpu, pp: ppPhrase(t.combo, t.confidence, locale, r) }) : t.compare('ppSideNone', { gpu });
  return [sideText(names.a, speed.pp.a), sideText(names.b, speed.pp.b)].join(t.compare('listSeparator'));
}

/** FAQ 3문항 — 속도(배율 + 두 기기의 기준 모델 속도) · 각자 전부 올라가는 가장 큰 모델 · 판정 수와 갈리는 모델 수 */
export function compareFaq(t: CompareTranslators, locale: string, cmp: GpuComparison, names: CompareNames): QA[] {
  const modelName = (id: string) => cmp.rows.find((r) => r.model.id === id)?.model.name ?? id;
  const items: QA[] = [];

  // Q1 — 속도
  let speedAnswer = speedSentence(t, locale, cmp, names);
  if (cmp.speed) {
    const ref = cmp.speed.reference;
    speedAnswer += t.compare('faqSpeedRef', {
      model: ref.model.name,
      quant: ref.a.baseline.quant,
      a: names.a,
      speedA: speedPhrase(t.common, t.confidence, locale, ref.a.baseline),
      b: names.b,
      speedB: speedPhrase(t.common, t.confidence, locale, ref.b.baseline),
    });
  }
  items.push({ question: t.compare('faqSpeedQ', names), answer: speedAnswer });

  // Q2 — 각자 전부 올라가는 가장 큰 모델 (GPU 허브 FAQ Q1 과 같은 값)
  const largest = (side: CompareSide, name: string) => {
    const pick = largestPick(side);
    const memory = sideMemoryLabel(t, locale, side);
    return pick
      ? t.compare('faqLargestSide', {
          gpu: name,
          model: modelName(pick.combo.modelId),
          quant: pick.q.quant,
          size: formatGB(locale, pick.q.fileGB, 2),
          memory,
          speed: speedPhrase(t.common, t.confidence, locale, pick.q),
        })
      : t.compare('faqLargestSideNone', { gpu: name, total: cmp.rows.length, memory });
  };
  items.push({ question: t.compare('faqLargestQ'), answer: `${largest(cmp.a, names.a)} ${largest(cmp.b, names.b)}` });

  // Q3 — 판정 수
  const counts = (side: CompareSide, name: string) =>
    t.compare('countsSide', { gpu: name, great: side.counts.S, well: side.counts.A, slow: side.counts.B, none: side.counts.F });
  items.push({
    question: t.compare('faqCountQ'),
    answer: t.compare('faqCountA', {
      total: cmp.rows.length,
      countsA: counts(cmp.a, names.a),
      countsB: counts(cmp.b, names.b),
      differ: cmp.differing,
    }),
  });
  return items;
}
