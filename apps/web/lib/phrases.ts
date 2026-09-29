/**
 * 수치 문장 조립 — 표·FAQ·메타 description·JSON-LD 가 **같은 문자열**을 쓰도록 한 곳에서 만든다.
 * 모든 속도 문장은 est. + 밴드 + 신뢰 라벨을 동반한다 (CLAUDE.md 규칙 3).
 */
import type { Mode, Result } from '@canrun/engine';
import type { ComboAssessment, GpuCore, MeasuredJoin, QuantAssessment } from '@canrun/data/client';
import { formatCtx, formatGB, formatInt, formatSpeed, formatTokS } from './format';

/** next-intl translator 의 최소 형태 (네임스페이스가 이미 바인딩된 t) */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** 실측 컨텍스트 표기 ("2k" / "2k/4k") — 추정의 기준 8k 와 조건이 다름을 밝힌다 */
export function measuredCtx(measured: MeasuredJoin | undefined): string {
  const ctxs = [...new Set((measured?.points ?? []).map((bp) => bp.ctx))].sort((a, b) => a - b);
  return ctxs.map(formatCtx).join('/');
}

export function confidenceText(
  tConfidence: Translate,
  result: Result,
  measured?: MeasuredJoin,
): string {
  if (result.confidence === 'measured') {
    return tConfidence('measured', {
      n: measured?.values.length ?? 1,
      ctx: measuredCtx(measured),
    });
  }
  return tConfidence(result.confidence, { band: formatSpeed('en', result).band });
}

/**
 * "est. 41.8 tok/s (36.8–46.8, calibrated estimate ±12%)" / 실측이면 측정 컨텍스트 + 8k 추정 밴드·라벨 병기
 */
export function speedPhrase(
  tCommon: Translate,
  tConfidence: Translate,
  locale: string,
  q: Pick<QuantAssessment, 'result' | 'estimate' | 'measured'>,
): string {
  if (q.result.confidence === 'measured') {
    const estimate = formatSpeed(locale, q.estimate);
    return tCommon('speedMeasured', {
      est: formatTokS(locale, q.result.tgTokS.est),
      ctx: measuredCtx(q.measured),
      n: q.measured?.values.length ?? 1,
      estEst: estimate.est,
      estLow: estimate.low,
      estHigh: estimate.high,
      label: confidenceText(tConfidence, q.estimate),
    });
  }
  const s = formatSpeed(locale, q.result);
  return tCommon('speedEst', {
    est: s.est,
    low: s.low,
    high: s.high,
    label: confidenceText(tConfidence, q.result),
  });
}

/** quant 표기 — desperate 티어(2비트)는 "품질 손실 큼" 을 붙인다 (docs/01 §3) */
export function quantText(tHint: Translate, q: Pick<QuantAssessment, 'quant' | 'tier'>): string {
  return q.tier === 'desperate' ? tHint('quantDesperate', { quant: q.quant }) : q.quant;
}

/** 실행 방식 라벨 — 통합 메모리의 full-gpu 는 "통합 메모리" */
export function modeKey(mode: Mode, gpuKind: GpuCore['kind']): string {
  switch (mode) {
    case 'full-gpu':
      return gpuKind === 'unified' ? 'fullUnified' : 'fullGpu';
    case 'cpu-moe':
      return 'cpuMoe';
    case 'partial-offload':
      return 'partialOffload';
    case 'cpu-only':
      return 'cpuOnly';
  }
}

/** GPU 표시 이름 — CPU 프로필처럼 설명형 이름은 messages 오버라이드 (규칙 4) */
export function gpuName(
  tGpuName: Translate & { has?: (key: string) => boolean },
  gpu: Pick<GpuCore, 'id' | 'name'>,
): string {
  return tGpuName.has?.(gpu.id) ? tGpuName(gpu.id) : gpu.name;
}

/** 메모리 셀 — "7.2 / 8 GB" · "+ RAM" · "RAM 6.0 GB" · 미탑재 "needs N GB" (허브 표·계산기 카드 공용) */
export function memoryText(
  tMemory: Translate,
  locale: string,
  q: Pick<QuantAssessment, 'memory' | 'result' | 'fReason'>,
  gpu: Pick<GpuCore, 'kind' | 'vramGB'>,
): string {
  const m = q.memory;
  if (q.fReason === 'no-fit') return tMemory('need', { need: formatGB(locale, m.needGB) });
  const total = gpu.kind === 'dgpu' ? (gpu.vramGB ?? 0) : m.gpuUsableGB;
  switch (q.result.mode) {
    case 'full-gpu':
      return tMemory('gpu', { used: formatGB(locale, m.gpuGB), total: formatGB(locale, total) });
    case 'cpu-moe':
    case 'partial-offload':
      return tMemory('gpuPlusRam', {
        used: formatGB(locale, m.gpuGB),
        total: formatGB(locale, total),
        ram: formatGB(locale, m.ramGB),
      });
    case 'cpu-only':
      return tMemory('ram', { ram: formatGB(locale, m.ramGB) });
  }
}

/** 미탑재 사유 — 필요량과 가용량을 함께 (docs/01 §3 "필요 메모리 vs 가용") */
export function noFitText(
  tReason: Translate,
  locale: string,
  q: Pick<QuantAssessment, 'memory'>,
  gpuKind: GpuCore['kind'],
): string {
  const m = q.memory;
  const need = formatGB(locale, m.needGB);
  if (gpuKind === 'dgpu') {
    return tReason('noFitDgpu', {
      need,
      gpu: formatGB(locale, m.gpuUsableGB),
      ram: formatGB(locale, m.ramUsableGB),
    });
  }
  if (gpuKind === 'unified') {
    return tReason('noFitUnified', {
      need,
      ram: formatGB(locale, m.ramUsableGB),
      gpu: formatGB(locale, m.gpuUsableGB),
    });
  }
  return tReason('noFitCpu', { need, ram: formatGB(locale, m.ramUsableGB) });
}

export type NoteTranslators = {
  reason: Translate;
  hint: Translate;
  verdict: Translate;
  common: Translate;
};

/** 판정 사유(실제로 걸린 규칙)·추천·최후 수단·RAM 힌트 (결정 D4) — 허브 표 `Notes`·계산기 카드 공용 */
export function noteLines(
  t: NoteTranslators,
  locale: string,
  combo: Pick<ComboAssessment, 'display' | 'recommended' | 'lastResort' | 'ramHint' | 'reasoning'>,
  gpuKind: GpuCore['kind'],
  showReasoning: boolean,
): string[] {
  const q = combo.display;
  const lines: string[] = [];

  if (q.fReason === 'no-fit') {
    lines.push(noFitText(t.reason, locale, q, gpuKind));
  } else if (q.fReason === 'too-slow') {
    lines.push(t.reason('tooSlow'));
  } else if (q.verdictReason === 'cap-full-gpu-only') {
    lines.push(t.reason('capFullGpuOnly'));
  } else if (q.verdictReason === 'cap-partial') {
    lines.push(t.reason('capPartial'));
  } else if (q.verdictReason === 'cap-cpu-moe') {
    lines.push(t.reason('capCpuMoe', { min: formatInt(locale, q.capMinTokS ?? 0) }));
  } else if (q.verdictReason === 'cap-cpu-only') {
    lines.push(t.reason('capCpuOnly'));
  }
  if (combo.recommended && combo.recommended.quant !== q.quant) {
    lines.push(
      t.hint(combo.recommended.tier === 'desperate' ? 'recommendedDesperate' : 'recommended', {
        quant: combo.recommended.quant,
        verdict: t.verdict(combo.recommended.result.verdict),
      }),
    );
  }
  if (combo.lastResort) {
    lines.push(
      t.hint('lastResort', {
        quant: combo.lastResort.quant,
        verdict: t.verdict(combo.lastResort.result.verdict),
      }),
    );
  }
  if (combo.ramHint) {
    lines.push(
      t.hint('ramHint', { ram: formatInt(locale, combo.ramHint.ramGB), verdict: t.verdict(combo.ramHint.verdict) }),
    );
  }
  if (showReasoning && combo.reasoning) lines.push(t.common('reasoningMark'));
  return lines;
}

/**
 * 제목용 짧은 GPU 이름 (결정 D14): 브랜드 접두를 떼고 "(N-core GPU)" 를 "N-core" 로.
 * 콤보 제목이 SERP 폭 안에 들어가도록 — 본문·허브는 전체 이름을 쓴다.
 */
export function shortGpuName(name: string): string {
  return name
    .replace(/^(?:GeForce|Radeon|Intel|NVIDIA|Apple)\s+/, '')
    .replace(/\s*\((\d+)-core GPU\)/, ' $1-core')
    // 마케팅 괄호명("(Strix Halo)")과 "dual-channel"은 제목에서 뺀다 — h1·본문은 전체 이름
    .replace(/\s*\([^)]*\)/, '')
    .replace(/\s+(?:dual-channel|듀얼채널)\s+CPU$/, ' CPU');
}
